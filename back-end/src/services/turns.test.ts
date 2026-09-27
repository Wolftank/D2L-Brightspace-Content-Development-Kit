import { describe, expect, it, vi } from 'vitest';
import type { Message, Project, Turn } from '../db/schema.js';
import type { QueueTurnInput, QueueTurnResult } from '../db/turns.js';
import { NotFound, TurnActive } from '../errors.js';
import { createTurnService, type TurnServiceDeps } from './turns.js';

const CONTENT = [{ type: 'text' as const, text: 'Build a self-check on mitosis' }];

function setup(queueResult?: (input: QueueTurnInput) => QueueTurnResult) {
  const deps = {
    projects: {
      get: vi.fn((ownerId: string, id: string) => (ownerId === 'owner-1' && id === 'project-1' ? ({ id } as Project) : undefined)),
    },
    turns: {
      queue: vi.fn(
        queueResult ??
          ((input: QueueTurnInput): QueueTurnResult => ({
            message: { id: input.messageId, turnId: input.turnId, content: input.content } as Message,
            turn: { id: input.turnId, messageId: input.messageId, status: 'queued' } as Turn,
          })),
      ),
    },
    runner: { executeTurn: vi.fn(async () => {}) },
  } satisfies TurnServiceDeps;
  return { deps, service: createTurnService(deps) };
}

describe('turn service', () => {
  it('queues the message and turn under fresh ids, then hands the turn to the runner once', () => {
    const { deps, service } = setup();

    const started = service.start('owner-1', 'project-1', CONTENT);

    const input = deps.turns.queue.mock.calls[0]![0];
    expect(input).toMatchObject({ projectId: 'project-1', content: CONTENT });
    expect(input.turnId).not.toBe(input.messageId);
    expect(started).toEqual({
      message: { id: input.messageId, turnId: input.turnId, content: CONTENT },
      turn: { id: input.turnId, messageId: input.messageId, status: 'queued' },
    });
    expect(deps.runner.executeTurn).toHaveBeenCalledOnce();
    expect(deps.runner.executeTurn).toHaveBeenCalledWith(input.turnId);
  });

  it('throws TurnActive with the active turn and hands nothing to the runner', () => {
    const { deps, service } = setup(() => ({ active: { id: 'turn-running' } as Turn }));

    expect(() => service.start('owner-1', 'project-1', CONTENT)).toThrow(new TurnActive('turn-running'));
    expect(deps.runner.executeTurn).not.toHaveBeenCalled();
  });

  it.each([
    ['another owner', 'owner-2', 'project-1'],
    ['an unknown project', 'owner-1', 'missing'],
  ])('throws NotFound for %s without queueing anything', (_case, ownerId, projectId) => {
    const { deps, service } = setup();

    expect(() => service.start(ownerId, projectId, CONTENT)).toThrow(NotFound);
    expect(deps.turns.queue).not.toHaveBeenCalled();
    expect(deps.runner.executeTurn).not.toHaveBeenCalled();
  });
});
