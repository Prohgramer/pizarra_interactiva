import type { RoomStore, StoredRoom } from './types';

/**
 * Almacén en memoria: se usa en desarrollo sin DATABASE_URL y en pruebas.
 * Las salas sobreviven a que se descarguen, pero no a reiniciar el proceso.
 */
export class MemoryStore implements RoomStore {
  readonly kind = 'memory';
  readonly #rooms = new Map<string, Uint8Array>();

  async load(roomId: string): Promise<StoredRoom | null> {
    const state = this.#rooms.get(roomId);
    return state ? { state: state.slice(), migrated: false } : null;
  }

  async save(roomId: string, state: Uint8Array): Promise<void> {
    // Sin base de datos no hay cuentas, así que aquí no hay dueño que guardar.
    this.#rooms.set(roomId, state.slice());
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}
}
