import { randomUUID } from 'node:crypto';
import type { MessagesRepo } from '../db/messages.js';
import type { ProjectsRepo } from '../db/projects.js';
import type { Message, Turn } from '../db/schema.js';
import type { TurnsRepo } from '../db/turns.js';
import { NotFound, TurnActive } from '../errors.js';
import type { Runner } from '../pipeline/runner.js';
import type { ContentBlock } from '../types/content.js';

export interface TurnServiceDeps {
  projects: Pick<ProjectsRepo, 'get'>;
  messages: Pick<MessagesRepo, 'create'>;
  turns: Pick<TurnsRepo, 'create' | 'findActive'>;
  runner: Pick<Runner, 'executeTurn'>;
}

export interface StartedTurn {
  message: Message;
  turn: Turn;
}

export interface TurnService {
  /**
   * Stores the instructor's message with a `queued` turn and hands the turn
   * to the runner exactly once, without awaiting the agent's work.
   *
   * @throws NotFound when the project does not exist or is not `ownerId`'s.
   * @throws TurnActive when the project already has a queued or running turn.
   */
  start(ownerId: string, projectId: string, content: ContentBlock[]): StartedTurn;
}

export function createTurnService(deps: TurnServiceDeps): TurnService {
  return {
    start(ownerId, projectId, content) {
      if (!deps.projects.get(ownerId, projectId)) {
        throw new NotFound();
      }

      // No await between the busy check and the two inserts, so of two
      // requests arriving together only one is accepted and the rejected one
      // stores nothing.
      const active = deps.turns.findActive(projectId);
      if (active) {
        throw new TurnActive(active.id);
      }

      const turnId = randomUUID();
      const message = deps.messages.create({
        id: randomUUID(),
        projectId,
        role: 'instructor',
        content,
        turnId,
      });
      const turn = deps.turns.create({ id: turnId, projectId, messageId: message.id });

      // executeTurn stores its own failures and reports them on the event
      // stream; the catch keeps an unexpected rejection out of the process
      // after the 202 is sent.
      deps.runner.executeTurn(turn.id).catch((err: unknown) => {
        console.error(`Failed to run turn ${turn.id}:`, err);
      });

      return { message, turn };
    },
  };
}
