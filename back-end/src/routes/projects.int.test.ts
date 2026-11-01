import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { projects as projectsTable, turns as turnsTable, users as usersTable, type Turn, type User } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { createEventService } from '../pipeline/events.js';
import { createBuildService } from '../services/builds.js';
import { createProjectService } from '../services/projects.js';
import { createTurnService } from '../services/turns.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';

describe('project routes', () => {
  let dataDir: string;
  let db: Db;
  let owner: User;
  let projectsRepo: ProjectsRepo;
  let workspaces: WorkspaceService;

  function app(workspaceService: WorkspaceService = workspaces) {
    const events = createEventService(createEventsRepo(db));
    const buildsRepo = createBuildsRepo(db);
    const deps: Deps = {
      users: createUsersRepo(db),
      projects: createProjectService({
        projects: projectsRepo,
        workspaces: workspaceService,
        builds: buildsRepo,
        turns: createTurnsRepo(db),
      }),
      builds: createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces: workspaceService, events }),
      events,
      turns: createTurnService({ projects: projectsRepo, turns: createTurnsRepo(db), runner: { executeTurn: async () => {} } }),
      messages: {
        list: () => {
          throw new Error('not used by these tests');
        },
      },
      driver: { name: 'claude', probe: async () => ({ ok: true }) },
      preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
    };
    return createApp(deps);
  }

  function insertTurn(id: string, projectId: string, status: Turn['status']): Turn {
    return db.insert(turnsTable).values({ id, projectId, messageId: `message-${id}`, status }).returning().get();
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-project-routes-'));
    db = testDb();
    owner = createUsersRepo(db).ensureLocalUser();
    projectsRepo = createProjectsRepo(db);
    workspaces = createWorkspaceService({ dataDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('POST /api/projects', () => {
    it('creates a SCORM project with a provisioned workspace, trimming the title', async () => {
      const res = await request(app()).post('/api/projects').send({ title: '  Cell division practice  ' });

      expect(res.status).toBe(201);
      expect(res.body.project).toMatchObject({
        ownerId: owner.id,
        title: 'Cell division practice',
        avenue: 'scorm',
        targetCourse: null,
        sessionId: null,
      });
      await expect(workspaces.locate(res.body.project.id)).resolves.toBe(workspaces.pathFor(res.body.project.id));
    });

    it('accepts an explicit scorm avenue and ignores fields V1 does not take', async () => {
      const res = await request(app())
        .post('/api/projects')
        .send({ title: 'Cell division practice', avenue: 'scorm', targetCourse: '12345' });

      expect(res.status).toBe(201);
      expect(res.body.project).toMatchObject({ avenue: 'scorm', targetCourse: null });
    });

    it.each([
      ['a blank title', { title: '   ' }],
      ['a missing title', {}],
      ['another avenue', { title: 'Cell division practice', avenue: 'topic' }],
    ])('rejects %s with the validation envelope and creates nothing', async (_case, body) => {
      const res = await request(app()).post('/api/projects').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(db.select().from(projectsTable).all()).toEqual([]);
    });

    it('leaves no project or workspace behind when workspace setup fails', async () => {
      const brokenKit = createWorkspaceService({ dataDir, kitDir: join(dataDir, 'no-such-kit') });

      const res = await request(app(brokenKit)).post('/api/projects').send({ title: 'Cell division practice' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('internal_error');
      expect(db.select().from(projectsTable).all()).toEqual([]);
      await expect(fs.readdir(join(dataDir, 'projects'))).resolves.toEqual([]);
    });
  });

  describe('GET /api/projects', () => {
    const message = { content: [{ type: 'text', text: 'Make it shorter.' }] };

    async function createAt(time: string, title: string): Promise<string> {
      vi.setSystemTime(new Date(`2026-10-28T12:00:${time}Z`));
      return (await request(app()).post('/api/projects').send({ title })).body.project.id;
    }

    async function listedTitles(): Promise<string[]> {
      const res = await request(app()).get('/api/projects');
      expect(res.status).toBe(200);
      return res.body.items.map((item: { project: { title: string } }) => item.project.title);
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('is an empty list when the instructor has no projects', async () => {
      const res = await request(app()).get('/api/projects');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    it("lists only the caller's projects, most recently used first, each with its latest build or null", async () => {
      db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
      projectsRepo.create({ id: 'not-yours', ownerId: 'someone-else', title: 'Not yours' });
      const olderId = await createAt('00', 'Cell division practice');
      await createAt('10', 'Photosynthesis quiz');
      const buildsRepo = createBuildsRepo(db);
      buildsRepo.create({ projectId: olderId, version: 1, avenue: 'scorm' });
      const latest = buildsRepo.create({ projectId: olderId, version: 2, avenue: 'scorm' });

      const res = await request(app()).get('/api/projects');

      expect(res.body.items).toEqual([
        { project: expect.objectContaining({ title: 'Photosynthesis quiz', ownerId: owner.id }), latestBuild: null },
        {
          project: expect.objectContaining({ id: olderId, title: 'Cell division practice' }),
          latestBuild: { id: latest.id, version: 2, status: 'checking', createdAt: latest.createdAt },
        },
      ]);
    });

    it('moves a project to the top when a message is sent', async () => {
      const olderId = await createAt('00', 'Cell division practice');
      await createAt('10', 'Photosynthesis quiz');
      expect(await listedTitles()).toEqual(['Photosynthesis quiz', 'Cell division practice']);

      vi.setSystemTime(new Date('2026-10-28T12:00:20Z'));
      expect((await request(app()).post(`/api/projects/${olderId}/messages`).send(message)).status).toBe(202);

      expect(await listedTitles()).toEqual(['Cell division practice', 'Photosynthesis quiz']);
    });

    it('moves a project to the top when a build finishes', async () => {
      const olderId = await createAt('00', 'Cell division practice');
      await createAt('10', 'Photosynthesis quiz');
      const buildsRepo = createBuildsRepo(db);
      const build = buildsRepo.create({ projectId: olderId, version: 1, avenue: 'scorm' });

      vi.setSystemTime(new Date('2026-10-28T12:00:20Z'));
      buildsRepo.finish(build.id, { status: 'ready', qa: { passed: true, findings: [] }, error: null, outputHash: 'hash-1' });

      expect(await listedTitles()).toEqual(['Cell division practice', 'Photosynthesis quiz']);
    });
  });

  describe('GET /api/projects/:projectId', () => {
    it('returns the project with build summaries, oldest first, and no active turn', async () => {
      const created = await request(app()).post('/api/projects').send({ title: 'Cell division practice' });
      const projectId = created.body.project.id;
      const buildsRepo = createBuildsRepo(db);
      const first = buildsRepo.create({ projectId, version: 1, avenue: 'scorm' });
      const second = buildsRepo.create({ projectId, version: 2, avenue: 'scorm' });
      insertTurn('finished', projectId, 'completed');

      const res = await request(app()).get(`/api/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        project: created.body.project,
        builds: [
          { id: first.id, version: 1, status: 'checking', createdAt: first.createdAt },
          { id: second.id, version: 2, status: 'checking', createdAt: second.createdAt },
        ],
      });
    });

    it.each(['queued', 'running'] as const)('includes a %s turn as the active turn', async (status) => {
      const created = await request(app()).post('/api/projects').send({ title: 'Cell division practice' });
      const turn = insertTurn('turn-1', created.body.project.id, status);

      const res = await request(app()).get(`/api/projects/${created.body.project.id}`);

      expect(res.body.activeTurn).toEqual(turn);
    });

    it("returns 404 for another owner's project and for an unknown id", async () => {
      db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
      projectsRepo.create({ id: 'not-yours', ownerId: 'someone-else', title: 'Not yours' });

      for (const id of ['not-yours', 'no-such-project']) {
        const res = await request(app()).get(`/api/projects/${id}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
    });
  });
});
