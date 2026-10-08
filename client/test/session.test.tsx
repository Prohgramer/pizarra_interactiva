/**
 * La sesión guardada en el navegador: cuándo se conserva, cuándo se olvida y
 * qué ve la interfaz mientras tanto.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/lib/api';
import { SessionProvider, useSession } from '../src/hooks/useSession';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    rename: vi.fn(),
  },
}));

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, api: apiMock };
});

const ANA = { id: 'u1', email: 'ana@ejemplo.test', name: 'Ana' };

function Pantalla() {
  const { user, status, login, logout } = useSession();
  return (
    <div>
      <p data-testid="estado">{status}</p>
      <p data-testid="quien">{user ? user.name : 'sin cuenta'}</p>
      <button type="button" onClick={() => void login({ email: 'ana@ejemplo.test', password: 'contraseña-larga' })}>
        Entrar
      </button>
      <button type="button" onClick={() => void logout()}>
        Salir
      </button>
    </div>
  );
}

function mostrar() {
  return render(
    <SessionProvider>
      <Pantalla />
    </SessionProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('sesión guardada', () => {
  test('sin token guardado no se le pregunta nada al servidor', async () => {
    mostrar();
    expect(screen.getByTestId('estado')).toHaveTextContent('ready');
    expect(screen.getByTestId('quien')).toHaveTextContent('sin cuenta');
    expect(apiMock.me).not.toHaveBeenCalled();
  });

  test('con un token válido se recupera la cuenta al abrir la app', async () => {
    window.localStorage.setItem('pizarra:sesion', 'token-bueno');
    apiMock.me.mockResolvedValue({ user: ANA });

    mostrar();
    expect(screen.getByTestId('estado')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('quien')).toHaveTextContent('Ana'));
    expect(apiMock.me).toHaveBeenCalledWith('token-bueno', expect.anything());
  });

  test('un token que el servidor ya no reconoce se olvida', async () => {
    window.localStorage.setItem('pizarra:sesion', 'token-viejo');
    apiMock.me.mockRejectedValue(new ApiError('UNAUTHORIZED', 'Necesitas iniciar sesión.', 401));

    mostrar();
    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('ready'));
    expect(screen.getByTestId('quien')).toHaveTextContent('sin cuenta');
    expect(window.localStorage.getItem('pizarra:sesion')).toBeNull();
  });

  test('si el servidor no responde se conserva el token para reintentar', async () => {
    window.localStorage.setItem('pizarra:sesion', 'token-bueno');
    apiMock.me.mockRejectedValue(new ApiError('SERVER_ERROR', 'No se pudo hablar con el servidor.', 0));

    mostrar();
    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('ready'));
    expect(window.localStorage.getItem('pizarra:sesion')).toBe('token-bueno');
  });
});

describe('entrar y salir', () => {
  test('al entrar se guarda el token y aparece la cuenta', async () => {
    apiMock.login.mockResolvedValue({ user: ANA, token: 'token-nuevo', expiresAt: '2030-01-01T00:00:00.000Z' });
    apiMock.me.mockResolvedValue({ user: ANA });
    mostrar();

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(screen.getByTestId('quien')).toHaveTextContent('Ana'));
    expect(window.localStorage.getItem('pizarra:sesion')).toBe('token-nuevo');
  });

  test('al salir se olvida enseguida, aunque el servidor tarde', async () => {
    window.localStorage.setItem('pizarra:sesion', 'token-bueno');
    apiMock.me.mockResolvedValue({ user: ANA });
    apiMock.logout.mockReturnValue(new Promise(() => {}));
    mostrar();
    await waitFor(() => expect(screen.getByTestId('quien')).toHaveTextContent('Ana'));

    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));

    expect(screen.getByTestId('quien')).toHaveTextContent('sin cuenta');
    expect(window.localStorage.getItem('pizarra:sesion')).toBeNull();
    expect(apiMock.logout).toHaveBeenCalledWith('token-bueno');
  });
});
