import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './index.js';
import { createMessagesRepo } from './messages.js';
import { turns, type Message, type Turn } from './schema.js';

export interface QueueTurnInput {
  turnId: string;
  messageId: string;
  projectId: string;
  content: Message['content'];
}

/** A turn the runner has started: `running`, with its start time set. */
export type RunningTurn = Turn & { status: 'running'; startedAt: number };

export type QueueTurnResult = { message: Message; turn: Turn } | { active: Turn };

/** What a finished turn stores besides its status. */
export interface FinishedTurnDetails {
  usage?: Turn['usage'];
  replyId?: string;
}

/** A turn's final status. A failed turn always carries its error. */
export type FinishTurnInput =
  | (FinishedTurnDetails & { status: 'completed' | 'cancelled' })
  | (FinishedTurnDetails & { status: 'failed'; error: NonNullable<Turn['error']> });

export interface TurnsRepo {
  /** The project's `queued` or `running` turn, if it has one. */
  findActive(projectId: string): Turn | undefined;
  /**
   * Stores the instructor's message and a `queued` turn in one transaction.
   * When the project already has a `queued` or `running` turn, returns it as
   * `active` and stores nothing.
   */
  queue(input: QueueTurnInput): QueueTurnResult;
  /** Marks a `queued` turn `running` with its start time. Undefined when the turn is missing or not `queued`. */
  start(id: string): RunningTurn | undefined;
  /** Stores a turn's final status, finish time, error, usage, and reply, returning the updated row. */
  finish(id: string, input: FinishTurnInput): Turn;
  /** Fails every `queued` or `running` turn with `error`, returning the failed turns. */
  failActive(error: NonNullable<Turn['error']>): Turn[];
}

function findActive(db: Db, projectId: string): Turn | undefined {
  return db
    .select()
    .from(turns)
    .where(and(eq(turns.projectId, projectId), inArray(turns.status, ['queued', 'running'])))
    .get();
}

export function createTurnsRepo(db: Db): TurnsRepo {
  return {
    findActive(projectId) {
      return findActive(db, projectId);
    },
    queue({ turnId, messageId, projectId, content }) {
      return db.transaction(
        (tx) => {
          const active = findActive(tx, projectId);
          if (active) return { active };
          const message = createMessagesRepo(tx).create({ id: messageId, projectId, role: 'instructor', content, turnId });
          const turn = tx.insert(turns).values({ id: turnId, projectId, messageId, status: 'queued' }).returning().get();
          return { message, turn };
        },
        { behavior: 'immediate' },
      );
    },
    start(id) {
      return db
        .update(turns)
        .set({ status: 'running', startedAt: Date.now() })
        .where(and(eq(turns.id, id), eq(turns.status, 'queued')))
        .returning()
        .get() as RunningTurn | undefined;
    },
    finish(id, input) {
      const { status, usage, replyId } = input;
      const error = input.status === 'failed' ? input.error : null;
      return db
        .update(turns)
        .set({ status, error, usage: usage ?? null, replyId: replyId ?? null, finishedAt: Date.now() })
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
