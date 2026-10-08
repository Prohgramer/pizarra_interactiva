/**
 * Presencia: identidad, colores sin repetir, cursores, nota en edición y
 * cambios de nombre, con clientes `ws` reales.
 */
import { after, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_HEIGHT,
  MAX_NAME_LENGTH,
  PRESENCE_COLORS,
  normalizeName,
  type PresenceColor,
} from '@pizarra/shared';
import { assignPresenceColor } from '../src/presence';
import { parseIdentity } from '../src/validation';
import { DOC_EVENTS, PEER_EVENTS, TestClient, makeNote, makeRoomId, startServer, type RunningServer } from './helpers';

const running: RunningServer[] = [];
const clients: TestClient[] = [];

async function setup() {
  const server = await startServer();
  running.push(server);
  return { ...server, roomId: makeRoomId() };
}

async function join(url: string) {
  const joined = await TestClient.join(url);
  clients.push(joined.client);
  return joined;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(running.splice(0).map(({ server }) => server.close()));
});

after(() => {
  for (const client of clients) client.socket.terminate();
});

describe('identidad', () => {
  test('el nombre y el color de la URL llegan en init y a los demás', async () => {
    const { roomUrl, roomId } = await setup();
    const ana = await join(roomUrl(roomId, { name: 'Ana', color: 'teal' }));
    assert.deepEqual({ name: ana.init.self.name, color: ana.init.self.color }, { name: 'Ana', color: 'teal' });

    const beto = await join(roomUrl(roomId, { name: 'Beto', color: 'violet' }));
    assert.deepEqual(beto.init.peers, [{ ...ana.init.self, cursor: null, focus: null }]);
    const { peer } = await ana.client.next('peer:joined');
    assert.deepEqual(peer, { ...beto.init.self, cursor: null, focus: null });
  });

  test('no repite colores en una sala mientras haya libres', async () => {
    const { roomUrl, roomId } = await setup();
    const colors: PresenceColor[] = [];
    for (const name of ['Ana', 'Beto', 'Carla']) {
      colors.push((await join(roomUrl(roomId, { name, color: 'teal' }))).init.self.color);
    }
    assert.equal(colors[0], 'teal', 'la primera persona recibe su color preferido');
    assert.equal(new Set(colors).size, 3, `colores asignados: ${colors.join(', ')}`);
  });

  test('un color liberado vuelve a estar disponible', async () => {
    const { roomUrl, roomId } = await setup();
    const ana = await join(roomUrl(roomId, { name: 'Ana', color: 'pink' }));
    await join(roomUrl(roomId, { name: 'Beto' }));
    await ana.client.close();

    const carla = await join(roomUrl(roomId, { name: 'Carla', color: 'pink' }));
    assert.equal(carla.init.self.color, 'pink');
  });

  test('normaliza el nombre y usa valores por defecto si la identidad no es válida', async () => {
    const { roomUrl, roomId } = await setup();
    const spaced = await join(roomUrl(roomId, { name: '   Ana    María\t\n ', color: 'no-es-un-color' }));
    assert.equal(spaced.init.self.name, 'Ana María');
    assert.ok(PRESENCE_COLORS.includes(spaced.init.self.color));

    const empty = await join(roomUrl(roomId, { name: '   ' }));
    assert.equal(empty.init.self.name, 'Invitado');
  });
});

describe('cursores', () => {
  test('se reenvían a los demás de la sala, ajustados al tablero, y nunca al emisor', async () => {
    const { roomUrl, roomId } = await setup();
    const a = await join(roomUrl(roomId, { name: 'Ana' }));
    const b = await join(roomUrl(roomId, { name: 'Beto' }));
    const c = await join(roomUrl(roomId, { name: 'Carla' }));
    const other = await join(roomUrl(makeRoomId(), { name: 'Otra sala' }));

    a.client.send({ type: 'presence:cursor', cursor: { x: 1200.6, y: 800 } });
    const expected = { type: 'peer:cursor', id: a.init.self.id, cursor: { x: 1201, y: 800 } };
    assert.deepEqual(await b.client.next('peer:cursor'), expected);
    assert.deepEqual(await c.client.next('peer:cursor'), expected);

    a.client.send({ type: 'presence:cursor', cursor: { x: -50, y: 999_999 } });
    assert.deepEqual((await b.client.next('peer:cursor')).cursor, { x: 0, y: BOARD_HEIGHT });

    a.client.send({ type: 'presence:cursor', cursor: null });
    assert.deepEqual(await b.client.next('peer:cursor'), { type: 'peer:cursor', id: a.init.self.id, cursor: null });

    assert.deepEqual(await a.client.unexpected(['peer:cursor']), [], 'el emisor no recibe su propio cursor');
    assert.deepEqual(await other.client.unexpected(PEER_EVENTS), [], 'otra sala no se entera');
  });

  test('quien entra tarde ve los cursores y las notas en edición de los demás', async () => {
    const { roomUrl, roomId } = await setup();
    const a = await join(roomUrl(roomId, { name: 'Ana' }));
    const b = await join(roomUrl(roomId, { name: 'Beto' }));
    const note = makeNote();

    a.client.send({ type: 'presence:cursor', cursor: { x: 300, y: 400 } });
    a.client.send({ type: 'presence:focus', noteId: note.id });
    await b.client.next('peer:focus');

    const late = await join(roomUrl(roomId, { name: 'Carla' }));
    const ana = late.init.peers.find((peer) => peer.id === a.init.self.id);
    assert.deepEqual(ana, { ...a.init.self, cursor: { x: 300, y: 400 }, focus: note.id });
  });
});

