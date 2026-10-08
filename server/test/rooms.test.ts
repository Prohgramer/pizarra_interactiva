/**
 * Salas y persistencia de punta a punta: servidor real, clientes Yjs reales
 * y PostgreSQL (PGlite, o TEST_DATABASE_URL) como almacén.
 */
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import {
  getNoteText,
  insertNote,
  removeNote,
  replaceText,
  setNoteColor,
  setNotePosition,
} from '@pizarra/shared';
import type { Database } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { PostgresStore } from '../src/store/postgres';
import {
  DOC_EVENTS,
  FAST_TIMINGS,
  FlakyStore,
  PEER_EVENTS,
  TEST_ORIGIN,
  TestClient,
  YClient,
  asBoardNote,
  createTestDatabase,
  delay,
  eventually,
  makeNote,
  makeRoomId,
  notesOf,
  startServer,
  type RunningServer,
} from './helpers';

let db: Database;
let postgres: PostgresStore;
let store: FlakyStore;
const running: RunningServer[] = [];
const clients: TestClient[] = [];
const yclients: YClient[] = [];

before(async () => {
  db = await createTestDatabase();
  await migrate(db);
  postgres = new PostgresStore(db);
});

after(async () => {
  for (const client of clients) client.socket.terminate();
  await db.close();
});

beforeEach(async () => {
  await db.exec('TRUNCATE rooms CASCADE');
  store = new FlakyStore(postgres);
});

afterEach(async () => {
  await Promise.all(yclients.splice(0).map((yclient) => (yclient.online ? yclient.disconnect() : undefined)));
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(running.splice(0).map(({ server }) => server.close()));
});

async function setup(options: Parameters<typeof startServer>[0] = {}) {
  const server = await startServer({ store, ...FAST_TIMINGS, ...options });
  running.push(server);
  return server;
}

async function join(url: string) {
  const joined = await TestClient.join(url);
  clients.push(joined.client);
  return joined;
}

async function yjoin(url: string) {
  const yclient = await YClient.join(url);
  yclients.push(yclient);
  return yclient;
}

/** Notas guardadas en la base para una sala. */
async function storedNotes(roomId: string) {
  const stored = await postgres.load(roomId);
  return stored ? notesOf(stored.state) : [];
}

/** Intenta abrir un WebSocket y devuelve el código HTTP con que se rechazó. */
async function rejectedStatus(url: string): Promise<number> {
  const ws = new WebSocket(url, { origin: TEST_ORIGIN });
  ws.on('error', () => {});
  const [, response] = (await once(ws, 'unexpected-response')) as [unknown, IncomingMessage];
  ws.terminate();
  return response.statusCode ?? 0;
}

describe('salas', () => {
  test('cada sala es independiente: ni los cambios ni la presencia se mezclan', async () => {
    const { roomUrl } = await setup();
    const [roomA, roomB] = [makeRoomId(), makeRoomId()];
    const a1 = await yjoin(roomUrl(roomA));
    const a2 = await yjoin(roomUrl(roomA));
    const b1 = await yjoin(roomUrl(roomB));

    assert.deepEqual(b1.init.peers, [], 'la presencia es por sala');
    await a1.client.next('peer:joined');

    a1.change((doc) => insertNote(doc, makeNote({ text: 'solo para A' }), 0));
    a1.client.send({ type: 'presence:cursor', cursor: { x: 10, y: 20 } });
    await a2.receive();
    await a2.client.next('peer:cursor');
    assert.deepEqual(await b1.client.unexpected([...DOC_EVENTS, ...PEER_EVENTS]), []);

    assert.deepEqual(notesOf((await join(roomUrl(roomB))).init.doc), [], 'la sala B sigue vacía');
  });

  test('rechaza con 404 las rutas que no son de una sala válida', async () => {
    const { httpUrl } = await setup();
    const base = httpUrl.replace('http', 'ws');
    for (const path of ['/', '/rooms/', '/rooms/abc', '/rooms/ABCDEFGHIJKL', '/rooms/abcdefghijkl/x', '/otra/abcdefghijkl']) {
      assert.equal(await rejectedStatus(`${base}${path}`), 404, `ruta ${path}`);
    }
  });
});

