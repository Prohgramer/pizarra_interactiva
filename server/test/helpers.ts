import { once } from 'node:events';
import { randomUUID, getRandomValues } from 'node:crypto';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {
  TICKET_PARAM,
  createRoomId,
  createUndoManager,
  decodeUpdate,
  encodeUpdate,
  isEmptyUpdate,
  readNotes,
  roomSocketPath,
  type BoardNote,
  type InitMessage,
  type Note,
  type AuthResponse,
  type ServerMessage,
  type ServerMessageType,
  type TicketResponse,
  type User,
} from '@pizarra/shared';
import { Accounts, PostgresAccounts } from '../src/accounts';
import { createPgDatabase, type Database, type Sql } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { createBoardServer, type BoardServer, type BoardServerOptions } from '../src/server';
import { PostgresStore } from '../src/store/postgres';
import type { RoomStore, StoredRoom } from '../src/store/types';

export const TEST_ORIGIN = 'http://localhost:5173';

export const makeRoomId = () => createRoomId((bytes) => getRandomValues(bytes));

export interface RunningServer {
  server: BoardServer;
  /** URL WebSocket de una sala nueva, distinta para cada servidor. */
  wsUrl: string;
  /** URL WebSocket de la sala indicada, con la identidad (`?name=&color=&ticket=`) si se pasa. */
  roomUrl: (roomId: string, identity?: { name?: string; color?: string; ticket?: string }) => string;
  httpUrl: string;
  /** Cliente de la API HTTP del servidor. */
  api: ApiClient;
  /** URL de la sala con un ticket recién pedido para esa sesión. */
  roomUrlAs: (roomId: string, token: string) => Promise<string>;
}

/** Tiempos cortos para que las pruebas de persistencia no esperen segundos. */
export const FAST_TIMINGS = { flushDelayMs: 20, retryDelayMs: 40, idleTtlMs: 0 } as const;

export async function startServer(options: Partial<BoardServerOptions> = {}): Promise<RunningServer> {
  const server = createBoardServer({ port: 0, host: '127.0.0.1', allowedOrigins: [TEST_ORIGIN], ...options });
  const port = await server.listen();
  const roomUrl: RunningServer['roomUrl'] = (roomId, identity = {}) => {
    const query = new URLSearchParams();
    if (identity.name !== undefined) query.set('name', identity.name);
    if (identity.color !== undefined) query.set('color', identity.color);
    if (identity.ticket !== undefined) query.set(TICKET_PARAM, identity.ticket);
    const search = query.size > 0 ? `?${query}` : '';
    return `ws://127.0.0.1:${port}${roomSocketPath(roomId)}${search}`;
  };
  const httpUrl = `http://127.0.0.1:${port}`;
  const api = createApiClient(httpUrl);
  return {
    server,
    wsUrl: roomUrl(makeRoomId()),
    roomUrl,
    httpUrl,
    api,
    roomUrlAs: async (roomId, token) => {
      const { status, body } = await api.post('/auth/ticket', undefined, token);
      assert.equal(status, 200, 'no se pudo pedir el ticket');
      return roomUrl(roomId, { ticket: (body as TicketResponse).ticket });
    },
  };
}

/**
 * Servidor con base de datos y cuentas, como en producción. Con `db` reutiliza
 * una base ya creada (las pruebas comparten una por archivo y la vacían entre
 * casos: levantar PGlite en cada prueba cuesta segundos).
 */
export async function startServerWithAccounts(
  options: Partial<BoardServerOptions> & { db?: Database } = {},
): Promise<RunningServer & { db: Database; accounts: Accounts }> {
  const db = options.db ?? (await createTestDatabase());
  await migrate(db);
  const accounts = options.accounts ?? new Accounts(new PostgresAccounts(db));
  const running = await startServer({ store: new PostgresStore(db), ...FAST_TIMINGS, ...options, accounts });
  return { ...running, db, accounts };
}

/* ───────────── Cliente de la API HTTP ───────────── */

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export interface ApiClient {
  request<T = unknown>(method: string, path: string, body?: unknown, token?: string): Promise<ApiResponse<T>>;
  get<T = unknown>(path: string, token?: string): Promise<ApiResponse<T>>;
  post<T = unknown>(path: string, body?: unknown, token?: string): Promise<ApiResponse<T>>;
  patch<T = unknown>(path: string, body?: unknown, token?: string): Promise<ApiResponse<T>>;
  del<T = unknown>(path: string, token?: string): Promise<ApiResponse<T>>;
}

