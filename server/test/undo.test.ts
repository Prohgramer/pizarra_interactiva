/**
 * Deshacer y rehacer entre varias personas. Cada cliente usa el mismo gestor
 * que el cliente real (`createUndoManager`), así que estas pruebas comprueban
 * de verdad qué revierte —y qué no— un paso atrás en un documento compartido.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getNoteText,
  getNotesMap,
  insertNote,
  removeNote,
  replaceText,
  setNoteColor,
  setNotePosition,
} from '@pizarra/shared';
import { TestClient, YClient, makeNote, notesOf, startServer, type RunningServer } from './helpers';

const running: RunningServer[] = [];
const clients: TestClient[] = [];
const yclients: YClient[] = [];

async function setup() {
  const server = await startServer();
  running.push(server);
  return server;
}

async function yjoin(url: string) {
  const yclient = await YClient.join(url);
  yclients.push(yclient);
  // El gestor se crea al entrar: lo que llegue en el `init` no es deshacible.
  void yclient.undo;
  return yclient;
}

afterEach(async () => {
  await Promise.all(yclients.splice(0).map((yclient) => (yclient.online ? yclient.disconnect() : undefined)));
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(running.splice(0).map(({ server }) => server.close()));
});

describe('deshacer y rehacer', () => {
  test('deshacer revierte lo propio y deja lo de las demás', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const mine = makeNote({ text: 'mía' });
    const yours = makeNote({ text: 'tuya' });

    a.change((doc) => insertNote(doc, mine, 0));
    await b.receive();
    b.change((doc) => insertNote(doc, yours, 1));
    await a.receive();
    assert.equal(a.notes().length, 2);

    a.run(() => a.undo.undo());
    await b.receive();

    assert.deepEqual(
      a.notes().map((note) => note.text),
      ['tuya'],
      'solo desaparece la nota de A',
    );
    assert.deepEqual(
      b.notes().map((note) => note.text),
      ['tuya'],
      'y desaparece también para B',
    );
    assert.deepEqual(await a.client.unexpected(['error']), [], 'el servidor acepta lo que produce deshacer');
  });

  test('deshacer un movimiento lo devuelve a su sitio aunque otra persona lo haya movido después', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ x: 100, y: 100 });
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();

    a.undo.stopCapturing();
    a.change((doc) => setNotePosition(doc, note.id, 640, 480));
    await b.receive();
    b.change((doc) => setNotePosition(doc, note.id, 900, 900));
    await a.receive();

    // La posición se resuelve con la última escritura: deshacer un movimiento
    // es un movimiento más, y gana por ser el último.
    a.run(() => a.undo.undo());
    await b.receive();

    assert.deepEqual(a.notes()[0], { ...note, x: 100, y: 100, z: 0 });
    assert.deepEqual(b.notes()[0], { ...note, x: 100, y: 100, z: 0 }, 'y todas ven lo mismo');
  });

  test('deshacer mi texto conserva lo que escribió otra persona en la misma nota', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ text: 'idea' });
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();

    a.undo.stopCapturing();
    a.change((doc) => replaceText(getNoteText(doc, note.id)!, 'idea de A'));
    await b.receive();
    b.change((doc) => replaceText(getNoteText(doc, note.id)!, 'idea de A y de B'));
    await a.receive();

    a.run(() => a.undo.undo());
    await b.receive();

    // Se van los caracteres que escribió A y se quedan los de B.
    assert.equal(a.notes()[0]?.text, 'idea y de B');
    assert.equal(b.notes()[0]?.text, 'idea y de B');
  });

  test('rehacer vuelve a aplicar lo deshecho y llega a los demás', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ color: 'yellow' });
    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();

    // Cortar el paso: si no, el color se juntaría con la creación en uno solo.
    a.undo.stopCapturing();
    a.change((doc) => setNoteColor(doc, note.id, 'lilac'));
    await b.receive();

    a.run(() => a.undo.undo());
    await b.receive();
    assert.equal(b.notes()[0]?.color, 'yellow');

    a.run(() => a.undo.redo());
    await b.receive();
    assert.equal(a.notes()[0]?.color, 'lilac');
    assert.equal(b.notes()[0]?.color, 'lilac');
  });

  test('deshacer un borrado devuelve la nota con su texto', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ text: 'no la pierdas', color: 'green' });
    a.change((doc) => insertNote(doc, note, 3));
    await b.receive();

    a.undo.stopCapturing();
    a.change((doc) => removeNote(doc, note.id));
    await b.receive();
    assert.deepEqual(b.notes(), []);

    a.run(() => a.undo.undo());
    await b.receive();

    assert.deepEqual(a.notes(), [{ ...note, z: 3 }]);
    assert.deepEqual(b.notes(), [{ ...note, z: 3 }], 'vuelve entera, con su texto y su color');
    const late = await TestClient.join(wsUrl);
    clients.push(late.client);
    assert.deepEqual(notesOf(late.init.doc), [{ ...note, z: 3 }], 'y el servidor la tiene guardada así');
  });

  test('un paso deshecho no se puede volver a deshacer, pero sí rehacer', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const note = makeNote();

    assert.equal(a.undo.canUndo(), false, 'al entrar no hay nada propio que deshacer');
    a.change((doc) => insertNote(doc, note, 0));
    assert.equal(a.undo.canUndo(), true);

    a.run(() => a.undo.undo());
    assert.equal(a.undo.canUndo(), false);
    assert.equal(a.undo.canRedo(), true);
    assert.deepEqual(a.notes(), []);
  });

  test('lo que llega del servidor no entra en la pila de deshacer', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);

    b.change((doc) => insertNote(doc, makeNote({ text: 'de B' }), 0));
    await a.receive();

    assert.equal(a.undo.canUndo(), false, 'A no puede deshacer lo que hizo B');
    a.run(() => a.undo.undo());
    assert.equal(a.notes().length, 1);
  });

  test('sin conexión también se deshace, y al volver se sincroniza el resultado', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);

    await a.disconnect();
    const kept = makeNote({ text: 'esta se queda' });
    const undone = makeNote({ text: 'esta no' });
    a.change((doc) => insertNote(doc, kept, 0));
    a.undo.stopCapturing();
    a.change((doc) => insertNote(doc, undone, 1));
    a.run(() => a.undo.undo());
    assert.deepEqual(
      a.notes().map((note) => note.text),
      ['esta se queda'],
    );

    await a.connect(wsUrl);
    await b.receive();
    assert.deepEqual(
      b.notes().map((note) => note.text),
      ['esta se queda'],
      'al servidor solo llega el resultado, no el ida y vuelta',
    );
  });

  test('deshacer la creación borra la nota aunque otra persona la haya escrito', async () => {
    const { wsUrl } = await setup();
    const a = await yjoin(wsUrl);
    const b = await yjoin(wsUrl);
    const note = makeNote({ text: '' });

    a.change((doc) => insertNote(doc, note, 0));
    await b.receive();
    b.change((doc) => replaceText(getNoteText(doc, note.id)!, 'idea de B'));
    await a.receive();

    // Limitación conocida: el borrado gana, como cuando alguien borra a mano
    // una nota que otra persona está editando.
    a.run(() => a.undo.undo());
    await b.receive();

    assert.equal(getNotesMap(a.doc).size, 0);
    assert.equal(getNotesMap(b.doc).size, 0);
  });
});
