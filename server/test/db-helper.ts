import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db, Queryable } from '../src/db.js';

const dir = new URL('../migrations/', import.meta.url);

/** Настоящий PostgreSQL в памяти (WASM) с применёнными миграциями. */
export async function createTestDb(): Promise<Db> {
  const raw = new PGlite();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await raw.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  const wrap = (c: { query: PGlite['query'] }): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const r = await c.query<T>(text, params);
      return { rows: r.rows };
    },
  });
  return {
    ...wrap(raw),
    tx: (fn) => raw.transaction((tx) => fn(wrap(tx as unknown as { query: PGlite['query'] }))),
    close: () => raw.close(),
  };
}
