import type { RoomAccess } from './accounts';
import type { NoteColor } from './constants';
import type { Point } from './geometry';
import type { PresenceColor } from './presence';

export interface Note {
  id: string;
  /** Esquina superior izquierda, en píxeles del tablero. */
  x: number;
  y: number;
  text: string;
  color: NoteColor;
  /** Inclinación en grados, fija desde la creación. */
  rotation: number;
}


/** Una persona conectada a la sala. El id lo asigna el servidor por conexión. */
export interface Peer {
  id: string;
  name: string;
  color: PresenceColor;
}

/** Una persona con su estado de presencia actual. */
export interface PeerPresence extends Peer {
  /** Posición del cursor en coordenadas del tablero; null si no está sobre él. */
  cursor: Point | null;
  /** Nota cuyo texto está editando, o null. */
  focus: string | null;
}

/* ───────────── Cliente → servidor ───────────── */

/**
 * Cambios del documento de la sala: un update de Yjs en base64. Sirve tanto
 * para las ediciones en vivo como para enviar, al reconectar, todo lo que se
 * editó sin conexión.
 */
export interface DocUpdateMessage {
  type: 'doc:update';
  update: string;
}

export interface CursorMessage {
  type: 'presence:cursor';
  cursor: Point | null;
}

export interface FocusMessage {
  type: 'presence:focus';
  noteId: string | null;
}

export interface RenameMessage {
  type: 'presence:rename';
  name: string;
}

export type ClientMessage = DocUpdateMessage | CursorMessage | FocusMessage | RenameMessage;
export type ClientMessageType = ClientMessage['type'];

/* ───────────── Servidor → cliente ───────────── */

/**
 * Estado completo de la sala al conectar. El cliente fusiona `doc` con su
 * copia local y responde con un `doc:update` de lo que el servidor no tenía.
 */
export interface InitMessage {
  type: 'init';
  /** Estado completo del documento (update de Yjs en base64). */
  doc: string;
  /** Quién soy en esta sala (con el color que asignó el servidor). */
  self: Peer;
  /** Las demás personas conectadas. */
  peers: PeerPresence[];
  /** Qué puede hacer aquí quien acaba de conectarse. Lo decide el servidor. */
  access: RoomAccess;
}

/** El acceso cambió mientras la sala estaba abierta (el dueño cambió quién puede entrar). */
export interface AccessMessage {
  type: 'access';
  access: RoomAccess;
}

/** Cambios del documento hechos por otra persona (nunca los propios). */
export interface DocUpdatedMessage {
  type: 'doc:updated';
  update: string;
}

/** Señal de vida periódica: si deja de llegar, el cliente reconecta. */
export interface HeartbeatMessage {
  type: 'heartbeat';
}

export interface PeerJoinedMessage {
  type: 'peer:joined';
  peer: PeerPresence;
}

export interface PeerLeftMessage {
  type: 'peer:left';
  id: string;
}

export interface PeerRenamedMessage {
  type: 'peer:renamed';
  id: string;
  name: string;
}

export interface PeerCursorMessage {
  type: 'peer:cursor';
  id: string;
  cursor: Point | null;
}

export interface PeerFocusMessage {
  type: 'peer:focus';
  id: string;
  noteId: string | null;
}

/**
 * INVALID_UPDATE y BOARD_LIMIT rechazan un update del documento: después del
 * error el servidor cierra con RESET_CLOSE_CODE y el cliente se resincroniza.
 * FORBIDDEN rechaza un mensaje que esta conexión no tiene permitido (escribir
 * en un tablero donde solo mira) y RATE_LIMIT, uno que llegó de más.
 */
export const ERROR_CODES = [
  'INVALID_JSON',
  'INVALID_MESSAGE',
  'INVALID_UPDATE',
  'BOARD_LIMIT',
  'FORBIDDEN',
  'RATE_LIMIT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  /** Detalle legible para depurar; la interfaz muestra su propio texto según `code`. */
  message: string;
}

export type ServerMessage =
  | InitMessage
  | AccessMessage
  | DocUpdatedMessage
  | HeartbeatMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | PeerRenamedMessage
  | PeerCursorMessage
  | PeerFocusMessage
  | ErrorMessage;
export type ServerMessageType = ServerMessage['type'];
