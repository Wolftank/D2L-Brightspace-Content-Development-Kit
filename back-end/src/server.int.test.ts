import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateProjectResponse, SendMessageResponse } from '@cdk/contract';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuildsRepo } from './db/builds.js';
import { type Db, openDb } from './db/index.js';
import { createProjectsRepo } from './db/projects.js';
import { builds as buildsTable, events as eventsTable, turns as turnsTable, type Build, type Turn } from './db/schema.js';
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

  function storedTurn(id = 'turn-1'): Turn {
    return withDb((db) => db.select().from(turnsTable).all().find((turn) => turn.id === id)!);
  }

  function storedEventKinds(turnId: string): string[] {
    return withDb((db) => db.select().from(eventsTable).all().filter((event) => event.turnId === turnId).map((event) => event.kind));
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

  /** Runs `src/server.ts` with `settings` until it exits or logs that it is listening. With `channel`, it has an IPC channel, as under the desktop app. */
  function runServer(
    port: number,
    settings: Record<string, string> = {},
    { channel = false } = {},
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: BACK_END,
        env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...settings },
        stdio: channel ? ['ignore', 'pipe', 'pipe', 'ipc'] : 'pipe',
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

  it.each([
    ['sends the shutdown message, as the app does when it quits', 'app quit', (server: ChildProcess) => server.send('shutdown')],
    ['closes its channel, as when the app crashes', 'app gone', (server: ChildProcess) => server.disconnect()],
  ])('cancels the running turn and exits when the app %s, so the next start leaves the turn cancelled, not interrupted', async (_case, trigger, stop) => {
    const port = await listenOnFreePort();
    await closeBlocker();
    await runServer(port, { AGENT_DRIVER: 'scripted' }, { channel: true });
    const post = async <T>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as T;
    };
    const { project } = await post<CreateProjectResponse>('/projects', { title: 'Cell division practice' });
    const { turn } = await post<SendMessageResponse>(`/projects/${project.id}/messages`, { content: [{ type: 'text', text: '[long-step] Create a practice set' }] });
    // The scripted agent's second status line starts its long step.
    await vi.waitFor(() => expect(storedEventKinds(turn.id).filter((kind) => kind === 'turn.status')).toHaveLength(2), { timeout: 10_000, interval: 50 });

    const exited = new Promise((resolve) => child!.once('exit', resolve));
    stop(child!);

    expect(await exited).toBe(0);
    expect(storedTurn(turn.id)).toMatchObject({ status: 'cancelled', error: null });
    expect(storedEventKinds(turn.id).at(-1)).toBe('turn.cancelled');
    const records = await logRecords();
    expect(records).toContainEqual(expect.objectContaining({ msg: 'back-end stopping', trigger }));
    expect(records).toContainEqual(expect.objectContaining({ msg: 'Turn cancelled', turnId: turn.id }));
    expect(records.at(-1)).toMatchObject({ msg: 'back-end stopped' });

    await runServer(port, { AGENT_DRIVER: 'scripted' });

    expect(storedTurn(turn.id)).toMatchObject({ status: 'cancelled', error: null });
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
