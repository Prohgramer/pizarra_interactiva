/**
 * Validación y normalización de los mensajes que llegan de los clientes.
 *
 * El servidor no confía en nada de lo que recibe: cada campo se lee de forma
 * explícita, se comprueba su tipo y se construye un objeto nuevo solo con los
 * campos conocidos (los extra se descartan). Escrito a mano, sin librerías,
 * para que las reglas sean visibles y fáciles de auditar.
 *
 * Aquí se valida la forma de los mensajes. El contenido de un `doc:update`
 * (un update binario de Yjs) se valida después, aplicándolo a una copia de
 * prueba del documento y revisando el resultado (ver `Room.applyUpdate`).
 */
import {
  BASE64_PATTERN,
  DEFAULT_NAME,
  MAX_MESSAGE_BYTES,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  NOTE_ID_PATTERN,
  TICKET_PARAM,
  clampCursor,
  isEmail,
  isMemberRole,
  isPassword,
  isPresenceColor,
  isVisibility,
  normalizeEmail,
  normalizeName,
  type ClientMessage,
  type ClientMessageType,
  type ErrorCode,
  type MemberRole,
  type Point,
  type PresenceColor,
  type RoomVisibility,
} from '@pizarra/shared';

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ErrorCode; reason: string };

type RawObject = Record<string, unknown>;

class ValidationError extends Error {}

function fail(reason: string): never {
  throw new ValidationError(reason);
}

function isObject(value: unknown): value is RawObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lee solo propiedades propias, para no confundir un campo ausente con algo heredado. */
function field(source: RawObject, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function readId(source: RawObject, key = 'id'): string {
  const value = field(source, key);
  if (typeof value !== 'string' || !NOTE_ID_PATTERN.test(value)) fail(`«${key}» debe ser un UUID en minúsculas.`);
  return value;
}

function readFiniteNumber(source: RawObject, key: string): number {
  const value = field(source, key);
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`«${key}» debe ser un número finito.`);
  return value;
}

/**
 * Un validador por tipo de mensaje. El tipo mapeado obliga a que exista uno
 * para cada mensaje del protocolo: si se agrega un mensaje en `shared`, esto
 * deja de compilar hasta que se valide.
 */
const validators: { [K in ClientMessageType]: (raw: RawObject) => Extract<ClientMessage, { type: K }> } = {
  'doc:update': (raw) => {
    const update = field(raw, 'update');
    if (typeof update !== 'string' || update.length === 0 || !BASE64_PATTERN.test(update)) {
      fail('«update» debe ser un update de Yjs en base64.');
    }
    return { type: 'doc:update', update };
  },

  'presence:cursor': (raw) => {
    if (!Object.hasOwn(raw, 'cursor')) fail('Falta «cursor» (un punto o null).');
    const value = field(raw, 'cursor');
    let cursor: Point | null = null;
    if (value !== null) {
      if (!isObject(value)) fail('«cursor» debe ser un punto o null.');
      cursor = clampCursor(readFiniteNumber(value, 'x'), readFiniteNumber(value, 'y'));
    }
    return { type: 'presence:cursor', cursor };
  },

  'presence:focus': (raw) => {
    if (!Object.hasOwn(raw, 'noteId')) fail('Falta «noteId» (un id de nota o null).');
    const noteId = field(raw, 'noteId') === null ? null : readId(raw, 'noteId');
    return { type: 'presence:focus', noteId };
  },

  'presence:rename': (raw) => {
    const value = field(raw, 'name');
    if (typeof value !== 'string') fail('«name» debe ser un texto.');
    const name = normalizeName(value);
    if (!name) fail('«name» no puede quedar vacío.');
    return { type: 'presence:rename', name };
  },
};

function isClientMessageType(value: unknown): value is ClientMessageType {
  return typeof value === 'string' && Object.hasOwn(validators, value);
}

export interface RequestedIdentity {
  name: string;
  /** Color que la persona prefiere; el servidor lo respeta si está libre en la sala. */
  preferredColor: PresenceColor | undefined;
  /** Ticket de un solo uso de quien inició sesión (`?ticket=…`), si lo hay. */
  ticket: string | undefined;
}

