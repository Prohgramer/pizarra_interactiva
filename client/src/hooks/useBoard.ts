import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  CURSOR_THROTTLE_MS,
  FORBIDDEN_CLOSE_CODE,
  HEARTBEAT_TIMEOUT_MS,
  MAX_NOTES,
  MAX_PAYLOAD_BYTES,
  MAX_ROTATION_DEG,
  MAX_TEXT_LENGTH,
  MOVE_THROTTLE_MS,
  NOTE_COLORS,
  NOTE_HEIGHT,
  NOTE_WIDTH,
  RESET_CLOSE_CODE,
  SYNC_THROTTLE_MS,
  TICKET_PARAM,
  clampCursor,
  clampNotePosition,
  clampRotation,
  createUndoManager,
  decodeUpdate,
  encodeUpdate,
  getNoteText,
  getNotesMap,
  identityQuery,
  insertNote,
  isEmptyUpdate,
  nextZ,
  normalizeName,
  readNotes,
  removeNote,
  replaceText,
  roomSocketPath,
  sanitizeText,
  setNoteColor,
  setNotePosition,
  type BoardNote,
  type ClientMessage,
  type ErrorCode,
  type Identity,
  type Note,
  type NoteColor,
  type Peer,
  type Point,
  type RoomAccess,
  type ServerMessage,
} from '@pizarra/shared';
import { WS_URL } from '../config';
import { ApiError, api } from '../lib/api';
import { createCursorStore, type CursorStore } from '../lib/cursorStore';
import { createNoteId } from '../lib/ids';
import { peersReducer, type PeersState } from './peersReducer';

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

export interface Caret {
  start: number;
  end: number;
}

export interface BoardApi {
  /** La copia local (IndexedDB) ya se cargó: se puede editar, con o sin conexión. */
  ready: boolean;
  notes: BoardNote[];
  status: ConnectionStatus;
  /** Hay cambios hechos sin conexión que el servidor todavía no recibió. */
  pendingChanges: boolean;
  /** Qué puede hacer aquí quien está conectado; null hasta el primer `init`. */
  access: RoomAccess | null;
  /** El servidor cerró la conexión porque ya no puedes entrar a este tablero. */
  forbidden: boolean;
  /** Quién soy en la sala (con el color que asignó el servidor); null hasta el primer `init`. */
  self: Peer | null;
  /** Las demás personas conectadas, con la nota que editan. */
  peers: PeersState;
  /** Cursores de las demás personas (fuera del estado de React; ver CursorStore). */
  cursors: CursorStore;
  /** Crea una nota centrada en `center` y la devuelve (o `null` si no se pudo). */
  createNote: (center: Point) => Note | null;
  /** Posición intermedia de un arrastre: se ve ya y se escribe en el documento con throttle. */
  moveNote: (id: string, x: number, y: number) => void;
  /** Posición final: se escribe y se envía sin esperar. */
  commitMove: (id: string, x: number, y: number) => void;
  /** Nuevo valor del texto, con la selección del textarea tras el cambio. */
  editText: (id: string, value: string, caret: Caret) => void;
  setColor: (id: string, color: NoteColor) => void;
  deleteNote: (id: string) => void;
  /** Hay algún cambio propio para deshacer (o para rehacer). */
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Deshace el último cambio propio. Devuelve la nota cuyo texto conviene
   * enfocar (si el cambio deshecho era una edición de texto), o null.
   */
  undo: () => string | null;
  redo: () => string | null;
  /** Recuerda dónde está el cursor de texto, anclado al contenido (sobrevive a cambios remotos). */
  rememberCaret: (id: string, caret: Caret) => void;
  /** Dónde debería estar el cursor de texto ahora, tras cambios remotos. */
  resolveCaret: (id: string) => Caret | null;
  /** Posición de mi cursor en el tablero (null: fuera). Se envía con throttle. */
  updateCursor: (cursor: Point | null) => void;
  /** Nota cuyo texto estoy editando (null: ninguna). */
  setFocus: (noteId: string | null) => void;
  rename: (name: string) => void;
}

interface BoardOptions {
  identity: Identity;
  /** Token de sesión, para pedir el ticket del WebSocket. null: sin cuenta. */
  token: string | null;
  /** Se llama si el servidor ya no reconoce la sesión guardada. */
  onSessionExpired: () => void;
  /** Recibe los avisos para la persona (cambios rechazados, límites). */
  onNotice: (text: string) => void;
}