describe('persistencia', () => {
  test('al volver a una sala descargada, todo sigue ahí y en el mismo orden', async () => {
    const { server, roomUrl } = await setup();
    const roomId = makeRoomId();
    const a = await yjoin(roomUrl(roomId));

    const notes = [makeNote({ text: 'uno' }), makeNote({ text: 'dos' }), makeNote({ text: 'tres' })];
    a.change((doc) => notes.forEach((note, z) => insertNote(doc, note, z)));
    a.change((doc) => setNotePosition(doc, notes[0]!.id, 700, 900));
    a.change((doc) => {
      replaceText(getNoteText(doc, notes[1]!.id)!, 'dos, editada');
      setNoteColor(doc, notes[1]!.id, 'blue');
    });
    a.change((doc) => removeNote(doc, notes[2]!.id));
    await a.client.unexpected([], 30); // que el servidor procese los mensajes

    await a.disconnect();
    await eventually(() => assert.equal(server.rooms.stats().rooms, 0, 'la sala vacía se descarga'));

    const expected = [
      asBoardNote({ ...notes[0]!, x: 700, y: 900 }, 0),
      asBoardNote({ ...notes[1]!, text: 'dos, editada', color: 'blue' }, 1),
    ];
    assert.deepEqual(await storedNotes(roomId), expected, 'quedó guardado en la base');
    assert.deepEqual(notesOf((await join(roomUrl(roomId))).init.doc), expected);
  });

  test('sobrevive a reiniciar el servidor', async () => {
    const roomId = makeRoomId();
    const note = makeNote({ text: 'antes del reinicio' });

    // Con un intervalo de guardado largo: lo guarda el cierre ordenado, no el temporizador.
    const first = await setup({ flushDelayMs: 60_000 });
    const a = await yjoin(first.roomUrl(roomId));
    a.change((doc) => insertNote(doc, note, 0));
    await a.client.unexpected([], 30);
    assert.equal(store.saves.length, 0, 'todavía no se escribió nada');

    await first.server.close();
    assert.deepEqual(await storedNotes(roomId), [asBoardNote(note, 0)]);

    const second = await setup();
    assert.deepEqual(notesOf((await join(second.roomUrl(roomId))).init.doc), [asBoardNote(note, 0)]);
  });

  test('lo editado sin conexión se guarda al volver', async () => {
    const { roomUrl } = await setup();
    const roomId = makeRoomId();
    const a = await yjoin(roomUrl(roomId));
    a.change((doc) => insertNote(doc, makeNote({ text: 'en línea' }), 0));

    await a.disconnect();
    a.change((doc) => insertNote(doc, makeNote({ text: 'sin conexión' }), 1));
    await a.connect(roomUrl(roomId));

    await eventually(async () =>
      assert.deepEqual(
        (await storedNotes(roomId)).map((note) => note.text),
        ['en línea', 'sin conexión'],
      ),
    );
  });

  test('agrupa un arrastre entero en pocas escrituras', async () => {
    const { roomUrl } = await setup({ flushDelayMs: 300 });
    const roomId = makeRoomId();
    const a = await yjoin(roomUrl(roomId));
    const note = makeNote();
    a.change((doc) => insertNote(doc, note, 0));

    // Como un arrastre real: una posición cada 10 ms.
    for (let i = 1; i <= 20; i += 1) {
      a.change((doc) => setNotePosition(doc, note.id, i * 10, i * 5));
      await delay(10);
    }

    await eventually(async () => {
      const [saved] = await storedNotes(roomId);
      assert.equal(saved?.x, 200);
      assert.equal(saved?.y, 100);
    });
    assert.ok(store.saves.length <= 2, `21 cambios en ${store.saves.length} escritura(s)`);
  });

  test('si la base no responde al abrir una sala, rechaza con 503 y se recupera', async () => {
    const { roomUrl, httpUrl } = await setup();
    const url = roomUrl(makeRoomId());

    store.failing.load = true;
    assert.equal(await rejectedStatus(url), 503);
    const health = (await (await fetch(`${httpUrl}/health`)).json()) as { status: string };
    assert.equal(health.status, 'degraded');

    store.failing.load = false;
    assert.deepEqual((await join(url)).init.peers, []);
  });

  test('si falla una escritura, conserva los cambios, no descarga la sala y reintenta', async () => {
    const { server, roomUrl } = await setup();
    const roomId = makeRoomId();
    const a = await yjoin(roomUrl(roomId));

    store.failing.save = true;
    const note = makeNote({ text: 'no se pierde' });
    a.change((doc) => insertNote(doc, note, 0));
    await a.disconnect();
    await delay(150); // varios intentos fallidos

    assert.equal(server.rooms.stats().rooms, 1, 'una sala con cambios sin guardar no se descarga');
    assert.deepEqual(await storedNotes(roomId), []);

    store.failing.save = false;
    await eventually(async () => assert.deepEqual(await storedNotes(roomId), [asBoardNote(note, 0)]));
    await eventually(() => assert.equal(server.rooms.stats().rooms, 0));
  });

  test('varias personas que entran a la vez comparten una sola carga de la sala', async () => {
    const { roomUrl } = await setup();
    const roomId = makeRoomId();
    let loads = 0;
    const load = store.load.bind(store);
    store.load = async (id) => {
      loads += 1;
      await delay(50); // una base lenta
      return load(id);
    };

    const joined = await Promise.all([1, 2, 3].map(() => join(roomUrl(roomId))));
    assert.equal(loads, 1);
    assert.deepEqual(
      joined.map(({ init }) => notesOf(init.doc)),
      [[], [], []],
    );
  });
});

describe('migración desde la Etapa 2', () => {
  test('una sala guardada como filas se abre como documento y sus filas se borran', async () => {
    const { roomUrl } = await setup();
    const roomId = makeRoomId();
    const [first, second] = [makeNote({ text: 'fila uno', color: 'pink' }), makeNote({ text: 'fila dos', x: 900 })];
    await db.query('INSERT INTO rooms (id) VALUES ($1)', [roomId]);
    for (const [order, note] of [second, first].entries()) {
      await db.query(
        `INSERT INTO notes (room_id, id, x, y, text, color, rotation, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [roomId, note.id, note.x, note.y, note.text, note.color, note.rotation, order === 0 ? 5 : 2],
      );
    }

    const { init } = await join(roomUrl(roomId));
    assert.deepEqual(notesOf(init.doc), [asBoardNote(first, 2), asBoardNote(second, 5)], 'mismo orden que sort_order');

    // La sala convertida se guarda sola y sus filas viejas desaparecen.
    await eventually(async () => {
      const { rows } = await db.query<{ has_doc: boolean; legacy: string }>(
        `SELECT doc IS NOT NULL AS has_doc,
                (SELECT count(*) FROM notes WHERE room_id = $1)::text AS legacy
           FROM rooms WHERE id = $1`,
        [roomId],
      );
      assert.deepEqual(rows[0], { has_doc: true, legacy: '0' });
    });
    assert.deepEqual(await storedNotes(roomId), [asBoardNote(first, 2), asBoardNote(second, 5)]);
  });
});
