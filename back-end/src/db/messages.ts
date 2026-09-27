import { eq, max } from 'drizzle-orm';
import type { Db } from './index.js';
import { messages, type Message } from './schema.js';

export interface CreateMessageInput {
  id: string;
  projectId: string;
  role: Message['role'];
  content: Message['content'];
  turnId: string | null;
}

export interface MessagesRepo {
  get(id: string): Message | undefined;
  /** Inserts a message with the project's next `seq`, starting at 1. */
  create(input: CreateMessageInput): Message;
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
  };
}
