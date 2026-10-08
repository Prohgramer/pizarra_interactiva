/**
 * El cliente de la API: qué manda, qué entiende y cómo traduce los errores.
 * `fetch` se reemplaza por un doble para no depender de un servidor.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, api } from '../src/lib/api';

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(response: Response | Error) {
  const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('peticiones', () => {
  test('manda el cuerpo como JSON y devuelve lo que responde el servidor', async () => {
    const user = { id: '1', email: 'ana@ejemplo.test', name: 'Ana' };
    const fetchMock = mockFetch(respond(200, { user, token: 'abc', expiresAt: '2030-01-01T00:00:00.000Z' }));

    const session = await api.login({ email: 'ana@ejemplo.test', password: 'contraseña-larga' });

    expect(session.user).toEqual(user);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/auth\/login$/);
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(init!.body))).toEqual({ email: 'ana@ejemplo.test', password: 'contraseña-larga' });
    expect((init!.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  test('lleva el token en la cabecera Authorization y no en la URL', async () => {
    const fetchMock = mockFetch(respond(200, { ticket: 't', expiresIn: 30_000 }));
    await api.ticket('token-secreto');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain('token-secreto');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer token-secreto');
  });

  test('una respuesta sin cuerpo no rompe (204 al cerrar sesión)', async () => {
    mockFetch(respond(204));
    await expect(api.logout('token')).resolves.toBeUndefined();
  });
});

describe('errores', () => {
  test('convierte el error del servidor en un ApiError con su código y su texto', async () => {
    mockFetch(respond(409, { error: { code: 'EMAIL_TAKEN', message: 'Ya hay una cuenta con ese correo.' } }));

    const error = await api
      .register({ email: 'ana@ejemplo.test', name: 'Ana', password: 'contraseña-larga' })
      .catch((problem: unknown) => problem);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'EMAIL_TAKEN', status: 409, message: 'Ya hay una cuenta con ese correo.' });
    expect((error as ApiError).expired).toBe(false);
  });

  test('reconoce la sesión vencida, que es la que hay que olvidar', async () => {
    mockFetch(respond(401, { error: { code: 'UNAUTHORIZED', message: 'Necesitas iniciar sesión.' } }));
    const error = (await api.me('viejo').catch((problem: unknown) => problem)) as ApiError;
    expect(error.expired).toBe(true);
  });

  test('sin conexión avisa de eso, no de un error del servidor', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    const error = (await api.me('token').catch((problem: unknown) => problem)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/conexión/i);
  });

  test('un error sin cuerpo reconocible también llega como ApiError', async () => {
    mockFetch(new Response('vaya', { status: 500 }));
    const error = (await api.rooms('token').catch((problem: unknown) => problem)) as ApiError;
    expect(error.code).toBe('SERVER_ERROR');
    expect(error.status).toBe(500);
  });
});
