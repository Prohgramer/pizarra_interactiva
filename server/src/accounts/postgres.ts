/**
 * Cuentas, sesiones y permisos en PostgreSQL. SQL a mano, como el resto del
 * proyecto: cada consulta se lee y se puede explicar.
 */
import {
  isMemberRole,
  isVisibility,
  DEFAULT_VISIBILITY,
  type MemberRole,
  type RoomMember,
  type RoomSummary,
  type RoomVisibility,
  type User,
} from '@pizarra/shared';
import type { Database } from '../db/database';
import type { AccountStore, RoomRecord, StoredSession, StoredUser } from './types';

interface UserRow {
  id: string;
  email: string;
  name: string;
}

interface UserWithHashRow extends UserRow {
  password_hash: string;
}

/** Violación de una restricción de unicidad (correo ya registrado). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name };
}

export class PostgresAccounts implements AccountStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async createUser({
    email,
    name,
    passwordHash,
  }: {
    email: string;
    name: string;
    passwordHash: string;
  }): Promise<User | null> {
    try {
      const { rows } = await this.#db.query<UserRow>(
        `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
         RETURNING id, email, name`,
        [email, name, passwordHash],
      );
      return rows[0] ? toUser(rows[0]) : null;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const { rows } = await this.#db.query<UserWithHashRow>(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email],
    );
    const row = rows[0];
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  async findUserById(id: string): Promise<User | null> {
    const { rows } = await this.#db.query<UserRow>('SELECT id, email, name FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async renameUser(id: string, name: string): Promise<User | null> {
    const { rows } = await this.#db.query<UserRow>(
      'UPDATE users SET name = $2, updated_at = now() WHERE id = $1 RETURNING id, email, name',
      [id, name],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async createSession(tokenHash: Uint8Array, userId: string, expiresAt: Date): Promise<void> {
    await this.#db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      Buffer.from(tokenHash),
      userId,
      expiresAt,
    ]);
  }

  async findSession(tokenHash: Uint8Array): Promise<StoredSession | null> {
    const { rows } = await this.#db.query<UserRow & { expires_at: Date; last_seen_at: Date }>(
      `SELECT u.id, u.email, u.name, s.expires_at, s.last_seen_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [Buffer.from(tokenHash)],
    );
    const row = rows[0];
    if (!row) return null;
    return { user: toUser(row), expiresAt: new Date(row.expires_at), lastSeenAt: new Date(row.last_seen_at) };
  }

  async touchSession(tokenHash: Uint8Array, expiresAt: Date): Promise<void> {
    await this.#db.query('UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE token_hash = $1', [
      Buffer.from(tokenHash),
      expiresAt,
    ]);
  }

  async deleteSession(tokenHash: Uint8Array): Promise<void> {
    await this.#db.query('DELETE FROM sessions WHERE token_hash = $1', [Buffer.from(tokenHash)]);
  }

  async deleteExpiredSessions(): Promise<number> {
    const { rows } = await this.#db.query<{ id: string }>(
      'DELETE FROM sessions WHERE expires_at <= now() RETURNING token_hash AS id',
    );
    return rows.length;
  }

  async findRoom(roomId: string): Promise<RoomRecord | null> {
    const { rows } = await this.#db.query<{ id: string; owner_id: string | null; visibility: string }>(
      'SELECT id, owner_id, visibility FROM rooms WHERE id = $1',
      [roomId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      ownerId: row.owner_id,
      // La columna tiene CHECK, pero el tipo se estrecha aquí igual que con todo lo que entra.
      visibility: isVisibility(row.visibility) ? row.visibility : DEFAULT_VISIBILITY,
    };
  }

  async setVisibility(roomId: string, visibility: RoomVisibility): Promise<boolean> {
    const { rows } = await this.#db.query<{ id: string }>(
      'UPDATE rooms SET visibility = $2, updated_at = now() WHERE id = $1 RETURNING id',
      [roomId, visibility],
    );
    return rows.length > 0;
  }

  async memberRole(roomId: string, userId: string): Promise<MemberRole | null> {
    const { rows } = await this.#db.query<{ role: string }>(
      'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId],
    );
    const role = rows[0]?.role;
    return isMemberRole(role) ? role : null;
  }

  async listMembers(roomId: string): Promise<RoomMember[]> {
    const { rows } = await this.#db.query<UserRow & { role: string }>(
      `SELECT u.id, u.email, u.name, m.role
         FROM room_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.room_id = $1
        ORDER BY u.name, u.email`,
      [roomId],
    );
    return rows.flatMap((row) => (isMemberRole(row.role) ? [{ user: toUser(row), role: row.role }] : []));
  }

  async addMember(roomId: string, userId: string, role: MemberRole): Promise<void> {
    await this.#db.query(
      `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (room_id, user_id) DO UPDATE SET role = excluded.role`,
      [roomId, userId, role],
    );
  }

  async removeMember(roomId: string, userId: string): Promise<boolean> {
    const { rows } = await this.#db.query<{ user_id: string }>(
      'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2 RETURNING user_id',
      [roomId, userId],
    );
    return rows.length > 0;
  }

  async listRoomsFor(userId: string): Promise<RoomSummary[]> {
    const { rows } = await this.#db.query<{
      id: string;
      visibility: string;
      role: string;
      updated_at: Date;
    }>(
      `SELECT r.id,
              r.visibility,
              CASE WHEN r.owner_id = $1 THEN 'owner' ELSE m.role END AS role,
              r.updated_at
         FROM rooms r
         LEFT JOIN room_members m ON m.room_id = r.id AND m.user_id = $1
        WHERE r.owner_id = $1 OR m.user_id = $1
        ORDER BY r.updated_at DESC
        LIMIT 100`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      role: row.role === 'owner' ? 'owner' : isMemberRole(row.role) ? row.role : 'viewer',
      visibility: isVisibility(row.visibility) ? row.visibility : DEFAULT_VISIBILITY,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }
}
