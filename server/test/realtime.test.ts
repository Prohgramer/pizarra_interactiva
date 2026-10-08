/**
 * Pruebas de integración: levantan el servidor real en un puerto libre y
 * conectan varios clientes con su propio documento Yjs para comprobar la
 * sincronización, la convergencia y la validación.
 */
import { after, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {
  MAX_MESSAGE_BYTES,
  MAX_PAYLOAD_BYTES,
  RESET_CLOSE_CODE,
  encodeUpdate,
  getNoteText,
  getNotesMap,
  insertNote,
  removeNote,
  replaceText,
  setNoteColor,
  setNotePosition,
} from '@pizarra/shared';
import {
  DOC_EVENTS,
  TestClient,
  YClient,
  asBoardNote,
  makeNote,
  makeRoomId,
  notesOf,
  startServer,
  type RunningServer,
} from './helpers';

const running: RunningServer[] = [];
const clients: TestClient[] = [];
const yclients: YClient[] = [];

async function setup(options?: Parameters<typeof startServer>[0]) {
  const server = await startServer(options);
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

afterEach(async () => {
  await Promise.all(yclients.splice(0).map((yclient) => (yclient.online ? yclient.disconnect() : undefined)));
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(running.splice(0).map(({ server }) => server.close()));
});

after(() => {
  // Por si algún test falló a mitad de camino.
  for (const client of clients) client.socket.terminate();
});

describe('conexión y presencia', () => {
  test('el cliente recibe init con el documento, su identidad y nadie más', async () => {
    const { wsUrl } = await setup();
    const { init } = await join(wsUrl);
    assert.deepEqual(notesOf(init.doc), []);
    assert.deepEqual(init.peers, []);
    assert.equal(init.self.name, 'Invitado', 'sin nombre en la URL se usa el nombre por defecto');
    assert.match(init.self.id, /^[\w-]{8}$/);
  });

  test('los demás reciben peer:joined y peer:left al entrar y salir alguien', async () => {
    const { wsUrl } = await setup();
    const a = await join(wsUrl);
    const b = await join(wsUrl);

    assert.deepEqual(b.init.peers, [{ ...a.init.self, cursor: null, focus: null }]);
    assert.deepEqual(await a.client.next('peer:joined'), {
      type: 'peer:joined',
      peer: { ...b.init.self, cursor: null, focus: null },
    });

    await b.client.close();
    assert.deepEqual(await a.client.next('peer:left'), { type: 'peer:left', id: b.init.self.id });
  });

  test('/health informa estado, almacenamiento, salas abiertas y conectados', async () => {
    const { wsUrl, roomUrl, httpUrl } = await setup();
    await join(wsUrl);
    await join(wsUrl);
    await join(roomUrl(makeRoomId()));

    const response = await fetch(`${httpUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      storage: 'memory',
      accounts: false,
      rooms: 2,
      clients: 3,
    });
  });
});

describe('sincronización en tiempo real', () => {
  test('crear, mover, editar y borrar llega a los demás pero nunca al emisor', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const c = await yjoin(wsUrl);
    const note = makeNote({ text: 'Hola' });

    // A crea
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();
    await c.receive();
    assert.deepEqual(b.notes(), [asBoardNote(note, 0)]);
    assert.deepEqual(await a.client.unexpected(DOC_EVENTS), [], 'A no debe recibir su propio cambio');

    // B mueve y cambia el color
    b.change((doc) => {
      setNotePosition(doc, note.id, 640, 480);
      setNoteColor(doc, note.id, 'lilac');
    });
    await a.receive();
    await c.receive();
    assert.deepEqual(c.notes(), [asBoardNote({ ...note, x: 640, y: 480, color: 'lilac' }, 0)]);
    assert.deepEqual(await b.client.unexpected(DOC_EVENTS), [], 'B no debe recibir su propio cambio');

    // C edita el texto
    c.change((doc) => replaceText(getNoteText(doc, note.id)!, 'Hola a todos'));
    await a.receive();
    await b.receive();
    assert.equal(a.notes()[0]?.text, 'Hola a todos');

    // A borra
    a.change((doc) => removeNote(doc, note.id));
    await b.receive();
    await c.receive();
    assert.deepEqual(b.notes(), []);
    assert.deepEqual(c.notes(), []);
  });

  test('quien entra tarde recibe el documento completo y actualizado', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);

    const first = makeNote({ text: 'Primera' });
    const second = makeNote({ color: 'green', rotation: -2 });
    const removed = makeNote();
    a.change((doc) => {
      insertNote(doc, first, 0);
      insertNote(doc, second, 1);
      insertNote(doc, removed, 2);
    });
    a.change((doc) => setNotePosition(doc, first.id, 900, 700));
    a.change((doc) => replaceText(getNoteText(doc, second.id)!, 'Segunda'));
    a.change((doc) => removeNote(doc, removed.id));
    for (let i = 0; i < 4; i += 1) await b.receive(); // los cuatro cambios ya se procesaron

    const late = await join(wsUrl);
    assert.equal(late.init.peers.length, 2);
    assert.deepEqual(notesOf(late.init.doc), [
      asBoardNote({ ...first, x: 900, y: 700 }, 0),
      asBoardNote({ ...second, text: 'Segunda' }, 1),
    ]);
  });

  test('un update que no trae nada nuevo no se reenvía', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);

    const update = a.change((doc) => insertNote(doc, makeNote(), 0));
    await b.receive();
    a.sendUpdate(update); // el mismo update otra vez

    assert.deepEqual(await b.client.unexpected(DOC_EVENTS), []);
  });
});

describe('conflictos y edición sin conexión', () => {
  test('dos personas escriben en la misma nota sin conexión y el texto se fusiona', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ text: 'idea' });
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();

    await a.disconnect();
    await b.disconnect();
    a.change((doc) => replaceText(getNoteText(doc, note.id)!, 'Gran idea'));
    b.change((doc) => replaceText(getNoteText(doc, note.id)!, 'idea para el lunes'));

    // Al volver, cada una envía lo que el servidor no tenía y recibe lo de la otra.
    await a.connect(wsUrl);
    await b.connect(wsUrl);
    await a.receive();

    const merged = 'Gran idea para el lunes';
    assert.equal(a.notes()[0]?.text, merged);
    assert.equal(b.notes()[0]?.text, merged);
    const late = await join(wsUrl);
    assert.equal(notesOf(late.init.doc)[0]?.text, merged, 'el servidor tiene lo mismo');
  });

  test('movimientos simultáneos convergen al mismo valor en todas partes', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote();
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();

    await a.disconnect();
    await b.disconnect();
    a.change((doc) => setNotePosition(doc, note.id, 100, 100));
    b.change((doc) => setNotePosition(doc, note.id, 900, 900));
    await a.connect(wsUrl);
    await b.connect(wsUrl);
    await a.receive();

    // Gana una de las dos (la última escritura según Yjs), pero es la misma en todas partes.
    const [position] = a.notes();
    assert.deepEqual(b.notes()[0], position);
    assert.ok(position && [100, 900].includes(position.x));
  });

  test('lo creado sin conexión llega a los demás al reconectar', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);

    await a.disconnect();
    const offline = [makeNote({ text: 'en el tren' }), makeNote({ text: 'sin wifi' })];
    a.change((doc) => offline.forEach((note, index) => insertNote(doc, note, index)));
    assert.deepEqual(await b.client.unexpected(DOC_EVENTS), [], 'sin conexión no sale nada');

    await a.connect(wsUrl);
    await b.receive();
    assert.deepEqual(
      b.notes().map((note) => note.text),
      ['en el tren', 'sin wifi'],
    );
  });

  test('borrar una nota gana sobre una edición simultánea de su texto', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ text: 'efímera' });
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();

    await a.disconnect();
    await b.disconnect();
    a.change((doc) => removeNote(doc, note.id));
    b.change((doc) => replaceText(getNoteText(doc, note.id)!, 'efímera, editada'));
    await a.connect(wsUrl);
    await b.connect(wsUrl);
    await a.receive();

    assert.deepEqual(a.notes(), []);
    assert.deepEqual(b.notes(), []);
  });
});

describe('el servidor no confía en el cliente', () => {
  test('rechaza mensajes mal formados con un error, sin cortar la conexión', async () => {
    const { wsUrl } = await setup();
    const a = (await join(wsUrl)).client;
    const b = (await join(wsUrl)).client;

    const cases: Array<{ name: string; payload: unknown; raw?: boolean; code: string }> = [
      { name: 'texto que no es JSON', payload: '{esto no es json', raw: true, code: 'INVALID_JSON' },
      { name: 'JSON que no es objeto', payload: '[1,2,3]', raw: true, code: 'INVALID_MESSAGE' },
      { name: 'tipo desconocido', payload: { type: 'note:hack' }, code: 'INVALID_MESSAGE' },
      { name: 'tipo de la etapa 1', payload: { type: 'note:create', note: makeNote() }, code: 'INVALID_MESSAGE' },
      { name: 'tipo de otro sentido', payload: { type: 'init', doc: '' }, code: 'INVALID_MESSAGE' },
      { name: 'update ausente', payload: { type: 'doc:update' }, code: 'INVALID_MESSAGE' },
      { name: 'update que no es base64', payload: { type: 'doc:update', update: 'no*es*base64' }, code: 'INVALID_MESSAGE' },
      { name: 'update vacío', payload: { type: 'doc:update', update: '' }, code: 'INVALID_MESSAGE' },
      {
        name: 'mensaje de presencia gigante',
        payload: { type: 'presence:rename', name: 'x'.repeat(MAX_MESSAGE_BYTES) },
        code: 'INVALID_MESSAGE',
      },
    ];

    for (const { name, payload, raw, code } of cases) {
      if (raw) a.sendRaw(payload as string);
      else a.send(payload);
      const error = await a.next('error');
      assert.equal(error.code, code, `caso «${name}»`);
    }

    a.sendRaw(Buffer.from('{"type":"doc:update"}'), { binary: true });
    assert.equal((await a.next('error')).code, 'INVALID_MESSAGE', 'caso «mensaje binario»');

    assert.deepEqual(await b.unexpected(DOC_EVENTS), [], 'nada inválido debe llegar a los demás');
    assert.equal(a.socket.readyState, WebSocket.OPEN, 'un mensaje mal formado no cierra la conexión');
  });

  /** Documentos inválidos: cada uno se construye aparte y se envía como update. */
  const invalidDocs: Array<{ name: string; code: string; build: (doc: Y.Doc) => void }> = [
    {
      name: 'color fuera de la paleta',
      code: 'INVALID_UPDATE',
      build: (doc) => insertNote(doc, { ...makeNote(), color: 'black' as never }, 0),
    },
    {
      name: 'posición fuera del tablero',
      code: 'INVALID_UPDATE',
      build: (doc) => insertNote(doc, { ...makeNote(), x: 99_999 }, 0),
    },
    {
      name: 'inclinación excesiva',
      code: 'INVALID_UPDATE',
      build: (doc) => insertNote(doc, { ...makeNote(), rotation: 45 }, 0),
    },
    {
      name: 'id de nota que no es UUID',
      code: 'INVALID_UPDATE',
      build: (doc) => insertNote(doc, { ...makeNote(), id: '../../etc/passwd' }, 0),
    },
    {
      name: 'campo desconocido',
      code: 'INVALID_UPDATE',
      build: (doc) => {
        const note = makeNote();
        insertNote(doc, note, 0);
        getNotesMap(doc).get(note.id)?.set('admin', true);
      },
    },
    {
      name: 'nota que no es un mapa',
      code: 'INVALID_UPDATE',
      build: (doc) => getNotesMap(doc).set(makeNote().id, 'hola' as never),
    },
    {
      name: 'texto que no es Y.Text',
      code: 'INVALID_UPDATE',
      build: (doc) => {
        const note = makeNote();
        insertNote(doc, note, 0);
        getNotesMap(doc).get(note.id)?.set('text', 'texto plano');
      },
    },
    {
      name: 'texto con formato',
      code: 'INVALID_UPDATE',
      build: (doc) => {
        const note = makeNote();
        insertNote(doc, note, 0);
        getNoteText(doc, note.id)?.insert(0, 'negrita', { bold: true });
      },
    },
    {
      name: 'texto con caracteres de control',
      code: 'INVALID_UPDATE',
      build: (doc) => {
        const note = makeNote();
        insertNote(doc, note, 0);
        getNoteText(doc, note.id)?.insert(0, `a${String.fromCharCode(0)}b`);
      },
    },
    {
      name: 'otro tipo raíz',
      code: 'INVALID_UPDATE',
      build: (doc) => doc.getMap('basura').set('x', 1),
    },
    {
      name: 'texto demasiado largo',
      code: 'BOARD_LIMIT',
      build: (doc) => insertNote(doc, makeNote({ text: 'x'.repeat(51) }), 0),
    },
    {
      name: 'demasiadas notas',
      code: 'BOARD_LIMIT',
      build: (doc) => [0, 1, 2, 3].forEach((z) => insertNote(doc, makeNote(), z)),
    },
  ];

  for (const { name, code, build } of invalidDocs) {
    test(`rechaza un update con ${name}, pide resincronizar y no lo reenvía`, async () => {
      const { wsUrl } = await setup({ limits: { notes: 3, textLength: 50 } });
      const a = (await join(wsUrl)).client;
      const b = (await join(wsUrl)).client;
      const closed = once(a.socket, 'close');

      const doc = new Y.Doc();
      build(doc);
      a.send({ type: 'doc:update', update: encodeUpdate(Y.encodeStateAsUpdate(doc)) });

      assert.equal((await a.next('error')).code, code);
      const [closeCode] = (await closed) as [number];
      assert.equal(closeCode, RESET_CLOSE_CODE, 'el cliente debe descartar su copia y resincronizarse');
      assert.deepEqual(await b.unexpected(DOC_EVENTS), [], 'nada inválido llega a los demás');
      assert.deepEqual(notesOf((await join(wsUrl)).init.doc), [], 'el documento del servidor no cambió');
    });
  }

  test('rechaza bytes que no son un update de Yjs', async () => {
    const { wsUrl } = await setup();
    const a = (await join(wsUrl)).client;
    a.send({ type: 'doc:update', update: Buffer.from([9, 9, 9, 9, 200, 200]).toString('base64') });
    assert.equal((await a.next('error')).code, 'INVALID_UPDATE');
  });

  test('rechaza un update que depende de otro que el servidor no recibió', async () => {
    const { wsUrl } = await setup();
    const a = (await join(wsUrl)).client;
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => updates.push(update));
    doc.transact(() => insertNote(doc, makeNote(), 0));
    doc.transact(() => insertNote(doc, makeNote(), 1));

    a.send({ type: 'doc:update', update: encodeUpdate(updates[1]!) }); // falta el primero
    assert.equal((await a.next('error')).code, 'INVALID_UPDATE');
  });

  test('tras un update rechazado, el servidor sigue aceptando updates válidos', async () => {
    const { wsUrl } = await setup();
    const evil = (await join(wsUrl)).client;
    const bad = new Y.Doc();
    bad.getMap('basura').set('x', 1);
    evil.send({ type: 'doc:update', update: encodeUpdate(Y.encodeStateAsUpdate(bad)) });
    await evil.next('error');

    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ text: 'sigue funcionando' });
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();
    assert.deepEqual(b.notes(), [asBoardNote(note, 0)]);
  });

  test('cierra la conexión si un mensaje supera maxPayload (2 MiB)', async () => {
    const { wsUrl } = await setup();
    const a = (await join(wsUrl)).client;
    const closed = once(a.socket, 'close');

    a.sendRaw(JSON.stringify({ type: 'doc:update', update: 'A'.repeat(MAX_PAYLOAD_BYTES) }));

    const [code] = (await closed) as [number];
    assert.equal(code, 1009); // Message Too Big
  });

  test('rechaza orígenes no permitidos durante el handshake', async () => {
    const { wsUrl } = await setup();
    for (const origin of ['https://sitio-malicioso.example', undefined]) {
      const ws = new WebSocket(wsUrl, origin ? { origin } : {});
      ws.on('error', () => {}); // terminate() durante el handshake emite un error esperado
      const [, response] = (await once(ws, 'unexpected-response')) as [unknown, IncomingMessage];
      assert.equal(response.statusCode, 403, `origen ${origin ?? '(ausente)'}`);
      ws.terminate();
    }
  });
});

describe('señales de vida', () => {
  test('el servidor manda heartbeat para que el cliente note un socket zombi', async () => {
    const { wsUrl } = await setup({ heartbeatIntervalMs: 60 });
    const a = (await join(wsUrl)).client;
    assert.deepEqual(await a.next('heartbeat', 1000), { type: 'heartbeat' });
    assert.deepEqual(await a.next('heartbeat', 1000), { type: 'heartbeat' });
  });

  test('cierra las conexiones que no responden al ping y mantiene las sanas', async () => {
    const { wsUrl } = await setup({ heartbeatIntervalMs: 80 });
    const healthy = (await join(wsUrl)).client;

    // `autoPong: false` simula un cliente colgado que ya no contesta.
    const ghost = await TestClient.connect(wsUrl, { autoPong: false });
    clients.push(ghost);
    const [code] = (await once(ghost.socket, 'close')) as [number];

    assert.equal(code, 1006); // cierre abrupto (terminate)
    const { peer } = await healthy.next('peer:joined');
    assert.deepEqual(await healthy.next('peer:left', 2000), { type: 'peer:left', id: peer.id });
    assert.equal(healthy.socket.readyState, WebSocket.OPEN);
  });
});
