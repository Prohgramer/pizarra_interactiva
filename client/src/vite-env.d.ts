/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del servidor WebSocket, p. ej. `wss://pizarra.onrender.com`. */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
