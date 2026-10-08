import type { NoteColor, PresenceColor } from '@pizarra/shared';

/** Nombres visibles de la paleta. El `Record` obliga a cubrir todos los colores. */
export const COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Amarillo',
  pink: 'Rosa',
  green: 'Verde',
  blue: 'Celeste',
  lilac: 'Lila',
};

/**
 * Tonos de presencia (cursores, avatares, nota en edición). Todos tienen un
 * contraste AA (≥ 4,5:1) con texto blanco, porque los nombres van encima.
 */
export const PRESENCE_COLOR_HEX: Record<PresenceColor, string> = {
  red: '#c8372d',
  orange: '#b45309',
  green: '#2f7d32',
  teal: '#0f766e',
  sky: '#0369a1',
  indigo: '#4f46e5',
  violet: '#8e3cc8',
  pink: '#c0266d',
};