/**
 * Lee la identidad de la URL del WebSocket (`?name=…&color=…&ticket=…`). Nunca
 * rechaza la conexión: un nombre inválido pasa a DEFAULT_NAME y un color
 * inválido se ignora (el servidor asigna uno libre). Si hay ticket, el nombre
 * de la cuenta manda sobre el de la URL.
 */
export function parseIdentity(url: string | undefined): RequestedIdentity {
  const params = new URL(url ?? '/', 'http://localhost').searchParams;
  const color = params.get('color');
  const ticket = params.get(TICKET_PARAM)?.trim();
  return {
    name: normalizeName(params.get('name') ?? '') || DEFAULT_NAME,
    preferredColor: isPresenceColor(color) ? color : undefined,
    ticket: ticket ? ticket : undefined,
  };
}

/* ───────────── Cuerpos de la API HTTP ───────────── */

export type BodyResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function readBody<T>(body: unknown, read: (raw: RawObject) => T): BodyResult<T> {
  if (!isObject(body)) return { ok: false, reason: 'El cuerpo debe ser un objeto JSON.' };
  try {
    return { ok: true, value: read(body) };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, reason: error.message };
    throw error;
  }
}

function readEmail(raw: RawObject): string {
  const value = field(raw, 'email');
  if (typeof value !== 'string') fail('«email» debe ser un texto.');
  const email = normalizeEmail(value);
  if (!isEmail(email)) fail('El correo no parece válido.');
  return email;
}

function readPassword(raw: RawObject): string {
  const value = field(raw, 'password');
  if (typeof value !== 'string') fail('«password» debe ser un texto.');
  if (!isPassword(value)) {
    fail(`La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`);
  }
  return value;
}

function readName(raw: RawObject): string {
  const value = field(raw, 'name');
  if (typeof value !== 'string') fail('«name» debe ser un texto.');
  const name = normalizeName(value);
  if (!name) fail('El nombre no puede quedar vacío.');
  return name;
}

export function parseRegistration(body: unknown): BodyResult<{ email: string; name: string; password: string }> {
  return readBody(body, (raw) => ({ email: readEmail(raw), name: readName(raw), password: readPassword(raw) }));
}

export function parseCredentials(body: unknown): BodyResult<{ email: string; password: string }> {
  // Al entrar no se exige el formato de la contraseña: eso lo dice el hash.
  return readBody(body, (raw) => {
    const password = field(raw, 'password');
    if (typeof password !== 'string' || password.length === 0) fail('Falta la contraseña.');
    return { email: readEmail(raw), password };
  });
}

export function parseNameChange(body: unknown): BodyResult<{ name: string }> {
  return readBody(body, (raw) => ({ name: readName(raw) }));
}

export function parseVisibilityChange(body: unknown): BodyResult<{ visibility: RoomVisibility }> {
  return readBody(body, (raw) => {
    const visibility = field(raw, 'visibility');
    if (!isVisibility(visibility)) fail('«visibility» debe ser public, link-read o private.');
    return { visibility };
  });
}

export function parseMemberInput(body: unknown): BodyResult<{ email: string; role: MemberRole }> {
  return readBody(body, (raw) => {
    const role = field(raw, 'role');
    if (!isMemberRole(role)) fail('«role» debe ser editor o viewer.');
    return { email: readEmail(raw), role };
  });
}

/** Convierte el texto crudo de un mensaje en un `ClientMessage` válido y normalizado. */
export function parseClientMessage(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'INVALID_JSON', reason: 'El mensaje no es JSON válido.' };
  }

  if (!isObject(data)) {
    return { ok: false, code: 'INVALID_MESSAGE', reason: 'El mensaje debe ser un objeto.' };
  }

  const type = field(data, 'type');
  if (!isClientMessageType(type)) {
    return { ok: false, code: 'INVALID_MESSAGE', reason: 'Tipo de mensaje desconocido.' };
  }

  // El socket admite mensajes grandes solo para sincronizar el documento.
  if (type !== 'doc:update' && Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
    return { ok: false, code: 'INVALID_MESSAGE', reason: 'Mensaje demasiado grande.' };
  }

  const validate: (raw: RawObject) => ClientMessage = validators[type];
  try {
    return { ok: true, message: validate(data) };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, code: 'INVALID_MESSAGE', reason: error.message };
    }
    throw error;
  }
}
