import pg from 'pg';

export interface QueryResult<Row> {
  rows: Row[];
}

/** Lo mínimo que el resto del servidor necesita de una conexión SQL. */
export interface Sql {
  /** Una sola sentencia con parámetros ($1, $2…). */
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<Row>>;
  /** Varias sentencias sin parámetros (scripts de migración). */
  exec(text: string): Promise<void>;
}

export interface Database extends Sql {
  /** Ejecuta `fn` dentro de BEGIN/COMMIT; si lanza, hace ROLLBACK. */
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function fromClient(client: pg.Pool | pg.PoolClient): Sql {
  return {
    query: async <Row>(text: string, params?: unknown[]) =>
      (await client.query(text, params)) as unknown as QueryResult<Row>,
    exec: async (text) => {
      await client.query(text);
    },
  };
}

/**
 * Base de datos PostgreSQL real, con un pool pequeño: el servidor escribe en
 * lote, así que pocas conexiones alcanzan.
 */
export function createPgDatabase(connectionString: string, log: (message: string) => void): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Sin este listener, un corte de una conexión inactiva tiraría el proceso.
  pool.on('error', (error) => log(`PostgreSQL: error en una conexión inactiva (${error.message}).`));

  return {
    ...fromClient(pool),

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(fromClient(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },

    close: () => pool.end(),
  };
}
