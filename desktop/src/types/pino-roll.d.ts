declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';

  /** Opens a rotating log file. */
  function pinoRoll(options: pinoRoll.PinoRollOptions): Promise<pinoRoll.LogFile>;

  namespace pinoRoll {
    /** The options the desktop app passes to pino-roll. */
    interface PinoRollOptions {
      file: string;
      extension?: string;
      size?: string | number;
      limit?: { count?: number; removeOtherLogFiles?: boolean };
      mkdir?: boolean;
      sync?: boolean;
    }

    /** The open log file. */
    type LogFile = DestinationStream & { end(): void };
  }

  export = pinoRoll;
}
