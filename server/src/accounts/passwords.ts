/**
 * Contraseñas: derivación con scrypt (viene en Node, sin dependencias).
 *
 * El hash guardado incluye los parámetros y la sal, así se pueden subir los
 * costos más adelante sin invalidar las contraseñas ya guardadas:
 *
 *     scrypt$16384$8$1$<sal en base64>$<clave en base64>
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** N = 2^14: unos 16 MB y ~50 ms por intento en una máquina normal. */
const PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, KEY_LENGTH, PARAMS);
  return [PREFIX, PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Compara en tiempo constante. Devuelve false ante cualquier hash que no
 * entienda, en vez de lanzar: un registro corrupto no debe dejar entrar.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const N = parsePositiveInt(parts[1]);
  const r = parsePositiveInt(parts[2]);
  const p = parsePositiveInt(parts[3]);
  if (N === null || r === null || p === null) return false;

  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const key = await derive(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/**
 * Hash de una contraseña que nadie tiene, calculado la primera vez que hace
 * falta. Al intentar entrar con un correo que no existe se compara contra
 * esto: así responder tarda lo mismo y no se puede averiguar qué correos están
 * registrados midiendo el tiempo.
 */
let dummy: Promise<string> | null = null;

export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString('base64'));
  return dummy;
}
