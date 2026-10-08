import { useSyncExternalStore } from 'react';
import { isRoomId } from '@pizarra/shared';

/**
 * Router mínimo sobre la History API: la app tiene solo tres pantallas y no
 * justifica una dependencia. En producción, Vercel reescribe toda ruta a
 * index.html (client/vercel.json); Vite hace lo mismo en desarrollo.
 */
export type Route =
  | { page: 'home' }
  | { page: 'login' }
  | { page: 'case' }
  | { page: 'board'; roomId: string }
  | { page: 'not-found' };

const BOARD_PREFIX = '/tablero/';
export const LOGIN_PATH = '/entrar';
/** Caso de estudio: cómo está hecha la pizarra. */
export const CASE_PATH = '/caso';

/** Enlace a la pantalla de entrada que vuelve a `from` al terminar. */
export function loginPath(from?: string): string {
  return from && from !== '/' ? `${LOGIN_PATH}?volver=${encodeURIComponent(from)}` : LOGIN_PATH;
}

export function boardPath(roomId: string): string {
  return `${BOARD_PREFIX}${roomId}`;
}

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { page: 'home' };
  if (pathname === LOGIN_PATH) return { page: 'login' };
  if (pathname === CASE_PATH) return { page: 'case' };
  if (pathname.startsWith(BOARD_PREFIX)) {
    const roomId = pathname.slice(BOARD_PREFIX.length).replace(/\/$/, '');
    if (isRoomId(roomId)) return { page: 'board', roomId };
  }
  return { page: 'not-found' };
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function getPathname(): string {
  return window.location.pathname;
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname);
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  for (const listener of listeners) listener();
}
