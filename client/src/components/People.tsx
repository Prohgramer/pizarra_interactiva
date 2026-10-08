import { useId, useRef, useState, type CSSProperties, type FocusEvent, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, normalizeName, type Peer } from '@pizarra/shared';
import type { PeerState } from '../hooks/peersReducer';
import { PRESENCE_COLOR_HEX } from '../lib/colors';
import { initials } from '../lib/identity';

interface PeopleProps {
  self: Peer;
  peers: readonly PeerState[];
  /** El nombre viene de una cuenta: cambiarlo lo cambia en todos los tableros. */
  fromAccount: boolean;
  onRename: (name: string) => void;
}

/** Avatares visibles; el resto se resume en «+N». */
const MAX_VISIBLE_PEERS = 3;

function peerStyle(peer: Peer): CSSProperties {
  return { '--peer': PRESENCE_COLOR_HEX[peer.color] } as CSSProperties;
}

/** Quién está en el tablero: tu avatar (que abre el cambio de nombre) y el de los demás. */
export function People({ self, peers, fromAccount, onRename }: PeopleProps) {
  const visible = peers.slice(0, MAX_VISIBLE_PEERS);
  const hidden = peers.slice(MAX_VISIBLE_PEERS);
  const total = peers.length + 1;
  const names = [`${self.name} (tú)`, ...peers.map((peer) => peer.name)].join(', ');

  return (
    <div className="people" role="group" aria-label={`${total} ${total === 1 ? 'persona' : 'personas'} en el tablero: ${names}`}>
      <SelfAvatar self={self} fromAccount={fromAccount} onRename={onRename} />
      {visible.map((peer) => (
        <span key={peer.id} className="avatar" style={peerStyle(peer)} title={peer.name} aria-hidden="true">
          {initials(peer.name)}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="avatar avatar--more" title={hidden.map((peer) => peer.name).join(', ')} aria-hidden="true">
          +{hidden.length}
        </span>
      )}
    </div>
  );
}

function SelfAvatar({
  self,
  fromAccount,
  onRename,
}: {
  self: Peer;
  fromAccount: boolean;
  onRename: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(self.name);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const hintId = useId();

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const toggle = () => {
    if (open) {
      close(false);
      return;
    }
    setDraft(self.name);
    setOpen(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizeName(draft);
    if (name && name !== self.name) onRename(name);
    close(true);
  };

  // Se cierra si el foco sale del formulario (salvo hacia el propio avatar, que lo alterna).
  const handleBlur = (event: FocusEvent<HTMLFormElement>) => {
    const next = event.relatedTarget;
    if (next === buttonRef.current) return;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="avatar avatar--self"
        style={peerStyle(self)}
        title={`${self.name} (tú)`}
        aria-label={`Tu nombre es ${self.name}. Cambiar nombre`}
        aria-expanded={open}
        onClick={toggle}
      >
        {initials(self.name)}
      </button>

      {open && (
        <form
          className="name-editor"
          aria-label="Cambiar tu nombre"
          onSubmit={submit}
          onBlur={handleBlur}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close(true);
          }}
        >
          <label htmlFor={inputId} className="name-editor__label">
            Tu nombre
          </label>
          <div className="name-editor__row">
            <input
              id={inputId}
              className="name-editor__input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.target.select()}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="nickname"
              spellCheck={false}
              aria-describedby={hintId}
              autoFocus
            />
            <button type="submit" className="button button--primary">
              Guardar
            </button>
          </div>
          <p id={hintId} className="name-editor__hint">
            {fromAccount
              ? 'Es el nombre de tu cuenta: se cambia en todos tus tableros.'
              : 'Así te ven las demás personas, junto a tu cursor.'}
          </p>
        </form>
      )}
    </>
  );
}
