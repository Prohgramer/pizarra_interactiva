/**
 * Límites y valores compartidos. El servidor los usa para validar y el cliente
 * para no enviar nunca algo que el servidor vaya a rechazar.
 */

/** Tamaño del tablero en píxeles CSS. */
export const BOARD_WIDTH = 4000;
export const BOARD_HEIGHT = 3000;

/** Tamaño fijo de cada nota. */
export const NOTE_WIDTH = 200;
export const NOTE_HEIGHT = 200;

/** Largo máximo del texto de una nota (en unidades UTF-16, igual que `maxLength`). */
export const MAX_TEXT_LENGTH = 1000;

/** Máximo de notas que admite un tablero (lo respeta la interfaz). */
export const MAX_NOTES = 200;

/**
 * Límites que aplica el servidor al validar el documento. Son más holgados que
 * los de la interfaz: al fusionar ediciones sin conexión de varias personas,
 * lo que cada una respetó por separado puede sumarse (dos personas agregan
 * notas a un tablero con 195), y un margen evita descartar trabajo legítimo.
 */
export const DOC_LIMITS = {
  notes: MAX_NOTES + 50,
  textLength: MAX_TEXT_LENGTH * 2,
} as const;

/** Inclinación máxima de una nota, en grados, hacia cada lado. */
export const MAX_ROTATION_DEG = 3;

/**
 * Tamaño máximo de un mensaje WebSocket entrante. Es alto porque al volver la
 * conexión el cliente envía en un solo update todo lo que editó sin conexión:
 * cubre el peor caso de un tablero lleno (DOC_LIMITS con texto de 3 bytes por
 * carácter, más base64).
 */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/** Tamaño máximo de cualquier otro mensaje (presencia): no tienen por qué ser grandes. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** Intervalo mínimo entre dos escrituras de posición mientras se arrastra. */
export const MOVE_THROTTLE_MS = 50;

/** Intervalo mínimo entre dos envíos de cambios del documento. */
export const SYNC_THROTTLE_MS = 50;

/**
 * Código con que el servidor cierra la conexión tras rechazar un update: el
 * cliente debe descartar su copia local y volver a sincronizarse (un update de
 * CRDT no se puede deshacer y los siguientes del mismo cliente dependerían de él).
 */
export const RESET_CLOSE_CODE = 4000;

/**
 * Código con que el servidor cierra una conexión que ya no puede estar en la
 * sala (el dueño restringió quién entra). El cliente no reintenta: avisa.
 */
export const FORBIDDEN_CLOSE_CODE = 4003;

/**
 * Cuántos mensajes por segundo acepta una conexión y cuántos puede acumular de
 * golpe. Lo normal son ~45 (cursor y arrastre, uno cada 50 ms); pasarse mucho
 * de ahí no es un uso legítimo, así que se corta.
 */
export const MESSAGE_RATE_PER_SECOND = 100;
export const MESSAGE_BURST = 300;

/**
 * Cada cuánto el servidor da señales de vida: un ping del protocolo (que el
 * navegador responde solo, y detecta clientes fantasma) y un mensaje
 * `heartbeat`, que el cliente sí puede ver desde JavaScript.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Si el cliente pasa este tiempo sin recibir nada, da la conexión por muerta y
 * reconecta. Un socket puede quedar «zombi» (abierto para el navegador pero sin
 * nadie del otro lado) si el servidor cae de golpe, y desde JavaScript no hay
 * forma de ver los pong del protocolo.
 */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2.5;

/** Paleta fija de colores. Los nombres visibles viven en el cliente. */
export const NOTE_COLORS = ['yellow', 'pink', 'green', 'blue', 'lilac'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === 'string' && (NOTE_COLORS as readonly string[]).includes(value);
}

/** UUID v1-v8 en formato canónico y en minúsculas (el cliente genera v4). */
export const NOTE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
