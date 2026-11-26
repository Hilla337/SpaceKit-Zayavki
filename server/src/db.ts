import pg from 'pg';

// bigint (id и т.п.) приходит из pg строкой, нам нужны числа.
pg.types.setTypeParser(20, (v) => Number(v));

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Выполняет fn в одной транзакции: при ошибке всё откатывается. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });

  const wrap = (c: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const r = await c.query(text, params);
      return { rows: r.rows as T[] };
    },
  });

  return {
    ...wrap(pool),
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
