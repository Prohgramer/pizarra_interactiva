/**
 * API HTTP de cuentas y permisos.
 *
 * Es el único lugar donde se crean cuentas y se decide quién puede entrar a un
 * tablero; el WebSocket solo pregunta el resultado. Sin base de datos no hay
 * cuentas: todas estas rutas responden 503 y el servidor funciona como antes
 * de esta etapa (tableros públicos, sin dueño).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  isRoomId,
  type AuthResponse,
  type RoomAccessResponse,
  type RoomsResponse,
  type TicketResponse,
  type User,
  type UserResponse,
} from '@pizarra/shared';
import type { Accounts } from '../accounts';
import type { AllowedOrigins } from '../config';
import { RateLimiter } from '../rate-limit';
import {
  parseCredentials,
  parseMemberInput,
  parseNameChange,
  parseRegistration,
  parseVisibilityChange,
  type BodyResult,
} from '../validation';
import { applyCors, bearerToken, clientAddress, readJsonBody, sendEmpty, sendError, sendJson } from './respond';

export interface ApiOptions {
  accounts: Accounts | null;
  allowedOrigins: AllowedOrigins;
  /** Se llama cuando cambia quién puede entrar a una sala (para las conexiones abiertas). */
  onAccessChanged?: (roomId: string) => void;
  log: (message: string) => void;
  now?: () => number;
}

/** Devuelve true si la petición era de la API (y ya está respondida). */
export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

function authResponse(session: { user: User; token: string; expiresAt: Date }): AuthResponse {
  return { user: session.user, token: session.token, expiresAt: session.expiresAt.toISOString() };
}

