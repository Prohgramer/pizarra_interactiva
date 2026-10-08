/**
 * URL base del servidor WebSocket; cada sala se conecta a `<base>/rooms/<id>`.
 * Sin `VITE_WS_URL` se asume el servidor de desarrollo en el mismo host,
 * puerto 8080. Usar `location.hostname` permite probar desde el móvil
 * abriendo la IP de la red local.
 */
function defaultWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:8080`;
}

export const WS_URL = (import.meta.env.VITE_WS_URL?.trim() || defaultWsUrl()).replace(/\/+$/, '');

/**
 * Base de la API HTTP: el mismo servidor que el WebSocket, con http/https.
 * Así solo hay una variable de entorno que configurar al desplegar.
 */
export const API_URL = WS_URL.replace(/^ws/, 'http');
