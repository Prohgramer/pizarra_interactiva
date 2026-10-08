/**
 * Cuentas: registro, inicio de sesión, sesiones y tickets del WebSocket.
 * Levantan el servidor real con una base de datos real (PGlite, o la de
 * TEST_DATABASE_URL) y hablan con la API por HTTP, como el cliente.
 */
import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PASSWORD_LENGTH,
  type ApiErrorBody,
  type AuthResponse,
  type TicketResponse,
  type UserResponse,
} from '@pizarra/shared';
import { Accounts, PostgresAccounts, hashPassword, verifyPassword } from '../src/accounts';
import {
  TestClient,
  createTestDatabase,
  makeRoomId,
  resetData,
  signUp,
  startServer,
  startServerWithAccounts,
  type RunningServer,
} from './helpers';
import type { Database } from '../src/db/database';
import { migrate } from '../src/db/migrate';

type Running = Awaited<ReturnType<typeof startServerWithAccounts>>;

// Una sola base para todo el archivo: se vacía entre pruebas.
let database: Database;
const running: Running[] = [];
const plain: RunningServer[] = [];
const clients: TestClient[] = [];

before(async () => {
  database = await createTestDatabase();
  await migrate(database);
});

after(async () => {
  await database.close();
});

async function setup(options: Parameters<typeof startServerWithAccounts>[0] = {}) {
  const server = await startServerWithAccounts({ db: database, ...options });
  running.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  for (const { server } of running.splice(0)) await server.close();
  await Promise.all(plain.splice(0).map(({ server }) => server.close()));
  await resetData(database);
});

function errorCode(body: unknown): string {
  return (body as ApiErrorBody).error.code;
}

describe('contraseñas', () => {
  test('el hash lleva sus parámetros y solo acepta la contraseña correcta', async () => {
    const hash = await hashPassword('contraseña-larga');
    assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.equal(await verifyPassword('contraseña-larga', hash), true);
    assert.equal(await verifyPassword('contraseña-larga ', hash), false);
    assert.equal(await verifyPassword('otra cosa', hash), false);
  });

  test('dos cuentas con la misma contraseña tienen hashes distintos (sal por cuenta)', async () => {
    const [a, b] = await Promise.all([hashPassword('la misma'), hashPassword('la misma')]);
    assert.notEqual(a, b);
  });

  test('un hash corrupto no deja entrar en vez de romper', async () => {
    for (const roto of ['', 'no-es-un-hash', 'scrypt$0$8$1$c2Fs$Y2xhdmU=', 'scrypt$16384$8$1$$']) {
      assert.equal(await verifyPassword('contraseña-larga', roto), false, roto);
    }
  });
});

describe('registro e inicio de sesión', () => {
  test('crear una cuenta devuelve la sesión y permite entrar después', async () => {
    const { api } = await setup();
    const created = await api.post<AuthResponse>('/auth/register', {
      email: 'Ana@Ejemplo.test ',
      name: '  Ana  ',
      password: 'contraseña-larga',
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, 'ana@ejemplo.test', 'el correo se normaliza');
    assert.equal(created.body.user.name, 'Ana', 'el nombre se recorta');
    assert.match(created.body.token, /^[A-Za-z0-9_-]{20,}$/);

    const me = await api.get<UserResponse>('/auth/me', created.body.token);
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.user, created.body.user);

    const login = await api.post<AuthResponse>('/auth/login', {
      email: 'ANA@ejemplo.test',
      password: 'contraseña-larga',
    });
    assert.equal(login.status, 200, 'el correo no distingue mayúsculas');
    assert.deepEqual(login.body.user, created.body.user);
    assert.notEqual(login.body.token, created.body.token, 'cada sesión tiene su token');
  });

  test('el mismo correo no se puede registrar dos veces', async () => {
    const { api } = await setup();
    const input = { email: 'dup@ejemplo.test', name: 'Dup', password: 'contraseña-larga' };
    assert.equal((await api.post('/auth/register', input)).status, 201);

    const again = await api.post('/auth/register', { ...input, name: 'Otra', password: 'otra-contraseña' });
    assert.equal(again.status, 409);
    assert.equal(errorCode(again.body), 'EMAIL_TAKEN');
  });

  test('rechaza datos que no sirven, diciendo qué falta', async () => {
    const { api } = await setup();
    const casos: Array<[string, unknown]> = [
      ['sin cuerpo', undefined],
      ['correo inválido', { email: 'no-es-un-correo', name: 'A', password: 'contraseña-larga' }],
      ['contraseña corta', { email: 'a@b.test', name: 'A', password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) }],
      ['nombre vacío', { email: 'a@b.test', name: '   ', password: 'contraseña-larga' }],
      ['tipos raros', { email: 42, name: [], password: null }],
    ];
    for (const [caso, body] of casos) {
      const response = await api.post('/auth/register', body);
      assert.equal(response.status, 400, caso);
      assert.equal(errorCode(response.body), 'INVALID_BODY', caso);
    }
  });

  test('entrar con datos que no coinciden no dice cuál de los dos falló', async () => {
    const { api } = await setup();
    await signUp(api, { email: 'existe@ejemplo.test', password: 'contraseña-larga' });

    const malaClave = await api.post('/auth/login', { email: 'existe@ejemplo.test', password: 'contraseña-mala' });
    const noExiste = await api.post('/auth/login', { email: 'nadie@ejemplo.test', password: 'contraseña-larga' });

    assert.equal(malaClave.status, 401);
    assert.equal(noExiste.status, 401);
    assert.deepEqual(malaClave.body, noExiste.body, 'la respuesta es idéntica en los dos casos');
  });

  test('demasiados intentos seguidos desde la misma dirección se cortan', async () => {
    const { api } = await setup();
    const intentar = () => api.post('/auth/login', { email: 'nadie@ejemplo.test', password: 'contraseña-larga' });

    let limitado = false;
    for (let i = 0; i < 12 && !limitado; i += 1) {
      const response = await intentar();
      if (response.status === 429) {
        limitado = true;
        assert.equal(errorCode(response.body), 'RATE_LIMIT');
      }
    }
    assert.ok(limitado, 'a los pocos intentos debería aparecer el límite');

    // El límite es de esa ruta: el resto de la API sigue atendiendo.
    assert.equal((await api.get('/auth/me')).status, 401);
  });
});

