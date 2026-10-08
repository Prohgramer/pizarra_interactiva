/**
 * El token de sesión, guardado en este navegador.
 *
 * Se guarda en localStorage y viaja en una cabecera, no en una cookie: el
 * cliente está en otro dominio que el servidor y las cookies de terceros son
 * un problema (las bloquean los navegadores). A cambio, hay que cuidar que la
 * app no tenga XSS, que es donde un token en localStorage sufre.
 */
const STORAGE_KEY = 'pizarra:sesion';

export function loadToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento, la sesión dura lo que la pestaña.
  }
}
