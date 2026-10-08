import * as Y from 'yjs';
import {
  MAX_TEXT_LENGTH,
  NOTE_COLORS,
  clampNotePosition,
  clampRotation,
  createDocFromNotes,
  isNoteColor,
  type Note,
} from '@pizarra/shared';
import type { Database } from '../db/database';
import type { RoomStore, StoredRoom } from './types';

type LegacyNoteRow = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  rotation: number;
  sort_order: number;
};

/** Una fila de la Etapa 2, normalizada con las reglas actuales. */
function fromLegacyRow(row: LegacyNoteRow): Note & { order: number } {
  return {
    id: row.id,
    ...clampNotePosition(row.x, row.y),
    text: row.text.slice(0, MAX_TEXT_LENGTH),
    color: isNoteColor(row.color) ? row.color : NOTE_COLORS[0],
    rotation: clampRotation(row.rotation),
    order: row.sort_order,
  };
}

/** `pg` devuelve Buffer y PGlite Uint8Array: ambos sirven, pero se normaliza a Uint8Array. */
function toBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export class PostgresStore implements RoomStore {
  readonly kind = 'postgres';
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async load(roomId: string): Promise<StoredRoom | null> {
    const { rows } = await this.#db.query<{ doc: Uint8Array | null }>('SELECT doc FROM rooms WHERE id = $1', [
      roomId,
    ]);
    const doc = rows[0]?.doc;
    if (doc) return { state: toBytes(doc), migrated: false };

    // Sala de la Etapa 2 (o inexistente): si tiene notas en filas, se arma su documento.
    const legacy = await this.#db.query<LegacyNoteRow>(
      `SELECT id, x, y, text, color, rotation, sort_order
         FROM notes
        WHERE room_id = $1
        ORDER BY sort_order, id`,
      [roomId],
    );
    if (legacy.rows.length === 0) return null;

    const migrated = createDocFromNotes(legacy.rows.map(fromLegacyRow));
    const state = Y.encodeStateAsUpdate(migrated);
    migrated.destroy();
    return { state, migrated: true };
  }

  async save(roomId: string, state: Uint8Array, ownerId?: string | null): Promise<void> {
    await this.#db.transaction(async (sql) => {
      // `owner_id` solo se escribe al crear la fila: quien crea el tablero es su dueño.
      await sql.query(
        `INSERT INTO rooms (id, doc, owner_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET doc = excluded.doc, updated_at = now()`,
        [roomId, Buffer.from(state.buffer, state.byteOffset, state.byteLength), ownerId ?? null],
      );
      // Si la sala venía de la Etapa 2, sus filas ya están en el documento.
      await sql.query('DELETE FROM notes WHERE room_id = $1', [roomId]);
    });
  }

  async ping(): Promise<void> {
    await this.#db.query('SELECT 1');
  }

  close(): Promise<void> {
    return this.#db.close();
  }
}
