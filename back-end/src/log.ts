import { type DestinationStream, type Level, type Logger, pino } from 'pino';

/** The levels `LOG_LEVEL` accepts, most severe first. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const satisfies readonly Level[];

export type LogLevel = (typeof LOG_LEVELS)[number];

const destinations = pino.multistream([]);

/**
 * The back end's logger. It writes one JSON record per line to every
 * destination added by `addLogDestination`, and nothing before the first.
 */
export const log: Logger = pino(
  {
    level: 'silent',
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  destinations,
);

/** Writes every record at `level` or more severe to `stream`. */
export function addLogDestination(stream: DestinationStream, level: LogLevel): void {
  destinations.add({ stream, level });
  log.level = pino.levels.labels[destinations.minLevel]!;
}
