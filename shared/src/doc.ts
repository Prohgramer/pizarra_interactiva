/**
 * El documento Yjs de una sala: esquema, validación y operaciones.
 *
 *   notes: Y.Map<id de nota, Y.Map>     (único tipo raíz)
 *     x, y       number   esquina superior izquierda
 *     color      NoteColor
 *     rotation   number   inclinación en grados, fija
 *     z          number   orden de apilamiento (empates: por id)
 *     text       Y.Text   texto colaborativo, se fusiona carácter a carácter
 *
 * Posición y color se resuelven con la última escritura; el texto, con el CRDT
 * de Y.Text. Cliente y servidor usan estas mismas funciones.
 */
import * as Y from 'yjs';
import { fromBase64, toBase64 } from 'lib0/buffer';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DOC_LIMITS,
  MAX_ROTATION_DEG,
  NOTE_COLORS,
  NOTE_HEIGHT,
  NOTE_ID_PATTERN,
  NOTE_WIDTH,
  isNoteColor,
  type NoteColor,
} from './constants';
import { clampNotePosition, clampRotation } from './geometry';
import type { ErrorCode, Note } from './protocol';

export const NOTES_KEY = 'notes';

const NOTE_KEYS: ReadonlySet<string> = new Set(['x', 'y', 'color', 'rotation', 'z', 'text']);

export type YNote = Y.Map<unknown>;

/** Nota leída del documento, con su orden de apilamiento. */
export interface BoardNote extends Note {
  z: number;
}

export function getNotesMap(doc: Y.Doc): Y.Map<YNote> {
  return doc.getMap<YNote>(NOTES_KEY);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/* ───────────── Texto ───────────── */

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Caracteres de control que no tienen sentido en una nota (se conservan tabulación y salto de línea). */
function isForbiddenTextChar(code: number): boolean {
  return (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f;
}

/** Quita del texto los caracteres de control (incluido el retorno de carro). */
export function sanitizeText(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i += 1) {
    if (!isForbiddenTextChar(value.charCodeAt(i))) result += value[i];
  }
  return result;
}

/**
 * Lleva `text` al valor `next` con el cambio mínimo: se conserva el prefijo y
 * el sufijo comunes y solo se borra e inserta el medio. Así una edición local
 * es una operación pequeña que se fusiona bien con las de otras personas.
 * Nunca parte un par sustituto (un emoji) por la mitad.
 */
export function replaceText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;

  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;

  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
  ) {
    endCurrent -= 1;
    endNext -= 1;
  }

  if (start > 0 && isHighSurrogate(current.charCodeAt(start - 1))) start -= 1;
  if (endCurrent < current.length && isLowSurrogate(current.charCodeAt(endCurrent))) {
    endCurrent += 1;
    endNext += 1;
  }

  const apply = () => {
    if (endCurrent > start) text.delete(start, endCurrent - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  };
  if (text.doc) text.doc.transact(apply);
  else apply();
}

/* ───────────── Lectura ───────────── */

/**
 * Lee una nota de forma defensiva: devuelve null si no es una nota, y
 * normaliza lo que esté fuera de rango en vez de confiar en el documento.
 */
export function readNote(id: string, value: unknown): BoardNote | null {
  if (!NOTE_ID_PATTERN.test(id) || !(value instanceof Y.Map)) return null;
  const x = value.get('x');
  const y = value.get('y');
  const color = value.get('color');
  const rotation = value.get('rotation');
  const z = value.get('z');
  const text = value.get('text');
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;

  return {
    id,
    ...clampNotePosition(x, y),
    text: text instanceof Y.Text ? text.toString() : '',
    color: isNoteColor(color) ? color : NOTE_COLORS[0],
    rotation: isFiniteNumber(rotation) ? clampRotation(rotation) : 0,
    z: isFiniteNumber(z) ? z : 0,
  };
}