describe('sesiones', () => {
  test('un token inventado o ya cerrado no sirve', async () => {
    const { api } = await setup();
    const { token } = await signUp(api);

    assert.equal((await api.get('/auth/me', 'token-inventado')).status, 401);
    assert.equal((await api.get('/auth/me')).status, 401, 'sin token tampoco');

    assert.equal((await api.post('/auth/logout', undefined, token)).status, 204);
    const after = await api.get('/auth/me', token);
    assert.equal(after.status, 401);
    assert.equal(errorCode(after.body), 'UNAUTHORIZED');
  });

  test('una sesión vencida se rechaza y se borra sola', async () => {
    const { api, db } = await setup();
    const { token } = await signUp(api);
    // Se la envejece a mano: esperar 30 días en una prueba no es opción.
    await db.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");

    assert.equal((await api.get('/auth/me', token)).status, 401);
    const { rows } = await db.query('SELECT count(*)::int AS total FROM sessions');
    assert.equal((rows[0] as { total: number }).total, 0, 'la sesión vencida ya no está');
  });

  test('el token se guarda hasheado: en la base no está el que usa el cliente', async () => {
    const { api, db } = await setup();
    const { token } = await signUp(api);
    const { rows } = await db.query<{ token_hash: Uint8Array }>('SELECT token_hash FROM sessions');
    const guardado = Buffer.from(rows[0]!.token_hash).toString('base64url');
    assert.notEqual(guardado, token);
    assert.equal(Buffer.from(rows[0]!.token_hash).length, 32, 'es un sha256');
  });

  test('cambiar el nombre de la cuenta cambia lo que ve todo el mundo', async () => {
    const { api } = await setup();
    const { token } = await signUp(api, { name: 'Antes' });
    const updated = await api.patch<UserResponse>('/auth/me', { name: 'Después' }, token);
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.name, 'Después');

    const me = await api.get<UserResponse>('/auth/me', token);
    assert.equal(me.body.user.name, 'Después');
  });
});

describe('tickets del WebSocket', () => {
  test('el ticket es de un solo uso y hace falta sesión para pedirlo', async () => {
    const { api, accounts } = await setup();
    const { token, user } = await signUp(api);

    assert.equal((await api.post('/auth/ticket')).status, 401, 'sin sesión no hay ticket');

    const issued = await api.post<TicketResponse>('/auth/ticket', undefined, token);
    assert.equal(issued.status, 200);
    assert.ok(issued.body.expiresIn > 0);

    assert.deepEqual(await accounts.consumeTicket(issued.body.ticket), user);
    assert.equal(await accounts.consumeTicket(issued.body.ticket), null, 'el segundo uso ya no vale');
  });

  test('un ticket vencido no vale', async () => {
    let ahora = 1_000_000;
    const { api, db } = await setup();
    // Un servicio aparte con reloj propio, sobre la misma base.
    const accounts = new Accounts(new PostgresAccounts(db), { now: () => ahora, ticketTtlMs: 1000 });
    const { user } = await signUp(api);

    const { ticket } = accounts.issueTicket(user.id);
    ahora += 2000;
    assert.equal(await accounts.consumeTicket(ticket), null);
  });

  test('el WebSocket rechaza un ticket que no sirve, en vez de dejar entrar como invitado', async () => {
    const { roomUrl, api } = await setup();
    const { token, user } = await signUp(api, { name: 'Quien entra' });
    const roomId = makeRoomId();

    await assert.rejects(
      () => TestClient.connect(roomUrl(roomId, { ticket: 'no-existe' })),
      /401/,
      'un ticket inventado no entra',
    );

    const { body } = await api.post<TicketResponse>('/auth/ticket', undefined, token);
    const client = await TestClient.connect(roomUrl(roomId, { ticket: body.ticket, name: 'Otro nombre' }));
    clients.push(client);
    const init = await client.next('init');
    assert.equal(init.self.name, user.name, 'el nombre sale de la cuenta, no de la URL');
    assert.equal(init.access.role, 'guest', 'el tablero todavía no tiene dueño');
    assert.equal(init.access.ownerless, true);
  });
});

describe('sin base de datos', () => {
  test('las rutas de cuentas avisan que no hay cuentas, y el tablero sigue funcionando', async () => {
    const server = await startServer();
    plain.push(server);
    const { api, wsUrl, httpUrl } = server;

    const response = await api.post('/auth/login', { email: 'a@b.test', password: 'contraseña-larga' });
    assert.equal(response.status, 503);
    assert.equal(errorCode(response.body), 'NO_ACCOUNTS');

    const health = await (await fetch(`${httpUrl}/health`)).json();
    assert.equal((health as { accounts: boolean }).accounts, false);

    const { client, init } = await TestClient.join(wsUrl);
    clients.push(client);
    assert.equal(init.access.canWrite, true, 'sin cuentas, cualquiera con el enlace edita');
    assert.equal(init.access.ownerless, true);
  });
});
