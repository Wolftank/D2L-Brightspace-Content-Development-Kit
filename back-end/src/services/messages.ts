import type { ChatMessage, MessageHistoryResponse } from '@cdk/contract';
import type { MessagesRepo } from '../db/messages.js';
import type { ProjectsRepo } from '../db/projects.js';
import { NotFound } from '../errors.js';

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
  list(ownerId: string, projectId: string, query: ListMessagesQuery): MessageHistoryResponse;
}

export function createMessageService(deps: MessageServiceDeps): MessageService {
  return {
    list(ownerId, projectId, { cursor, limit }): MessageHistoryResponse {
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
