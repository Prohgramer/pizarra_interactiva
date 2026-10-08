import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  BOARD_WIDTH,
  NOTE_WIDTH,
  ROOM_ID_ALPHABET,
  createRoomId,
  encodeUpdate,
  getNoteText,
  insertNote,
  isEmptyUpdate,
  isRoomId,
  readNotes,
  replaceText,
  sanitizeText,
  setNotePosition,
  validateBoardDoc,
} from '@pizarra/shared';
import { parseAllowedOrigins } from '../src/config';
import { isOriginAllowed, roomIdFromUrl } from '../src/server';
import { parseClientMessage } from '../src/validation';
import { makeNote, makeRoomId } from './helpers';

describe('parseClientMessage', () => {
  test('acepta un doc:update en base64 y descarta campos desconocidos', () => {
    const doc = new Y.Doc();
    insertNote(doc, makeNote(), 0);
    const update = encodeUpdate(Y.encodeStateAsUpdate(doc));
    const result = parseClientMessage(JSON.stringify({ type: 'doc:update', update, extra: 1 }));
    assert.deepEqual(result, { ok: true, message: { type: 'doc:update', update } });
  });

  test('no se deja engañar por propiedades heredadas', () => {
    const result = parseClientMessage('{"type":"toString"}');
    assert.equal(result.ok, false);
    const proto = parseClientMessage('{"type":"doc:update","__proto__":{"update":"AAA="}}');
    assert.equal(proto.ok, false);
  });

  test('rechaza ids de nota en mayúsculas en el foco', () => {
    const noteId = makeNote().id.toUpperCase();
    assert.equal(parseClientMessage(JSON.stringify({ type: 'presence:focus', noteId })).ok, false);
  });
});

describe('documento', () => {
  test('replaceText hace el cambio mínimo y no parte emojis', () => {
    const doc = new Y.Doc();
    const note = makeNote({ text: 'hola mundo' });
    insertNote(doc, note, 0);
    const text = getNoteText(doc, note.id)!;
    const ops: unknown[] = [];
    text.observe((event) => ops.push(...event.delta));

    replaceText(text, 'hola gran mundo');
    assert.deepEqual(ops, [{ retain: 5 }, { insert: 'gran ' }], 'solo se inserta lo nuevo');
    assert.equal(text.toString(), 'hola gran mundo');

    replaceText(text, 'hola 🦦 mundo');
    assert.equal(text.toString(), 'hola 🦦 mundo');
    replaceText(text, 'hola 🦊 mundo'); // comparten la primera mitad del par sustituto
    assert.equal(text.toString(), 'hola 🦊 mundo');
  });

  test('sanitizeText quita caracteres de control y conserva saltos de línea y tabulaciones', () => {
    const raw = `a${String.fromCharCode(0)}b\r\nc\td${String.fromCharCode(0x7f)}`;
    assert.equal(sanitizeText(raw), 'ab\nc\td');
  });

  test('readNotes normaliza lo que está fuera de rango en vez de confiar', () => {
    const doc = new Y.Doc();
    const note = makeNote();
    insertNote(doc, note, 0);
    setNotePosition(doc, note.id, 1e9, -5); // setNotePosition ya ajusta
    assert.deepEqual(readNotes(doc)[0], { ...note, x: BOARD_WIDTH - NOTE_WIDTH, y: 0, z: 0 });
  });

  test('validateBoardDoc acepta un documento válido y uno vacío', () => {
    const doc = new Y.Doc();
    assert.equal(validateBoardDoc(doc), null);
    insertNote(doc, makeNote({ text: 'válida' }), 0);
    replaceText(getNoteText(doc, readNotes(doc)[0]!.id)!, 'sigue siendo válida');
    assert.equal(validateBoardDoc(doc), null);
  });

  test('isEmptyUpdate reconoce un diff sin cambios', () => {
    const doc = new Y.Doc();
    insertNote(doc, makeNote(), 0);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    assert.equal(isEmptyUpdate(Y.encodeStateAsUpdate(copy, Y.encodeStateVector(doc))), true);
    assert.equal(isEmptyUpdate(Y.encodeStateAsUpdate(doc)), false);
  });
});

describe('ids de sala', () => {
  test('createRoomId genera ids válidos y distintos', () => {
    const ids = new Set(Array.from({ length: 500 }, makeRoomId));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.ok(isRoomId(id), id);
  });

  test('createRoomId descarta los bytes que sesgarían el alfabeto', () => {
    // 255 y 252 se descartan; 0 → «a», 35 → «9», 251 → 251 % 36 = 35 → «9».
    const sequence = [255, 0, 252, 35, 251];
    let call = 0;
    const id = createRoomId((bytes) => {
      bytes.fill(0);
      if (call++ === 0) bytes.set(sequence);
    });
    assert.equal(id.slice(0, 3), `a99`);
    assert.equal(id.length, 12);
    assert.equal(ROOM_ID_ALPHABET[35], '9');
  });

  test('roomIdFromUrl solo acepta /rooms/<id válido>', () => {
    assert.equal(roomIdFromUrl('/rooms/abcdefghij12'), 'abcdefghij12');
    assert.equal(roomIdFromUrl('/rooms/abcdefghij12?x=1'), 'abcdefghij12');
    for (const url of [undefined, '/', '/rooms/', '/rooms/ABCDEFGHIJ12', '/rooms/abc', '/rooms/abcdefghij12/', '/rooms/%2e%2e']) {
      assert.equal(roomIdFromUrl(url), null, String(url));
    }
  });
});

describe('orígenes permitidos', () => {
  test('parsea la lista de ALLOWED_ORIGINS', () => {
    assert.deepEqual(parseAllowedOrigins(' https://a.app/ , https://b.app '), ['https://a.app', 'https://b.app']);
    assert.equal(parseAllowedOrigins('*'), '*');
    assert.deepEqual(parseAllowedOrigins(undefined), ['http://localhost:5173', 'http://127.0.0.1:5173']);
  });

  test('exige un origen de la lista', () => {
    assert.equal(isOriginAllowed('https://a.app', ['https://a.app']), true);
    assert.equal(isOriginAllowed('https://b.app', ['https://a.app']), false);
    assert.equal(isOriginAllowed(undefined, ['https://a.app']), false);
    assert.equal(isOriginAllowed(undefined, '*'), true);
  });
});
