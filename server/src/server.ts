import http from 'node:http';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  DOC_LIMITS,
  FORBIDDEN_CLOSE_CODE,
  HEARTBEAT_INTERVAL_MS,
  MAX_PAYLOAD_BYTES,
  MESSAGE_BURST,
  MESSAGE_RATE_PER_SECOND,
  OPEN_ACCESS,
  RESET_CLOSE_CODE,
  ROOM_SOCKET_PREFIX,
  decodeUpdate,
  encodeUpdate,
  isRoomId,
  type ClientMessage,
  type ErrorCode,
  type RoomAccess,
  type ServerMessage,
  type User,
} from '@pizarra/shared';
import type { Accounts } from './accounts';
import type { AllowedOrigins } from './config';
import { createApi } from './http/api';
import { applyCors } from './http/respond';
import { RateLimiter } from './rate-limit';
import { RoomManager, type DocLimits, type Room, type RoomTimings } from './rooms';
import { MemoryStore } from './store/memory';
import type { RoomStore } from './store/types';
import { parseClientMessage, parseIdentity, type RequestedIdentity } from './validation';

export interface BoardServerOptions extends Partial<RoomTimings> {
  port: number;
  host?: string;
  allowedOrigins: AllowedOrigins;
  /** Dónde se guardan las salas; por defecto, en memoria. */
  store?: RoomStore;
  /** Cuentas y permisos. Sin esto, todos los tableros son públicos y sin dueño. */
  accounts?: Accounts | null;
  heartbeatIntervalMs?: number;
  /** Límites del documento (por defecto, DOC_LIMITS); las pruebas los achican. */
  limits?: DocLimits;
  log?: (message: string) => void;
}

export interface BoardServer {
  readonly httpServer: http.Server;
  readonly rooms: RoomManager;
  /** Empieza a escuchar y devuelve el puerto real (útil con `port: 0`). */
  listen(): Promise<number>;
  /** Cierra las conexiones y guarda todas las salas. No cierra el almacén. */
  close(): Promise<void>;
}

export const DEFAULT_TIMINGS: RoomTimings = {
  flushDelayMs: 1000,
  retryDelayMs: 5000,
  idleTtlMs: 30_000,
};

/** Si un cliente acumula más que esto sin leer, es demasiado lento y se lo desconecta. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

/** Lo que el servidor recuerda de cada conexión abierta. */
interface Connection {
  room: Room;
  /** Id de presencia, que además identifica a la conexión en el límite de mensajes. */
  peerId: string;
  /** La cuenta de quien se conectó, o null si entró por el enlace sin identificarse. */
  user: User | null;
  access: RoomAccess;
  /** Ya se está anotando que esta persona es la dueña: no hace falta repetirlo. */
  claiming?: boolean;
}

export function isOriginAllowed(origin: string | undefined, allowed: AllowedOrigins): boolean {
  if (allowed === '*') return true;
  // Los navegadores siempre envían Origin; sin él no podemos comprobar nada.
  if (!origin) return false;
  return allowed.includes(origin);
}

