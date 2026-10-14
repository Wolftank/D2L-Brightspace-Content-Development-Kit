import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BackEnd, BackEndStartError, startBackEnd } from './back-end.js';

/** A stand-in back end: answers /api/health on PORT and starts a long-running child, like the agent. */
const FAKE_SERVER = `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(new URL('pids.json', import.meta.url), JSON.stringify({ backEnd: process.pid, agent: agent.pid, env: {
  PORT: process.env.PORT, APP_ORIGIN: process.env.APP_ORIGIN, APP_DIR: process.env.APP_DIR,
} }));
createServer((req, res) => res.writeHead(req.url === '/api/health' ? 200 : 404).end()).listen(Number(process.env.PORT), '127.0.0.1');
`;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilStopped(pid: number): Promise<boolean> {
  for (let i = 0; i < 50 && isRunning(pid); i++) await sleep(100);
  return !isRunning(pid);
}

describe('startBackEnd', () => {
  let dir: string;
  let backEnd: BackEnd | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cdk-desktop-'));
  });

  afterEach(async () => {
    await backEnd?.stop();
    backEnd = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function script(source: string): Promise<string> {
    const path = join(dir, 'server.mjs');
    await writeFile(path, source);
    return path;
  }

  it('starts the back end on a free port as the app origin, serving the built front end', async () => {
    backEnd = await startBackEnd(await script(FAKE_SERVER), join(dir, 'front-end'));
    const { env } = JSON.parse(await readFile(join(dir, 'pids.json'), 'utf8'));
    const origin = new URL(backEnd.url).origin;

    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(env).toEqual({ PORT: new URL(origin).port, APP_ORIGIN: origin, APP_DIR: join(dir, 'front-end') });
    expect((await fetch(new URL('/api/health', origin))).status).toBe(200);
  });

  it("stops the back end's whole process tree, including the processes it started", async () => {
    backEnd = await startBackEnd(await script(FAKE_SERVER), dir);
    const pids = JSON.parse(await readFile(join(dir, 'pids.json'), 'utf8'));
    expect(isRunning(pids.agent)).toBe(true);

    await backEnd.stop();

    expect(await waitUntilStopped(pids.backEnd)).toBe(true);
    expect(await waitUntilStopped(pids.agent)).toBe(true);
  });

  it('settles exited when the back end stops on its own', async () => {
    backEnd = await startBackEnd(await script(`${FAKE_SERVER}\nsetTimeout(() => process.exit(0), 300);`), dir);

    await expect(backEnd.exited).resolves.toBeUndefined();
  });

  it('reports the error output of a back end that stops while starting', async () => {
    const start = startBackEnd(await script("process.stderr.write('Invalid back-end settings: PORT: must be a whole number'); process.exitCode = 1;"), dir);

    await expect(start).rejects.toThrow(BackEndStartError);
    await expect(start).rejects.toThrow(/stopped while starting[\s\S]*PORT: must be a whole number/);
  });

  it('stops a back end that does not become healthy in time', async () => {
    const path = await script(`
      import { writeFileSync } from 'node:fs';
      writeFileSync(new URL('pids.json', import.meta.url), JSON.stringify({ backEnd: process.pid }));
      setInterval(() => {}, 1000);
    `);

    await expect(startBackEnd(path, dir, 2_000)).rejects.toThrow('did not start within 2 seconds');
    const { backEnd: pid } = JSON.parse(await readFile(join(dir, 'pids.json'), 'utf8'));
    expect(await waitUntilStopped(pid)).toBe(true);
  });
});
