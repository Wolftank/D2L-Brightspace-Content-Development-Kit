import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Db } from '../db/index.js';
import { createMessagesRepo } from '../db/messages.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { messages as messagesTable, turns as turnsTable, users as usersTable, type Turn, type User } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo, type TurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import type { Runner } from '../pipeline/runner.js';
import { createTurnService } from '../services/turns.js';

const CONTENT = [{ type: 'text' as const, text: 'A ten-question practice set on cell division' }];

describe('POST /api/projects/:projectId/messages', () => {
  let db: Db;
  let owner: User;
  let projectsRepo: ProjectsRepo;
  let turnsRepo: TurnsRepo;
  let runner: { executeTurn: ReturnType<typeof vi.fn<Runner['executeTurn']>> };

  function app() {
    const deps: Deps = {
      users: createUsersRepo(db),
      projects: {
        create: async () => {
          throw new Error('not used by these tests');
        },
        get: () => {
          throw new Error('not used by these tests');
        },
      },
      builds: {
        get: () => {
          throw new Error('not used by these tests');
        },
        download: async () => {
          throw new Error('not used by these tests');
        },
      },
      turns: createTurnService({
        projects: projectsRepo,
        messages: createMessagesRepo(db),
        turns: turnsRepo,
        runner,
      }),
      events: {
        append: () => {
          throw new Error('not used by these tests');
        },
        after: () => [],
        subscribe: () => () => {},
      },
      driver: { probe: async () => ({ ok: true }) },
    };
    return createApp(deps);
  }

  function insertTurn(id: string, status: Turn['status']): Turn {
    return db.insert(turnsTable).values({ id, projectId: 'project-1', messageId: `message-${id}`, status }).returning().get();
  }

  function storedMessages() {
    return db.select().from(messagesTable).all();
  }

  function storedTurns() {
    return db.select().from(turnsTable).all();
  }

  beforeEach(() => {
    db = testDb();
    owner = createUsersRepo(db).ensureLocalUser();
    projectsRepo = createProjectsRepo(db);
    turnsRepo = createTurnsRepo(db);
    runner = { executeTurn: vi.fn(async () => {}) };
    projectsRepo.create({ id: 'project-1', ownerId: owner.id, title: 'Cell division practice' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores the message and a queued turn, returns 202, and hands the turn to the runner exactly once', async () => {
    const res = await request(app()).post('/api/projects/project-1/messages').send({ content: CONTENT });

    expect(res.status).toBe(202);
    const { message, turn } = res.body;
    expect(message).toMatchObject({
      projectId: 'project-1',
      seq: 1,
      role: 'instructor',
      content: CONTENT,
      turnId: turn.id,
    });
    expect(turn).toMatchObject({
      projectId: 'project-1',
      messageId: message.id,
      replyId: null,
      status: 'queued',
    });
    expect(storedMessages()).toHaveLength(1);
    expect(storedTurns()).toHaveLength(1);
    expect(runner.executeTurn).toHaveBeenCalledExactlyOnceWith(turn.id);
  });

  it.each(['queued', 'running'] as const)('rejects a request while a %s turn is active, naming it', async (status) => {
    const active = insertTurn('active-turn', status);

    const res = await request(app()).post('/api/projects/project-1/messages').send({ content: CONTENT });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('turn_active');
    expect(res.body.error.details).toEqual({ turnId: active.id });
    expect(storedMessages()).toEqual([]);
    expect(storedTurns()).toEqual([active]);
    expect(runner.executeTurn).not.toHaveBeenCalled();
  });

  it('accepts exactly one of two simultaneous requests, storing nothing for the rejected one', async () => {
    const server = app();

    const responses = await Promise.all([
      request(server).post('/api/projects/project-1/messages').send({ content: CONTENT }),
      request(server).post('/api/projects/project-1/messages').send({ content: CONTENT }),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([202, 409]);
    expect(storedMessages()).toHaveLength(1);
    expect(storedTurns()).toHaveLength(1);
    expect(runner.executeTurn).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('accepts a new request after a turn ends %s', async (status) => {
    insertTurn('finished-turn', status);

    const res = await request(app()).post('/api/projects/project-1/messages').send({ content: CONTENT });

    expect(res.status).toBe(202);
    expect(runner.executeTurn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a missing content field', {}],
    ['an empty content array', { content: [] }],
    ['blank request text', { content: [{ type: 'text', text: '   ' }] }],
    ['an unsupported block type', { content: [{ type: 'file', fileId: 'file-1' }] }],
    ['a text block without text', { content: [{ type: 'text' }] }],
  ])('rejects %s with the validation envelope and stores nothing', async (_case, body) => {
    const res = await request(app()).post('/api/projects/project-1/messages').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(storedMessages()).toEqual([]);
    expect(storedTurns()).toEqual([]);
    expect(runner.executeTurn).not.toHaveBeenCalled();
  });

  it("returns 404 for another owner's project and for an unknown id, storing nothing", async () => {
    db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
    projectsRepo.create({ id: 'not-yours', ownerId: 'someone-else', title: 'Not yours' });

    for (const id of ['not-yours', 'no-such-project']) {
      const res = await request(app()).post(`/api/projects/${id}/messages`).send({ content: CONTENT });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    expect(storedMessages()).toEqual([]);
    expect(storedTurns()).toEqual([]);
    expect(runner.executeTurn).not.toHaveBeenCalled();
  });

  it('keeps the 202 and logs when the runner rejects after acceptance', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    runner.executeTurn.mockRejectedValueOnce(new Error('runner exploded'));

    const res = await request(app()).post('/api/projects/project-1/messages').send({ content: CONTENT });

    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('Failed to run turn'), expect.any(Error));
    });
    expect(storedMessages()).toHaveLength(1);
    expect(storedTurns()).toHaveLength(1);
  });
});
