import { addLogDestination, type LogLevel } from '../log.js';

/** One parsed log record. */
export type LogRecord = Record<string, unknown> & { level: number; msg: string };

/** Collects every log record at `level` or more severe written from now on. */
export function captureLog(level: LogLevel = 'trace'): LogRecord[] {
  const records: LogRecord[] = [];
  addLogDestination({ write: (line: string) => void records.push(JSON.parse(line) as LogRecord) }, level);
  return records;
}
