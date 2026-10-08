import type { Peer, User } from '@pizarra/shared';
import type { ConnectionStatus } from '../hooks/useBoard';
import type { PeerState } from '../hooks/peersReducer';
import { REDO_SHORTCUT, UNDO_SHORTCUT } from '../lib/shortcuts';
import { AccountButton } from './AccountButton';
import { LinkIcon, PlusIcon, RedoIcon, UndoIcon } from './Icons';
import { Link } from './Link';
import { People } from './People';

interface ToolbarProps {
  status: ConnectionStatus;
  self: Peer;
  peers: readonly PeerState[];
  /** Cuenta con la que se entró, o null si se entró por el enlace. */
  user: User | null;
  sessionLoading: boolean;
  canCreate: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onCreate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onShare: () => void;
  onRename: (name: string) => void;
  onLogout: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando…',
  live: 'En vivo',
  offline: 'Sin conexión',
};

export function Toolbar({
  status,
  self,
  peers,
  user,
  sessionLoading,
  canCreate,
  canUndo,
  canRedo,
  onCreate,
  onUndo,
  onRedo,
  onShare,
  onRename,
  onLogout,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <Link to="/" className="brand" aria-label="Pizarra: ir al inicio">
        <span className="brand__mark" aria-hidden="true" />
        <span className="brand__name">Pizarra</span>
      </Link>

      <span className="toolbar__divider" aria-hidden="true" />

      <span className={`status status--${status}`} role="status" title={STATUS_LABEL[status]}>
        <span className="status__dot" aria-hidden="true" />
        <span className="status__label">{STATUS_LABEL[status]}</span>
      </span>

      <People self={self} peers={peers} fromAccount={user !== null} onRename={onRename} />

      <span className="toolbar__divider" aria-hidden="true" />

      {/* Deshacer y rehacer son tuyos: no tocan lo que hicieron las demás personas. */}
      <button
        type="button"
        className="button button--ghost button--icon"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={`Deshacer mi último cambio (${UNDO_SHORTCUT})`}
        title={`Deshacer (${UNDO_SHORTCUT})`}
      >
        <UndoIcon />
      </button>

      <button
        type="button"
        className="button button--ghost button--icon"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label={`Rehacer mi último cambio (${REDO_SHORTCUT})`}
        title={`Rehacer (${REDO_SHORTCUT})`}
      >
        <RedoIcon />
      </button>

      <button type="button" className="button button--ghost" onClick={onShare} aria-label="Copiar enlace del tablero">
        <LinkIcon />
        <span className="button__label">Compartir</span>
      </button>

      <button
        type="button"
        className="button button--primary"
        onClick={onCreate}
        disabled={!canCreate}
        aria-label="Nueva nota"
      >
        <PlusIcon />
        <span className="button__label">Nueva nota</span>
      </button>

      <span className="toolbar__divider" aria-hidden="true" />

      <AccountButton user={user} loading={sessionLoading} onLogout={onLogout} />
    </header>
  );
}
