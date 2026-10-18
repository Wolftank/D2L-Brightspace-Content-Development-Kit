import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import pretty from 'pino-pretty';
import roll, { type LogFile } from 'pino-roll';
import { addLogDestination, log, type LogLevel } from './log.js';

/** Log files older than this many days are deleted. */
export const LOG_RETENTION_DAYS = 14;

/** When a log file is rotated, and how many rotated files are kept alongside the current one. */
export interface LogFileLimits {
  /** The size at which a file is rotated, in pino-roll's units, such as `10m`. */
  size: string;
  keptFiles: number;
}

/** At most 14 files of 10 MB each. */
export const LOG_FILE_LIMITS: LogFileLimits = { size: '10m', keptFiles: 13 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The names pino-roll gives the log files: `cdk.<yyyy-MM-dd>.<n>.log`. */
const LOG_FILE_NAME = /^cdk\.\d{4}-\d{2}-\d{2}\.\d+\.log$/;

/** Deletes the log files in `logsDir` last written more than `LOG_RETENTION_DAYS` before `now`. */
export async function removeExpiredLogs(logsDir: string, now: number): Promise<void> {
  const cutoff = now - LOG_RETENTION_DAYS * DAY_MS;
  for (const name of await readdir(logsDir)) {
    if (!LOG_FILE_NAME.test(name)) continue;
    const path = join(logsDir, name);
    if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
  }
}

/**
 * Opens today's log file in `logsDir`, creating the folder if needed. The
 * file is rotated daily and at `limits.size`; each rotation keeps
 * `limits.keptFiles` older files and deletes expired ones. Writes are
 * synchronous, so a record is on disk before the process can be killed.
 */
export async function openLogFile(logsDir: string, limits: LogFileLimits = LOG_FILE_LIMITS): Promise<LogFile> {
  const file = await roll({
    file: join(logsDir, 'cdk'),
    extension: '.log',
    frequency: 'daily',
    dateFormat: 'yyyy-MM-dd',
    size: limits.size,
    limit: { count: limits.keptFiles, removeOtherLogFiles: true },
    mkdir: true,
    sync: true,
  });
  file.on('cleanup-complete', () => {
    removeExpiredLogs(logsDir, Date.now()).catch((err: unknown) => log.error({ err }, 'Failed to delete expired log files'));
  });
  await removeExpiredLogs(logsDir, Date.now());
  return file;
}

/** Sends the log at `level` to a rotating file in `logsDir`, and to standard output in a readable form. */
export async function startLogging(logsDir: string, level: LogLevel): Promise<void> {
  addLogDestination(await openLogFile(logsDir), level);
  addLogDestination(pretty({ destination: 1, sync: true }), level);
}
