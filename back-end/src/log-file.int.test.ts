import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLogDestination, log } from './log.js';
import { LOG_RETENTION_DAYS, openLogFile, removeExpiredLogs } from './log-file.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('log files', () => {
  let dataDir: string;
  let logsDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-log-'));
    logsDir = join(dataDir, 'logs');
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10 });
  });

  async function writeDated(name: string, ageDays: number): Promise<void> {
    const path = join(logsDir, name);
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path, '{}\n');
    const date = new Date(Date.now() - ageDays * DAY_MS);
    await fs.utimes(path, date, date);
  }

  it("writes one JSON record per line, at the destination's level or more severe, to today's file in a new logs folder", async () => {
    const file = await openLogFile(logsDir);
    addLogDestination(file, 'info');

    log.debug('debug detail');
    log.info({ projectId: 'project-1' }, 'first');
    log.error('second');
    file.end();

    const files = await fs.readdir(logsDir);
    expect(files).toEqual([expect.stringMatching(/^cdk\.\d{4}-\d{2}-\d{2}\.1\.log$/)]);
    const records = (await fs.readFile(join(logsDir, files[0]!), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(records).toEqual([
      expect.objectContaining({ level: 30, projectId: 'project-1', msg: 'first' }),
      expect.objectContaining({ level: 50, msg: 'second' }),
    ]);
  });

  it('rotates each file at its size cap and keeps only the newest files', async () => {
    const file = await openLogFile(logsDir, { size: '1k', keptFiles: 2 });

    for (let i = 0; i < 40; i++) {
      file.write(`${JSON.stringify({ i, padding: 'x'.repeat(200) })}\n`);
      await sleep(5);
    }
    await sleep(200);
    file.end();

    const files = await fs.readdir(logsDir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.length).toBeLessThanOrEqual(3);
    for (const name of files) {
      expect((await fs.stat(join(logsDir, name))).size).toBeLessThan(2 * 1024);
    }
  });

  it(`deletes log files last written more than ${LOG_RETENTION_DAYS} days ago and keeps everything else`, async () => {
    await writeDated('cdk.2026-01-01.1.log', LOG_RETENTION_DAYS + 1);
    await writeDated('cdk.2026-01-01.2.log', LOG_RETENTION_DAYS + 1);
    await writeDated('cdk.2026-01-10.1.log', LOG_RETENTION_DAYS - 1);
    await writeDated('notes.txt', LOG_RETENTION_DAYS + 30);

    await removeExpiredLogs(logsDir, Date.now());

    expect((await fs.readdir(logsDir)).sort()).toEqual(['cdk.2026-01-10.1.log', 'notes.txt']);
  });

  it('deletes expired log files when it opens the log', async () => {
    await writeDated('cdk.2026-01-01.1.log', LOG_RETENTION_DAYS + 1);

    (await openLogFile(logsDir)).end();

    expect(await fs.readdir(logsDir)).not.toContain('cdk.2026-01-01.1.log');
  });
});