describe('edición y nombre', () => {
  test('la nota en edición se reenvía y se limpia con null', async () => {
    const { roomUrl, roomId } = await setup();
    const a = await join(roomUrl(roomId, { name: 'Ana' }));
    const b = await join(roomUrl(roomId, { name: 'Beto' }));
    const { id: noteId } = makeNote();

    a.client.send({ type: 'presence:focus', noteId });
    assert.deepEqual(await b.client.next('peer:focus'), { type: 'peer:focus', id: a.init.self.id, noteId });
    a.client.send({ type: 'presence:focus', noteId: null });
    assert.deepEqual(await b.client.next('peer:focus'), { type: 'peer:focus', id: a.init.self.id, noteId: null });
    assert.deepEqual(await a.client.unexpected(['peer:focus']), [], 'el emisor no recibe su propio foco');
  });

  test('el cambio de nombre se normaliza, se reenvía y lo ve quien entra después', async () => {
    const { roomUrl, roomId } = await setup();
    const a = await join(roomUrl(roomId, { name: 'Ana' }));
    const b = await join(roomUrl(roomId, { name: 'Beto' }));

    a.client.send({ type: 'presence:rename', name: '  Ana   López  ' });
    assert.deepEqual(await b.client.next('peer:renamed'), {
      type: 'peer:renamed',
      id: a.init.self.id,
      name: 'Ana López',
    });

    const late = await join(roomUrl(roomId, { name: 'Carla' }));
    assert.equal(late.init.peers.find((peer) => peer.id === a.init.self.id)?.name, 'Ana López');
  });

  test('rechaza mensajes de presencia inválidos sin reenviarlos', async () => {
    const { roomUrl, roomId } = await setup();
    const a = await join(roomUrl(roomId, { name: 'Ana' }));
    const b = await join(roomUrl(roomId, { name: 'Beto' }));

    const cases: Array<[string, unknown]> = [
      ['cursor ausente', { type: 'presence:cursor' }],
      ['cursor como texto', { type: 'presence:cursor', cursor: '10,20' }],
      ['cursor sin y', { type: 'presence:cursor', cursor: { x: 10 } }],
      ['cursor no numérico', { type: 'presence:cursor', cursor: { x: 'a', y: 1 } }],
      ['foco ausente', { type: 'presence:focus' }],
      ['foco que no es un id', { type: 'presence:focus', noteId: 'abc' }],
      ['nombre no textual', { type: 'presence:rename', name: 42 }],
      ['nombre vacío', { type: 'presence:rename', name: '   ' }],
    ];
    for (const [name, payload] of cases) {
      a.client.send(payload);
      assert.equal((await a.client.next('error')).code, 'INVALID_MESSAGE', `caso «${name}»`);
    }
    assert.deepEqual(await b.client.unexpected([...PEER_EVENTS, ...DOC_EVENTS]), []);
  });
});

describe('funciones de presencia', () => {
  test('assignPresenceColor respeta el preferido libre y si no elige el menos usado', () => {
    assert.equal(assignPresenceColor('sky', []), 'sky');
    assert.equal(assignPresenceColor('sky', ['sky']), 'red');
    assert.equal(assignPresenceColor(undefined, ['red', 'orange']), 'green');
    // Con toda la paleta usada una vez, el preferido empata con el mínimo y se respeta.
    assert.equal(assignPresenceColor('violet', [...PRESENCE_COLORS]), 'violet');
    assert.equal(assignPresenceColor('violet', [...PRESENCE_COLORS, 'violet']), 'red');
  });

  test('normalizeName limpia, colapsa y recorta por caracteres, no por unidades UTF-16', () => {
    assert.equal(normalizeName('  Ana \t\n María  '), 'Ana María');
    assert.equal(normalizeName(`Ana${String.fromCharCode(0)}${String.fromCharCode(0x9b)}Beto`), 'Ana Beto');
    assert.equal(normalizeName('   '), '');
    const emojis = '🦦'.repeat(MAX_NAME_LENGTH + 5);
    assert.equal(Array.from(normalizeName(emojis)).length, MAX_NAME_LENGTH);
    const last = normalizeName(emojis).slice(-1).charCodeAt(0);
    assert.ok(last < 0xd800 || last > 0xdbff, 'no corta un emoji por la mitad');
  });

  test('parseIdentity lee nombre, color y ticket de la URL', () => {
    assert.deepEqual(parseIdentity('/rooms/abc?name=Luc%C3%ADa&color=indigo&ticket=t123'), {
      name: 'Lucía',
      preferredColor: 'indigo',
      ticket: 't123',
    });
    assert.deepEqual(parseIdentity('/rooms/abc'), {
      name: 'Invitado',
      preferredColor: undefined,
      ticket: undefined,
    });
    assert.equal(parseIdentity('/rooms/abc?ticket=%20%20').ticket, undefined, 'un ticket en blanco es no tener ticket');
  });
});
