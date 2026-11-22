import { join } from 'node:path';
import { type Logger, pino } from 'pino';
import roll from 'pino-roll';

/**
 * Opens the desktop app's log in `logsDir`, beside the back end's: one JSON
 * record per line in `desktop.<n>.log`, rotated at 1 MB with one older file
 * kept. Writes are synchronous, so a record is on disk before the app exits.
 */
export async function openLog(logsDir: string): Promise<Logger> {
  const file = await roll({
    file: join(logsDir, 'desktop'),
    extension: '.log',
    size: '1m',
    limit: { count: 1, removeOtherLogFiles: true },
    mkdir: true,
    sync: true,
  });
  return pino({ base: { pid: process.pid }, timestamp: pino.stdTimeFunctions.isoTime }, file);
}
