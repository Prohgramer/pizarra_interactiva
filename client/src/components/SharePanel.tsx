import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  MEMBER_ROLES,
  ROOM_VISIBILITIES,
  type MemberRole,
  type RoomAccess,
  type RoomMember,
  type RoomVisibility,
} from '@pizarra/shared';
import type { RoomAccessState } from '../hooks/useRoomAccess';
import { ApiError, api } from '../lib/api';
import { CloseIcon, LinkIcon, TrashIcon } from './Icons';

interface SharePanelProps {
  roomId: string;
  token: string | null;
  signedIn: boolean;
  room: RoomAccessState;
  /** El acceso que manda: el del socket si ya llegó, si no el de la API. */
  access: RoomAccess;
  onClose: () => void;
  onCopyLink: () => void;
  onNotice: (text: string) => void;
}

const VISIBILITY_LABEL: Record<RoomVisibility, string> = {
  public: 'Cualquiera con el enlace puede editar',
  'link-read': 'Cualquiera con el enlace puede mirar',
  private: 'Solo las personas que invites',
};

const VISIBILITY_HINT: Record<RoomVisibility, string> = {
  public: 'Como una pizarra en un pasillo: quien tenga el enlace entra y escribe.',
  'link-read': 'Se puede compartir para mostrar, sin que nadie mueva nada.',
  private: 'Ni siquiera con el enlace: hay que tener cuenta y estar en la lista.',
};

const ROLE_LABEL: Record<MemberRole, string> = {
  editor: 'Puede editar',
  viewer: 'Solo puede mirar',
};

/** Quién puede entrar al tablero y con qué enlace. Lo administra el dueño. */
export function SharePanel({
  roomId,
  token,
  signedIn,
  room,
  access,
  onClose,
  onCopyLink,
  onNotice,
}: SharePanelProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const emailId = useId();
  const isOwner = access.role === 'owner';

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'No se pudo completar el cambio.');
    } finally {
      setBusy(false);
    }
  };

  const changeVisibility = (visibility: RoomVisibility) =>
    void guard(async () => {
      if (!token) return;
      const { access: updated } = await api.setVisibility(roomId, token, visibility);
      room.setAccess(updated);
      onNotice(`Ahora: ${VISIBILITY_LABEL[visibility].toLowerCase()}.`);
    });

  const addMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void guard(async () => {
      if (!token) return;
      const { members } = await api.addMember(roomId, token, { email, role });
      room.setMembers(members);
      setEmail('');
      onNotice('Invitación lista: ya puede entrar con su cuenta.');
    });
  };

  const removeMember = (member: RoomMember) =>
    void guard(async () => {
      if (!token) return;
      const { members } = await api.removeMember(roomId, token, member.user.id);
      room.setMembers(members);
    });

  return (
    <div className="overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
      >
        <header className="panel__head">
          <h2 id={titleId} className="panel__title">
            Compartir el tablero
          </h2>
          <button ref={closeRef} type="button" className="panel__close" aria-label="Cerrar" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <button type="button" className="button button--primary panel__copy" onClick={onCopyLink}>
          <LinkIcon />
          Copiar el enlace
        </button>

        <p className="panel__state">
          <strong>{VISIBILITY_LABEL[access.visibility]}.</strong>{' '}
          {room.owner ? `El tablero es de ${room.owner.name}.` : 'Este tablero todavía no tiene dueño.'}
        </p>

        {isOwner && (
          <fieldset className="panel__group" disabled={busy}>
            <legend className="panel__legend">Quién puede entrar</legend>
            {ROOM_VISIBILITIES.map((option) => (
              <label key={option} className="panel__option">
                <input
                  type="radio"
                  name="visibility"
                  value={option}
                  checked={access.visibility === option}
                  onChange={() => changeVisibility(option)}
                />
                <span>
                  <span className="panel__option-label">{VISIBILITY_LABEL[option]}</span>
                  <span className="panel__option-hint">{VISIBILITY_HINT[option]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {isOwner && (
          <section className="panel__group">
            <h3 className="panel__legend">Personas invitadas</h3>
            {room.members.length === 0 ? (
              <p className="panel__empty">Todavía no invitaste a nadie.</p>
            ) : (
              <ul className="panel__members">
                {room.members.map((member) => (
                  <li key={member.user.id} className="panel__member">
                    <span className="panel__member-name">
                      {member.user.name}
                      <span className="panel__member-email">{member.user.email}</span>
                    </span>
                    <span className="panel__member-role">{ROLE_LABEL[member.role]}</span>
                    <button
                      type="button"
                      className="panel__member-remove"
                      aria-label={`Quitar a ${member.user.name}`}
                      disabled={busy}
                      onClick={() => removeMember(member)}
                    >
                      <TrashIcon width={16} height={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form className="panel__invite" onSubmit={addMember}>
              <label className="panel__label" htmlFor={emailId}>
                Invitar por correo
              </label>
              <div className="panel__invite-row">
                <input
                  id={emailId}
                  className="panel__input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="persona@correo.com"
                  autoComplete="off"
                  required
                />
                <select
                  className="panel__select"
                  value={role}
                  aria-label="Qué puede hacer"
                  onChange={(event) => setRole(event.target.value as MemberRole)}
                >
                  {MEMBER_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABEL[option]}
                    </option>
                  ))}
                </select>
                <button type="submit" className="button button--ghost" disabled={busy}>
                  Invitar
                </button>
              </div>
              <p className="panel__hint">Tiene que tener una cuenta en Pizarra con ese correo.</p>
            </form>
          </section>
        )}

        {!isOwner && access.ownerless && (
          <p className="panel__hint">
            {signedIn
              ? 'Será tuyo en cuanto escribas la primera nota: ahí podrás elegir quién entra.'
              : 'Si entras con una cuenta y escribes la primera nota, el tablero será tuyo y podrás restringir quién entra.'}
          </p>
        )}

        {error && (
          <p className="panel__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