/** Extrae el id de sala de `/rooms/<id>`; null si la ruta no es de una sala válida. */
export function roomIdFromUrl(url: string | undefined): string | null {
  const { pathname } = new URL(url ?? '/', 'http://localhost');
  if (!pathname.startsWith(ROOM_SOCKET_PREFIX)) return null;
  const roomId = pathname.slice(ROOM_SOCKET_PREFIX.length);
  return isRoomId(roomId) ? roomId : null;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function toText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

export function createBoardServer(options: BoardServerOptions): BoardServer {
  const log = options.log ?? (() => {});
  const store = options.store ?? new MemoryStore();
  const rooms = new RoomManager({
    store,
    limits: options.limits ?? DOC_LIMITS,
    flushDelayMs: options.flushDelayMs ?? DEFAULT_TIMINGS.flushDelayMs,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_TIMINGS.retryDelayMs,
    idleTtlMs: options.idleTtlMs ?? DEFAULT_TIMINGS.idleTtlMs,
    log,
  });
  const alive = new WeakMap<WebSocket, boolean>();
  const accounts = options.accounts ?? null;
  /** Quién es y qué puede hacer cada conexión abierta. */
  const connections = new WeakMap<WebSocket, Connection>();
  /** Mensajes por conexión: una ráfaga corta pasa, una inundación no. */
  const messageRate = new RateLimiter({ capacity: MESSAGE_BURST, refillPerSecond: MESSAGE_RATE_PER_SECOND });
  let closing = false;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  const api = createApi({
    accounts,
    allowedOrigins: options.allowedOrigins,
    onAccessChanged: (roomId) => void refreshAccess(roomId),
    log,
  });

  const httpServer = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (await api(req, res)) return;
    } catch (error) {
      log(`Error atendiendo ${req.method} ${pathname}: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Error del servidor.' } }));
      return;
    }

    applyCors(req, res, options.allowedOrigins);
    if (req.method === 'GET' && pathname === '/health') {
      let healthy = true;
      try {
        await store.ping();
      } catch {
        healthy = false;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(
        JSON.stringify({
          status: healthy ? 'ok' : 'degraded',
          storage: store.kind,
          accounts: accounts !== null,
          ...rooms.stats(),
        }),
      );
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'No encontrado' }));
  });

  // El upgrade se maneja a mano: se valida origen y sala, y se carga la sala
  // antes del handshake, así la conexión recibe el `init` en cuanto abre.
  httpServer.on('upgrade', (req, socket, head) => {
    void handleUpgrade(req, socket, head);
  });

  async function handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on('error', () => {}); // un cliente que corta a mitad del handshake no debe tirar el proceso

    const origin = req.headers.origin;
    if (!isOriginAllowed(origin, options.allowedOrigins)) {
      log(`Conexión rechazada: origen no permitido (${origin ?? 'sin origen'}).`);
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    const roomId = roomIdFromUrl(req.url);
    if (!roomId) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    const identity = parseIdentity(req.url);

    if (closing) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    // El ticket es de un solo uso: si venció o ya se usó, el cliente pide otro
    // y reintenta (mejor que dejarlo entrar como si no tuviera cuenta).
    let user: User | null = null;
    if (accounts && identity.ticket !== undefined) {
      user = await accounts.consumeTicket(identity.ticket);
      if (!user) {
        log('Conexión rechazada: ticket vencido o ya usado.');
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
    }

    let access: RoomAccess = OPEN_ACCESS;
    if (accounts) {
      const resolved = await accounts.accessFor(roomId, user);
      if (!resolved) {
        log(`Conexión rechazada: ${user ? user.email : 'alguien sin cuenta'} no puede entrar a ${roomId}.`);
        rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }
      access = resolved;
    }
    // Con cuenta, el nombre que ven las demás personas es el de la cuenta.
    const presence: RequestedIdentity = user ? { ...identity, name: user.name } : identity;

    let room: Room;
    try {
      room = await rooms.acquire(roomId);
    } catch {
      // Base de datos caída o servidor cerrándose: el cliente reintentará con backoff.
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    // El cliente se fue mientras se cargaba la sala.
    if (socket.destroyed) {
      rooms.release(room);
      return;
    }

    // Si el handshake no llega a completarse, la referencia se libera al cerrarse el socket.
    let attached = false;
    socket.once('close', () => {
      if (!attached) rooms.release(room);
    });

    wss.handleUpgrade(req, socket, head, (ws) => {
      attached = true;
      onConnection(ws, room, presence, user, access);
    });
  }

  function send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  /** Envía a todos los clientes de la sala menos a `except` (normalmente, el emisor). */
  function broadcast(room: Room, message: ServerMessage, except?: WebSocket): void {
    const payload = JSON.stringify(message);
    for (const client of room.clients.keys()) {
      if (client === except || client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        log('Cliente demasiado lento: se cierra la conexión.');
        client.terminate();
        continue;
      }
      client.send(payload);
    }
  }

  function sendError(ws: WebSocket, code: ErrorCode, message: string): void {
    send(ws, { type: 'error', code, message });
  }

  /** Estado completo de la sala para `ws`, al conectar. */
  function sendInit(room: Room, ws: WebSocket, access: RoomAccess): void {
    const self = room.clients.get(ws);
    if (!self) return;
    const { id, name, color } = self;
    send(ws, {
      type: 'init',
      doc: encodeUpdate(room.encodeState()),
      self: { id, name, color },
      peers: room.peers(ws),
      access,
    });
  }

  /**
   * El tablero todavía no tiene dueño y quien escribe tiene cuenta: pasa a ser
   * suyo. Se guarda en el momento (en vez de esperar al volcado en lote) para
   * poder confirmárselo enseguida: la interfaz le ofrece elegir quién entra.
   */
  async function claimRoom(connection: Connection, ws: WebSocket): Promise<void> {
    const { user, room } = connection;
    if (!accounts || !user || !connection.access.ownerless || connection.claiming) return;
    connection.claiming = true;
    room.claimBy(user.id);
    try {
      await room.flush();
      const next = await accounts.accessFor(room.id, user);
      if (next) {
        connection.access = next;
        send(ws, { type: 'access', access: next });
      }
      await refreshAccess(room.id);
    } catch (error) {
      // Si no se pudo guardar, se reintenta con el próximo cambio.
      connection.claiming = false;
      log(`No se pudo anotar el dueño de ${room.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * El dueño cambió quién puede entrar: se vuelve a resolver el permiso de
   * cada conexión abierta de esa sala. Quien deja de poder mirar se va; a
   * quien cambia de rol se le avisa para que la interfaz se ajuste sola.
   */
  async function refreshAccess(roomId: string): Promise<void> {
    const room = rooms.peek(roomId);
    if (!room || !accounts) return;
    for (const ws of [...room.clients.keys()]) {
      const connection = connections.get(ws);
      if (!connection) continue;
      const next = await accounts.accessFor(roomId, connection.user);
      if (!next) {
        ws.close(FORBIDDEN_CLOSE_CODE, 'Ya no puedes entrar a este tablero');
        continue;
      }
      const before = connection.access;
      if (
        next.role === before.role &&
        next.canWrite === before.canWrite &&
        next.visibility === before.visibility &&
        next.ownerless === before.ownerless
      ) {
        continue;
      }
      connection.access = next;
      send(ws, { type: 'access', access: next });
    }
  }

  function apply(connection: Connection, ws: WebSocket, message: ClientMessage): void {
    const { room } = connection;
    const peer = room.clients.get(ws);
    if (!peer) return;

    switch (message.type) {
      case 'doc:update': {
        if (!connection.access.canWrite) {
          sendError(ws, 'FORBIDDEN', 'En este tablero solo puedes mirar.');
          return;
        }
        const result = room.applyUpdate(decodeUpdate(message.update));
        if (!result.ok) {
          // Un update de CRDT no se puede deshacer en el cliente, y sus updates
          // siguientes dependen de este: se le pide que descarte su copia y se resincronice.
          log(`Update rechazado en la sala ${room.id}: ${result.problem.reason}`);
          sendError(ws, result.problem.code, result.problem.reason);
          ws.close(RESET_CLOSE_CODE, 'Documento rechazado');
          return;
        }
        if (result.changed) {
          // El primer cambio de alguien con cuenta le da el tablero, si no tenía dueño.
          void claimRoom(connection, ws);
          broadcast(room, { type: 'doc:updated', update: message.update }, ws);
        }
        return;
      }
      // La presencia no se guarda: solo se recuerda el último valor (para quien
      // entre después) y se reenvía a los demás.
      case 'presence:cursor': {
        peer.cursor = message.cursor;
        broadcast(room, { type: 'peer:cursor', id: peer.id, cursor: message.cursor }, ws);
        return;
      }
      case 'presence:focus': {
        peer.focus = message.noteId;
        broadcast(room, { type: 'peer:focus', id: peer.id, noteId: message.noteId }, ws);
        return;
      }
      case 'presence:rename': {
        if (connection.user) {
          sendError(ws, 'FORBIDDEN', 'Tu nombre sale de tu cuenta: cámbialo ahí.');
          return;
        }
        peer.name = message.name;
        broadcast(room, { type: 'peer:renamed', id: peer.id, name: message.name }, ws);
        return;
      }
    }
  }

  function onConnection(
    ws: WebSocket,
    room: Room,
    identity: RequestedIdentity,
    user: User | null,
    access: RoomAccess,
  ): void {
    const peer = room.join(ws, identity);
    const connection: Connection = { room, peerId: peer.id, user, access };
    connections.set(ws, connection);
    alive.set(ws, true);
    log(`Cliente conectado a la sala ${room.id} (${room.clients.size} en la sala).`);

    ws.on('pong', () => alive.set(ws, true));

    ws.on('message', (data, isBinary) => {
      // Un cliente que inunda el socket se corta: al reconectar se sincroniza,
      // así que no se pierde nada por cerrarle la conexión.
      if (!messageRate.take(connection.peerId)) {
        log(`Demasiados mensajes en la sala ${room.id}: se cierra la conexión.`);
        sendError(ws, 'RATE_LIMIT', 'Demasiados mensajes seguidos.');
        ws.close(1008, 'demasiados mensajes');
        return;
      }
      if (isBinary) {
        sendError(ws, 'INVALID_MESSAGE', 'Solo se aceptan mensajes de texto.');
        return;
      }
      const result = parseClientMessage(toText(data));
      if (!result.ok) {
        sendError(ws, result.code, result.reason);
        return;
      }
      apply(connection, ws, result.message);
    });

    ws.on('close', () => {
      room.leave(ws);
      connections.delete(ws);
      messageRate.forget(connection.peerId);
      log(`Cliente desconectado de la sala ${room.id} (${room.clients.size} en la sala).`);
      broadcast(room, { type: 'peer:left', id: peer.id });
      rooms.release(room);
    });

    // Sin este listener, un error del socket (p. ej. superar maxPayload) tiraría el proceso.
    ws.on('error', (error) => log(`Error en la conexión: ${error.message}`));

    sendInit(room, ws, access);
    broadcast(room, { type: 'peer:joined', peer: { ...peer } }, ws);
  }

  // Ping/pong: quien no respondió al ping anterior se considera una conexión fantasma.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        log('Conexión sin respuesta al ping: se cierra.');
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
      // El ping del protocolo lo responde el navegador solo, pero JavaScript no
      // lo ve: este mensaje es la señal de vida que sí puede vigilar el cliente.
      send(ws, { type: 'heartbeat' });
    }
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return {
    httpServer,
    rooms,

    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(options.port, options.host, () => {
          httpServer.off('error', reject);
          resolve((httpServer.address() as AddressInfo).port);
        });
      });
    },

    async close() {
      closing = true;
      clearInterval(heartbeat);
      // 1001 («going away»): los clientes reconectan solos cuando el servidor vuelve.
      for (const ws of wss.clients) ws.close(1001, 'Servidor reiniciándose');
      await rooms.closeAll();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    },
  };
}
