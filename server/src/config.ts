export type AllowedOrigins = readonly string[] | '*';

export interface ServerConfig {
  port: number;
  allowedOrigins: AllowedOrigins;
  /** Conexión a PostgreSQL; sin ella los tableros viven solo en memoria. */
  databaseUrl: string | undefined;
}

/** Orígenes del cliente de Vite en desarrollo. */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * `ALLOWED_ORIGINS` es una lista separada por comas (`https://a.com,https://b.com`)
 * o `*` para aceptar cualquier origen. Si no está definida se usan los de desarrollo.
 */
export function parseAllowedOrigins(value: string | undefined): AllowedOrigins {
  const trimmed = value?.trim();
  if (!trimmed) return DEV_ORIGINS;
  if (trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 8080;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT inválido: «${value}».`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: parsePort(env.PORT),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
  };
}
