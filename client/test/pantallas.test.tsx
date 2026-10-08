/**
 * Pantallas: la de entrar y la barra del tablero. Comprueban lo que ve y
 * puede hacer quien usa la app, no los detalles de implementación.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/lib/api';
import { SessionProvider } from '../src/hooks/useSession';
import { LoginPage } from '../src/pages/LoginPage';
import { Toolbar } from '../src/components/Toolbar';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { me: vi.fn(), login: vi.fn(), logout: vi.fn(), register: vi.fn(), rename: vi.fn() },
}));

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, api: apiMock };
});

const ANA = { id: 'u1', email: 'ana@ejemplo.test', name: 'Ana' };

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/entrar');
  // Tras entrar, el proveedor comprueba la sesión: el doble tiene que responder.
  apiMock.me.mockResolvedValue({ user: ANA });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('pantalla de entrar', () => {
  const mostrar = () =>
    render(
      <SessionProvider>
        <LoginPage />
      </SessionProvider>,
    );

  test('entra con correo y contraseña', async () => {
    apiMock.login.mockResolvedValue({ user: ANA, token: 'token', expiresAt: '2030-01-01T00:00:00.000Z' });
    window.history.replaceState(null, '', '/entrar?volver=%2Ftablero%2Fabcdefghijkl');
    mostrar();

    await userEvent.type(screen.getByLabelText('Correo'), 'ana@ejemplo.test');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'contraseña-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(apiMock.login).toHaveBeenCalledWith({ email: 'ana@ejemplo.test', password: 'contraseña-larga' });
    // Al entrar vuelve a donde estaba.
    expect(window.location.pathname).toBe('/tablero/abcdefghijkl');
  });

  test('muestra el motivo cuando el servidor rechaza', async () => {
    apiMock.login.mockRejectedValue(new ApiError('INVALID_CREDENTIALS', 'El correo o la contraseña no coinciden.', 401));
    mostrar();

    await userEvent.type(screen.getByLabelText('Correo'), 'ana@ejemplo.test');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'otra-cosa');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El correo o la contraseña no coinciden.');
    expect(window.location.pathname).toBe('/entrar');
  });

  test('crear una cuenta pide además el nombre', async () => {
    apiMock.register.mockResolvedValue({ user: ANA, token: 'token', expiresAt: '2030-01-01T00:00:00.000Z' });
    mostrar();

    expect(screen.queryByLabelText('Tu nombre')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Crear una cuenta' }));

    await userEvent.type(screen.getByLabelText('Correo'), 'ana@ejemplo.test');
    await userEvent.type(screen.getByLabelText('Tu nombre'), 'Ana');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'contraseña-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(apiMock.register).toHaveBeenCalledWith({
      email: 'ana@ejemplo.test',
      name: 'Ana',
      password: 'contraseña-larga',
    });
  });

  test('un «volver» que apunte a otro sitio se ignora', async () => {
    apiMock.login.mockResolvedValue({ user: ANA, token: 'token', expiresAt: '2030-01-01T00:00:00.000Z' });
    window.history.replaceState(null, '', '/entrar?volver=https%3A%2F%2Fotro-sitio.test%2Fa');
    mostrar();

    await userEvent.type(screen.getByLabelText('Correo'), 'ana@ejemplo.test');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'contraseña-larga');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(window.location.href).toContain('localhost');
    expect(window.location.pathname).toBe('/');
  });
});

describe('barra del tablero', () => {
  const props = {
    status: 'live' as const,
    self: { id: 'yo', name: 'Nutria curiosa', color: 'indigo' as const },
    peers: [],
    user: null,
    sessionLoading: false,
    canCreate: true,
    canUndo: false,
    canRedo: false,
    onCreate: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onShare: vi.fn(),
    onRename: vi.fn(),
    onLogout: vi.fn(),
  };

  test('deshacer y rehacer están apagados cuando no hay nada que deshacer', () => {
    render(<Toolbar {...props} />);
    expect(screen.getByRole('button', { name: /^Deshacer/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Rehacer/ })).toBeDisabled();
  });

  test('deshacer avisa al pulsarlo', async () => {
    const onUndo = vi.fn();
    render(<Toolbar {...props} canUndo onUndo={onUndo} />);

    await userEvent.click(screen.getByRole('button', { name: /^Deshacer/ }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  test('sin cuenta ofrece entrar; con cuenta, el menú para salir', async () => {
    const { rerender } = render(<Toolbar {...props} />);
    expect(screen.getByRole('link', { name: 'Entrar a tu cuenta' })).toHaveAttribute(
      'href',
      expect.stringContaining('/entrar'),
    );

    const onLogout = vi.fn();
    rerender(<Toolbar {...props} user={ANA} onLogout={onLogout} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tu cuenta: Ana' }));
    const menu = screen.getByRole('group', { name: 'Tu cuenta' });
    expect(within(menu).getByText('ana@ejemplo.test')).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole('button', { name: 'Salir de la cuenta' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  test('no se puede crear una nota cuando el tablero es de solo lectura', () => {
    render(<Toolbar {...props} canCreate={false} />);
    expect(screen.getByRole('button', { name: 'Nueva nota' })).toBeDisabled();
  });
});
