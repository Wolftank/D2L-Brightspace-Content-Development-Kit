import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './index.js';
import { turns, type Turn } from './schema.js';

export interface FinishTurnInput {
  status: 'completed' | 'failed' | 'cancelled';
  error?: Turn['error'];
  usage?: Turn['usage'];
  replyId?: string;
}

export interface TurnsRepo {
  /** The project's `queued` or `running` turn, if it has one. */
  findActive(projectId: string): Turn | undefined;
  /** Marks a `queued` turn `running` with its start time. Undefined when the turn is missing or not `queued`. */
  start(id: string): Turn | undefined;
  /** Stores a turn's final status, finish time, error, usage, and reply, returning the updated row. */
  finish(id: string, input: FinishTurnInput): Turn;
  /** Fails every `queued` or `running` turn with `error`, returning the failed turns. */
  failActive(error: NonNullable<Turn['error']>): Turn[];
}

export function createTurnsRepo(db: Db): TurnsRepo {
  return {
    findActive(projectId) {
      return db
        .select()
        .from(turns)
        .where(and(eq(turns.projectId, projectId), inArray(turns.status, ['queued', 'running'])))
        .get();
    },
    start(id) {
      return db
        .update(turns)
        .set({ status: 'running', startedAt: Date.now() })
        .where(and(eq(turns.id, id), eq(turns.status, 'queued')))
        .returning()
        .get();
    },
    finish(id, { status, error, usage, replyId }) {
      return db
        .update(turns)
        .set({ status, error: error ?? null, usage: usage ?? null, replyId: replyId ?? null, finishedAt: Date.now() })
        .where(eq(turns.id, id))
        .returning()
        .get()!;
    },
    failActive(error) {
      return db
        .update(turns)
        .set({ status: 'failed', error, finishedAt: Date.now() })
        .where(inArray(turns.status, ['queued', 'running']))
        .returning()
        .all();
    },
  };
}
