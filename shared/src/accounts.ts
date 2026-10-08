/**
 * Cuentas y permisos: tipos y reglas que comparten cliente y servidor.
 *
 * Las cuentas son opcionales. Sin cuenta se puede seguir entrando a un tablero
 * público con su enlace (como hasta la Etapa 5); con cuenta, un tablero tiene
 * dueño, se puede restringir quién entra y quién escribe, y aparece en tu lista.
 */

/** Un correo largo no aporta nada y sí complica (límite del estándar). */
export const MAX_EMAIL_LENGTH = 254;

export const MIN_PASSWORD_LENGTH = 8;
/** Tope alto pero finito: derivar la clave de un texto enorme cuesta CPU. */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Comprobación deliberadamente floja: algo@algo.algo, sin espacios. Validar
 * correos con una expresión estricta rechaza direcciones válidas; lo único que
 * necesitamos es descartar lo que claramente no es un correo.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minúsculas y sin espacios alrededor: así «Ana@X.com » y «ana@x.com» son la misma cuenta. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

export function isPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value).length >= MIN_PASSWORD_LENGTH &&
    Array.from(value).length <= MAX_PASSWORD_LENGTH
  );
}

/** Una cuenta, como la ve quien inició sesión. El correo no sale nunca en la presencia. */
export interface User {
  id: string;
  email: string;
  name: string;
}

/** Cómo se llega a un tablero: con cuenta (dueño o invitado) o por el enlace. */
export const ACCESS_ROLES = ['owner', 'editor', 'viewer', 'guest'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

/** Roles que el dueño puede dar a otra persona. */
export const MEMBER_ROLES = ['editor', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Quién puede entrar por el enlace:
 * - `public`: cualquiera con el enlace edita (lo de siempre, y el valor por defecto);
 * - `link-read`: cualquiera con el enlace mira, solo el dueño y las personas invitadas editan;
 * - `private`: solo el dueño y las personas invitadas.
 */
export const ROOM_VISIBILITIES = ['public', 'link-read', 'private'] as const;
export type RoomVisibility = (typeof ROOM_VISIBILITIES)[number];

export const DEFAULT_VISIBILITY: RoomVisibility = 'public';

export function isVisibility(value: unknown): value is RoomVisibility {
  return typeof value === 'string' && (ROOM_VISIBILITIES as readonly string[]).includes(value);
}

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Lo que una persona puede hacer en un tablero. Lo decide siempre el servidor. */
export interface RoomAccess {
  visibility: RoomVisibility;
  role: AccessRole;
  canWrite: boolean;
  /** true si el tablero todavía no tiene dueño (nadie con cuenta escribió en él). */
  ownerless: boolean;
}

/** Acceso de un tablero público sin dueño: lo que había antes de las cuentas. */
export const OPEN_ACCESS: RoomAccess = {
  visibility: DEFAULT_VISIBILITY,
  role: 'guest',
  canWrite: true,
  ownerless: true,
};

/** Una persona invitada a un tablero (solo lo ve el dueño). */
export interface RoomMember {
  user: User;
  role: MemberRole;
}

/** Un tablero en «Tus tableros». */
export interface RoomSummary {
  id: string;
  role: AccessRole;
  visibility: RoomVisibility;
  /** ISO 8601; el cliente la formatea. */
  updatedAt: string;
}

/**
 * Cuánto dura una sesión sin usarse. Cada vez que se usa se renueva, así que
 * quien entra seguido no tiene que volver a identificarse.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * El ticket que autoriza a abrir el WebSocket. Es de un solo uso y dura poco:
 * la URL de una conexión puede terminar en registros y proxys, así que ahí no
 * viaja el token de sesión, sino esto, que ya no sirve para nada más.
 */
export const TICKET_TTL_MS = 30_000;
export const TICKET_PARAM = 'ticket';

/* ───────────── API HTTP ───────────── */

/**
 * Códigos de error de la API. El cliente decide qué texto mostrar según el
 * código; el `message` que acompaña sirve para depurar.
 */
export const API_ERROR_CODES = [
  'INVALID_BODY',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMIT',
  'NO_ACCOUNTS',
  'SERVER_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export interface AuthResponse {
  user: User;
  /** Va en la cabecera `Authorization: Bearer …` de las próximas peticiones. */
  token: string;
  /** ISO 8601. */
  expiresAt: string;
}

export interface UserResponse {
  user: User;
}

export interface TicketResponse {
  ticket: string;
  expiresIn: number;
}

export interface RoomsResponse {
  rooms: RoomSummary[];
}

/** Estado de permisos de un tablero. `members` solo viaja si quien pregunta es el dueño. */
export interface RoomAccessResponse {
  access: RoomAccess;
  owner: { id: string; name: string } | null;
  members?: RoomMember[];
}
