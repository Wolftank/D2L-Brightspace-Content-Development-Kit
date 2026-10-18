import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { type BackEnd, startBackEnd } from '../src/back-end.js';

/** The runnable app that `npm run package` writes next to the installer. */
const APP = fileURLToPath(new URL('../release/win-unpacked/', import.meta.url));
const EXE = join(APP, 'CDK.exe');
const SERVER = join(APP, 'resources', 'app', 'node_modules', 'cdk-back-end', 'dist', 'server.js');
const FRONT_END = join(APP, 'resources', 'front-end');

let dataDir: string;

test.beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'cdk-package-'));
  process.env.DATA_DIR = dataDir;
});

test.afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
});

/** The status of a GET to `path` on the back end at `port`, sent with the preview origin's Host. */
function previewStatus(port: string, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: `preview.localhost:${port}` } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    })
      .on('error', reject)
      .end();
  });
}

/** The ids of running processes whose executable is inside `dir`. */
async function processesIn(dir: string): Promise<string[]> {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir.replaceAll("'", "''")}', 'OrdinalIgnoreCase') } | ForEach-Object ProcessId`;
  const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return stdout.split(/\s+/).filter(Boolean);
}

test("the packaged back end runs on the app's runtime and serves the app, projects and previews", async () => {
  let backEnd: BackEnd | undefined;
  try {
    backEnd = await startBackEnd(EXE, SERVER, FRONT_END);
    const origin = new URL(backEnd.url).origin;
    const { port } = new URL(origin);

    const app = await fetch(backEnd.url);
    expect(app.status).toBe(200);
    expect(await app.text()).toContain('<title>D2L Content Development Kit</title>');

    const project = await fetch(new URL('/api/projects', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Package check' }),
    });
    expect(project.status, await project.clone().text()).toBe(201);

    expect(await previewStatus(port, `/preview/player.html?buildId=b&attempt=1&parentOrigin=${encodeURIComponent(origin)}`)).toBe(200);
    expect(await previewStatus(port, '/preview/d2l-emulator.js')).toBe(200);
  } finally {
    await backEnd?.stop();
  }
});

test('the app opens the CDK window and leaves no processes when closed', async () => {
  const app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${join(dataDir, 'window')}`] });
  const window = await app.firstWindow();
  await expect(window.getByRole('heading', { name: 'Create an activity' })).toBeVisible();

  await app.close();

  for (let i = 0; i < 50 && (await processesIn(APP)).length > 0; i++) await sleep(100);
  expect(await processesIn(APP)).toEqual([]);
});
