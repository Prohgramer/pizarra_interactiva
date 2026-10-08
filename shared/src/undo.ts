/**
 * Deshacer y rehacer, por persona.
 *
 * Cada pestaña sigue solo sus propias transacciones (las del origen que le
 * pasa), así deshacer nunca toca lo que hicieron las demás: en un CRDT no hay
 * una historia única del documento, pero sí una historia propia dentro de él.
 *
 * Vive junto al esquema del documento (y no en el cliente) porque define qué
 * es un paso deshacible; las pruebas del servidor usan esta misma función para
 * comprobar cómo se comporta deshacer entre varias personas.
 */
import * as Y from 'yjs';
import { getNotesMap } from './doc';

/**
 * Los cambios seguidos se agrupan en un solo paso mientras no pase este
 * tiempo entre uno y otro (escribir una frase se deshace de una vez). El
 * cliente además corta el grupo al cambiar de acción o de nota.
 */
export const UNDO_CAPTURE_MS = 500;

/**
 * Gestor de deshacer sobre las notas del documento.
 *
 * `trackedOrigins` deja fuera lo que llega del servidor y lo que carga la
 * copia local: solo se deshace lo que hizo esta persona en esta sesión.
 *
 * `ignoreRemoteMapChanges` permite que deshacer devuelva su valor anterior a
 * un campo que otra persona cambió después. Es lo que corresponde aquí:
 * posición y color ya se resuelven con la última escritura (mover una nota es
 * pisar el valor que hubiera), así que deshacer un movimiento es un
 * movimiento más. Sin esto, Yjs descarta en silencio el paso que no puede
 * aplicar y deshace el anterior: quien mueve una nota que otra persona movió
 * después vería desaparecer la nota que había creado antes.
 *
 * El texto no entra en este trato: al ser un CRDT de secuencia, deshacer
 * quita o devuelve solo los caracteres propios y respeta los ajenos.
 */
export function createUndoManager(doc: Y.Doc, origin: unknown): Y.UndoManager {
  return new Y.UndoManager(getNotesMap(doc), {
    trackedOrigins: new Set([origin]),
    captureTimeout: UNDO_CAPTURE_MS,
    ignoreRemoteMapChanges: true,
  });
}
