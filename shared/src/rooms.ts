/**
 * Salas. El id lo genera el cliente al crear un tablero: 12 caracteres [a-z0-9]
 * (~62 bits de azar), así el enlace no se puede adivinar. La sala se guarda en
 * la base de datos recién cuando tiene su primera nota.
 */
export const ROOM_ID_LENGTH = 12;
export const ROOM_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const ROOM_ID_PATTERN = /^[a-z0-9]{12}$/;

/** Ruta del WebSocket de una sala en el servidor: `/rooms/<id>`. */
export const ROOM_SOCKET_PREFIX = '/rooms/';

export function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

export function roomSocketPath(roomId: string): string {
  return `${ROOM_SOCKET_PREFIX}${roomId}`;
}

/**
 * Genera un id de sala con la fuente de azar que se le pase, que debe llenar
 * el array recibido (en el navegador, `crypto.getRandomValues`). Descarta los
 * bytes ≥ 252 para que los 36 caracteres tengan exactamente la misma probabilidad.
 */
export function createRoomId(fillRandom: (bytes: Uint8Array<ArrayBuffer>) => unknown): string {
  const limit = Math.floor(256 / ROOM_ID_ALPHABET.length) * ROOM_ID_ALPHABET.length;
  let id = '';
  while (id.length < ROOM_ID_LENGTH) {
    const bytes = new Uint8Array(ROOM_ID_LENGTH * 2);
    fillRandom(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      id += ROOM_ID_ALPHABET[byte % ROOM_ID_ALPHABET.length];
      if (id.length === ROOM_ID_LENGTH) break;
    }
  }
  return id;
}
