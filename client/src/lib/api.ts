/**
 * Cliente de la API HTTP del servidor (cuentas y permisos).
 *
 * El token de sesión viaja en la cabecera `Authorization`, no en una cookie:
 * el cliente y el servidor están en dominios distintos y así no hay que pelear
 * con cookies de terceros ni con CSRF.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  AuthResponse,
  MemberRole,
  RoomAccessResponse,
  RoomMember,
  RoomVisibility,
  RoomsResponse,
  TicketResponse,
  UserResponse,
} from '@pizarra/shared';
import { API_URL } from '../config';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }

  /** La sesión ya no vale: hay que pedir que vuelva a entrar. */
  get expired(): boolean {
    return this.code === 'UNAUTHORIZED';
  }
}

interface RequestOptions {
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, { body, token, signal }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(token && { authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('SERVER_ERROR', 'No se pudo hablar con el servidor. Revisa tu conexión.', 0);
  }

  const text = await response.text();
  // Un proxy caído puede devolver HTML: se prefiere un error claro a un SyntaxError.
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const { error } = (parsed ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(error?.code ?? 'SERVER_ERROR', error?.message ?? 'El servidor devolvió un error.', response.status);
  }
  return parsed as T;
}

export const api = {
  register: (input: { email: string; name: string; password: string }) =>
    request<AuthResponse>('POST', '/auth/register', { body: input }),

  login: (input: { email: string; password: string }) =>
    request<AuthResponse>('POST', '/auth/login', { body: input }),

  logout: (token: string) => request<void>('POST', '/auth/logout', { token }),

  me: (token: string, signal?: AbortSignal) => request<UserResponse>('GET', '/auth/me', { token, signal }),

  rename: (token: string, name: string) => request<UserResponse>('PATCH', '/auth/me', { token, body: { name } }),

  /** Permiso de un solo uso para abrir el WebSocket. */
  ticket: (token: string) => request<TicketResponse>('POST', '/auth/ticket', { token }),

  rooms: (token: string, signal?: AbortSignal) => request<RoomsResponse>('GET', '/rooms', { token, signal }),

  roomAccess: (roomId: string, token: string | null, signal?: AbortSignal) =>
    request<RoomAccessResponse>('GET', `/rooms/${roomId}/access`, { token, signal }),

  setVisibility: (roomId: string, token: string, visibility: RoomVisibility) =>
    request<{ access: RoomAccessResponse['access'] }>('PATCH', `/rooms/${roomId}`, { token, body: { visibility } }),

  addMember: (roomId: string, token: string, input: { email: string; role: MemberRole }) =>
    request<{ members: RoomMember[] }>('POST', `/rooms/${roomId}/members`, { token, body: input }),

  removeMember: (roomId: string, token: string, userId: string) =>
    request<{ members: RoomMember[] }>('DELETE', `/rooms/${roomId}/members/${userId}`, { token }),
};
