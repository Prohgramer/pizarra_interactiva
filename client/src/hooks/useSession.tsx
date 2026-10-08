/**
 * La sesión de quien está usando la app: null si entró sin cuenta.
 *
 * Vive en un contexto porque la necesitan la portada, la barra del tablero y
 * el hook del tablero (para pedir el ticket del WebSocket).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@pizarra/shared';
import { ApiError, api } from '../lib/api';
import { loadToken, saveToken } from '../lib/session';

export type SessionStatus = 'loading' | 'ready';

export interface SessionApi {
  /** Cuenta actual, o null si nadie inició sesión. */
  user: User | null;
  /** Token de sesión, para las llamadas que lo necesitan. */
  token: string | null;
  /** «loading» mientras se comprueba el token guardado, al abrir la app. */
  status: SessionStatus;
  register: (input: { email: string; name: string; password: string }) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** Cambia el nombre de la cuenta (el que ven las demás personas). */
  rename: (name: string) => Promise<void>;
  /** Olvida la sesión sin avisar al servidor (cuando ya no vale). */
  forget: () => void;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SessionStatus>(token ? 'loading' : 'ready');
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const start = useCallback((session: { user: User; token: string }) => {
    saveToken(session.token);
    setToken(session.token);
    setUser(session.user);
    setStatus('ready');
  }, []);

  const forget = useCallback(() => {
    saveToken(null);
    setToken(null);
    setUser(null);
    setStatus('ready');
  }, []);

  // Al abrir la app se comprueba el token guardado: puede haber vencido o
  // haberse cerrado la sesión desde otro dispositivo.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setStatus('ready');
      return;
    }
    const controller = new AbortController();
    api
      .me(token, controller.signal)
      .then(({ user: found }) => {
        setUser(found);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Si el servidor no responde, se conserva el token y se reintenta al recargar.
        if (error instanceof ApiError && error.expired) forget();
        setStatus('ready');
      });
    return () => controller.abort();
  }, [token, forget]);

  const value = useMemo<SessionApi>(
    () => ({
      user,
      token,
      status,
      register: async (input) => start(await api.register(input)),
      login: async (input) => start(await api.login(input)),
      logout: async () => {
        const current = tokenRef.current;
        forget();
        if (current) await api.logout(current).catch(() => {});
      },
      rename: async (name) => {
        const current = tokenRef.current;
        if (!current) return;
        const { user: updated } = await api.rename(current, name);
        setUser(updated);
      },
      forget,
    }),
    [forget, start, status, token, user],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession necesita estar dentro de <SessionProvider>.');
  return session;
}
