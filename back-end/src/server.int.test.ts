import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBuildsRepo } from './db/builds.js';
import { type Db, openDb } from './db/index.js';
import { createProjectsRepo } from './db/projects.js';
import { builds as buildsTable, turns as turnsTable, type Build, type Turn } from './db/schema.js';
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


  function storedBuild(): Build {
    return withDb((db) => db.select().from(buildsTable).all()[0]!);
  }

  function listenOnFreePort(): Promise<number> {
    return new Promise((resolve) => {
      blocker = createServer().listen(0, '127.0.0.1', () => resolve((blocker!.address() as { port: number }).port));
    });
  }

  /** Every record in the back end's log files, oldest first. */
  async function logRecords(): Promise<Record<string, unknown>[]> {
    const logsDir = join(dataDir, 'logs');
    const files = (await fs.readdir(logsDir)).sort();
    const text = (await Promise.all(files.map((name) => fs.readFile(join(logsDir, name), 'utf8')))).join('');
    return text.trim().split('\n').map((line) => JSON.parse(line));
  }

  function closeBlocker(): Promise<void> {
    return new Promise((resolve) => blocker!.close(() => resolve()));
  }

  /** Runs `src/server.ts` with `settings` until it exits or logs that it is listening. */
  function runServer(port: number, settings: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: BACK_END,
        env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...settings },
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
      createBuildsRepo(db).create({ projectId: 'project-1', version: 1, avenue: 'scorm', turnId: 'turn-1' });
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

    it('exits with a plain message and leaves running turns and checking builds alone when the port is in use', async () => {
    const port = await listenOnFreePort();

    const run = await runServer(port);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`Port ${port} on 127.0.0.1 is already in use`);
    expect(await logRecords()).toContainEqual(
      expect.objectContaining({ level: 60, msg: expect.stringContaining(`Port ${port} on 127.0.0.1 is already in use`) }),
    );
    expect(storedTurn()).toMatchObject({ status: 'running', error: null });
    expect(storedBuild()).toMatchObject({ status: 'checking', error: null });
  }, 30_000);

  it('fails turns and builds left active by an earlier back end once it holds its port', async () => {
    const port = await listenOnFreePort();
    await closeBlocker();

    await runServer(port);

    expect(await logRecords()).toContainEqual(expect.objectContaining({ msg: 'back-end listening', url: `http://127.0.0.1:${port}` }));
    expect(storedTurn()).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
    expect(storedBuild()).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
  }, 30_000);

  it('logs its data folder and settings at startup, and no secret from the environment', async () => {
    const port = await listenOnFreePort();
    await closeBlocker();
    const secrets = {
      ANTHROPIC_API_KEY: 'sk-ant-test-api-key',
      ANTHROPIC_AUTH_TOKEN: 'test-auth-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token',
      LAUNCH_TOKEN: 'test-launch-token',
    };

    await runServer(port, { ...secrets, APP_VERSION: '0.2.0' });

    const [startup] = await logRecords();
    expect(startup).toMatchObject({
      msg: 'back-end starting',
      settings: { port, dataDir, appVersion: '0.2.0', logLevel: 'info', agent: { driver: 'claude' } },
    });
    const logText = JSON.stringify(await logRecords());
    for (const value of Object.values(secrets)) expect(logText).not.toContain(value);
  }, 30_000);

  it('exits naming each invalid turn limit', async () => {
    const port = await listenOnFreePort();
    await closeBlocker();

    const run = await runServer(port, { AGENT_MAX_STEPS: '0', AGENT_MAX_BUDGET_USD: 'lots' });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('AGENT_MAX_STEPS: must be a whole number of 1 or more');
    expect(run.stderr).toContain('AGENT_MAX_BUDGET_USD: must be a number of US dollars greater than 0');
    expect(storedTurn()).toMatchObject({ status: 'running', error: null });
  }, 30_000);
});
