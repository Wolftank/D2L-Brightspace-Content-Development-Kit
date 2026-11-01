import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import { type BackEnd, launchCookie, startBackEnd } from '../src/back-end.js';

/** The runnable app that `npm run package` writes next to the installer. */
const APP = fileURLToPath(new URL('../release/win-unpacked/', import.meta.url));
const EXE = join(APP, 'CDK.exe');
const SERVER = join(APP, 'resources', 'app', 'node_modules', 'cdk-back-end', 'dist', 'server.js');
const FRONT_END = join(APP, 'resources', 'front-end');
/** The version the packaged app reports, from its own package.json. */
const APP_VERSION: string = JSON.parse(await readFile(join(APP, 'resources', 'app', 'package.json'), 'utf8')).version;

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

/** Every record in the log files in `logsDir`, oldest file first. */
async function logRecords(logsDir: string): Promise<Record<string, unknown>[]> {
  const files = (await readdir(logsDir)).filter((name) => name.endsWith('.log')).sort();
  const text = (await Promise.all(files.map((name) => readFile(join(logsDir, name), 'utf8')))).join('');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

/** The ids of running processes whose executable is inside `dir`. */
async function processesIn(dir: string): Promise<string[]> {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir.replaceAll("'", "''")}', 'OrdinalIgnoreCase') } | ForEach-Object ProcessId`;
  const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return stdout.split(/\s+/).filter(Boolean);
}

test("the packaged back end runs on the app's runtime, serves the app, projects and previews, and logs to the data folder", async () => {
  let backEnd: BackEnd | undefined;
  try {
    backEnd = await startBackEnd(EXE, SERVER, FRONT_END, APP_VERSION);
    const origin = new URL(backEnd.url).origin;
    const { port } = new URL(origin);

    const app = await fetch(backEnd.url);
    expect(app.status).toBe(200);
    expect(await app.text()).toContain('<title>D2L Content Development Kit</title>');

    const create = (headers: Record<string, string>) => fetch(new URL('/api/projects', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ title: 'Package check' }),
    });
    expect((await create({})).status).toBe(403);
    const project = await create({ cookie: launchCookie(backEnd.launchToken) });
    expect(project.status, await project.clone().text()).toBe(201);

    expect(await previewStatus(port, `/preview/player.html?buildId=b&attempt=1&parentOrigin=${encodeURIComponent(origin)}`)).toBe(200);
    expect(await previewStatus(port, '/preview/d2l-emulator.js')).toBe(200);

    const logsDir = await backEnd.logsDir;
    expect(logsDir).toBe(join(dataDir, 'logs'));
    const records = await logRecords(logsDir);
    expect(records[0]).toMatchObject({ msg: 'back-end starting', settings: { appVersion: APP_VERSION, dataDir } });
    expect(records).toContainEqual(
      expect.objectContaining({ reqId: project.headers.get('x-request-id'), method: 'POST', path: '/api/projects', status: 201 }),
    );
    expect(JSON.stringify(records)).not.toContain(backEnd.launchToken);
  } finally {
    await backEnd?.stop();
  }
});

test('the app opens the CDK window and leaves no processes when closed', async () => {
  const app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${join(dataDir, 'window')}`] });
  const window = await app.firstWindow();
  await expect(window.getByRole('heading', { name: 'My projects' })).toBeVisible();
  expect(await window.evaluate(() => fetch('/api/me').then((res) => res.status))).toBe(200);
  const menu = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.items.map((item) => ({ label: item.label, items: item.submenu?.items.map((entry) => entry.label) })),
  );
  expect(menu).toEqual([{ label: 'Help', items: ['Open logs folder'] }]);

  await app.close();

  for (let i = 0; i < 50 && (await processesIn(APP)).length > 0; i++) await sleep(100);
  expect(await processesIn(APP)).toEqual([]);
});

test('closing and reopening the packaged app restores a project that can continue', async () => {
  const options = {
    executablePath: EXE,
    args: [`--user-data-dir=${join(dataDir, 'f16-window')}`],
    env: { ...process.env, DATA_DIR: join(dataDir, 'f16-data'), AGENT_DRIVER: 'scripted' },
  };
  let app = await electron.launch(options);
  try {
    let window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'Create an activity' })).toBeVisible();
    await window.getByLabel('Project title').fill('Saved desktop project');
    await window.getByLabel('What should students learn or do?').fill('Create a workplace safety practice set.');
    await window.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(window.getByRole('heading', { name: 'Ready to download' })).toBeVisible({ timeout: 20_000 });
    await app.close();
    await expect.poll(() => processesIn(APP)).toEqual([]);
    app = await electron.launch(options);
    window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: 'My projects' })).toBeVisible();
    await window.getByRole('link', { name: 'Saved desktop project', exact: true }).click();
    await expect(window.getByLabel('Conversation history')).toContainText('Create a workplace safety practice set.');
    await expect(window.getByTitle('Interactive preview of build 1')).toBeVisible({ timeout: 20_000 });
    await window.getByLabel('Describe a change').fill('[follow-up] Add two more questions.');
    await window.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(window.getByText('Version 2', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(window.getByTitle('Interactive preview of build 2')).toBeVisible();
  } finally { await app.close(); }
});
