import type { MessagesRepo } from '../db/messages.js';
import type { ProjectsRepo } from '../db/projects.js';
import type { Message, Turn } from '../db/schema.js';
import { NotFound } from '../errors.js';

export type TurnSummary = Pick<Turn, 'id' | 'status' | 'error'>;

/** A message as the chat lists it: instructor messages carry a summary of the turn they started. */
export type ChatMessage = Message & { turn?: TurnSummary };

export interface MessagePage {
  /** Oldest first. */
  items: ChatMessage[];
  /** Present only when more messages follow; pass it back as `cursor` to read them. */
  nextCursor?: string;
}

export interface ListMessagesQuery {
  /** The `seq` of the last message already read, or undefined to start from the first. */
  cursor?: number;
  limit: number;
}

export interface MessageServiceDeps {
  projects: Pick<ProjectsRepo, 'get'>;
  messages: Pick<MessagesRepo, 'listByProject'>;
}

export interface MessageService {
  /** A page of `ownerId`'s project's messages. Throws `NotFound` for an unknown or another owner's project. */
  list(ownerId: string, projectId: string, query: ListMessagesQuery): MessagePage;
}

export function createMessageService(deps: MessageServiceDeps): MessageService {
  return {
    list(ownerId, projectId, { cursor, limit }) {
      if (!deps.projects.get(ownerId, projectId)) throw new NotFound();
      const rows = deps.messages.listByProject(projectId, { after: cursor ?? 0, limit: limit + 1 });
      const items = rows
        .slice(0, limit)
        .map(({ message, turn }): ChatMessage =>
          turn ? { ...message, turn: { id: turn.id, status: turn.status, error: turn.error } } : message,
        );
      return rows.length > limit ? { items, nextCursor: String(items.at(-1)!.seq) } : { items };
    },
  };
}
