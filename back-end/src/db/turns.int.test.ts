import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './index.js';
import { createProjectsRepo } from './projects.js';
import { turns as turnsTable, type Turn } from './schema.js';
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
    projectId = createProjectsRepo(db).create({ ownerId, title: 'Cell division practice' }).id;
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
