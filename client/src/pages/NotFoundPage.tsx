import { useEffect } from 'react';
import { createRoomId } from '@pizarra/shared';
import { Link } from '../components/Link';
import { boardPath, navigate } from '../lib/router';

export function NotFoundPage() {
  useEffect(() => {
    document.title = 'Enlace no válido · Pizarra';
  }, []);

  const createBoard = () => {
    navigate(boardPath(createRoomId((bytes) => crypto.getRandomValues(bytes))), { replace: true });
  };

  return (
    <main className="home home--centered">
      <section className="home__hero">
        <div className="lost-note note--pink" aria-hidden="true">
          ?
        </div>
        <h1 className="home__title">Este enlace no lleva a ningún tablero</h1>
        <p className="home__lead">
          Revisa que esté completo: los enlaces de tablero terminan en <code>/tablero/</code> seguido de 12 letras
          minúsculas o números.
        </p>
        <div className="home__actions">
          <button type="button" className="button button--primary button--large" onClick={createBoard}>
            Crear un tablero nuevo
          </button>
          <Link to="/" className="button button--ghost button--large">
            Ir al inicio
          </Link>
        </div>
      </section>
    </main>
  );
}
