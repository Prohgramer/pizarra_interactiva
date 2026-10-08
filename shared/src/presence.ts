import { BOARD_HEIGHT, BOARD_WIDTH } from './constants';
import { clamp, type Point } from './geometry';

/**
 * Presencia: quién está en la sala, dónde tiene el cursor y qué nota edita.
 * Es efímera: vive en la memoria del servidor y nunca se guarda en la base.
 */

/** Colores de presencia (cursores y avatares). Los tonos concretos viven en el cliente. */
export const PRESENCE_COLORS = ['red', 'orange', 'green', 'teal', 'sky', 'indigo', 'violet', 'pink'] as const;
export type PresenceColor = (typeof PRESENCE_COLORS)[number];

/** Largo máximo de un nombre, en caracteres (no en unidades UTF-16: un emoji cuenta uno). */
export const MAX_NAME_LENGTH = 32;

/** Nombre que asigna el servidor si el cliente no manda uno válido. */
export const DEFAULT_NAME = 'Invitado';

/** Intervalo mínimo entre dos envíos de la posición del cursor. */
export const CURSOR_THROTTLE_MS = 50;

export function isPresenceColor(value: unknown): value is PresenceColor {
  return typeof value === 'string' && (PRESENCE_COLORS as readonly string[]).includes(value);
}

/** Caracteres de control C0 (0x00–0x1F), DEL y C1 (0x7F–0x9F). */
function isControlChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Normaliza un nombre: sin caracteres de control, espacios colapsados, sin
 * espacios en los extremos y como mucho MAX_NAME_LENGTH caracteres. Puede
 * devolver '' (nombre inválido). Cliente y servidor usan la misma función.
 */
export function normalizeName(value: string): string {
  const cleaned = Array.from(value, (char) => (isControlChar(char) ? ' ' : char)).join('');
  const collapsed = cleaned.replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, MAX_NAME_LENGTH).join('').trim();
}

/** Ajusta la posición de un cursor al tablero (a diferencia de una nota, puede llegar al borde). */
export function clampCursor(x: number, y: number): Point {
  return {
    x: Math.round(clamp(x, 0, BOARD_WIDTH)),
    y: Math.round(clamp(y, 0, BOARD_HEIGHT)),
  };
}

export interface Identity {
  name: string;
  color: PresenceColor;
}

/**
 * La identidad viaja en la URL del WebSocket (`?name=…&color=…`), así el
 * servidor la conoce desde el handshake y el `init` ya trae el color asignado.
 */
export function identityQuery({ name, color }: Identity): string {
  return `?name=${encodeURIComponent(name)}&color=${encodeURIComponent(color)}`;
}
