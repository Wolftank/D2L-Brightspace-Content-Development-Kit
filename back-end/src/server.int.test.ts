import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDb } from './db/index.js';
import { createProjectsRepo } from './db/projects.js';
import { turns as turnsTable, type Turn } from './db/schema.js';
import { createTurnsRepo } from './db/turns.js';
import { createUsersRepo } from './db/users.js';

const BACK_END = fileURLToPath(new URL('..', import.meta.url));

describe('server startup', () => {
  let dataDir: string;
  let blocker: Server | undefined;
  let child: ChildProcess | undefined;

  function withDb<T>(use: (db: Db) => T): T {
    const db = openDb(join(dataDir, 'cdk.db')) as Db & { $client: Database.Database };
    try {
      return use(db);
    } finally {
      db.$client.close();
    }
  }

  function storedTurn(): Turn {
    return withDb((db) => db.select().from(turnsTable).all()[0]!);
  }

  function listenOnFreePort(): Promise<number> {
    return new Promise((resolve) => {
      blocker = createServer().listen(0, '127.0.0.1', () => resolve((blocker!.address() as { port: number }).port));
    });
  }

  function closeBlocker(): Promise<void> {
    return new Promise((resolve) => blocker!.close(() => resolve()));
  }

  /** Runs `src/server.ts` until it exits or logs that it is listening. */
  function runServer(port: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: BACK_END,
        env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      });
      child.stdout!.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes('listening')) resolve({ code: null, stdout, stderr });
      });
      child.stderr!.on('data', (chunk) => (stderr += chunk));
      child.on('exit', (code) => resolve({ code, stdout, stderr }));
    });
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-server-'));
    withDb((db) => {
      const ownerId = createUsersRepo(db).ensureLocalUser().id;
      createProjectsRepo(db).create({ id: 'project-1', ownerId, title: 'Cell division practice' });
      const turns = createTurnsRepo(db);
      turns.queue({ turnId: 'turn-1', messageId: 'message-1', projectId: 'project-1', content: [{ type: 'text', text: 'Hi' }] });
      turns.start('turn-1');
    });
  });

  afterEach(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child!.once('exit', resolve));
      child.kill();
      await exited;
    }
    child = undefined;
    if (blocker?.listening) await closeBlocker();
    blocker = undefined;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('exits with a plain message and leaves running turns alone when the port is in use', async () => {
    const port = await listenOnFreePort();

    const run = await runServer(port);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`Port ${port} on 127.0.0.1 is already in use`);
    expect(storedTurn()).toMatchObject({ status: 'running', error: null });
  }, 30_000);

  it('fails turns left running by an earlier back end once it holds its port', async () => {
    const port = await listenOnFreePort();
    await closeBlocker();

    const run = await runServer(port);

    expect(run.stdout).toContain(`back-end listening on http://127.0.0.1:${port}`);
    expect(storedTurn()).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
  }, 30_000);
});
