import { memo, useSyncExternalStore, type CSSProperties } from 'react';
import type { PeersState } from '../hooks/peersReducer';
import { PRESENCE_COLOR_HEX } from '../lib/colors';
import type { CursorStore } from '../lib/cursorStore';

interface CursorsProps {
  store: CursorStore;
  peers: PeersState;
}

/**
 * Cursores de las demás personas, dentro del tablero (en sus coordenadas).
 * Se suscribe directo al CursorStore: los movimientos solo renderizan esta capa.
 * Es decorativa para lectores de pantalla: quién está se anuncia en los avatares.
 */
export const Cursors = memo(function Cursors({ store, peers }: CursorsProps) {
  const cursors = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return (
    <div className="cursors" aria-hidden="true">
      {Array.from(cursors, ([id, cursor]) => {
        const peer = peers.get(id);
        if (!peer) return null;
        const style = {
          translate: `${cursor.x}px ${cursor.y}px`,
          '--peer': PRESENCE_COLOR_HEX[peer.color],
        } as CSSProperties;
        return (
          <div key={id} className="cursor" style={style}>
            <svg className="cursor__arrow" width="18" height="20" viewBox="0 0 18 20">
              <path d="M1.5 1.5v15l4.2-3.9 3 6.4 2.9-1.3-3-6.3 5.8-.2z" />
            </svg>
            <span className="cursor__label">{peer.name}</span>
          </div>
        );
      })}
    </div>
  );
});
