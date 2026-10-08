import { Accounts, PostgresAccounts } from '../accounts';
import { createPgDatabase } from '../db/database';
import { migrate } from '../db/migrate';
import { MemoryStore } from './memory';
import { PostgresStore } from './postgres';
import type { RoomStore } from './types';

export type { RoomStore, StoredRoom } from './types';
export { MemoryStore } from './memory';
export { PostgresStore } from './postgres';

export interface Backend {
  store: RoomStore;
  /** null sin base de datos: el servidor funciona, pero sin cuentas ni permisos. */
  accounts: Accounts | null;
}

/**
 * Con DATABASE_URL: PostgreSQL, con las migraciones aplicadas antes de aceptar
 * conexiones (si la base no responde, el arranque falla). Sin ella: memoria,
 * y sin cuentas, porque una cuenta que se pierde al reiniciar no sirve.
 */
export async function createBackend(
  databaseUrl: string | undefined,
  log: (message: string) => void,
): Promise<Backend> {
  if (!databaseUrl) {
    log('Sin DATABASE_URL: los tableros se guardan en memoria y se pierden al reiniciar el servidor.');
    log('Sin base de datos tampoco hay cuentas: todos los tableros son públicos.');
    return { store: new MemoryStore(), accounts: null };
  }

  const db = createPgDatabase(databaseUrl, log);
  try {
    const applied = await migrate(db);
    log(applied.length > 0 ? `Migraciones aplicadas: ${applied.join(', ')}.` : 'Esquema de la base al día.');
  } catch (error) {
    await db.close();
    throw error;
  }
  // Las dos comparten el mismo pool: cerrar el almacén cierra la base.
  return { store: new PostgresStore(db), accounts: new Accounts(new PostgresAccounts(db)) };
}
