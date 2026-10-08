import { useEffect, useRef, useState, type FocusEvent } from 'react';
import type { User } from '@pizarra/shared';
import { loginPath } from '../lib/router';
import { UserIcon } from './Icons';
import { Link } from './Link';

interface AccountButtonProps {
  user: User | null;
  /** Mientras se comprueba la sesión guardada no se muestra nada: evita el parpadeo. */
  loading?: boolean;
  onLogout: () => void;
}

/** Entrar, o el menú de la cuenta (nombre, correo y salir). */
export function AccountButton({ user, loading = false, onLogout }: AccountButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!user) setOpen(false);
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <Link
        to={loginPath(window.location.pathname)}
        className="button button--ghost"
        aria-label="Entrar a tu cuenta"
      >
        <UserIcon />
        <span className="button__label">Entrar</span>
      </Link>
    );
  }

  // El menú se cierra cuando el foco sale de él (o con Escape).
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false);
  };

  return (
    <div className="account" onBlur={handleBlur} onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
      <button
        ref={buttonRef}
        type="button"
        className="button button--ghost"
        aria-expanded={open}
        aria-label={`Tu cuenta: ${user.name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <UserIcon />
        <span className="button__label">{user.name}</span>
      </button>

      {open && (
        <div className="account__menu" role="group" aria-label="Tu cuenta">
          <p className="account__name">{user.name}</p>
          <p className="account__email">{user.email}</p>
          <button
            type="button"
            className="account__action"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Salir de la cuenta
          </button>
        </div>
      )}
    </div>
  );
}
