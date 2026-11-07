import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { SendMessageResponse } from '@cdk/contract';
import type { ProjectsRepo } from '../db/projects.js';
import type { Message } from '../db/schema.js';
import type { TurnsRepo } from '../db/turns.js';
import { NotFound, TurnActive, TurnNotFound } from '../errors.js';
import type { Runner } from '../pipeline/runner.js';

export interface TurnServiceDeps {
  projects: Pick<ProjectsRepo, 'get'>;
  turns: Pick<TurnsRepo, 'get' | 'queue'>;
  runner: Pick<Runner, 'executeTurn' | 'cancel'>;
}

export interface TurnService {
  /**
   * Stores `content` as the instructor's message on `ownerId`'s project with a
   * new `queued` turn, then hands the turn to the runner without waiting for
   * it. Throws `NotFound` for an unknown or another owner's project, and
   * `TurnActive` while the project has a `queued` or `running` turn.
   * `logger` records the queued turn, linking it to the request that sent
   * the message.
   */
  start(ownerId: string, projectId: string, content: Message['content'], logger: Logger): SendMessageResponse;

  /** Has the runner cancel `ownerId`'s turn. Throws `TurnNotFound` for an unknown or another owner's turn. */
  cancel(ownerId: string, turnId: string, logger: Logger): void;
}

export function createTurnService(deps: TurnServiceDeps): TurnService {
  return {
    start(ownerId, projectId, content, logger) {
      if (!deps.projects.get(ownerId, projectId)) throw new NotFound();
      const result = deps.turns.queue({ turnId: randomUUID(), messageId: randomUUID(), projectId, content });
      if ('active' in result) throw new TurnActive(result.active.id);
      logger.info({ projectId, turnId: result.turn.id }, 'Turn queued');
      void deps.runner.executeTurn(result.turn.id);
      return result;
    },

    cancel(ownerId, turnId, logger) {
      const turn = deps.turns.get(turnId);
      if (!turn || !deps.projects.get(ownerId, turn.projectId)) throw new TurnNotFound();
      logger.info({ projectId: turn.projectId, turnId, status: turn.status }, 'Turn cancel requested');
      deps.runner.cancel(turnId);
    },
  };
}
