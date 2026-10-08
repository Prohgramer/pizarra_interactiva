/**
 * Límite de ritmo con cubo de fichas: cada clave (una IP, una conexión) tiene
 * un cubo que se rellena solo. Mientras queden fichas se atiende; cuando se
 * acaban, se rechaza. Permite ráfagas cortas sin castigar el uso normal.
 */
export interface RateLimitOptions {
  /** Fichas que caben en el cubo: cuántas peticiones seguidas se toleran. */
  capacity: number;
  /** Fichas que se reponen por segundo. */
  refillPerSecond: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #options: Required<RateLimitOptions>;

  constructor(options: RateLimitOptions) {
    // El `??` importa: quien pasa `now: undefined` quiere el reloj por defecto.
    this.#options = { ...options, now: options.now ?? Date.now };
  }

  get size(): number {
    return this.#buckets.size;
  }

  /** Toma una ficha. false si no quedaban (hay que rechazar la petición). */
  take(key: string, cost = 1): boolean {
    const { capacity, refillPerSecond, now } = this.#options;
    const at = now();
    const bucket = this.#buckets.get(key) ?? { tokens: capacity, updatedAt: at };

    const refill = ((at - bucket.updatedAt) / 1000) * refillPerSecond;
    bucket.tokens = Math.min(capacity, bucket.tokens + refill);
    bucket.updatedAt = at;

    const allowed = bucket.tokens >= cost;
    if (allowed) bucket.tokens -= cost;

    // El cubo lleno es indistinguible de uno nuevo: se olvida y no crece la memoria.
    if (bucket.tokens >= capacity) this.#buckets.delete(key);
    else this.#buckets.set(key, bucket);

    return allowed;
  }

  forget(key: string): void {
    this.#buckets.delete(key);
  }
}