const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;
/** Si IndexedDB no responde en este tiempo, se sigue sin copia local. */
const LOCAL_LOAD_TIMEOUT_MS = 3000;

/** Origen de las transacciones hechas en esta pestaña: son las únicas que se envían. */
const LOCAL = Symbol('local');
/** Origen de lo que llega del servidor. */
const REMOTE = Symbol('remote');

const ERROR_TEXT: Record<ErrorCode, string> = {
  INVALID_JSON: 'El servidor no pudo leer un mensaje.',
  INVALID_MESSAGE: 'El servidor rechazó un mensaje no válido.',
  FORBIDDEN: 'No tienes permiso para hacer eso en este tablero.',
  RATE_LIMIT: 'Demasiados cambios seguidos: se cortó la conexión y se reintenta.',
  INVALID_UPDATE: 'El servidor rechazó tus cambios locales porque no eran válidos. Se cargó la versión del servidor.',
  BOARD_LIMIT:
    'Al sincronizar, el tablero superó el límite de notas o de texto: se descartaron tus cambios locales pendientes.',
};

interface Throttle<T> {
  timer: ReturnType<typeof setTimeout> | null;
  lastAt: number;
  pending: T;
}

interface CursorThrottle extends Throttle<Point | null | undefined> {
  /** Último valor enviado (para no repetirlo). */
  sent: Point | null;
}

/** Selección del texto anclada al contenido (sobrevive a los cambios de las demás). */
type AnchoredCaret = readonly [Y.RelativePosition, Y.RelativePosition];

/** Dónde estaba el cursor de texto cuando se hizo un cambio; se guarda en su paso de deshacer. */
interface CaretMemory {
  noteId: string;
  caret: AnchoredCaret;
}

/** Clave con la que se guarda el caret dentro de un paso. */
const CARET_META = 'caret';

/** Lo único que hace falta de un paso del gestor (Yjs no exporta el tipo `StackItem`). */
interface UndoStep {
  meta: Map<unknown, unknown>;
}

interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
}

const NOTHING_TO_UNDO: UndoState = { canUndo: false, canRedo: false };

function samePoint(a: Point | null, b: Point | null): boolean {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y);
}

function sameNote(a: BoardNote, b: BoardNote): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.text === b.text &&
    a.color === b.color &&
    a.rotation === b.rotation &&
    a.z === b.z
  );
}

/**
 * Estado de un tablero (una sala) sobre un documento Yjs.
 *
 * El documento es local-first: vive en IndexedDB y se puede editar sin
 * conexión. Al conectar, el servidor envía su estado completo; se fusiona con
 * la copia local y se le devuelve solo lo que no tenía. Después, cada cambio
 * local se envía (agrupado, como mucho cada SYNC_THROTTLE_MS) y el servidor lo
 * reenvía a los demás. Si el servidor rechaza un update, se descarta la copia
 * local y se vuelve a empezar desde la del servidor.
 *
 * La presencia (quién está, cursores, nota en edición) viaja por el mismo
 * socket; la identidad va en la URL de conexión.
 */
