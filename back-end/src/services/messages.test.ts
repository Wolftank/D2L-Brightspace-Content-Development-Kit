import { describe, expect, it, vi } from 'vitest';
import type { MessageWithTurn } from '../db/messages.js';
import type { Message, Project, Turn } from '../db/schema.js';
import { NotFound } from '../errors.js';
import { createMessageService, type MessageServiceDeps } from './messages.js';

const PROJECT: Project = {
  id: 'project-1',
  ownerId: 'owner-1',
  title: 'Cell division practice',
  avenue: 'scorm',
  sessionId: null,
  createdAt: 1,
  updatedAt: 1,
};

function message(seq: number, overrides: Partial<Message> = {}): Message {
  return { id: `message-${seq}`, projectId: PROJECT.id, seq, role: 'agent', content: [], turnId: null, createdAt: seq, ...overrides };
}

function setup(rows: MessageWithTurn[] = []) {
  const deps = {
    projects: {
      get: vi.fn((ownerId: string, id: string) => (ownerId === PROJECT.ownerId && id === PROJECT.id ? PROJECT : undefined)),
    },
    messages: {
      listByProject: vi.fn((_projectId: string, { after, limit }: { after: number; limit: number }) =>
        rows.filter(({ message }) => message.seq > after).slice(0, limit),
      ),
    },
  } satisfies MessageServiceDeps;
  return { deps, service: createMessageService(deps) };
}

describe('message service', () => {
  describe('list', () => {
    it.each([
      ['an unknown project', 'owner-1', 'no-such-project'],
      ["another owner's project", 'someone-else', 'project-1'],
    ])('throws NotFound for %s and reads no messages', (_case, ownerId, projectId) => {
      const { deps, service } = setup([{ message: message(1), turn: null }]);

      expect(() => service.list(ownerId, projectId, { limit: 100 })).toThrow(NotFound);
      expect(deps.messages.listByProject).not.toHaveBeenCalled();
    });

    it('adds a turn summary to instructor messages only', () => {
      const turn = { id: 'turn-1', status: 'failed', error: { code: 'agent_error', message: 'The agent stopped.' } } as Turn;
      const { service } = setup([
        { message: message(1, { role: 'instructor' }), turn },
        { message: message(2), turn: null },
      ]);

      const { items } = service.list('owner-1', 'project-1', { limit: 100 });

      expect(items[0]!.turn).toEqual({ id: 'turn-1', status: 'failed', error: { code: 'agent_error', message: 'The agent stopped.' } });
      expect(items[1]).not.toHaveProperty('turn');
    });

    it('returns nextCursor only when more messages follow', () => {
      const { service } = setup([1, 2, 3].map((seq) => ({ message: message(seq), turn: null })));

      const first = service.list('owner-1', 'project-1', { limit: 2 });
      const second = service.list('owner-1', 'project-1', { cursor: Number(first.nextCursor), limit: 2 });

      expect(first).toEqual({ items: [message(1), message(2)], nextCursor: '2' });
      expect(second).toEqual({ items: [message(3)] });
    });
  });
});
