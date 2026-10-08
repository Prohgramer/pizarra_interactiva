/**
 * Utilidades de HTTP: leer el cuerpo JSON con límite, responder JSON y
 * cabeceras CORS. El cliente vive en otro dominio (Vercel) y el servidor en
 * otro (Render), así que la API necesita CORS; el token viaja en la cabecera
 * `Authorization` y no en una cookie, así que no hay riesgo de CSRF.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiErrorBody, ApiErrorCode } from '@pizarra/shared';
import type { AllowedOrigins } from '../config';

/** Un cuerpo JSON de la API nunca es grande; lo que pase de aquí se corta. */
export const MAX_BODY_BYTES = 8 * 1024;

export type Json = Record<string, unknown> | unknown[];

export function applyCors(req: IncomingMessage, res: ServerResponse, allowed: AllowedOrigins): void {
  const origin = req.headers.origin;
  if (!origin) return;
  if (allowed !== '*' && !allowed.includes(origin)) return;

  res.setHeader('access-control-allow-origin', allowed === '*' ? '*' : origin);
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-max-age', '600');
  // La respuesta depende del origen: no se puede cachear para todos por igual.
  res.setHeader('vary', 'Origin');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(payload);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
}

const STATUS: Record<ApiErrorCode, number> = {
  INVALID_BODY: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  RATE_LIMIT: 429,
  NO_ACCOUNTS: 503,
  SERVER_ERROR: 500,
};

export function sendError(res: ServerResponse, code: ApiErrorCode, message: string): void {
  sendJson(res, STATUS[code], { error: { code, message } } satisfies ApiErrorBody);
}

export type BodyRead = { ok: true; value: unknown } | { ok: false; reason: string };

/** Lee el cuerpo como JSON, cortando si se pasa del límite. Un cuerpo vacío es `undefined`. */
export function readJsonBody(req: IncomingMessage): Promise<BodyRead> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;

    const finish = (result: BodyRead) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish({ ok: false, reason: 'El cuerpo de la petición es demasiado grande.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        finish({ ok: true, value: undefined });
        return;
      }
      try {
        finish({ ok: true, value: JSON.parse(raw) });
      } catch {
        finish({ ok: false, reason: 'El cuerpo no es JSON válido.' });
      }
    });

    req.on('error', () => finish({ ok: false, reason: 'No se pudo leer el cuerpo de la petición.' }));
  });
}

/** Token de `Authorization: Bearer …`, o cadena vacía si no vino. */
export function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return '';
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : '';
}

/**
 * De quién viene la petición, para los límites de ritmo. Detrás del proxy de
 * la plataforma (Render) la IP real llega en `x-forwarded-for`.
 */
export function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || req.socket.remoteAddress || 'desconocida';
}
