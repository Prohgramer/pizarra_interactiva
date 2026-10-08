import { BOARD_HEIGHT, BOARD_WIDTH, MAX_ROTATION_DEG, NOTE_HEIGHT, NOTE_WIDTH } from './constants';

export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normaliza la esquina superior izquierda de una nota para que quede entera
 * dentro del tablero. Cliente y servidor usan la misma función, así el valor
 * optimista del emisor coincide con el que el servidor reenvía a los demás.
 */
export function clampNotePosition(x: number, y: number): Point {
  return {
    x: Math.round(clamp(x, 0, BOARD_WIDTH - NOTE_WIDTH)),
    y: Math.round(clamp(y, 0, BOARD_HEIGHT - NOTE_HEIGHT)),
  };
}

/** Limita la inclinación a ±MAX_ROTATION_DEG con dos decimales. */
export function clampRotation(degrees: number): number {
  return Math.round(clamp(degrees, -MAX_ROTATION_DEG, MAX_ROTATION_DEG) * 100) / 100;
}
