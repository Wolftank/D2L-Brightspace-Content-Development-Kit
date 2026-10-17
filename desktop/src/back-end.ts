import { execFile, spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

/** How long the back end may take to answer `/api/health` after it is spawned. */
export const STARTUP_TIMEOUT_MS = 30_000;

/** The most of the back end's error output kept for a startup failure message. */
const ERROR_OUTPUT_CHARS = 4_000;

/** A running back end, serving the app at `url`. */
export interface BackEnd {
  /** The app origin's root, `http://127.0.0.1:<port>/`. */
  url: string;
  /** Settles when the back end's process exits, for any reason. */
  exited: Promise<void>;
  /** Ends the back end's whole process tree: the back end, the agent, and every command either started. */
  stop(): Promise<void>;
}

/** The back end could not start. The message says why, with the end of its error output. */
export class BackEndStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackEndStartError';
  }
}

/** The app origin for a back end on `port`. */
export function appOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * The back end's environment: the app's own, plus the settings that make the
 * app's executable run it as Node and serve the built front end in `appDir`
 * on `port`.
 */
export function backEndEnv(env: NodeJS.ProcessEnv, port: number, appDir: string): NodeJS.ProcessEnv {
  return { ...env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), APP_ORIGIN: appOrigin(port), APP_DIR: appDir };
}

/** A port on 127.0.0.1 that is free now, chosen by the OS. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Ends process `pid` and every process it started, by process tree. */
function killTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    process.kill(-pid, 'SIGKILL');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

/**
 * Starts the back end at `server` with this process's executable as its Node
 * runtime, and resolves once it answers `/api/health`.
 *
 * Raises:
 *   BackEndStartError: when the back end exits or stays unhealthy for
 *   `STARTUP_TIMEOUT_MS`. The back end is stopped first.
 */
export async function startBackEnd(server: string, appDir: string, timeoutMs = STARTUP_TIMEOUT_MS): Promise<BackEnd> {
  const port = await freePort();
  const child = spawn(process.execPath, [server], {
    env: backEndEnv(process.env, port, appDir),
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });

  let errorOutput = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    errorOutput = (errorOutput + chunk).slice(-ERROR_OUTPUT_CHARS);
  });

  let running = true;
  const exited = new Promise<void>((resolve) => {
    const settle = () => {
      running = false;
      resolve();
    };
    child.once('close', settle);
    child.once('error', settle);
  });

  const backEnd: BackEnd = {
    url: `${appOrigin(port)}/`,
    exited,
    async stop() {
      if (!running || child.pid === undefined) return;
      await killTree(child.pid);
      await exited;
    },
  };

  const deadline = Date.now() + timeoutMs;
  while (running && Date.now() < deadline) {
    if (await isHealthy(port)) return backEnd;
    await sleep(100);
  }
  const message = running
    ? `The back end did not start within ${timeoutMs / 1000} seconds.`
    : `The back end stopped while starting.\n\n${errorOutput.trim()}`;
  await backEnd.stop();
  throw new BackEndStartError(message);
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`${appOrigin(port)}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
