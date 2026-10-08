/**
 * Permisos: quién es el dueño de un tablero, quién puede entrar y quién puede
 * escribir. Todo se comprueba contra el servidor real: la interfaz esconde lo
 * que no se puede hacer, pero quien decide es el servidor.
 */
import { after, afterEach, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { FORBIDDEN_CLOSE_CODE, MESSAGE_BURST, insertNote, type RoomAccessResponse, type RoomsResponse } from '@pizarra/shared';
import type { Database } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import {
  DOC_EVENTS,
  TestClient,
  YClient,
  createTestDatabase,
  eventually,
  makeNote,
  makeRoomId,
  resetData,
  signUp,
  startServerWithAccounts,
} from './helpers';

type Running = Awaited<ReturnType<typeof startServerWithAccounts>>;

let database: Database;
const running: Running[] = [];
const clients: TestClient[] = [];
const yclients: YClient[] = [];

before(async () => {
  database = await createTestDatabase();
  await migrate(database);
});

after(async () => {
  await database.close();
});

async function setup() {
  const server = await startServerWithAccounts({ db: database });
  running.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(yclients.splice(0).map((yclient) => (yclient.online ? yclient.disconnect() : undefined)));
  await Promise.all(clients.splice(0).map((client) => client.close()));
  for (const { server } of running.splice(0)) await server.close();
  await resetData(database);
});

async function yjoin(url: string) {
  const yclient = await YClient.join(url);
  yclients.push(yclient);
  return yclient;
}

async function join(url: string) {
  const joined = await TestClient.join(url);
  clients.push(joined.client);
  return joined;
}

/** Crea el tablero escribiendo su primera nota, como hace el cliente real. */
async function createBoard(server: Running, token: string): Promise<string> {
  const roomId = makeRoomId();
  const owner = await yjoin(await server.roomUrlAs(roomId, token));
  owner.change((doc) => insertNote(doc, makeNote({ text: 'primera' }), 0));
  await eventually(async () => {
    const { body } = await server.api.get<RoomAccessResponse>(`/rooms/${roomId}/access`, token);
    assert.equal(body.access.role, 'owner');
  });
  await owner.disconnect();
  return roomId;
}

