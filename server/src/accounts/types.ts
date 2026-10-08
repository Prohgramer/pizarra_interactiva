import type { MemberRole, RoomMember, RoomSummary, RoomVisibility, User } from '@pizarra/shared';

/** Una cuenta con su hash: solo sale del almacén para comprobar la contraseña. */
export interface StoredUser extends User {
  passwordHash: string;
}

export interface StoredSession {
  user: User;
  expiresAt: Date;
  lastSeenAt: Date;
}

/** Lo que la base sabe de un tablero además de su documento. */
export interface RoomRecord {
  id: string;
  ownerId: string | null;
  visibility: RoomVisibility;
}

/**
 * Cuentas, sesiones y permisos. Necesita PostgreSQL: sin base de datos no hay
 * cuentas (una cuenta que se pierde al reiniciar no sirve de nada), y el
 * servidor funciona como antes de esta etapa, con tableros públicos.
 */
export interface AccountStore {
  /** null si el correo ya está registrado. */
  createUser(input: { email: string; name: string; passwordHash: string }): Promise<User | null>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<User | null>;
  renameUser(id: string, name: string): Promise<User | null>;

  createSession(tokenHash: Uint8Array, userId: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: Uint8Array): Promise<StoredSession | null>;
  /** Renueva una sesión en uso (se llama de a ratos, no en cada petición). */
  touchSession(tokenHash: Uint8Array, expiresAt: Date): Promise<void>;
  deleteSession(tokenHash: Uint8Array): Promise<void>;
  deleteExpiredSessions(): Promise<number>;

  findRoom(roomId: string): Promise<RoomRecord | null>;
  setVisibility(roomId: string, visibility: RoomVisibility): Promise<boolean>;
  memberRole(roomId: string, userId: string): Promise<MemberRole | null>;
  listMembers(roomId: string): Promise<RoomMember[]>;
  /** Agrega o cambia el rol de una persona invitada. */
  addMember(roomId: string, userId: string, role: MemberRole): Promise<void>;
  removeMember(roomId: string, userId: string): Promise<boolean>;
  /** Tableros propios y aquellos a los que la invitaron, del más reciente al más viejo. */
  listRoomsFor(userId: string): Promise<RoomSummary[]>;
}
