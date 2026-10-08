/** Estado guardado de una sala: su documento Yjs codificado como un update completo. */
export interface StoredRoom {
  state: Uint8Array;
  /**
   * true si el estado se construyó recién a partir de datos de la Etapa 2
   * (filas en `notes`): la sala debe guardarse pronto para completar la migración.
   */
  migrated: boolean;
}

/**
 * Dónde se guardan las salas. El servidor trabaja en memoria y usa el almacén
 * solo para cargar una sala al abrirla y para volcar su documento en lote.
 */
export interface RoomStore {
  readonly kind: 'memory' | 'postgres';
  /** Estado de la sala, o null si nunca se guardó. */
  load(roomId: string): Promise<StoredRoom | null>;
  /**
  * Reemplaza el estado guardado de la sala (y la crea si no existía). Si se
  * pasa `ownerId` y la sala es nueva, queda como suya; el dueño de una sala
  * que ya existe no cambia nunca por guardar.
  */
  save(roomId: string, state: Uint8Array, ownerId?: string | null): Promise<void>;
  /** Falla si el almacén no responde (se usa en /health). */
  ping(): Promise<void>;
  close(): Promise<void>;
}
