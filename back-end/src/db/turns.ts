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

export type QueueTurnResult = { message: Message; turn: Turn } | { active: Turn };

export interface FinishTurnInput {
  status: 'completed' | 'failed' | 'cancelled';
  error?: Turn['error'];
  usage?: Turn['usage'];
  replyId?: string;
}

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
  start(id: string): Turn | undefined;
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
