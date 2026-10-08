/**
 * PostgresStore contra un PostgreSQL de verdad: PGlite por defecto, o la base
 * de TEST_DATABASE_URL si está definida.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { insertNote } from '@pizarra/shared';
import type { Database } from '../src/db/database';
import { migrate } from '../src/db/migrate';
import { PostgresStore } from '../src/store/postgres';
import { asBoardNote, createTestDatabase, makeNote, makeRoomId, notesOf } from './helpers';

let db: Database;
let store: PostgresStore;

before(async () => {
  db = await createTestDatabase();
  await migrate(db);
  store = new PostgresStore(db);
});

after(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('TRUNCATE rooms CASCADE');
});

/** Estado codificado de un documento con estas notas (z = posición en la lista). */
function stateWith(...notes: ReturnType<typeof makeNote>[]): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => notes.forEach((note, z) => insertNote(doc, note, z)));
  return Y.encodeStateAsUpdate(doc);
}

/** Una fila de la Etapa 2; el color es texto libre, como lo era entonces en la base. */
async function insertLegacyNote(roomId: string, note: ReturnType<typeof makeNote>, order: number, color: string = note.color) {
  await db.query(
    `INSERT INTO notes (room_id, id, x, y, text, color, rotation, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [roomId, note.id, note.x, note.y, note.text, color, note.rotation, order],
  );
}

describe('migraciones', () => {
  test('son idempotentes y quedan registradas en orden', async () => {
    assert.deepEqual(await migrate(db), [], 'la segunda vez no hay nada que aplicar');
    const { rows } = await db.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
    assert.deepEqual(
      rows.map((row) => row.id),
      ['001_init', '002_yjs_documents', '003_accounts'],
    );
  });
});

describe('PostgresStore', () => {
  test('una sala sin guardar no existe y no se crea al leerla', async () => {
    const roomId = makeRoomId();
    assert.equal(await store.load(roomId), null);
    const { rows } = await db.query('SELECT 1 FROM rooms WHERE id = $1', [roomId]);
    assert.equal(rows.length, 0);
  });

  test('guarda y carga el documento completo, byte a byte', async () => {
    const roomId = makeRoomId();
    const state = stateWith(makeNote({ text: 'Comillas \' " y emoji 🗒️\ncon salto de línea' }), makeNote());

    await store.save(roomId, state);
    const loaded = await store.load(roomId);

    assert.ok(loaded);
    assert.equal(loaded.migrated, false);
    assert.deepEqual(loaded.state, state);
  });

  test('guardar de nuevo reemplaza el estado y actualiza la fecha de modificación', async () => {
    const roomId = makeRoomId();
    const note = makeNote({ text: 'segunda versión' });
    await store.save(roomId, stateWith(makeNote()));
    await store.save(roomId, stateWith(note));

    assert.deepEqual(notesOf((await store.load(roomId))!.state), [asBoardNote(note, 0)]);
    const { rows } = await db.query<{ created_at: Date; updated_at: Date }>(
      'SELECT created_at, updated_at FROM rooms WHERE id = $1',
      [roomId],
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0] && rows[0].updated_at >= rows[0].created_at);
  });

  test('las salas están aisladas', async () => {
    const [roomA, roomB] = [makeRoomId(), makeRoomId()];
    const note = makeNote({ text: 'en A' });
    await store.save(roomA, stateWith(note));
    await store.save(roomB, stateWith());

    assert.deepEqual(notesOf((await store.load(roomA))!.state), [asBoardNote(note, 0)]);
    assert.deepEqual(notesOf((await store.load(roomB))!.state), []);
  });

  test('convierte las filas de la Etapa 2 en documento, normalizándolas', async () => {
    const roomId = makeRoomId();
    const [a, b] = [makeNote({ text: 'segunda' }), makeNote({ text: 'primera', x: -50 })];
    await db.query('INSERT INTO rooms (id) VALUES ($1)', [roomId]);
    await insertLegacyNote(roomId, a, 7);
    await insertLegacyNote(roomId, b, 3, 'black');

    const loaded = await store.load(roomId);
    assert.ok(loaded);
    assert.equal(loaded.migrated, true);
    assert.deepEqual(notesOf(loaded.state), [
      asBoardNote({ ...b, x: 0, color: 'yellow' }, 3),
      asBoardNote(a, 7),
    ]);
  });

  test('al guardar una sala convertida se borran sus filas viejas (y solo las suyas)', async () => {
    const [roomId, otherRoom] = [makeRoomId(), makeRoomId()];
    await db.query('INSERT INTO rooms (id) VALUES ($1), ($2)', [roomId, otherRoom]);
    await insertLegacyNote(roomId, makeNote(), 0);
    await insertLegacyNote(otherRoom, makeNote(), 0);

    const loaded = await store.load(roomId);
    await store.save(roomId, loaded!.state);

    const { rows } = await db.query<{ room_id: string }>('SELECT room_id FROM notes');
    assert.deepEqual(
      rows.map((row) => row.room_id),
      [otherRoom],
    );
    assert.equal((await store.load(roomId))!.migrated, false);
  });

  test('ping responde mientras la base está disponible', async () => {
    await store.ping();
  });
});
