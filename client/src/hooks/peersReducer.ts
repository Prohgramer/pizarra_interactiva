import type { Peer, PeerPresence } from '@pizarra/shared';

/** Otra persona en la sala, sin el cursor (que vive en el CursorStore). */
export interface PeerState extends Peer {
  /** Nota cuyo texto está editando, o null. */
  focus: string | null;
}

export type PeersState = ReadonlyMap<string, PeerState>;

export type PeersAction =
  | { type: 'reset'; peers: readonly PeerPresence[] }
  | { type: 'join'; peer: PeerPresence }
  | { type: 'leave'; id: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'focus'; id: string; noteId: string | null };

function toState({ id, name, color, focus }: PeerPresence): PeerState {
  return { id, name, color, focus };
}

function updatePeer(state: PeersState, id: string, update: (peer: PeerState) => PeerState): PeersState {
  const peer = state.get(id);
  if (!peer) return state;
  const next = new Map(state);
  next.set(id, update(peer));
  return next;
}

export function peersReducer(state: PeersState, action: PeersAction): PeersState {
  switch (action.type) {
    case 'reset':
      if (state.size === 0 && action.peers.length === 0) return state;
      return new Map(action.peers.map((peer) => [peer.id, toState(peer)]));
    case 'join': {
      const next = new Map(state);
      next.set(action.peer.id, toState(action.peer));
      return next;
    }
    case 'leave': {
      if (!state.has(action.id)) return state;
      const next = new Map(state);
      next.delete(action.id);
      return next;
    }
    case 'rename':
      return updatePeer(state, action.id, (peer) => ({ ...peer, name: action.name }));
    case 'focus':
      return updatePeer(state, action.id, (peer) => ({ ...peer, focus: action.noteId }));
  }
}
