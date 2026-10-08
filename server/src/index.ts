import { loadConfig } from './config';
import { createBoardServer } from './server';
import { createBackend } from './store';

// Carga server/.env si existe. Las variables ya definidas en el entorno tienen prioridad.
try {
  process.loadEnvFile();
} catch {
  // Sin archivo .env: se usan las variables del entorno y los valores por defecto.
}

const config = loadConfig();
const log = (message: string) => console.log(`[pizarra] ${message}`);

const { store, accounts } = await createBackend(config.databaseUrl, log);
const server = createBoardServer({
  port: config.port,
  allowedOrigins: config.allowedOrigins,
  store,
  accounts,
  log,
});
const port = await server.listen();

log(`Servidor escuchando en http://localhost:${port} (salud en /health).`);
log(
  config.allowedOrigins === '*'
    ? 'Orígenes permitidos: cualquiera (ALLOWED_ORIGINS=*).'
    : `Orígenes permitidos: ${config.allowedOrigins.join(', ')}`,
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} recibido: guardando las salas y cerrando…`);
  await server.close();
  await store.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
