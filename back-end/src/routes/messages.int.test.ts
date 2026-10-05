import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createMessagesRepo } from '../db/messages.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { messages as messagesTable, turns as turnsTable, users as usersTable, type Turn } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo, type TurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { WorkspaceMissing } from '../errors.js';
import { createEventService, type EventService } from '../pipeline/events.js';
import { createRunner, type RunnerDeps } from '../pipeline/runner.js';
import { createTurnService } from '../services/turns.js';

const BODY = { content: [{ type: 'text', text: 'Build a self-check on mitosis' }] };

describe('POST /api/projects/:projectId/messages', () => {
  let db: Db;
  let projectsRepo: ProjectsRepo;
  let turnsRepo: TurnsRepo;
  let events: EventService;
  let executeTurn: ReturnType<typeof vi.fn<(turnId: string) => Promise<void>>>;

  const unused = () => {
    throw new Error('not used by these tests');
  };

  function app() {
    const deps: Deps = {
      users: createUsersRepo(db),
      projects: { create: unused, get: unused },
      turns: createTurnService({ projects: projectsRepo, turns: turnsRepo, runner: { executeTurn } }),
      builds: { get: unused, download: unused, previewFile: unused },
      events,
      driver: { name: 'claude', probe: async () => ({ ok: true }) },
      preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
    };
    return createApp(deps);
  }

  function post(projectId = 'project-1', body: unknown = BODY) {
    return request(app()).post(`/api/projects/${projectId}/messages`).send(body as object);
  }

  function insertTurn(id: string, status: Turn['status']): void {
    db.insert(turnsTable).values({ id, projectId: 'project-1', messageId: `message-${id}`, status }).run();
  }

  /** A runner whose turns fail at their first step, before any agent work. */
  function failingRunner() {
    const deps = {
      turns: turnsRepo,
      messages: createMessagesRepo(db),
      events,
      sessions: { acquire: unused, release: unused, close: unused },
      workspaces: {
        hashOutput: async () => {
          throw new WorkspaceMissing();
        },
      },
      builds: { create: unused, latest: unused },
    } as unknown as RunnerDeps;
    return createRunner(deps);
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db = testDb();
    projectsRepo = createProjectsRepo(db);
    turnsRepo = createTurnsRepo(db);
    events = createEventService(createEventsRepo(db));
    executeTurn = vi.fn(async () => {});
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    projectsRepo.create({ id: 'project-1', ownerId, title: 'Cell division practice' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores the message and a queued turn, returns 202, and hands the turn to the runner once', async () => {
    const res = await post();

    expect(res.status).toBe(202);
    const { message, turn } = res.body;
    expect(message).toMatchObject({ projectId: 'project-1', seq: 1, role: 'instructor', content: BODY.content, turnId: turn.id });
    expect(turn).toMatchObject({ projectId: 'project-1', messageId: message.id, status: 'queued' });
    expect(db.select().from(messagesTable).all()).toEqual([message]);
    expect(executeTurn).toHaveBeenCalledOnce();
    expect(executeTurn).toHaveBeenCalledWith(turn.id);
  });

  it('trims each text and ignores fields V1 does not take', async () => {
    const res = await post('project-1', {
      content: [{ type: 'text', text: '  Build a self-check on mitosis\n', fileId: 'file-1' }],
      role: 'agent',
    });

    expect(res.status).toBe(202);
    expect(res.body.message).toMatchObject({ role: 'instructor' });
    expect(res.body.message.content).toEqual(BODY.content);
    expect(db.select().from(messagesTable).all()[0]!.content).toEqual(BODY.content);
  });

  it.each(['queued', 'running'] as const)('returns 409 turn_active while a %s turn exists', async (status) => {
    insertTurn('active', status);

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'turn_active', details: { turnId: 'active' } });
    expect(db.select().from(messagesTable).all()).toEqual([]);
    expect(executeTurn).not.toHaveBeenCalled();
  });

  it('accepts one of two simultaneous requests and leaves no extra message', async () => {
    const [first, second] = await Promise.all([post(), post()]);

    const accepted = first.status === 202 ? first : second;
    const rejected = first.status === 202 ? second : first;
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    expect(rejected.body.error.details.turnId).toBe(accepted.body.turn.id);
    expect(db.select().from(messagesTable).all()).toHaveLength(1);
    expect(db.select().from(turnsTable).all()).toHaveLength(1);
    expect(executeTurn).toHaveBeenCalledOnce();
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('accepts a new request after a %s turn', async (status) => {
    insertTurn('earlier', status);

    expect((await post()).status).toBe(202);
  });

  it('accepts a new request after startup marks the active turn interrupted', async () => {
    await post();
    failingRunner().failInterrupted();

    expect((await post()).status).toBe(202);
  });

  it.each([
    ['no content', {}],
    ['an empty content array', { content: [] }],
    ['blank text', { content: [{ type: 'text', text: '   ' }] }],
    ['text that is not a string', { content: [{ type: 'text', text: 42 }] }],
    ['a file block', { content: [{ type: 'file', fileId: 'file-1' }] }],
    ['a text block with a file block', { content: [{ type: 'text', text: 'Hi' }, { type: 'file', fileId: 'file-1' }] }],
    ['content that is not an array', { content: 'Build a quiz' }],
  ])('rejects %s with 400 invalid_request and stores nothing', async (_case, body) => {
    const res = await post('project-1', body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(db.select().from(messagesTable).all()).toEqual([]);
    expect(executeTurn).not.toHaveBeenCalled();
  });

  it("returns 404 for another owner's project and for an unknown id", async () => {
    db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
    projectsRepo.create({ id: 'not-yours', ownerId: 'someone-else', title: 'Not yours' });

    for (const id of ['not-yours', 'no-such-project']) {
      const res = await post(id);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    expect(db.select().from(messagesTable).all()).toEqual([]);
  });

  it('reports a runner failure after acceptance through the turn and its events, then accepts the next request', async () => {
    const runner = failingRunner();
    let pending: Promise<void> | undefined;
    executeTurn.mockImplementation((turnId) => (pending = runner.executeTurn(turnId)));

    const res = await post();
    await pending;

    expect(res.status).toBe(202);
    const stored = db.select().from(turnsTable).all()[0]!;
    expect(stored).toMatchObject({ id: res.body.turn.id, status: 'failed', error: { code: 'workspace_missing' } });
    expect(events.after('project-1', 0).map((event) => event.kind)).toEqual(['turn.started', 'turn.failed']);
    expect((await post()).status).toBe(202);
  });
});
