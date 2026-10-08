/**
 * Cuentas: registro, inicio de sesión, sesiones, tickets y permisos.
 *
 * Todo lo que decide quién puede hacer qué vive aquí; las rutas HTTP y el
 * WebSocket solo preguntan.
 */
import {
  DEFAULT_VISIBILITY,
  OPEN_ACCESS,
  SESSION_TTL_MS,
  normalizeEmail,
  type RoomAccess,
  type User,
} from '@pizarra/shared';
import { dummyHash, hashPassword, verifyPassword } from './passwords';
import { TicketStore, createToken, hashToken } from './tokens';
import type { AccountStore } from './types';

export interface Session {
  user: User;
  token: string;
  expiresAt: Date;
}

export interface AccountsOptions {
  now?: () => number;
  sessionTtlMs?: number;
  ticketTtlMs?: number;
}

/** Cada cuánto se renueva la fecha de vencimiento de una sesión que se usa. */
const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

export class Accounts {
  readonly store: AccountStore;
  readonly #tickets: TicketStore;
  readonly #now: () => number;
  readonly #sessionTtlMs: number;

  constructor(store: AccountStore, options: AccountsOptions = {}) {
    this.store = store;
    this.#now = options.now ?? Date.now;
    this.#sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
    this.#tickets = new TicketStore({ now: this.#now, ttlMs: options.ticketTtlMs });
  }

  /** Crea la cuenta y su primera sesión. null si el correo ya está registrado. */
  async register(input: { email: string; name: string; password: string }): Promise<Session | null> {
    const passwordHash = await hashPassword(input.password);
    const user = await this.store.createUser({
      email: normalizeEmail(input.email),
      name: input.name,
      passwordHash,
    });
    return user && this.#startSession(user);
  }

  /**
   * null si el correo no existe o la contraseña no coincide: quien lo intenta
   * no debe poder distinguir un caso del otro (ni por la respuesta ni por lo
   * que tarda, de ahí la comparación contra un hash de mentira).
   */
  async login(input: { email: string; password: string }): Promise<Session | null> {
    const found = await this.store.findUserByEmail(normalizeEmail(input.email));
    const hash = found?.passwordHash ?? (await dummyHash());
    const ok = await verifyPassword(input.password, hash);
    if (!found || !ok) return null;
    const { passwordHash: _passwordHash, ...user } = found;
    return this.#startSession(user);
  }

  /** Quién es el dueño de un token, renovando la sesión si hace rato que no se usa. */
  async authenticate(token: string): Promise<User | null> {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = await this.store.findSession(tokenHash);
    if (!session) return null;

    const now = this.#now();
    if (session.expiresAt.getTime() <= now) {
      await this.store.deleteSession(tokenHash);
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
      await this.store.touchSession(tokenHash, new Date(now + this.#sessionTtlMs));
    }
    return session.user;
  }

  async logout(token: string): Promise<void> {
    if (token) await this.store.deleteSession(hashToken(token));
  }

  async rename(userId: string, name: string): Promise<User | null> {
    return this.store.renameUser(userId, name);
  }

  issueTicket(userId: string): { ticket: string; expiresIn: number } {
    return this.#tickets.issue(userId);
  }

  /** Canjea el ticket del WebSocket (un solo uso) por su cuenta. */
  async consumeTicket(ticket: string): Promise<User | null> {
    const userId = this.#tickets.consume(ticket);
    return userId ? this.store.findUserById(userId) : null;
  }

  /**
   * Qué puede hacer `user` (o quien no tiene cuenta, con null) en este tablero.
   * Devuelve null si no puede ni mirarlo.
   *
   * Un tablero que todavía no está en la base, o que es de antes de las
   * cuentas, no tiene dueño: se comporta como público, igual que siempre.
   */
  async accessFor(roomId: string, user: User | null): Promise<RoomAccess | null> {
    const room = await this.store.findRoom(roomId);
    if (!room || room.ownerId === null) return { ...OPEN_ACCESS, visibility: room?.visibility ?? DEFAULT_VISIBILITY };

    const visibility = room.visibility;
    if (user && room.ownerId === user.id) return { visibility, role: 'owner', canWrite: true, ownerless: false };

    if (user) {
      const role = await this.store.memberRole(roomId, user.id);
      if (role) return { visibility, role, canWrite: role === 'editor', ownerless: false };
    }

    switch (visibility) {
      case 'public':
        return { visibility, role: 'guest', canWrite: true, ownerless: false };
      case 'link-read':
        return { visibility, role: 'guest', canWrite: false, ownerless: false };
      case 'private':
        return null;
    }
  }

  async #startSession(user: User): Promise<Session> {
    const token = createToken();
    const expiresAt = new Date(this.#now() + this.#sessionTtlMs);
    await this.store.createSession(hashToken(token), user.id, expiresAt);
    return { user, token, expiresAt };
  }
}
