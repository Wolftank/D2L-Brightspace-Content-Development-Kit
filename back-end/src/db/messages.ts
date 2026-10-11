import { and, asc, eq, gt, max } from 'drizzle-orm';
import type { Db } from './index.js';
import { messages, turns, type Message, type Turn } from './schema.js';

export interface CreateMessageInput {
  id: string;
  projectId: string;
  role: Message['role'];
  content: Message['content'];
  turnId: string | null;
}

export interface ListMessagesInput {
  /** Only messages with a `seq` above this are listed. */
  after: number;
  limit: number;
}

/** A message with the turn it started: set for instructor messages, null for agent messages. */
export interface MessageWithTurn {
  message: Message;
  turn: Turn | null;
}

export interface MessagesRepo {
  get(id: string): Message | undefined;
  /** Inserts a message with the project's next `seq`, starting at 1. */
  create(input: CreateMessageInput): Message;
  /** Up to `limit` of the project's messages after `after`, in `seq` order, each with the turn it started. */
  listByProject(projectId: string, input: ListMessagesInput): MessageWithTurn[];
}

export function createMessagesRepo(db: Db): MessagesRepo {
  return {
    get(id) {
      return db.select().from(messages).where(eq(messages.id, id)).get();
    },
    create({ id, projectId, role, content, turnId }) {
      // No await between reading the highest seq and inserting, so concurrent
      // calls never pick the same seq.
      const row = db
        .select({ latest: max(messages.seq) })
        .from(messages)
        .where(eq(messages.projectId, projectId))
        .get();
      const message: Message = {
        id,
        projectId,
        seq: (row?.latest ?? 0) + 1,
        role,
        content,
        turnId,
        createdAt: Date.now(),
      };
      db.insert(messages).values(message).run();
      return message;
    },
    listByProject(projectId, { after, limit }) {
      return db
        .select({ message: messages, turn: turns })
        .from(messages)
        .leftJoin(turns, eq(turns.messageId, messages.id))
        .where(and(eq(messages.projectId, projectId), gt(messages.seq, after)))
        .orderBy(asc(messages.seq))
        .limit(limit)
        .all();
    },
  };
}