/** Notas válidas del documento, en orden de apilamiento. */
export function readNotes(doc: Y.Doc): BoardNote[] {
  const notes: BoardNote[] = [];
  for (const [id, value] of getNotesMap(doc).entries()) {
    const note = readNote(id, value);
    if (note) notes.push(note);
  }
  return notes.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Orden de apilamiento para una nota nueva: encima de todas. */
export function nextZ(doc: Y.Doc): number {
  let max = -1;
  for (const value of getNotesMap(doc).values()) {
    const z = value instanceof Y.Map ? value.get('z') : undefined;
    if (isFiniteNumber(z) && z > max) max = z;
  }
  return Math.floor(max) + 1;
}

/* ───────────── Escritura ───────────── */

function getNote(doc: Y.Doc, id: string): YNote | null {
  const note = getNotesMap(doc).get(id);
  return note instanceof Y.Map ? note : null;
}

export function getNoteText(doc: Y.Doc, id: string): Y.Text | null {
  const text = getNote(doc, id)?.get('text');
  return text instanceof Y.Text ? text : null;
}

export function insertNote(doc: Y.Doc, note: Note, z: number): void {
  const yNote = new Y.Map<unknown>([
    ['x', note.x],
    ['y', note.y],
    ['color', note.color],
    ['rotation', note.rotation],
    ['z', z],
    ['text', new Y.Text(sanitizeText(note.text))],
  ]);
  getNotesMap(doc).set(note.id, yNote);
}

export function setNotePosition(doc: Y.Doc, id: string, x: number, y: number): void {
  const note = getNote(doc, id);
  if (!note) return;
  const position = clampNotePosition(x, y);
  doc.transact(() => {
    if (note.get('x') !== position.x) note.set('x', position.x);
    if (note.get('y') !== position.y) note.set('y', position.y);
  });
}

export function setNoteColor(doc: Y.Doc, id: string, color: NoteColor): void {
  const note = getNote(doc, id);
  if (note && note.get('color') !== color) note.set('color', color);
}

export function removeNote(doc: Y.Doc, id: string): void {
  getNotesMap(doc).delete(id);
}

/** Crea el documento de una sala a partir de notas sueltas (migración de la Etapa 2). */
export function createDocFromNotes(notes: ReadonlyArray<Note & { order: number }>): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const note of notes) insertNote(doc, note, note.order);
  });
  return doc;
}

/* ───────────── Validación (servidor) ───────────── */

export interface DocProblem {
  code: Extract<ErrorCode, 'INVALID_UPDATE' | 'BOARD_LIMIT'>;
  reason: string;
}

function isPlainText(text: Y.Text): boolean {
  const content = text.toString();
  for (let i = 0; i < content.length; i += 1) {
    if (isForbiddenTextChar(content.charCodeAt(i))) return false;
  }
  // Sin formato ni objetos incrustados: solo inserciones de texto sin atributos.
  return (text.toDelta() as Array<{ insert?: unknown; attributes?: unknown }>).every(
    (op) => typeof op.insert === 'string' && op.attributes === undefined,
  );
}

/**
 * Comprueba que el documento completo cumpla el esquema y los límites.
 * El servidor la usa sobre una copia de prueba antes de aceptar un update.
 * Devuelve el primer problema encontrado, o null si es válido.
 */
export function validateBoardDoc(doc: Y.Doc, limits = DOC_LIMITS): DocProblem | null {
  const invalid = (reason: string): DocProblem => ({ code: 'INVALID_UPDATE', reason });

  if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) {
    return invalid('El update depende de cambios que el servidor no tiene.');
  }
  for (const name of doc.share.keys()) {
    if (name !== NOTES_KEY) return invalid(`Tipo raíz no permitido: «${name}».`);
  }

  const notes = getNotesMap(doc);
  if (notes._start !== null) return invalid('«notes» debe ser un mapa.');
  if (notes.size > limits.notes) {
    return { code: 'BOARD_LIMIT', reason: `El tablero supera las ${limits.notes} notas.` };
  }

  for (const [id, note] of notes.entries()) {
    if (!NOTE_ID_PATTERN.test(id)) return invalid(`Id de nota inválido: «${id}».`);
    if (!(note instanceof Y.Map) || note._start !== null) return invalid(`La nota ${id} debe ser un mapa.`);
    for (const key of note.keys()) {
      if (!NOTE_KEYS.has(key)) return invalid(`Campo desconocido «${key}» en la nota ${id}.`);
    }

    const x = note.get('x');
    const y = note.get('y');
    if (
      !isFiniteNumber(x) ||
      !isFiniteNumber(y) ||
      x < 0 ||
      y < 0 ||
      x > BOARD_WIDTH - NOTE_WIDTH ||
      y > BOARD_HEIGHT - NOTE_HEIGHT
    ) {
      return invalid(`Posición fuera del tablero en la nota ${id}.`);
    }
    if (!isNoteColor(note.get('color'))) return invalid(`Color no permitido en la nota ${id}.`);
    const rotation = note.get('rotation');
    if (!isFiniteNumber(rotation) || Math.abs(rotation) > MAX_ROTATION_DEG) {
      return invalid(`Inclinación inválida en la nota ${id}.`);
    }
    if (!isFiniteNumber(note.get('z'))) return invalid(`Orden de apilamiento inválido en la nota ${id}.`);

    const text = note.get('text');
    if (!(text instanceof Y.Text) || !isPlainText(text)) return invalid(`Texto inválido en la nota ${id}.`);
    if (text.length > limits.textLength) {
      return { code: 'BOARD_LIMIT', reason: `La nota ${id} supera los ${limits.textLength} caracteres.` };
    }
  }
  return null;
}

/* ───────────── Transporte ───────────── */

/** Los updates viajan dentro del JSON como base64. */
export const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function encodeUpdate(update: Uint8Array): string {
  return toBase64(update);
}

export function decodeUpdate(base64: string): Uint8Array {
  return fromBase64(base64);
}

/** Un update sin ningún cambio (lo que devuelve un diff cuando no hay nada nuevo). */
export function isEmptyUpdate(update: Uint8Array): boolean {
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}
