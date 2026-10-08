import { readdir, readFile } from 'node:fs/promises';
import type { Database } from './database';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

/** Clave arbitraria del advisory lock que serializa las migraciones entre procesos. */
const MIGRATION_LOCK_KEY = 72_615_001;

/**
 * Aplica, en orden, los archivos `migrations/NNN_nombre.sql` que todavía no
 * figuran en `schema_migrations`. Cada migración corre en su propia
 * transacción con un advisory lock, así dos instancias que arrancan a la vez
 * no la aplican dos veces. Devuelve los ids aplicados.
 */
export async function migrate(db: Database): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const id = file.slice(0, -'.sql'.length);
    const script = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');

    const ran = await db.transaction(async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const { rows } = await sql.query('SELECT 1 FROM schema_migrations WHERE id = $1', [id]);
      if (rows.length > 0) return false;
      await sql.exec(script);
      await sql.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
      return true;
    });

    if (ran) applied.push(id);
  }

  return applied;
}
