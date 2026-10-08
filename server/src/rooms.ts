import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { DOC_LIMITS, getNotesMap, validateBoardDoc, type DocProblem, type PeerPresence } from '@pizarra/shared';
import { assignPresenceColor, createPeerId } from './presence';
import type { RoomStore, StoredRoom } from './store/types';
import type { RequestedIdentity } from './validation';

export interface RoomTimings {
  /** Espera máxima entre un cambio y su escritura en el almacén. */
  flushDelayMs: number;
  /** Espera antes de reintentar una escritura fallida. */
  retryDelayMs: number;
  /** Tiempo que una sala sin nadie sigue en memoria antes de descargarse. */
  idleTtlMs: number;
}

export type DocLimits = { readonly [K in keyof typeof DOC_LIMITS]: number };

export interface RoomManagerOptions extends RoomTimings {
  store: RoomStore;
  limits: DocLimits;
  log: (message: string) => void;
}

export type ApplyResult = { ok: true; changed: boolean } | { ok: false; problem: DocProblem };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDoc(state?: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  getNotesMap(doc); // define la raíz como Y.Map antes de integrar nada
  if (state) Y.applyUpdate(doc, state);
  return doc;
}

/**
 * Una sala cargada en memoria: su documento Yjs, sus clientes y si falta
 * guardar. La memoria es la fuente de verdad mientras la sala está abierta; el
 * almacén se actualiza en lote ("write-behind"): tras un cambio, como mucho
 * `flushDelayMs` después se escribe el estado completo del documento. Veinte
 * cambios por segundo terminan siendo una escritura.
 */
export class Room {
  readonly id: string;
  /** Conexiones de la sala y la presencia de cada una (efímera: no se guarda). */
  readonly clients = new Map<WebSocket, PeerPresence>();
  /** El documento aceptado. */
  readonly #doc: Y.Doc;
  /** Copia idéntica donde se prueba cada update antes de aceptarlo (un CRDT no se puede deshacer). */
  #shadow: Y.Doc;
  readonly #options: RoomManagerOptions;
  #dirty = false;
  #flushTimer: NodeJS.Timeout | undefined;
  /** Cola que serializa las escrituras de esta sala. */
  #writes: Promise<void> = Promise.resolve();
  /** Conexiones que usan la sala (incluidas las que aún están en el handshake). */
  #refs = 0;
  /** Primera persona con cuenta que escribió aquí: será la dueña si la sala es nueva. */
  #ownerCandidate: string | null = null;

  constructor(id: string, stored: StoredRoom | null, options: RoomManagerOptions) {
    this.id = id;
    this.#options = options;
    this.#doc = createDoc(stored?.state);
    this.#shadow = createDoc(stored?.state);
    // Una sala recién convertida desde la Etapa 2 se guarda pronto como documento.
    if (stored?.migrated) this.#markDirty();
  }

  get refs(): number {
    return this.#refs;
  }

  get hasPendingChanges(): boolean {
    return this.#dirty;
  }

  /** Anota quién escribió primero, por si la sala todavía no existe en la base. */
  claimBy(userId: string): void {
    this.#ownerCandidate ??= userId;
  }

  retain(): void {
    this.#refs += 1;
  }

  release(): number {
    this.#refs = Math.max(0, this.#refs - 1);
    return this.#refs;
  }

  /** Estado completo del documento: para el `init` y para guardar. */
  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.#doc);
  }

  /**
   * Aplica el update de un cliente solo si el documento resultante es válido.
   * Se prueba primero en la copia; si falla, la copia se reconstruye y el
   * documento aceptado no se toca. `changed` es false si el update no traía
   * nada nuevo (p. ej. lo que ya se había recibido antes de una reconexión).
   */
  applyUpdate(update: Uint8Array): ApplyResult {
    let problem: DocProblem | null;
    try {
      Y.applyUpdate(this.#shadow, update);
      problem = validateBoardDoc(this.#shadow, this.#options.limits);
    } catch {
      problem = { code: 'INVALID_UPDATE', reason: 'No es un update de Yjs válido.' };
    }

    if (problem) {
      this.#shadow.destroy();
      this.#shadow = createDoc(this.encodeState());
      return { ok: false, problem };
    }

    let changed = false;
    const onUpdate = () => {
      changed = true;
    };
    this.#doc.on('update', onUpdate);
    Y.applyUpdate(this.#doc, update);
    this.#doc.off('update', onUpdate);

    if (changed) this.#markDirty();
    return { ok: true, changed };
  }

  /** Escribe ya los cambios pendientes. Rechaza si el almacén falla (y reintenta solo). */
  flush(): Promise<void> {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    const run = this.#writes.then(() => this.#writePending());
    this.#writes = run.catch(() => {});
    return run;
  }

  dispose(): void {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;
    this.#doc.destroy();
    this.#shadow.destroy();
  }

  #markDirty(): void {
    this.#dirty = true;
    this.#scheduleFlush(this.#options.flushDelayMs);
  }

  #scheduleFlush(delayMs: number): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      this.flush().catch(() => {}); // el error ya se registró y hay un reintento programado
    }, delayMs);
    this.#flushTimer.unref();
  }

  async #writePending(): Promise<void> {
    if (!this.#dirty) return;
    // Se baja la marca antes de escribir: si llega un cambio durante la escritura, vuelve a subir.
    this.#dirty = false;
    try {
      await this.#options.store.save(this.id, this.encodeState(), this.#ownerCandidate);
    } catch (error) {
      this.#dirty = true;
      this.#options.log(`No se pudo guardar la sala ${this.id}: ${errorMessage(error)}. Se reintentará.`);
      this.#scheduleFlush(this.#options.retryDelayMs);
      throw error;
    }
  }

  /** Registra una conexión con un id nuevo y un color que no se repita, si se puede. */
  join(ws: WebSocket, identity: RequestedIdentity): PeerPresence {
    const taken = Array.from(this.clients.values(), (peer) => peer.color);
    const peer: PeerPresence = {
      id: createPeerId(),
      name: identity.name,
      color: assignPresenceColor(identity.preferredColor, taken),
      cursor: null,
      focus: null,
    };
    this.clients.set(ws, peer);
    return peer;
  }

  leave(ws: WebSocket): PeerPresence | undefined {
    const peer = this.clients.get(ws);
    this.clients.delete(ws);
    return peer;
  }

  /** Presencia de todas las conexiones menos `except`, como copias seguras de enviar. */
  peers(except?: WebSocket): PeerPresence[] {
    const peers: PeerPresence[] = [];
    for (const [ws, peer] of this.clients) {
      if (ws !== except) peers.push({ ...peer, cursor: peer.cursor && { ...peer.cursor } });
    }
    return peers;
  }
}

