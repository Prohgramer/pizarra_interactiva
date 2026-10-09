import { useEffect, useState } from 'react';
import { createRoomId, type AccessRole, type RoomSummary, type RoomVisibility } from '@pizarra/shared';
import { AccountButton } from '../components/AccountButton';
import { ArrowRightIcon, CloseIcon, EyeIcon, LockIcon, PlusIcon } from '../components/Icons';
import { Link } from '../components/Link';
import { useSession } from '../hooks/useSession';
import { api } from '../lib/api';
import {
  forgetRoom,
  formatRoomCode,
  formatVisitedAt,
  loadRecentRooms,
  type RecentRoom,
} from '../lib/recentRooms';
import { CASE_PATH, boardPath, loginPath, navigate } from '../lib/router';

/** Notas decorativas de la portada: texto, color, inclinación y posición. */
const DECOR_NOTES = [
  { text: 'Lluvia de ideas', color: 'yellow', rotation: -4, className: 'decor--a' },
  { text: 'Sprint 12 ✓', color: 'green', rotation: 3, className: 'decor--b' },
  { text: '¿Y si probamos…?', color: 'pink', rotation: 2, className: 'decor--c' },
  { text: 'Demo el viernes', color: 'blue', rotation: -2, className: 'decor--d' },
] as const;

const ROLE_LABEL: Partial<Record<AccessRole, string>> = {
  owner: 'Tuyo',
  editor: 'Puedes editar',
  viewer: 'Solo lectura',
};

export function HomePage() {
  const { user, token, status, logout } = useSession();
  const [recent, setRecent] = useState<RecentRoom[]>(loadRecentRooms);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);

  useEffect(() => {
    document.title = 'Pizarra · notas en tiempo real';
  }, []);

  // Los tableros de la cuenta: propios y aquellos a los que invitaron.
  useEffect(() => {
    if (!token || !user) {
      setRooms(null);
      return;
    }
    const controller = new AbortController();
    api
      .rooms(token, controller.signal)
      .then((response) => setRooms(response.rooms))
      .catch(() => {
        if (!controller.signal.aborted) setRooms([]);
      });
    return () => controller.abort();
  }, [token, user]);

  const createBoard = () => {
    navigate(boardPath(createRoomId((bytes) => crypto.getRandomValues(bytes))));
  };

  const mine = new Set(rooms?.map((room) => room.id));
  const otherRecent = recent.filter((room) => !mine.has(room.id));

  return (
    <main className="home">
      <div className="home__decor" aria-hidden="true">
        {DECOR_NOTES.map((note) => (
          <div
            key={note.text}
            className={`decor-note note--${note.color} ${note.className}`}
            style={{ rotate: `${note.rotation}deg` }}
          >
            {note.text}
          </div>
        ))}
      </div>

      <header className="home__bar">
        <AccountButton user={user} loading={status === 'loading'} onLogout={() => void logout()} />
      </header>

      <section className="home__hero">
        <p className="home__brand">
          <span className="brand__mark" aria-hidden="true" />
          Pizarra
        </p>
        <h1 className="home__title">Notas adhesivas para pensar en equipo, en tiempo real.</h1>
        <p className="home__lead">
          Crea un tablero, comparte el enlace y muevan, escriban y ordenen notas a la vez. Todo queda guardado.
        </p>
        <button type="button" className="button button--primary button--large" onClick={createBoard}>
          <PlusIcon />
          Crear tablero
        </button>
        {!user && status === 'ready' && (
          <p className="home__note">
            Se puede usar sin cuenta. <Link to={loginPath('/')}>Con una cuenta</Link> los tableros son tuyos: eliges
            quién entra y los tienes todos juntos.
          </p>
        )}
        {/* <p className="home__note">
          <Link to={CASE_PATH}>Cómo está hecha</Link>: el caso de estudio, con las decisiones y lo que se rompió.
        </p> */}
      </section>

      {rooms !== null && rooms.length > 0 && (
        <section className="recent" aria-labelledby="mine-title">
          <h2 id="mine-title" className="recent__title">
            Tus tableros
          </h2>
          <ul className="recent__list">
            {rooms.map((room) => (
              <li key={room.id} className="recent__item">
                <Link to={boardPath(room.id)} className="recent__link">
                  <span className="recent__mark" aria-hidden="true" />
                  <span className="recent__code">{formatRoomCode(room.id)}</span>
                  <span className="recent__badges">
                    <VisibilityBadge visibility={room.visibility} />
                    <span className="badge">{ROLE_LABEL[room.role] ?? 'Invitado'}</span>
                  </span>
                  <span className="recent__time">{formatVisitedAt(new Date(room.updatedAt).getTime())}</span>
                  <ArrowRightIcon className="recent__arrow" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherRecent.length > 0 && (
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title" className="recent__title">
            {rooms !== null && rooms.length > 0 ? 'Otros tableros que visitaste' : 'Tus tableros recientes'}
          </h2>
          <ul className="recent__list">
            {otherRecent.map((room) => {
              const code = formatRoomCode(room.id);
              return (
                <li key={room.id} className="recent__item">
                  <Link to={boardPath(room.id)} className="recent__link">
                    <span className="recent__mark" aria-hidden="true" />
                    <span className="recent__code">{code}</span>
                    <span className="recent__time">{formatVisitedAt(room.visitedAt)}</span>
                    <ArrowRightIcon className="recent__arrow" />
                  </Link>
                  <button
                    type="button"
                    className="recent__forget"
                    aria-label={`Quitar el tablero ${code} de recientes`}
                    onClick={() => setRecent(forgetRoom(room.id))}
                  >
                    <CloseIcon />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="recent__hint">Solo se guardan en este navegador. Quitar uno de la lista no borra el tablero.</p>
        </section>
      )}
    </main>
  );
}

function VisibilityBadge({ visibility }: { visibility: RoomVisibility }) {
  if (visibility === 'private') {
    return (
      <span className="badge" title="Privado: solo quien invites">
        <LockIcon width={13} height={13} />
        Privado
      </span>
    );
  }
  if (visibility === 'link-read') {
    return (
      <span className="badge" title="Con el enlace se puede mirar, no editar">
        <EyeIcon width={13} height={13} />
        Con enlace
      </span>
    );
  }
  return null;
}
