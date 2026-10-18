declare module 'pino-roll' {
  import type { EventEmitter } from 'node:events';
  import type { DestinationStream } from 'pino';

  /** Opens a rotating log file. */
  function pinoRoll(options: pinoRoll.PinoRollOptions): Promise<pinoRoll.LogFile>;

  namespace pinoRoll {
    /** The options this back end passes to pino-roll. */
    interface PinoRollOptions {
      file: string;
      extension?: string;
      frequency?: 'daily' | 'hourly' | number;
      dateFormat?: string;
      size?: string | number;
      limit?: { count?: number; removeOtherLogFiles?: boolean };
      mkdir?: boolean;
      sync?: boolean;
    }

    /** The open log file. It emits `cleanup-complete` after each rotation removes old files. */
    type LogFile = DestinationStream & EventEmitter & { end(): void };
  }

  export = pinoRoll;
}
