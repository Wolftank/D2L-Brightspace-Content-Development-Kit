import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventsRepo } from './events.js';
import { type Db, openDb } from './index.js';
import { createProjectsRepo } from './projects.js';
import * as schema from './schema.js';
 
/**
 * R5 (#65): `openDb` against an in-memory database, a new database file, and
 * a database file created by an earlier set of migrations. File databases live
 * in a temporary directory. Each test names the Sprint 2 cases it covers.
 */
 
type OpenDb = Db & { $client: Database.Database };
 
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const JOURNAL = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
  entries: unknown[];
};
const SCHEMA_TABLES = Object.values(schema).map((table) => getTableConfig(table));
 
/** Asserts the database has exactly the tables and columns declared in `schema.ts`. */
function expectMatchesSchema(db: OpenDb): void {
  const tables = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'")
    .pluck()
    .all();
  expect([...tables].sort()).toEqual(SCHEMA_TABLES.map((table) => table.name).sort());
 
  for (const table of SCHEMA_TABLES) {
    const columns = db.$client.prepare('SELECT name FROM pragma_table_info(?)').pluck().all(table.name);
    expect([...columns].sort(), table.name).toEqual(table.columns.map((column) => column.name).sort());
  }
}
 
/** Returns how many migrations the database has recorded as applied. */
function appliedMigrations(db: OpenDb): number {
  return db.$client.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get() as number;
}
 
describe('R5 regression: database', () => {
  let dataDir: string;
  let opened: OpenDb[];
 
  function open(path: string): OpenDb {
    const db = openDb(path) as OpenDb;
    opened.push(db);
    return db;
  }
 
  /** Creates a database file at `path` with only the first `count` migrations applied. */
  function createWithMigrations(path: string, count: number): Database.Database {
    const migrationsFolder = join(dataDir, 'migrations');
    cpSync(MIGRATIONS, migrationsFolder, { recursive: true });
    writeFileSync(
      join(migrationsFolder, 'meta', '_journal.json'),
      JSON.stringify({ ...JOURNAL, entries: JOURNAL.entries.slice(0, count) }),
    );
    const sqlite = new Database(path);
    migrate(drizzle(sqlite), { migrationsFolder });
    return sqlite;
  }
 
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cdk-db-'));
    opened = [];
  });
 
  afterEach(() => {
    for (const db of opened) {
      if (db.$client.open) db.$client.close();
    }
    rmSync(dataDir, { recursive: true, force: true });
  });
 
  it('opens an in-memory database with every table in the schema (F24)', () => {
    const db = open(':memory:');
 
    expectMatchesSchema(db);
    expect(appliedMigrations(db)).toBe(JOURNAL.entries.length);
  });
 
  it('creates a missing parent directory, runs every migration and sets WAL for a file path (F25)', () => {
    const path = join(dataDir, 'nested', 'data', 'cdk.db');
 
    const db = open(path);
 
    expect(existsSync(path)).toBe(true);
    expectMatchesSchema(db);
    expect(appliedMigrations(db)).toBe(JOURNAL.entries.length);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });
 
  it.each([
    ['an in-memory database', () => ':memory:'],
    ['a database file', () => join(dataDir, 'cdk.db')],
  ])('rejects a project whose owner does not exist, in %s (F26)', (_, path) => {
    const db = open(path());
    const projects = createProjectsRepo(db);
 
    expect(() => projects.create({ id: 'project-1', ownerId: 'no-such-user', title: 'Cell division practice' })).toThrow(
      'FOREIGN KEY constraint failed',
    );
    expect(projects.getById('project-1')).toBeUndefined();
  });
 
  it.each(JOURNAL.entries.slice(0, -1).map((_, index) => index + 1))(
    'upgrades a database file created with the first %i migration(s), keeping its rows and using the events table',
    (count) => {
      const path = join(dataDir, 'cdk.db');
      const existing = createWithMigrations(path, count);
      existing.prepare("INSERT INTO users (id, display_name) VALUES ('user-1', 'Instructor')").run();
      existing
        .prepare(
          "INSERT INTO projects (id, owner_id, title, created_at, updated_at) VALUES ('project-1', 'user-1', 'Cell division practice', 1, 1)",
        )
        .run();
      existing.close();
 
      const db = open(path);
 
      expectMatchesSchema(db);
      expect(appliedMigrations(db)).toBe(JOURNAL.entries.length);
      expect(createProjectsRepo(db).get('user-1', 'project-1')?.title).toBe('Cell division practice');
      const event = createEventsRepo(db).insert({ projectId: 'project-1', kind: 'turn.started', payload: {} });
      expect(createEventsRepo(db).listAfter('project-1', 0)).toEqual([event]);
      db.$client.close();
 
      expect(appliedMigrations(open(path))).toBe(JOURNAL.entries.length);
    },
  );
});
 
