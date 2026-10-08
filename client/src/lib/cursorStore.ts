import type { Point } from '@pizarra/shared';

export type CursorMap = ReadonlyMap<string, Point>;

/**
 * Cursores de las demás personas, fuera del estado de React: llegan hasta 20
 * veces por segundo por persona y solo los dibuja la capa de cursores (con
 * `useSyncExternalStore`), así el resto del tablero no se vuelve a renderizar.
 */
export interface CursorStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CursorMap;
  set: (peerId: string, cursor: Point | null) => void;
  reset: (entries?: Iterable<readonly [string, Point]>) => void;
}

export function createCursorStore(): CursorStore {
  let snapshot: CursorMap = new Map();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    set(peerId, cursor) {
      if (!cursor && !snapshot.has(peerId)) return;
      const next = new Map(snapshot);
      if (cursor) next.set(peerId, cursor);
      else next.delete(peerId);
      snapshot = next;
      emit();
    },
    reset(entries = []) {
      const list = Array.from(entries);
      if (snapshot.size === 0 && list.length === 0) return;
      snapshot = new Map(list);
      emit();
    },
  };
}
