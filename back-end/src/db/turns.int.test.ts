import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './index.js';
import { createProjectsRepo } from './projects.js';
import { messages as messagesTable, turns as turnsTable, type Turn } from './schema.js';
import { testDb } from './test-db.js';
import { createTurnsRepo, type TurnsRepo } from './turns.js';
import { createUsersRepo } from './users.js';

describe('turns repo', () => {
  let db: Db;
  let turns: TurnsRepo;
  let projectId: string;

  function insertTurn(id: string, status: Turn['status']): void {
    db.insert(turnsTable).values({ id, projectId, messageId: `message-${id}`, status }).run();
  }

  beforeEach(() => {
    db = testDb();
    turns = createTurnsRepo(db);
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    projectId = createProjectsRepo(db).create({ id: 'project-1', ownerId, title: 'Cell division practice' }).id;
  });

  it("finds the project's queued or running turn", () => {
    insertTurn('finished', 'completed');
    expect(turns.findActive(projectId)).toBeUndefined();

    insertTurn('active', 'running');
    expect(turns.findActive(projectId)?.id).toBe('active');
    expect(turns.findActive('other-project')).toBeUndefined();
  });

  describe('queue', () => {
    const content = [{ type: 'text' as const, text: 'Build a self-check on mitosis' }];

    it('stores the instructor message and a queued turn, and returns both', () => {
      const result = turns.queue({ turnId: 'turn-1', messageId: 'message-1', projectId, content });

      expect(result).toMatchObject({
        message: { id: 'message-1', projectId, seq: 1, role: 'instructor', content, turnId: 'turn-1' },
        turn: { id: 'turn-1', projectId, messageId: 'message-1', status: 'queued', startedAt: null, replyId: null },
      });
      expect(db.select().from(messagesTable).all()).toHaveLength(1);
      expect(db.select().from(turnsTable).all()).toHaveLength(1);
    });

    it.each(['queued', 'running'] as const)('returns a %s turn as active and stores nothing', (status) => {
      insertTurn('active', status);

      const result = turns.queue({ turnId: 'turn-2', messageId: 'message-2', projectId, content });

      expect(result).toEqual({ active: expect.objectContaining({ id: 'active', status }) });
      expect(db.select().from(messagesTable).all()).toEqual([]);
      expect(db.select().from(turnsTable).all()).toHaveLength(1);
    });

    it('rolls the message back when the turn cannot be stored', () => {
      insertTurn('turn-1', 'completed');

      expect(() => turns.queue({ turnId: 'turn-1', messageId: 'message-1', projectId, content })).toThrow();

      expect(db.select().from(messagesTable).all()).toEqual([]);
      expect(db.select().from(turnsTable).all()).toEqual([expect.objectContaining({ id: 'turn-1', status: 'completed' })]);
    });

    it('is not blocked by a finished turn', () => {
      insertTurn('finished', 'failed');

      expect(turns.queue({ turnId: 'turn-2', messageId: 'message-2', projectId, content })).toHaveProperty('turn');
    });
  });

  it('starts a queued turn once, stamping its start time', () => {
    insertTurn('turn-1', 'queued');

    const started = turns.start('turn-1');

    expect(started).toMatchObject({ id: 'turn-1', status: 'running' });
    expect(started?.startedAt).toBeTypeOf('number');
    expect(turns.start('turn-1')).toBeUndefined();
    expect(turns.start('missing')).toBeUndefined();
  });

  it('stores the final status, finish time, error, usage, and reply', () => {
    insertTurn('turn-1', 'running');

    const finished = turns.finish('turn-1', {
      status: 'failed',
      error: { code: 'internal_error', message: 'm' },
      usage: { steps: 3 },
      replyId: 'reply-1',
    });

    expect(finished).toMatchObject({
      status: 'failed',
      error: { code: 'internal_error', message: 'm' },
      usage: { steps: 3 },
      replyId: 'reply-1',
    });
    expect(finished.finishedAt).toBeTypeOf('number');
  });

  it('fails only queued and running turns, returning them', () => {
    insertTurn('queued', 'queued');
    insertTurn('running', 'running');
    insertTurn('completed', 'completed');
    const error = { code: 'interrupted', message: 'm' };

    const failed = turns.failActive(error);

    expect(failed.map((turn) => turn.id).sort()).toEqual(['queued', 'running']);
    expect(failed.every((turn) => turn.status === 'failed' && turn.finishedAt !== null)).toBe(true);
    expect(failed[0]!.error).toEqual(error);
    expect(turns.failActive(error)).toEqual([]);
  });
});