interface RoomEntry {
  loading: Promise<Room>;
  room?: Room;
  evictTimer?: NodeJS.Timeout;
}

/**
 * Abre salas bajo demanda (una sola carga aunque entren varias personas a la
 * vez) y las descarga cuando quedan vacías, después de guardar sus cambios.
 */
export class RoomManager {
  readonly #entries = new Map<string, RoomEntry>();
  readonly #options: RoomManagerOptions;
  #closed = false;

  constructor(options: RoomManagerOptions) {
    this.#options = options;
  }

  get storageKind(): RoomStore['kind'] {
    return this.#options.store.kind;
  }

  /** Salas en memoria y clientes conectados en total. */
  stats(): { rooms: number; clients: number } {
    let rooms = 0;
    let clients = 0;
    for (const { room } of this.#entries.values()) {
      if (!room) continue;
      rooms += 1;
      clients += room.clients.size;
    }
    return { rooms, clients };
  }

  /** La sala si ya está en memoria, sin cargarla ni retenerla. */
  peek(roomId: string): Room | undefined {
    return this.#entries.get(roomId)?.room;
  }

  /** Devuelve la sala cargada, sumándole una referencia. Cada `acquire` requiere un `release`. */
  async acquire(roomId: string): Promise<Room> {
    for (;;) {
      if (this.#closed) throw new Error('El servidor se está cerrando.');

      let entry = this.#entries.get(roomId);
      if (!entry) entry = this.#open(roomId);
      const room = await entry.loading;

      // Mientras se esperaba, la sala pudo descargarse: en ese caso se vuelve a abrir.
      if (this.#entries.get(roomId) !== entry) continue;

      clearTimeout(entry.evictTimer);
      entry.evictTimer = undefined;
      room.retain();
      return room;
    }
  }

  release(room: Room): void {
    if (room.release() > 0) return;
    const entry = this.#entries.get(room.id);
    if (!entry || entry.room !== room || this.#closed) return;
    this.#scheduleEviction(entry, room, this.#options.idleTtlMs);
  }

  /** Guarda todas las salas y deja de aceptar nuevas. Se usa al apagar el servidor. */
  async closeAll(): Promise<void> {
    this.#closed = true;
    const rooms: Room[] = [];
    for (const entry of this.#entries.values()) {
      clearTimeout(entry.evictTimer);
      if (entry.room) rooms.push(entry.room);
    }

    const results = await Promise.allSettled(rooms.map((room) => room.flush()));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) this.#options.log(`Al cerrar no se pudieron guardar ${failed} sala(s).`);

    for (const room of rooms) room.dispose();
    this.#entries.clear();
  }

  #open(roomId: string): RoomEntry {
    const entry: RoomEntry = {
      loading: this.#options.store.load(roomId).then((stored) => {
        if (stored?.migrated) this.#options.log(`Sala ${roomId} convertida desde notas de la Etapa 2.`);
        return new Room(roomId, stored, this.#options);
      }),
    };
    entry.loading.then(
      (room) => {
        entry.room = room;
      },
      (error: unknown) => {
        if (this.#entries.get(roomId) === entry) this.#entries.delete(roomId);
        this.#options.log(`No se pudo cargar la sala ${roomId}: ${errorMessage(error)}.`);
      },
    );
    this.#entries.set(roomId, entry);
    return entry;
  }

  #scheduleEviction(entry: RoomEntry, room: Room, delayMs: number): void {
    clearTimeout(entry.evictTimer);
    entry.evictTimer = setTimeout(() => void this.#evict(entry, room), delayMs);
    entry.evictTimer.unref();
  }

  async #evict(entry: RoomEntry, room: Room): Promise<void> {
    entry.evictTimer = undefined;
    try {
      await room.flush();
    } catch {
      // No se descarga una sala con cambios sin guardar: se vuelve a intentar.
      if (room.refs === 0 && this.#entries.get(room.id) === entry && !this.#closed) {
        this.#scheduleEviction(entry, room, this.#options.retryDelayMs);
      }
      return;
    }

    // Alguien pudo entrar (o cambiar algo) mientras se guardaba.
    if (room.refs > 0 || room.hasPendingChanges || this.#entries.get(room.id) !== entry) return;
    this.#entries.delete(room.id);
    room.dispose();
    this.#options.log(`Sala ${room.id} guardada y descargada de memoria.`);
  }
}
