import { randomBytes } from 'node:crypto';
import { PRESENCE_COLORS, type PresenceColor } from '@pizarra/shared';

/** Id de una conexión dentro de su sala. Es aleatorio y no identifica a la persona fuera de ella. */
export function createPeerId(): string {
  return randomBytes(6).toString('base64url');
}

/**
 * Elige el color de quien entra: su preferido si nadie lo usa; si no, el
 * menos usado de la paleta (en orden, para que sea predecible). Si el
 * preferido empata con el mínimo, se respeta igual.
 */
export function assignPresenceColor(
  preferred: PresenceColor | undefined,
  taken: readonly PresenceColor[],
): PresenceColor {
  const usage = new Map<PresenceColor, number>(PRESENCE_COLORS.map((color) => [color, 0]));
  for (const color of taken) usage.set(color, (usage.get(color) ?? 0) + 1);

  const minimum = Math.min(...usage.values());
  if (preferred && usage.get(preferred) === minimum) return preferred;
  return PRESENCE_COLORS.find((color) => usage.get(color) === minimum) ?? PRESENCE_COLORS[0];
}
