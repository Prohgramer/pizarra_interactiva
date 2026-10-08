import { PRESENCE_COLORS, isPresenceColor, normalizeName, type Identity } from '@pizarra/shared';

/**
 * Identidad de esta persona (nombre y color preferido), guardada en el
 * navegador para que sea la misma en todos los tableros y entre visitas.
 */
const STORAGE_KEY = 'pizarra:identidad';

const ANIMALS: ReadonlyArray<readonly [string, 'f' | 'm']> = [
  ['Nutria', 'f'],
  ['Zorro', 'm'],
  ['Búho', 'm'],
  ['Ballena', 'f'],
  ['Colibrí', 'm'],
  ['Tortuga', 'f'],
  ['Pingüino', 'm'],
  ['Jirafa', 'f'],
  ['Carpincho', 'm'],
  ['Llama', 'f'],
  ['Mapache', 'm'],
  ['Ardilla', 'f'],
  ['Pulpo', 'm'],
  ['Abeja', 'f'],
];

/** [masculino, femenino]: el adjetivo concuerda con el animal. */
const ADJECTIVES: ReadonlyArray<readonly [string, string]> = [
  ['curioso', 'curiosa'],
  ['veloz', 'veloz'],
  ['sereno', 'serena'],
  ['ingenioso', 'ingeniosa'],
  ['audaz', 'audaz'],
  ['creativo', 'creativa'],
  ['atento', 'atenta'],
  ['alegre', 'alegre'],
  ['valiente', 'valiente'],
  ['sabio', 'sabia'],
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

export function randomName(): string {
  const [animal, gender] = pick(ANIMALS);
  const [masculine, feminine] = pick(ADJECTIVES);
  return `${animal} ${gender === 'f' ? feminine : masculine}`;
}

/**
 * Lee la identidad guardada o inventa una nueva (`isNew`). No escribe nada:
 * quien la usa decide cuándo guardarla (StrictMode llama dos veces a los
 * inicializadores y no queremos dos nombres distintos).
 */
export function loadIdentity(): { identity: Identity; isNew: boolean } {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof parsed === 'object' && parsed !== null) {
      const { name, color } = parsed as Record<string, unknown>;
      const normalized = typeof name === 'string' ? normalizeName(name) : '';
      if (normalized && isPresenceColor(color)) return { identity: { name: normalized, color }, isNew: false };
    }
  } catch {
    // Almacenamiento no disponible o dato corrupto: se inventa una identidad nueva.
  }
  return { identity: { name: randomName(), color: pick(PRESENCE_COLORS) }, isNew: true };
}

export function saveIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Sin almacenamiento: la identidad dura lo que la pestaña.
  }
}

/** «Nutria curiosa» → «NC»; «lucía» → «L». */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toLocaleUpperCase('es') || '?';
}
