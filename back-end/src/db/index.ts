import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Opens the SQLite database at `path` (or `:memory:`), running any pending
 * migrations before returning.
 */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  if (path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