export function createApi({ accounts, allowedOrigins, onAccessChanged, log, now }: ApiOptions): ApiHandler {
  // Identificarse cuesta: pocos intentos por dirección y se reponen despacio.
  const attempts = new RateLimiter({ capacity: 10, refillPerSecond: 1 / 30, now });
  // El resto de la API: uso normal holgado, pero no ilimitado.
  const general = new RateLimiter({ capacity: 120, refillPerSecond: 2, now });

  return async function handle(req, res) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const segments = pathname.split('/').filter((part) => part.length > 0);
    const [first, second] = segments;
    if (first !== 'auth' && first !== 'rooms') return false;
    // `/rooms/<id>` a secas es el WebSocket de la sala, no una ruta de la API.
    if (first === 'rooms' && segments.length === 2 && req.method === 'GET') return false;

    applyCors(req, res, allowedOrigins);
    if (req.method === 'OPTIONS') {
      sendEmpty(res, 204);
      return true;
    }

    if (!accounts) {
      sendError(res, 'NO_ACCOUNTS', 'Este servidor no tiene base de datos: las cuentas están deshabilitadas.');
      return true;
    }
    const service = accounts;

    const address = clientAddress(req);
    const isAttempt = pathname === '/auth/login' || pathname === '/auth/register';
    if (!(isAttempt ? attempts : general).take(address)) {
      log(`Demasiadas peticiones desde ${address} a ${pathname}.`);
      sendError(res, 'RATE_LIMIT', 'Demasiados intentos. Prueba de nuevo en un rato.');
      return true;
    }

    /** Cuerpo JSON validado, o null si ya se respondió con el error. */
    async function body<T>(parse: (value: unknown) => BodyResult<T>): Promise<T | null> {
      const read = await readJsonBody(req);
      if (!read.ok) {
        sendError(res, 'INVALID_BODY', read.reason);
        return null;
      }
      const parsed = parse(read.value);
      if (!parsed.ok) {
        sendError(res, 'INVALID_BODY', parsed.reason);
        return null;
      }
      return parsed.value;
    }

    /** Cuenta de quien hace la petición, o null si ya se respondió con 401. */
    async function requireUser(): Promise<User | null> {
      const found = await service.authenticate(bearerToken(req));
      if (!found) sendError(res, 'UNAUTHORIZED', 'Necesitas iniciar sesión.');
      return found;
    }

    const method = req.method ?? 'GET';
    const route = `${method} /${segments.join('/')}`;

    /* ───────────── Cuentas ───────────── */

    if (route === 'POST /auth/register') {
      const input = await body(parseRegistration);
      if (!input) return true;
      const session = await service.register(input);
      if (!session) {
        sendError(res, 'EMAIL_TAKEN', 'Ya hay una cuenta con ese correo.');
        return true;
      }
      // Registrarse bien no debe gastarle los intentos a quien comparte la IP.
      attempts.forget(address);
      log(`Cuenta nueva: ${session.user.email}.`);
      sendJson(res, 201, authResponse(session));
      return true;
    }

    if (route === 'POST /auth/login') {
      const input = await body(parseCredentials);
      if (!input) return true;
      const session = await service.login(input);
      if (!session) {
        sendError(res, 'INVALID_CREDENTIALS', 'El correo o la contraseña no coinciden.');
        return true;
      }
      attempts.forget(address);
      sendJson(res, 200, authResponse(session));
      return true;
    }

    if (route === 'POST /auth/logout') {
      await service.logout(bearerToken(req));
      sendEmpty(res, 204);
      return true;
    }

    if (route === 'GET /auth/me') {
      const user = await requireUser();
      if (!user) return true;
      sendJson(res, 200, { user } satisfies UserResponse);
      return true;
    }

    if (route === 'PATCH /auth/me') {
      const user = await requireUser();
      if (!user) return true;
      const input = await body(parseNameChange);
      if (!input) return true;
      const updated = await service.rename(user.id, input.name);
      if (!updated) {
        sendError(res, 'NOT_FOUND', 'La cuenta ya no existe.');
        return true;
      }
      sendJson(res, 200, { user: updated } satisfies UserResponse);
      return true;
    }

    if (route === 'POST /auth/ticket') {
      const user = await requireUser();
      if (!user) return true;
      sendJson(res, 200, service.issueTicket(user.id) satisfies TicketResponse);
      return true;
    }

    /* ───────────── Tableros ───────────── */

    if (route === 'GET /rooms') {
      const user = await requireUser();
      if (!user) return true;
      sendJson(res, 200, { rooms: await service.store.listRoomsFor(user.id) } satisfies RoomsResponse);
      return true;
    }

    if (first !== 'rooms' || !isRoomId(second)) {
      sendError(res, 'NOT_FOUND', 'Ruta desconocida.');
      return true;
    }
    const roomId = second;
    const rest = segments.slice(2).join('/');

    // Quién pregunta: puede no tener cuenta (un tablero público se mira sin ella).
    const user = await service.authenticate(bearerToken(req));

    if (method === 'GET' && rest === 'access') {
      const access = await service.accessFor(roomId, user);
      if (!access) {
        sendError(res, 'FORBIDDEN', 'Este tablero es privado.');
        return true;
      }
      const room = await service.store.findRoom(roomId);
      const owner = room?.ownerId ? await service.store.findUserById(room.ownerId) : null;
      const response: RoomAccessResponse = {
        access,
        owner: owner && { id: owner.id, name: owner.name },
        ...(access.role === 'owner' && { members: await service.store.listMembers(roomId) }),
      };
      sendJson(res, 200, response);
      return true;
    }

    /** Solo el dueño administra el tablero. */
    async function requireOwner(): Promise<boolean> {
      if (!user) {
        sendError(res, 'UNAUTHORIZED', 'Necesitas iniciar sesión.');
        return false;
      }
      const access = await service.accessFor(roomId, user);
      if (access?.role !== 'owner') {
        sendError(res, 'FORBIDDEN', 'Solo quien creó el tablero puede cambiar esto.');
        return false;
      }
      return true;
    }

    if (method === 'PATCH' && rest === '') {
      if (!(await requireOwner())) return true;
      const input = await body(parseVisibilityChange);
      if (!input) return true;
      await service.store.setVisibility(roomId, input.visibility);
      onAccessChanged?.(roomId);
      log(`Tablero ${roomId}: ahora es ${input.visibility}.`);
      sendJson(res, 200, { access: await service.accessFor(roomId, user) });
      return true;
    }

    if (method === 'POST' && rest === 'members') {
      if (!(await requireOwner())) return true;
      const input = await body(parseMemberInput);
      if (!input) return true;
      const invited = await service.store.findUserByEmail(input.email);
      if (!invited) {
        sendError(res, 'NOT_FOUND', 'No hay ninguna cuenta con ese correo.');
        return true;
      }
      if (invited.id === user?.id) {
        sendError(res, 'INVALID_BODY', 'Ya eres el dueño de este tablero.');
        return true;
      }
      await service.store.addMember(roomId, invited.id, input.role);
      onAccessChanged?.(roomId);
      sendJson(res, 200, { members: await service.store.listMembers(roomId) });
      return true;
    }

    if (method === 'DELETE' && rest.startsWith('members/')) {
      if (!(await requireOwner())) return true;
      const removed = await service.store.removeMember(roomId, rest.slice('members/'.length));
      if (!removed) {
        sendError(res, 'NOT_FOUND', 'Esa persona no estaba invitada.');
        return true;
      }
      onAccessChanged?.(roomId);
      sendJson(res, 200, { members: await service.store.listMembers(roomId) });
      return true;
    }

    sendError(res, 'NOT_FOUND', 'Ruta desconocida.');
    return true;
  };
}
