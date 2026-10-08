import { useEffect, useId, useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, MIN_PASSWORD_LENGTH } from '@pizarra/shared';
import { Link } from '../components/Link';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { navigate } from '../lib/router';

type Mode = 'login' | 'register';

const TITLE: Record<Mode, string> = {
  login: 'Entra a tu cuenta',
  register: 'Crea tu cuenta',
};

/** A dónde volver después de entrar (`/entrar?volver=/tablero/…`). */
function returnPath(): string {
  const value = new URLSearchParams(window.location.search).get('volver');
  // Solo rutas de esta app: un «volver» a otro sitio sería una puerta para engaños.
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginPage() {
  const { user, status, login, register } = useSession();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    document.title = 'Entrar · Pizarra';
  }, []);

  // Si ya hay sesión (o se acaba de crear), no hay nada que hacer aquí.
  useEffect(() => {
    if (status === 'ready' && user) navigate(returnPath(), { replace: true });
  }, [status, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login({ email, password });
      else await register({ email, name, password });
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'No se pudo completar. Prueba de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <main className="home home--centered">
      <section className="home__hero auth">
        <Link to="/" className="home__brand auth__brand">
          <span className="brand__mark" aria-hidden="true" />
          Pizarra
        </Link>

        <h1 className="auth__title">{TITLE[mode]}</h1>
        <p className="auth__lead">
          Con cuenta, los tableros que creas son tuyos: eliges quién entra y quién escribe, y los tienes todos a mano.
          Sin cuenta se sigue pudiendo entrar a cualquier tablero público con su enlace.
        </p>

        <div className="auth__tabs" role="group" aria-label="Entrar o crear una cuenta">
          <button
            type="button"
            className={`auth__tab${mode === 'login' ? ' is-active' : ''}`}
            aria-pressed={mode === 'login'}
            onClick={() => switchTo('login')}
          >
            Ya tengo cuenta
          </button>
          <button
            type="button"
            className={`auth__tab${mode === 'register' ? ' is-active' : ''}`}
            aria-pressed={mode === 'register'}
            onClick={() => switchTo('register')}
          >
            Crear una cuenta
          </button>
        </div>

        <form className="auth__form" onSubmit={(event) => void submit(event)}>
          <label className="auth__label" htmlFor={emailId}>
            Correo
          </label>
          <input
            id={emailId}
            className="auth__input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            autoFocus
          />

          {mode === 'register' && (
            <>
              <label className="auth__label" htmlFor={nameId}>
                Tu nombre
              </label>
              <input
                id={nameId}
                className="auth__input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="name"
                required
              />
            </>
          )}

          <label className="auth__label" htmlFor={passwordId}>
            Contraseña
          </label>
          <input
            id={passwordId}
            className="auth__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            aria-describedby={error ? errorId : undefined}
            required
          />
          {mode === 'register' && (
            <p className="auth__hint">Al menos {MIN_PASSWORD_LENGTH} caracteres.</p>
          )}

          {error && (
            <p id={errorId} className="auth__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button button--primary button--large" disabled={busy}>
            {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <p className="auth__foot">
          <Link to="/">Volver al inicio</Link>
        </p>
      </section>
    </main>
  );
}