export function useBoard(roomId: string, { identity, token, onSessionExpired, onNotice }: BoardOptions): BoardApi {
  /** Cambia para empezar una sesión nueva (documento vacío) tras un rechazo del servidor. */
  const [epoch, setEpoch] = useState(0);
  const [docNotes, setDocNotes] = useState<BoardNote[]>([]);
  /** Posiciones de las notas que esta pestaña está arrastrando: ganan a las remotas. */
  const [dragging, setDragging] = useState<ReadonlyMap<string, Point>>(new Map());
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [pendingChanges, setPendingChanges] = useState(false);
  const [self, setSelf] = useState<Peer | null>(null);
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [peers, dispatchPeers] = useReducer(peersReducer, new Map() as PeersState);
  const [cursors] = useState(createCursorStore);
  const [undoState, setUndoState] = useState<UndoState>(NOTHING_TO_UNDO);

  const docRef = useRef<Y.Doc | null>(null);
  const readyRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const liveRef = useRef(false);
  /** Envía ya los cambios locales pendientes (lo define la sesión). */
  const flushNowRef = useRef<() => void>(() => {});
  const dragWritesRef = useRef(new Map<string, Throttle<Point | null>>());
  const caretsRef = useRef(new Map<string, AnchoredCaret>());
  const undoRef = useRef<Y.UndoManager | null>(null);
  /** Qué acción escribió el último cambio: si cambia, empieza un paso nuevo. */
  const lastStepRef = useRef<string | null>(null);
  /** Nota que hay que enfocar tras deshacer (la escribe el gestor al sacar un paso). */
  const undoFocusRef = useRef<string | null>(null);
  const cursorRef = useRef<CursorThrottle>({ timer: null, lastAt: -Infinity, sent: null, pending: undefined });
  /** Nota que estoy editando: se vuelve a anunciar tras reconectar. */
  const focusRef = useRef<string | null>(null);

  // Se leen desde refs para no reabrir la sesión si cambian: la identidad
  // actual se usa en la próxima conexión, y el callback de avisos siempre.
  const identityRef = useRef(identity);
  const tokenRef = useRef(token);
  const onNoticeRef = useRef(onNotice);
  const onSessionExpiredRef = useRef(onSessionExpired);
  useLayoutEffect(() => {
    identityRef.current = identity;
    tokenRef.current = token;
    onNoticeRef.current = onNotice;
    onSessionExpiredRef.current = onSessionExpired;
  });

  /**
   * Cambia al entrar o salir de una cuenta, y al cambiar el nombre de la
   * cuenta: en esos casos hay que reconectar, porque la identidad y los
   * permisos los resuelve el servidor en el handshake.
   */
  const sessionKey = token ? `${token}#${identity.name}` : 'anon';
  const showNotice = useCallback((text: string) => onNoticeRef.current(text), []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const setFocus = useCallback(
    (noteId: string | null) => {
      if (focusRef.current === noteId) return;
      focusRef.current = noteId;
      send({ type: 'presence:focus', noteId });
    },
    [send],
  );

  /* ───────────── Sesión: documento, copia local y conexión ───────────── */

  useEffect(() => {
    const doc = new Y.Doc();
    getNotesMap(doc);
    docRef.current = doc;

    // Deshacer solo lo propio: el gestor sigue las transacciones LOCAL. Las
    // suyas llevan su propio origen, así que también cuentan como locales.
    const undoManager = createUndoManager(doc, LOCAL);
    undoRef.current = undoManager;
    const isLocal = (origin: unknown) => origin === LOCAL || origin === undoManager;

    const refreshUndo = () => {
      const next: UndoState = { canUndo: undoManager.canUndo(), canRedo: undoManager.canRedo() };
      setUndoState((current) =>
        current.canUndo === next.canUndo && current.canRedo === next.canRedo ? current : next,
      );
    };

    // Cada paso recuerda dónde estaba el cursor de texto, para devolverlo ahí
    // al deshacer, como en cualquier editor.
    const rememberCaretInStep = ({ stackItem }: { stackItem: UndoStep }) => {
      const noteId = focusRef.current;
      const caret = noteId === null ? undefined : caretsRef.current.get(noteId);
      if (noteId !== null && caret) stackItem.meta.set(CARET_META, { noteId, caret } satisfies CaretMemory);
      refreshUndo();
    };

    const restoreCaretFromStep = ({ stackItem }: { stackItem: UndoStep }) => {
      const memory = stackItem.meta.get(CARET_META) as CaretMemory | undefined;
      // La nota puede haber desaparecido (deshacer una creación, o un borrado ajeno).
      if (memory && getNotesMap(doc).has(memory.noteId)) {
        caretsRef.current.set(memory.noteId, memory.caret);
        undoFocusRef.current = memory.noteId;
      }
      refreshUndo();
    };

    undoManager.on('stack-item-added', rememberCaretInStep);
    undoManager.on('stack-item-popped', restoreCaretFromStep);
    undoManager.on('stack-cleared', refreshUndo);

    let disposed = false;
    let persistence: IndexeddbPersistence | null = null;
    let persistenceClosed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let current: ConnectionStatus = 'connecting';
    /** Esta conexión ya hizo el intercambio inicial: los cambios locales pueden salir en vivo. */
    let synced = false;
    let outbox: Uint8Array[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let lastFlushAt = -Infinity;
    let rejection: ErrorCode | null = null;
    /** Último permiso conocido, para avisar solo cuando cambia de verdad. */
    let currentAccess: RoomAccess | null = null;
    /** Vigila que el servidor siga dando señales de vida. */
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const updateStatus = (next: ConnectionStatus) => {
      current = next;
      liveRef.current = next === 'live';
      setStatus(next);
    };

    // Notas derivadas del documento. Las que no cambiaron conservan su objeto,
    // así `memo` evita volver a renderizarlas.
    let cache = new Map<string, BoardNote>();
    let lastNotes: BoardNote[] = [];
    const refreshNotes = () => {
      const next = readNotes(doc).map((note) => {
        const previous = cache.get(note.id);
        return previous && sameNote(previous, note) ? previous : note;
      });
      cache = new Map(next.map((note) => [note.id, note]));
      if (next.length !== lastNotes.length || next.some((note, index) => note !== lastNotes[index])) {
        lastNotes = next;
        setDocNotes(next);
      }
      // Si alguien borró la nota que estoy editando, dejo de anunciarla.
      if (focusRef.current && !cache.has(focusRef.current)) setFocus(null);
    };

    const flushOutbox = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (!synced || outbox.length === 0) return;
      const update = Y.mergeUpdates(outbox);
      outbox = [];
      send({ type: 'doc:update', update: encodeUpdate(update) });
      lastFlushAt = performance.now();
    };
    flushNowRef.current = flushOutbox;

    const handleDocUpdate = (update: Uint8Array, origin: unknown) => {
      refreshNotes();
      if (!isLocal(origin)) return;
      if (!synced) {
        // Sin conexión: queda en el documento (y en IndexedDB) y saldrá en la próxima sincronización.
        setPendingChanges(true);
        return;
      }
      outbox.push(update);
      if (flushTimer !== undefined) return;
      const wait = SYNC_THROTTLE_MS - (performance.now() - lastFlushAt);
      if (wait <= 0) flushOutbox();
      else flushTimer = setTimeout(flushOutbox, wait);
    };
    doc.on('update', handleDocUpdate);

    const clearPresence = () => {
      dispatchPeers({ type: 'reset', peers: [] });
      cursors.reset();
    };

    const closePersistence = () => {
      if (persistenceClosed || !persistence) return;
      persistenceClosed = true;
      void persistence.destroy().catch(() => {});
    };

    /** El servidor rechazó la copia local: se borra y se empieza de nuevo con la suya. */
    const reset = async (reason: string) => {
      if (disposed) return;
      disposed = true;
      socketRef.current?.close();
      showNotice(reason);
      if (persistence && !persistenceClosed) {
        persistenceClosed = true;
        await persistence.clearData().catch(() => {});
      }
      setEpoch((value) => value + 1);
    };

    /** Intercambio inicial: se fusiona el estado del servidor y se le envía lo que no tenía. */
    const syncWithServer = (socket: WebSocket, serverState: Uint8Array) => {
      Y.applyUpdate(doc, serverState, REMOTE);
      const diff = Y.encodeStateAsUpdate(doc, Y.encodeStateVectorFromUpdate(serverState));
      outbox = [];
      if (!isEmptyUpdate(diff)) {
        const message = JSON.stringify({ type: 'doc:update', update: encodeUpdate(diff) } satisfies ClientMessage);
        if (message.length > MAX_PAYLOAD_BYTES) {
          void reset('Los cambios hechos sin conexión eran demasiado grandes para sincronizarse y se descartaron.');
          return;
        }
        socket.send(message);
      }
      synced = true;
      setPendingChanges(false);
    };

    const handleMessage = (socket: WebSocket, event: MessageEvent) => {
      if (disposed) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case 'init':
          syncWithServer(socket, decodeUpdate(message.doc));
          if (disposed) return;
          setSelf(message.self);
          currentAccess = message.access;
          setAccess(message.access);
          dispatchPeers({ type: 'reset', peers: message.peers });
          cursors.reset(message.peers.flatMap((peer) => (peer.cursor ? [[peer.id, peer.cursor] as const] : [])));
          attempt = 0;
          updateStatus('live');
          // Una conexión nueva empieza sin cursor ni foco en el servidor.
          cursorRef.current = { timer: null, lastAt: -Infinity, sent: null, pending: undefined };
          if (focusRef.current) send({ type: 'presence:focus', noteId: focusRef.current });
          return;
        case 'access': {
          // Cambió quién puede entrar (o el tablero acaba de tener dueño):
          // la interfaz se ajusta sola y solo se avisa de lo que se nota.
          const before = currentAccess;
          currentAccess = message.access;
          setAccess(message.access);
          if (before && before.canWrite !== message.access.canWrite) {
            showNotice(
              message.access.canWrite
                ? 'Ahora puedes editar este tablero.'
                : 'Este tablero pasó a solo lectura: puedes mirarlo, pero no cambiarlo.',
            );
          } else if (before?.ownerless && message.access.role === 'owner') {
            showNotice('Este tablero ya es tuyo: desde «Compartir» eliges quién puede entrar.');
          }
          return;
        }
        case 'doc:updated':
          try {
            Y.applyUpdate(doc, decodeUpdate(message.update), REMOTE);
          } catch (error) {
            console.error('Update del servidor ilegible', error);
          }
          return;
        case 'heartbeat':
          // Solo sirve para reiniciar el vigilante, que ya se reinició al llegar.
          return;
        case 'peer:joined':
          dispatchPeers({ type: 'join', peer: message.peer });
          cursors.set(message.peer.id, message.peer.cursor);
          return;
        case 'peer:left':
          dispatchPeers({ type: 'leave', id: message.id });
          cursors.set(message.id, null);
          return;
        case 'peer:renamed':
          dispatchPeers({ type: 'rename', id: message.id, name: message.name });
          return;
        case 'peer:cursor':
          cursors.set(message.id, message.cursor);
          return;
        case 'peer:focus':
          dispatchPeers({ type: 'focus', id: message.id, noteId: message.noteId });
          return;
        case 'error':
          // Los rechazos del documento llegan seguidos de un cierre con RESET_CLOSE_CODE.
          if (message.code === 'INVALID_UPDATE' || message.code === 'BOARD_LIMIT') rejection = message.code;
          else showNotice(ERROR_TEXT[message.code] ?? 'El servidor rechazó un mensaje.');
          return;
        default: {
          // Si se agrega un mensaje al protocolo y no se maneja aquí, esto no compila.
          const unhandled: never = message;
          void unhandled;
        }
      }
    };

    // Backoff exponencial con jitter: 0,5 s, 1 s, 2 s… hasta 10 s como máximo.
    const scheduleReconnect = () => {
      const ceiling = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** attempt);
      const delay = ceiling / 2 + Math.random() * (ceiling / 2);
      attempt += 1;
      retryTimer = setTimeout(() => void connect(), delay);
    };

    /**
     * Permiso de un solo uso para abrir el socket. Devuelve el ticket, null si
     * no se pudo pedir ahora mismo, o 'expired' si la sesión ya no vale.
     */
    const requestTicket = async (authToken: string): Promise<string | null | 'expired'> => {
      try {
        return (await api.ticket(authToken)).ticket;
      } catch (error) {
        return error instanceof ApiError && error.expired ? 'expired' : null;
      }
    };

    const connect = async () => {
      retryTimer = undefined;
      // Durante los reintentos se sigue mostrando «Sin conexión» hasta recibir el init,
      // para que el indicador no parpadee entre dos estados.
      if (current !== 'offline') updateStatus('connecting');

      let ticket: string | undefined;
      const authToken = tokenRef.current;
      if (authToken) {
        const result = await requestTicket(authToken);
        if (disposed) return;
        if (result === 'expired') {
          // Se olvida la sesión; al cambiar `sessionKey` esto se reinicia como invitado.
          onSessionExpiredRef.current();
          return;
        }
        if (result === null) {
          // Sin ticket no se conecta: entrar como invitado daría otra identidad.
          updateStatus('offline');
          scheduleReconnect();
          return;
        }
        ticket = result;
      }

      // La identidad se lee en cada intento: tras cambiar el nombre, reconecta con el nuevo.
      const query = identityQuery(identityRef.current);
      const url = `${WS_URL}${roomSocketPath(roomId)}${query}${ticket ? `&${TICKET_PARAM}=${ticket}` : ''}`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        console.error(`URL de WebSocket inválida: ${url}`, error);
        updateStatus('offline');
        return;
      }

      socketRef.current = socket;

      // Un socket puede quedar abierto para el navegador aunque del otro lado
      // ya no haya nadie (si el servidor cae de golpe). Si pasa demasiado
      // tiempo sin recibir nada —ni siquiera un `heartbeat`—, se lo da por muerto.
      let abandoned = false;
      const giveUp = () => {
        if (abandoned || disposed) return;
        abandoned = true;
        console.warn('Sin señales de vida del servidor: se reconecta.');
        if (socketRef.current === socket) socketRef.current = null;
        synced = false;
        clearPresence();
        socket.close(1000, 'sin señales de vida');
        updateStatus('offline');
        scheduleReconnect();
      };
      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(giveUp, HEARTBEAT_TIMEOUT_MS);
      };

      socket.addEventListener('open', armWatchdog);
      socket.addEventListener('message', (event) => {
        armWatchdog();
        handleMessage(socket, event);
      });
      socket.addEventListener('close', (event) => {
        if (abandoned) return; // ya se reconectó por falta de señales de vida
        clearTimeout(watchdog);
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        synced = false;
        currentAccess = null;
        clearPresence();
        if (event.code === RESET_CLOSE_CODE) {
          void reset(ERROR_TEXT[rejection ?? 'INVALID_UPDATE']);
          return;
        }
        // Ya no se puede entrar: reintentar no arreglaría nada.
        if (event.code === FORBIDDEN_CLOSE_CODE) {
          setForbidden(true);
          setAccess(null);
          updateStatus('offline');
          return;
        }
        updateStatus('offline');
        scheduleReconnect();
      });
    };

    // Al recuperar la red no tiene sentido esperar el resto del backoff.
    const handleOnline = () => {
      if (retryTimer === undefined) return;
      clearTimeout(retryTimer);
      attempt = 0;
      void connect();
    };

    // Primero la copia local; recién después la conexión, para que el
    // intercambio inicial ya incluya lo editado sin conexión en visitas anteriores.
    let started = false;
    const start = () => {
      if (started || disposed) return;
      started = true;
      readyRef.current = true;
      setReady(true);
      refreshNotes();
      window.addEventListener('online', handleOnline);
      void connect();
    };

    if (typeof indexedDB === 'undefined') {
      start();
    } else {
      try {
        persistence = new IndexeddbPersistence(`pizarra:tablero:${roomId}`, doc);
        persistence.whenSynced.then(start, start);
      } catch {
        start();
      }
      setTimeout(start, LOCAL_LOAD_TIMEOUT_MS);
    }

    const dragWrites = dragWritesRef.current;
    const carets = caretsRef.current;
    return () => {
      disposed = true;
      window.removeEventListener('online', handleOnline);
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
      clearTimeout(watchdog);
      for (const entry of dragWrites.values()) {
        if (entry.timer) clearTimeout(entry.timer);
      }
      dragWrites.clear();
      carets.clear();
      clearPresence();
      liveRef.current = false;
      readyRef.current = false;
      flushNowRef.current = () => {};

      const socket = socketRef.current;
      socketRef.current = null;
      // Cerrar un socket que aún se está conectando genera un aviso en consola
      // (pasa en desarrollo con StrictMode): se cierra en cuanto abre.
      if (socket?.readyState === WebSocket.CONNECTING) {
        socket.addEventListener('open', () => socket.close(1000));
      } else {
        socket?.close(1000);
      }

      doc.off('update', handleDocUpdate);
      closePersistence();
      docRef.current = null;
      undoRef.current = null;
      lastStepRef.current = null;
      undoFocusRef.current = null;
      undoManager.destroy();
      doc.destroy();

      setReady(false);
      setAccess(null);
      setForbidden(false);
      setDocNotes([]);
      setDragging(new Map());
      setPendingChanges(false);
      setStatus('connecting');
      setUndoState(NOTHING_TO_UNDO);
    };
  }, [roomId, epoch, sessionKey, cursors, send, setFocus, showNotice]);

  /* ───────────── Notas ───────────── */

  // Mientras se arrastra, la posición local gana a la del documento.
  const notes = useMemo(
    () =>
      dragging.size === 0
        ? docNotes
        : docNotes.map((note) => {
            const position = dragging.get(note.id);
            return position ? { ...note, ...position } : note;
          }),
    [docNotes, dragging],
  );

  const transact = useCallback((change: (doc: Y.Doc) => void) => {
    const doc = docRef.current;
    if (doc && readyRef.current) doc.transact(() => change(doc), LOCAL);
  }, []);

  /**
   * Empieza un paso de deshacer nuevo si esta acción no continúa la anterior.
   * La clave identifica acción y nota: escribir seguido en la misma nota es un
   * solo paso, y cambiar de nota, de acción o una acción suelta (`null`) corta.
   *
   * Los pasos también se cortan solos tras UNDO_CAPTURE_MS sin escribir (así
   * una pausa al escribir separa párrafos). Un arrastre no: con `gesture` se
   * reabre la ventana en cada escritura, para que soltar la nota después de
   * quedarse quieto un rato no deje media mitad del recorrido en otro paso.
   * `lastChange` es el reloj que usa Yjs para agrupar; `stopCapturing` es
   * justo lo contrario (lo pone a cero).
   */
  const beginStep = useCallback((key: string | null, gesture = false) => {
    const manager = undoRef.current;
    if (key === null || key !== lastStepRef.current) manager?.stopCapturing();
    else if (gesture && manager) manager.lastChange = Date.now();
    lastStepRef.current = key;
  }, []);

  const createNote = useCallback(
    (center: Point): Note | null => {
      const doc = docRef.current;
      if (!doc || !readyRef.current) return null;
      if (getNotesMap(doc).size >= MAX_NOTES) {
        showNotice(`El tablero ya tiene el máximo de ${MAX_NOTES} notas.`);
        return null;
      }
      const note: Note = {
        id: createNoteId(),
        ...clampNotePosition(center.x - NOTE_WIDTH / 2, center.y - NOTE_HEIGHT / 2),
        text: '',
        color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)] ?? NOTE_COLORS[0],
        rotation: clampRotation((Math.random() * 2 - 1) * MAX_ROTATION_DEG),
      };
      beginStep(null);
      transact((current) => insertNote(current, note, nextZ(current)));
      return note;
    },
    [beginStep, showNotice, transact],
  );

  const writePosition = useCallback(
    (id: string, position: Point, gesture = false) => {
      // Un arrastre entero (y las flechas seguidas) son un solo paso.
      beginStep(`move:${id}`, gesture);
      transact((doc) => setNotePosition(doc, id, position.x, position.y));
    },
    [beginStep, transact],
  );

  const flushDragWrite = useCallback(
    (id: string) => {
      const entry = dragWritesRef.current.get(id);
      if (!entry) return;
      entry.timer = null;
      if (!entry.pending) return;
      writePosition(id, entry.pending, true);
      entry.pending = null;
      entry.lastAt = performance.now();
    },
    [writePosition],
  );

  const moveNote = useCallback(
    (id: string, x: number, y: number) => {
      if (!readyRef.current) return;
      const position = clampNotePosition(x, y);
      setDragging((current) => new Map(current).set(id, position));

      let entry = dragWritesRef.current.get(id);
      if (!entry) {
        entry = { timer: null, lastAt: -Infinity, pending: null };
        dragWritesRef.current.set(id, entry);
      }
      entry.pending = position;
      // Ya hay una escritura programada: saldrá con esta última posición.
      if (entry.timer !== null) return;
      const wait = MOVE_THROTTLE_MS - (performance.now() - entry.lastAt);
      if (wait <= 0) flushDragWrite(id);
      else entry.timer = setTimeout(() => flushDragWrite(id), wait);
    },
    [flushDragWrite],
  );

  const stopDragging = useCallback((id: string) => {
    const entry = dragWritesRef.current.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    dragWritesRef.current.delete(id);
    setDragging((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }, []);

  const commitMove = useCallback(
    (id: string, x: number, y: number) => {
      // Si venía de un arrastre, la posición final cierra ese mismo paso.
      const dragged = dragWritesRef.current.has(id);
      stopDragging(id);
      writePosition(id, clampNotePosition(x, y), dragged);
      // La posición final sale sin esperar el throttle.
      flushNowRef.current();
    },
    [stopDragging, writePosition],
  );

  const rememberCaret = useCallback((id: string, { start, end }: Caret) => {
    const doc = docRef.current;
    const text = doc && getNoteText(doc, id);
    if (!text) return;
    caretsRef.current.set(id, [
      Y.createRelativePositionFromTypeIndex(text, start),
      Y.createRelativePositionFromTypeIndex(text, end),
    ]);
  }, []);

  const resolveCaret = useCallback((id: string): Caret | null => {
    const doc = docRef.current;
    const relative = caretsRef.current.get(id);
    if (!doc || !relative) return null;
    const start = Y.createAbsolutePositionFromRelativePosition(relative[0], doc);
    const end = Y.createAbsolutePositionFromRelativePosition(relative[1], doc);
    return start && end ? { start: start.index, end: end.index } : null;
  }, []);

  const editText = useCallback(
    (id: string, value: string, caret: Caret) => {
      beginStep(`text:${id}`);
      transact((doc) => {
        const text = getNoteText(doc, id);
        if (text) replaceText(text, sanitizeText(value).slice(0, MAX_TEXT_LENGTH));
      });
      rememberCaret(id, caret);
    },
    [beginStep, rememberCaret, transact],
  );

  const setColor = useCallback(
    (id: string, color: NoteColor) => {
      beginStep(null);
      transact((doc) => setNoteColor(doc, id, color));
    },
    [beginStep, transact],
  );

  const deleteNote = useCallback(
    (id: string) => {
      stopDragging(id);
      beginStep(null);
      transact((doc) => removeNote(doc, id));
      caretsRef.current.delete(id);
      // Al desmontarse, el textarea no siempre dispara blur.
      if (focusRef.current === id) setFocus(null);
    },
    [beginStep, setFocus, stopDragging, transact],
  );

  /* ───────────── Deshacer y rehacer ───────────── */

  /**
   * Deshace (o rehace) un paso propio y lo envía sin esperar el throttle.
   * Devuelve la nota que conviene enfocar: la que estaba editándose cuando se
   * hizo el cambio, si sigue en el tablero.
   */
  const stepHistory = useCallback((direction: 'undo' | 'redo'): string | null => {
    const manager = undoRef.current;
    if (!manager || !readyRef.current) return null;
    undoFocusRef.current = null;
    // Lo próximo que se escriba no se junta con lo que quedó en la pila.
    lastStepRef.current = null;
    if (direction === 'undo') manager.undo();
    else manager.redo();
    flushNowRef.current();
    return undoFocusRef.current;
  }, []);

  const undo = useCallback(() => stepHistory('undo'), [stepHistory]);
  const redo = useCallback(() => stepHistory('redo'), [stepHistory]);

  /* ───────────── Presencia ───────────── */

  const flushCursor = useCallback(() => {
    const cursor = cursorRef.current;
    cursor.timer = null;
    if (cursor.pending === undefined) return;
    const next = cursor.pending;
    cursor.pending = undefined;
    if (samePoint(next, cursor.sent)) return;
    send({ type: 'presence:cursor', cursor: next });
    cursor.sent = next;
    cursor.lastAt = performance.now();
  }, [send]);

  const updateCursor = useCallback(
    (point: Point | null) => {
      if (!liveRef.current) return;
      const cursor = cursorRef.current;
      cursor.pending = point && clampCursor(point.x, point.y);

      // Ocultar el cursor no espera: si no, un último movimiento podría llegar después.
      if (cursor.pending === null) {
        if (cursor.timer) clearTimeout(cursor.timer);
        flushCursor();
        return;
      }
      if (cursor.timer !== null) return;
      const wait = CURSOR_THROTTLE_MS - (performance.now() - cursor.lastAt);
      if (wait <= 0) flushCursor();
      else cursor.timer = setTimeout(flushCursor, wait);
    },
    [flushCursor],
  );

  const rename = useCallback(
    (name: string) => {
      const normalized = normalizeName(name);
      if (!normalized) return;
      identityRef.current = { ...identityRef.current, name: normalized };
      setSelf((current) => current && { ...current, name: normalized });
      // Sin conexión no hace falta avisar: la próxima conexión ya lleva el nombre nuevo.
      send({ type: 'presence:rename', name: normalized });
    },
    [send],
  );

  return {
    ready,
    notes,
    status,
    pendingChanges,
    access,
    forbidden,
    self,
    peers,
    cursors,
    createNote,
    moveNote,
    commitMove,
    editText,
    setColor,
    deleteNote,
    canUndo: undoState.canUndo,
    canRedo: undoState.canRedo,
    undo,
    redo,
    rememberCaret,
    resolveCaret,
    updateCursor,
    setFocus,
    rename,
  };
}