describe('dueño de un tablero', () => {
  test('lo es quien escribe primero con la sesión iniciada, y no cambia después', async () => {
    const server = await setup();
    const ana = await signUp(server.api, { name: 'Ana' });
    const beto = await signUp(server.api, { name: 'Beto' });

    const roomId = await createBoard(server, ana.token);

    const desdeBeto = await yjoin(await server.roomUrlAs(roomId, beto.token));
    desdeBeto.change((doc) => insertNote(doc, makeNote({ text: 'de Beto' }), 1));
    await eventually(async () => {
      const { rows } = await database.query<{ owner_id: string }>('SELECT owner_id FROM rooms WHERE id = $1', [
        roomId,
      ]);
      assert.equal(rows[0]?.owner_id, ana.user.id, 'escribir en un tablero ajeno no lo hace propio');
    });

    const access = await server.api.get<RoomAccessResponse>(`/rooms/${roomId}/access`, beto.token);
    assert.equal(access.body.access.role, 'guest');
    assert.deepEqual(access.body.owner, { id: ana.user.id, name: 'Ana' });
    assert.equal(access.body.members, undefined, 'la lista de invitadas es solo para el dueño');
  });

  test('un tablero sin nadie con cuenta se queda sin dueño y público', async () => {
    const server = await setup();
    const roomId = makeRoomId();
    const anonimo = await yjoin(server.roomUrl(roomId));
    anonimo.change((doc) => insertNote(doc, makeNote(), 0));

    await eventually(async () => {
      const { rows } = await database.query('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
      assert.equal(rows.length, 1);
      assert.equal((rows[0] as { owner_id: string | null }).owner_id, null);
    });

    const { body } = await server.api.get<RoomAccessResponse>(`/rooms/${roomId}/access`);
    assert.deepEqual(body.access, { visibility: 'public', role: 'guest', canWrite: true, ownerless: true });
  });
});

describe('visibilidad', () => {
  test('con «solo lectura por enlace», quien entra sin cuenta mira pero no escribe', async () => {
    const server = await setup();
    const ana = await signUp(server.api);
    const roomId = await createBoard(server, ana.token);

    const cambio = await server.api.patch(`/rooms/${roomId}`, { visibility: 'link-read' }, ana.token);
    assert.equal(cambio.status, 200);

    const mirona = await join(server.roomUrl(roomId));
    assert.deepEqual(mirona.init.access, {
      visibility: 'link-read',
      role: 'guest',
      canWrite: false,
      ownerless: false,
    });

    const duena = await yjoin(await server.roomUrlAs(roomId, ana.token));
    mirona.client.send({ type: 'doc:update', update: 'AAEB' });
    const error = await mirona.client.next('error');
    assert.equal(error.code, 'FORBIDDEN');
    assert.deepEqual(await duena.client.unexpected(DOC_EVENTS), [], 'lo que mandó no llegó a nadie');

    // La conexión sigue abierta y recibe lo que escriben las demás.
    duena.change((doc) => insertNote(doc, makeNote({ text: 'solo yo escribo' }), 1));
    assert.equal((await mirona.client.next('doc:updated')).type, 'doc:updated');
  });

  test('un tablero privado no deja entrar a quien no está invitado', async () => {
    const server = await setup();
    const ana = await signUp(server.api);
    const beto = await signUp(server.api);
    const roomId = await createBoard(server, ana.token);
    await server.api.patch(`/rooms/${roomId}`, { visibility: 'private' }, ana.token);

    await assert.rejects(() => TestClient.connect(server.roomUrl(roomId)), /403/, 'sin cuenta no entra');
    await assert.rejects(
      async () => TestClient.connect(await server.roomUrlAs(roomId, beto.token)),
      /403/,
      'con cuenta pero sin invitación, tampoco',
    );

    const acceso = await server.api.get(`/rooms/${roomId}/access`, beto.token);
    assert.equal(acceso.status, 403);

    // La dueña sigue entrando.
    const duena = await join(await server.roomUrlAs(roomId, ana.token));
    assert.equal(duena.init.access.role, 'owner');
  });

  test('solo el dueño cambia la visibilidad', async () => {
    const server = await setup();
    const ana = await signUp(server.api);
    const beto = await signUp(server.api);
    const roomId = await createBoard(server, ana.token);

    assert.equal((await server.api.patch(`/rooms/${roomId}`, { visibility: 'private' })).status, 401);
    assert.equal((await server.api.patch(`/rooms/${roomId}`, { visibility: 'private' }, beto.token)).status, 403);
    assert.equal((await server.api.patch(`/rooms/${roomId}`, { visibility: 'ninguna' }, ana.token)).status, 400);

    const { rows } = await database.query('SELECT visibility FROM rooms WHERE id = $1', [roomId]);
    assert.equal((rows[0] as { visibility: string }).visibility, 'public', 'nada de eso cambió el tablero');
  });
});

describe('personas invitadas', () => {
  test('el dueño invita por correo y esa persona puede escribir en un tablero privado', async () => {
    const server = await setup();
    const ana = await signUp(server.api, { name: 'Ana' });
    const beto = await signUp(server.api, { name: 'Beto', email: 'beto@ejemplo.test' });
    const roomId = await createBoard(server, ana.token);
    await server.api.patch(`/rooms/${roomId}`, { visibility: 'private' }, ana.token);

    const sinCuenta = await server.api.post(
      `/rooms/${roomId}/members`,
      { email: 'nadie@ejemplo.test', role: 'editor' },
      ana.token,
    );
    assert.equal(sinCuenta.status, 404, 'no se puede invitar a quien no tiene cuenta');

    const invitado = await server.api.post(
      `/rooms/${roomId}/members`,
      { email: 'BETO@ejemplo.test', role: 'editor' },
      ana.token,
    );
    assert.equal(invitado.status, 200);
    assert.deepEqual((invitado.body as { members: Array<{ user: { id: string }; role: string }> }).members, [
      { user: beto.user, role: 'editor' },
    ]);

    const conBeto = await yjoin(await server.roomUrlAs(roomId, beto.token));
    assert.equal(conBeto.init.access.role, 'editor');
    assert.equal(conBeto.init.access.canWrite, true);
    conBeto.change((doc) => insertNote(doc, makeNote({ text: 'aporte de Beto' }), 1));

    const conAna = await yjoin(await server.roomUrlAs(roomId, ana.token));
    assert.equal(
      conAna.notes().some((note) => note.text === 'aporte de Beto'),
      true,
    );
  });

  test('quien entra como «viewer» no puede escribir', async () => {
    const server = await setup();
    const ana = await signUp(server.api);
    const beto = await signUp(server.api, { email: 'mira@ejemplo.test' });
    const roomId = await createBoard(server, ana.token);
    await server.api.post(`/rooms/${roomId}/members`, { email: 'mira@ejemplo.test', role: 'viewer' }, ana.token);
    await server.api.patch(`/rooms/${roomId}`, { visibility: 'private' }, ana.token);

    const mirona = await join(await server.roomUrlAs(roomId, beto.token));
    assert.equal(mirona.init.access.role, 'viewer');
    assert.equal(mirona.init.access.canWrite, false);

    mirona.client.send({ type: 'doc:update', update: 'AAEB' });
    assert.equal((await mirona.client.next('error')).code, 'FORBIDDEN');
  });

  test('al quitar la invitación, quien estaba conectada se queda afuera', async () => {
    const server = await setup();
    const ana = await signUp(server.api);
    const beto = await signUp(server.api, { email: 'fuera@ejemplo.test' });
    const roomId = await createBoard(server, ana.token);
    await server.api.post(`/rooms/${roomId}/members`, { email: 'fuera@ejemplo.test', role: 'editor' }, ana.token);
    await server.api.patch(`/rooms/${roomId}`, { visibility: 'private' }, ana.token);

    const conectada = await TestClient.connect(await server.roomUrlAs(roomId, beto.token));
    clients.push(conectada);
    await conectada.next('init');

    const cerrada = new Promise<number>((resolve) => conectada.socket.once('close', resolve));
    const quitada = await server.api.del(`/rooms/${roomId}/members/${beto.user.id}`, ana.token);
    assert.equal(quitada.status, 200);
    assert.equal(await cerrada, FORBIDDEN_CLOSE_CODE, 'se cierra con el código de «sin acceso»');
  });

  test('cambiar a «solo lectura» avisa en el momento a quien está mirando', async () => {
    const server = await setup();
    const ana = await signUp(server.api);
    const roomId = await createBoard(server, ana.token);

    const invitada = await join(server.roomUrl(roomId));
    assert.equal(invitada.init.access.canWrite, true);

    await server.api.patch(`/rooms/${roomId}`, { visibility: 'link-read' }, ana.token);
    const aviso = await invitada.client.next('access');
    assert.deepEqual(aviso.access, { visibility: 'link-read', role: 'guest', canWrite: false, ownerless: false });
  });
});

describe('tus tableros', () => {
  test('lista los propios y aquellos a los que te invitaron', async () => {
    const server = await setup();
    const ana = await signUp(server.api);
    const beto = await signUp(server.api, { email: 'invitada@ejemplo.test' });
    const propio = await createBoard(server, ana.token);
    const compartido = await createBoard(server, ana.token);
    await server.api.post(`/rooms/${compartido}/members`, { email: 'invitada@ejemplo.test', role: 'viewer' }, ana.token);

    const deAna = await server.api.get<RoomsResponse>('/rooms', ana.token);
    assert.deepEqual(
      deAna.body.rooms.map((room) => room.id).sort(),
      [propio, compartido].sort(),
    );
    assert.equal(deAna.body.rooms.every((room) => room.role === 'owner'), true);

    const deBeto = await server.api.get<RoomsResponse>('/rooms', beto.token);
    assert.deepEqual(
      deBeto.body.rooms.map(({ id, role }) => ({ id, role })),
      [{ id: compartido, role: 'viewer' }],
    );

    assert.equal((await server.api.get('/rooms')).status, 401, 'sin sesión no hay lista');
  });
});

describe('identidad en la sala', () => {
  test('con cuenta, el nombre sale de la cuenta y no se puede cambiar por el socket', async () => {
    const server = await setup();
    const ana = await signUp(server.api, { name: 'Ana' });
    const roomId = makeRoomId();

    const conCuenta = await join(await server.roomUrlAs(roomId, ana.token));
    assert.equal(conCuenta.init.self.name, 'Ana');

    conCuenta.client.send({ type: 'presence:rename', name: 'Otra persona' });
    assert.equal((await conCuenta.client.next('error')).code, 'FORBIDDEN');

    const sinCuenta = await join(server.roomUrl(roomId, { name: 'Invitada' }));
    sinCuenta.client.send({ type: 'presence:rename', name: 'Invitada 2' });
    assert.deepEqual(await conCuenta.client.next('peer:renamed'), {
      type: 'peer:renamed',
      id: sinCuenta.init.self.id,
      name: 'Invitada 2',
    });
  });
});

describe('límite de mensajes', () => {
  test('una inundación de mensajes corta la conexión', async () => {
    const server = await setup();
    const { client } = await join(server.roomUrl(makeRoomId()));

    const cerrada = new Promise<number>((resolve) => client.socket.once('close', resolve));
    for (let i = 0; i < MESSAGE_BURST + 50; i += 1) {
      if (client.socket.readyState !== client.socket.OPEN) break;
      client.send({ type: 'presence:cursor', cursor: { x: i % 100, y: 1 } });
    }

    assert.equal((await client.next('error')).code, 'RATE_LIMIT');
    assert.equal(await cerrada, 1008);
  });
});
