import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLog } from './log.js';

let logsDir: string;

beforeEach(async () => {
  logsDir = join(await mkdtemp(join(tmpdir(), 'cdk-desktop-log-')), 'logs');
});

afterEach(async () => {
  await rm(join(logsDir, '..'), { recursive: true, force: true, maxRetries: 10 });
});

describe('openLog', () => {
  it('creates the logs folder and writes JSON records to desktop.1.log', async () => {
    const log = await openLog(logsDir);
    log.info('Checking for update');

    expect(await readdir(logsDir)).toEqual(['desktop.1.log']);
    const [record] = (await readFile(join(logsDir, 'desktop.1.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(record).toMatchObject({ level: 30, pid: process.pid, msg: 'Checking for update' });
    expect(typeof record.time).toBe('string');
  });

  it('appends to the same file when opened again', async () => {
    (await openLog(logsDir)).info('first launch');
    (await openLog(logsDir)).info('second launch');

    const lines = (await readFile(join(logsDir, 'desktop.1.log'), 'utf8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).msg)).toEqual(['first launch', 'second launch']);
  });
});
