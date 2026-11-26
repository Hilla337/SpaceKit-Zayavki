import { readdir, readFile } from 'node:fs/promises';
import { config } from './config.js';
import { createPgDb, type Db } from './db.js';

const defaultDir = new URL('../migrations/', import.meta.url);

export async function runMigrations(db: Db, dir: URL = defaultDir): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, dir), 'utf8');
    await db.tx(async (q) => {
      await q.query(sql);
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log('применена миграция', file);
  }
}

// Запуск как скрипт: npm run migrate
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const db = createPgDb(config.databaseUrl);
  runMigrations(db)
    .then(() => db.close())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