export function createApiClient(httpUrl: string): ApiClient {
  const request: ApiClient['request'] = async (method, path, body, token) => {
    const response = await fetch(`${httpUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  return {
    request,
    get: (path, token) => request('GET', path, undefined, token),
    post: (path, body, token) => request('POST', path, body, token),
    patch: (path, body, token) => request('PATCH', path, body, token),
    del: (path, token) => request('DELETE', path, undefined, token),
  };
}

let accountCount = 0;

/** Crea una cuenta y devuelve su sesión. El correo es distinto en cada llamada. */
export async function signUp(
  api: ApiClient,
  overrides: { email?: string; name?: string; password?: string } = {},
): Promise<{ user: User; token: string }> {
  accountCount += 1;
  const input = {
    email: overrides.email ?? `persona${accountCount}.${process.pid}@ejemplo.test`,
    name: overrides.name ?? `Persona ${accountCount}`,
    password: overrides.password ?? 'contraseña-larga',
  };
  const { status, body } = await api.post<AuthResponse>('/auth/register', input);
  assert.equal(status, 201, `no se pudo crear la cuenta: ${JSON.stringify(body)}`);
  return { user: body.user, token: body.token };
}

/** Vacía las tablas entre pruebas, dejando el esquema (y sus migraciones) como está. */
export async function resetData(db: Database): Promise<void> {
  await db.exec('TRUNCATE users, sessions, rooms, room_members, notes CASCADE');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reintenta `check` hasta que no lance o se agote el tiempo. */
export async function eventually(check: () => void | Promise<void>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await delay(15);
    }
  }
}

/* ───────────── Base de datos de prueba ───────────── */

function fromPglite(db: Pick<PGlite, 'query' | 'exec'>): Sql {
  return {
    query: async <Row>(text: string, params?: unknown[]) => db.query<Row>(text, params),
    exec: async (text) => {
      await db.exec(text);
    },
  };
}

/**
 * PostgreSQL para pruebas. Por defecto, PGlite: el Postgres real compilado a
 * WASM, en el mismo proceso, sin instalar nada. Con TEST_DATABASE_URL se usa
 * esa base a través del driver `pg`, dentro de un esquema propio y temporal:
 * los archivos de prueba corren en paralelo y así no se pisan, y no se toca
 * nada fuera de ese esquema.
 */
export async function createTestDatabase(): Promise<Database> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const schema = `pizarra_test_${process.pid}_${randomUUID().slice(0, 8)}`;
    const admin = createPgDatabase(url, () => {});
    await admin.exec(`CREATE SCHEMA "${schema}"`);
    await admin.close();

    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    const db = createPgDatabase(scoped.toString(), () => {});
    return {
      ...db,
      close: async () => {
        await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
        await db.close();
      },
    };
  }

  const pglite = new PGlite();
  return {
    ...fromPglite(pglite),
    transaction: (fn) => pglite.transaction((tx) => fn(fromPglite(tx))),
    close: () => pglite.close(),
  };
}

/* ───────────── Almacenes de prueba ───────────── */

/**
 * Envuelve un almacén para contar escrituras y simular fallos: mientras
 * `failing` sea true, `load` o `save` lanzan error.
 */
export class FlakyStore implements RoomStore {
  readonly inner: RoomStore;
  failing: { load?: boolean; save?: boolean } = {};
  readonly saves: Array<{ roomId: string; state: Uint8Array }> = [];

  constructor(inner: RoomStore) {
    this.inner = inner;
  }

  get kind() {
    return this.inner.kind;
  }

  load(roomId: string): Promise<StoredRoom | null> {
    if (this.failing.load) return Promise.reject(new Error('base de datos caída (simulado)'));
    return this.inner.load(roomId);
  }

  async save(roomId: string, state: Uint8Array): Promise<void> {
    if (this.failing.save) throw new Error('base de datos caída (simulado)');
    await this.inner.save(roomId, state);
    this.saves.push({ roomId, state });
  }

  ping(): Promise<void> {
    return this.failing.load ? Promise.reject(new Error('caída')) : this.inner.ping();
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

type MessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

interface Waiter {
  types: readonly ServerMessageType[];
  resolve: (message: ServerMessage) => void;
}

/**
 * Cliente de prueba: guarda cada mensaje recibido en una bandeja y permite
 * esperar el siguiente de un tipo, o comprobar que no llegó ninguno.
 */
export class TestClient {
  readonly #ws: WebSocket;
  readonly #inbox: ServerMessage[] = [];
  #waiters: Waiter[] = [];

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on('message', (data) => {
      this.#inbox.push(JSON.parse(data.toString()) as ServerMessage);
      this.#deliver();
    });
  }

  static async connect(url: string, options: WebSocket.ClientOptions = {}): Promise<TestClient> {
    const ws = new WebSocket(url, { origin: TEST_ORIGIN, ...options });
    const client = new TestClient(ws);
    await once(ws, 'open');
    return client;
  }

  /** Conecta y consume el `init` inicial. */
  static async join(url: string): Promise<{ client: TestClient; init: MessageOf<'init'> }> {
    const client = await TestClient.connect(url);
    const init = await client.next('init');
    return { client, init };
  }

  get socket(): WebSocket {
    return this.#ws;
  }

  #deliver(): void {
    this.#waiters = this.#waiters.filter((waiter) => {
      const index = this.#inbox.findIndex((message) => waiter.types.includes(message.type));
      if (index === -1) return true;
      const [message] = this.#inbox.splice(index, 1);
      waiter.resolve(message as ServerMessage);
      return false;
    });
  }

  /** Devuelve (y consume) el próximo mensaje del tipo indicado. */
  next<T extends ServerMessageType>(type: T, timeoutMs = 1000): Promise<MessageOf<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((waiter) => waiter !== entry);
        reject(new Error(`No llegó ningún mensaje «${type}» en ${timeoutMs} ms.`));
      }, timeoutMs);
      const entry: Waiter = {
        types: [type],
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message as MessageOf<T>);
        },
      };
      this.#waiters.push(entry);
      this.#deliver();
    });
  }

  /** Espera un momento y devuelve los mensajes sin consumir de esos tipos. */
  async unexpected(types: readonly ServerMessageType[], waitMs = 150): Promise<ServerMessage[]> {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.#inbox.filter((message) => types.includes(message.type));
  }

  send(message: unknown): void {
    this.#ws.send(JSON.stringify(message));
  }

  sendRaw(data: string | Buffer, options: { binary?: boolean } = {}): void {
    this.#ws.send(data, { binary: options.binary ?? false });
  }

  async close(): Promise<void> {
    if (this.#ws.readyState === WebSocket.CLOSED) return;
    const closed = once(this.#ws, 'close');
    this.#ws.close();
    await closed;
  }
}

/** Mensajes que produce un cambio del documento. */
export const DOC_EVENTS: readonly ServerMessageType[] = ['doc:updated'];

/** Todos los mensajes de presencia de otras personas. */
export const PEER_EVENTS: readonly ServerMessageType[] = [
  'peer:joined',
  'peer:left',
  'peer:renamed',
  'peer:cursor',
  'peer:focus',
];

export function makeNote(overrides: Partial<Note> = {}): Note {
  return { id: randomUUID(), x: 100, y: 120, text: '', color: 'yellow', rotation: 1.5, ...overrides };
}

/* ───────────── Cliente Yjs de prueba ───────────── */

/** Origen de los updates que llegan del servidor (para no reenviarlos). */
const REMOTE = Symbol('remoto');
/** Origen de los cambios propios, el que sigue el gestor de deshacer. */
const LOCAL = Symbol('local');

/**
 * Cliente de prueba con su propio documento Yjs. Sincroniza igual que el
 * cliente real: aplica el estado del `init` y responde con lo que el servidor
 * no tenía (sus cambios sin conexión). Los cambios en vivo se envían al
 * instante, sin throttle.
 */
export class YClient {
  readonly doc = new Y.Doc();
  client!: TestClient;
  init!: InitMessage;
  #online = false;
  #undo: Y.UndoManager | null = null;

  /** Gestor de deshacer, configurado como el del cliente real. */
  get undo(): Y.UndoManager {
    this.#undo ??= createUndoManager(this.doc, LOCAL);
    return this.#undo;
  }

  static async join(url: string): Promise<YClient> {
    const yclient = new YClient();
    await yclient.connect(url);
    return yclient;
  }

  get online(): boolean {
    return this.#online;
  }

  async connect(url: string): Promise<void> {
    const { client, init } = await TestClient.join(url);
    this.client = client;
    this.init = init;
    this.#online = true;

    const serverState = decodeUpdate(init.doc);
    Y.applyUpdate(this.doc, serverState, REMOTE);
    const diff = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVectorFromUpdate(serverState));
    if (!isEmptyUpdate(diff)) this.sendUpdate(diff);
  }

  /** Hace cambios locales en una transacción y, si hay conexión, los envía como un update. */
  change(fn: (doc: Y.Doc) => void): Uint8Array {
    return this.run(() => this.doc.transact(() => fn(this.doc), LOCAL));
  }

  /**
   * Ejecuta algo que cambia el documento con sus propias transacciones (como
   * deshacer) y envía el resultado. No lo envuelve en una transacción: Yjs
   * ignoraría el origen de las de adentro y el gestor de deshacer no las vería.
   */
  run(fn: () => void): Uint8Array {
    const updates: Uint8Array[] = [];
    const collect = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) updates.push(update);
    };
    this.doc.on('update', collect);
    fn();
    this.doc.off('update', collect);

    const update = Y.mergeUpdates(updates);
    if (this.#online && updates.length > 0) this.sendUpdate(update);
    return update;
  }

  sendUpdate(update: Uint8Array): void {
    this.client.send({ type: 'doc:update', update: encodeUpdate(update) });
  }

  /** Espera el próximo `doc:updated` y lo aplica. */
  async receive(timeoutMs?: number): Promise<void> {
    const { update } = await this.client.next('doc:updated', timeoutMs);
    Y.applyUpdate(this.doc, decodeUpdate(update), REMOTE);
  }

  notes(): BoardNote[] {
    return readNotes(this.doc);
  }

  async disconnect(): Promise<void> {
    this.#online = false;
    await this.client.close();
  }
}

/** Notas de un estado codificado (p. ej. el que guardó el almacén o el de un `init`). */
export function notesOf(state: Uint8Array | string): BoardNote[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, typeof state === 'string' ? decodeUpdate(state) : state);
  const notes = readNotes(doc);
  doc.destroy();
  return notes;
}

/** Una nota como la devuelve readNotes (con su orden de apilamiento). */
export function asBoardNote(note: Note, z: number): BoardNote {
  return { ...note, z };
}
