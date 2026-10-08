/**
 * Tokens de sesión y tickets del WebSocket.
 *
 * El token viaja en la cabecera `Authorization` y se guarda hasheado. El
 * ticket es otra cosa: un permiso de un solo uso y de vida corta para abrir el
 * socket, porque una URL puede terminar en registros y proxys y ahí no puede
 * ir algo que sirva por 30 días.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TICKET_TTL_MS } from '@pizarra/shared';

/** 32 bytes de azar en base64url: suficiente para que no se pueda adivinar. */
export function createToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** Comparación en tiempo constante de dos hashes del mismo largo. */
export function sameToken(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Ticket {
  userId: string;
  expiresAt: number;
}

/**
 * Tickets en memoria: duran segundos y se consumen al usarse, así que no vale
 * la pena guardarlos en la base (y con un solo proceso por sala, alcanza).
 */
export class TicketStore {
  readonly #tickets = new Map<string, Ticket>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? TICKET_TTL_MS;
  }

  get size(): number {
    return this.#tickets.size;
  }

  issue(userId: string): { ticket: string; expiresIn: number } {
    this.#collect();
    const ticket = createToken();
    this.#tickets.set(ticket, { userId, expiresAt: this.#now() + this.#ttlMs });
    return { ticket, expiresIn: this.#ttlMs };
  }

  /** Devuelve el id de quien lo pidió y lo invalida. null si no existe o venció. */
  consume(ticket: string): string | null {
    const found = this.#tickets.get(ticket);
    if (!found) return null;
    this.#tickets.delete(ticket);
    return found.expiresAt > this.#now() ? found.userId : null;
  }

  #collect(): void {
    const now = this.#now();
    for (const [ticket, { expiresAt }] of this.#tickets) {
      if (expiresAt <= now) this.#tickets.delete(ticket);
    }
  }
}
