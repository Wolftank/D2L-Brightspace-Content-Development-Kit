import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import { createFilesRepo } from '../db/files.js';
import type { Db } from '../db/index.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { projects as projectsTable, turns as turnsTable, users as usersTable, type Turn, type User } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import { fakeDeps, idleRunner } from '../test/deps.js';
import { KIT_DIR } from '../kit.js';
import { createEventService } from '../pipeline/events.js';
import { createBuildService } from '../services/builds.js';
import { createAvenueService } from '../services/avenues.js';
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
    const deps = fakeDeps({
      users: createUsersRepo(db),
      projects: createProjectService({
        projects: projectsRepo,
        workspaces: workspaceService,
        builds: buildsRepo,
        turns: createTurnsRepo(db),
        events,
      }),
      avenues: createAvenueService({ projects: projectsRepo, workspaces: workspaceService, turns: createTurnsRepo(db), events }),
      builds: createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces: workspaceService, events }),
      events,
      turns: createTurnService({ projects: projectsRepo, turns: createTurnsRepo(db), files: createFilesRepo(db), runner: idleRunner }),
    });
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
    it('creates a project with no avenue and an empty out/, trimming the title', async () => {
      const res = await request(app()).post('/api/projects').send({ title: '  Cell division practice  ' });

      expect(res.status).toBe(201);
      expect(res.body.project).toMatchObject({
        ownerId: owner.id,
        title: 'Cell division practice',
        avenue: null,
        targetCourse: null,
        sessionId: null,
      });
      const workspaceDir = await workspaces.locate(res.body.project.id);
      expect(await fs.readdir(join(workspaceDir, 'out'))).toEqual([]);
    });

    it('accepts an explicit scorm avenue and ignores fields V1 does not take', async () => {
      const res = await request(app())
        .post('/api/projects')
        .send({ title: 'Cell division practice', avenue: 'scorm', targetCourse: '12345' });

      expect(res.status).toBe(201);
      expect(res.body.project).toMatchObject({ avenue: 'scorm', targetCourse: null });
    });

    it('creates a content-topic project whose out/ holds exactly the content-topic starter', async () => {
      const res = await request(app()).post('/api/projects').send({ title: 'Campus map', avenue: 'topic' });

      expect(res.status).toBe(201);
      expect(res.body.project).toMatchObject({ title: 'Campus map', avenue: 'topic' });
      const starter = join(KIT_DIR, 'skills', 'd2l-content-topic', 'assets', 'starter');
      const out = join(workspaces.pathFor(res.body.project.id), 'out');
      expect((await fs.readdir(out)).sort()).toEqual((await fs.readdir(starter)).sort());
      expect(await fs.readFile(join(out, 'index.html'), 'utf8')).toBe(await fs.readFile(join(starter, 'index.html'), 'utf8'));
    });

    it.each([
      ['a blank title', { title: '   ' }],
      ['a missing title', {}],
      ['an avenue CDK cannot build', { title: 'Cell division practice', avenue: 'widget' }],
    ])('rejects %s with the validation envelope and creates nothing', async (_case, body) => {
      const res = await request(app()).post('/api/projects').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(db.select().from(projectsTable).all()).toEqual([]);
    });

    it('leaves no project or workspace behind when workspace setup fails', async () => {
      const brokenKit = createWorkspaceService({ dataDir, kitDir: join(dataDir, 'no-such-kit') });

      const res = await request(app(brokenKit)).post('/api/projects').send({ title: 'Cell division practice', avenue: 'scorm' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('internal_error');
      expect(db.select().from(projectsTable).all()).toEqual([]);
      await expect(fs.readdir(join(dataDir, 'projects'))).resolves.toEqual([]);
    });
  });

  describe('PATCH /api/projects/:projectId', () => {
    async function createScorm(): Promise<string> {
      return (await request(app()).post('/api/projects').send({ title: 'Cell division practice', avenue: 'scorm' })).body.project.id;
    }

    it("changes the avenue and replaces out/ with the new avenue's starter", async () => {
      const projectId = await createScorm();
      const outDir = join(workspaces.pathFor(projectId), 'out');
      await fs.writeFile(join(outDir, 'draft.html'), '<p>draft</p>');

      const res = await request(app()).patch(`/api/projects/${projectId}`).send({ avenue: 'topic' });

      expect(res.status).toBe(200);
      expect(res.body.project).toMatchObject({ id: projectId, avenue: 'topic' });
      expect(projectsRepo.getById(projectId)?.avenue).toBe('topic');
      expect(await fs.readdir(outDir)).toEqual(['data.js', 'index.html']);
    });

    it('refuses while a turn is active, for an avenue CDK cannot build, and for an unknown project', async () => {
      const projectId = await createScorm();
      const unbuildable = await request(app()).patch(`/api/projects/${projectId}`).send({ avenue: 'widget' });
      const unknown = await request(app()).patch('/api/projects/no-such-project').send({ avenue: 'topic' });
      insertTurn('turn-1', projectId, 'running');
      const busy = await request(app()).patch(`/api/projects/${projectId}`).send({ avenue: 'topic' });

      expect(unbuildable.body.error).toMatchObject({ code: 'invalid_request' });
      expect(unknown.body.error).toMatchObject({ code: 'not_found' });
      expect(busy.status).toBe(409);
      expect(busy.body.error).toMatchObject({ code: 'turn_active', details: { turnId: 'turn-1' } });
      expect(projectsRepo.getById(projectId)?.avenue).toBe('scorm');
    });

    it('refuses a message and a second change while a change is at work, and takes the message once it ends', async () => {
      const projectId = await createScorm();
      const message = { content: [{ type: 'text', text: 'Make it shorter.' }] };
      let copying = false;
      let finishCopy!: () => void;
      const copyHeld = new Promise<void>((resolve) => { finishCopy = resolve; });
      const server = app({
        ...workspaces,
        startOutput: async (id, avenue) => {
          copying = true;
          await copyHeld;
          await workspaces.startOutput(id, avenue);
        },
      });

      const change = request(server).patch(`/api/projects/${projectId}`).send({ avenue: 'topic' }).then((res) => res);
      await vi.waitFor(() => expect(copying).toBe(true));
      const during = await request(server).post(`/api/projects/${projectId}/messages`).send(message);
      const second = await request(server).patch(`/api/projects/${projectId}`).send({ avenue: 'scorm' });
      finishCopy();

      expect(during.status).toBe(409);
      expect(during.body.error).toMatchObject({ code: 'avenue_changing', nextStep: 'wait' });
      expect(second.body.error).toMatchObject({ code: 'avenue_changing' });
      expect((await change).body.project).toMatchObject({ avenue: 'topic' });
      expect((await request(server).post(`/api/projects/${projectId}/messages`).send(message)).status).toBe(202);
    });
  });

  describe('PATCH /api/projects/:projectId with a title', () => {
    async function create(title = 'Cell divison practice'): Promise<string> {
      return (await request(app()).post('/api/projects').send({ title, avenue: 'scorm' })).body.project.id;
    }

    it('renames the project, trimming the title, and leaves its avenue and out/ alone', async () => {
      const projectId = await create();
      const outDir = join(workspaces.pathFor(projectId), 'out');
      await fs.writeFile(join(outDir, 'draft.html'), '<p>draft</p>');
      const before = (await fs.readdir(outDir)).sort();

      const res = await request(app()).patch(`/api/projects/${projectId}`).send({ title: '  Cell division practice  ' });

      expect(res.status).toBe(200);
      expect(res.body.project).toMatchObject({ id: projectId, title: 'Cell division practice', avenue: 'scorm', targetCourse: null });
      expect((await fs.readdir(outDir)).sort()).toEqual(before);
    });

    it('keeps the new title in the database, so a new app instance and the project list show it', async () => {
      const projectId = await create();
      await request(app()).patch(`/api/projects/${projectId}`).send({ title: 'Mitosis review' });

      // Every app() call builds its services afresh over the same database, as a restart does.
      const reopened = await request(app()).get(`/api/projects/${projectId}`);
      const listed = await request(app()).get('/api/projects');

      expect(reopened.body.project.title).toBe('Mitosis review');
      expect(listed.body.items.map((item: { project: { title: string } }) => item.project.title)).toEqual(['Mitosis review']);
    });

    it('sends project.updated with the renamed project', async () => {
      const projectId = await create();

      const res = await request(app()).patch(`/api/projects/${projectId}`).send({ title: 'Mitosis review' });

      const events = createEventService(createEventsRepo(db)).after(projectId, 0);
      expect(events.at(-1)).toMatchObject({ kind: 'project.updated', payload: { project: res.body.project } });
    });

    it.each([
      ['a blank title', { title: '' }],
      ['a title of only spaces', { title: '   ' }],
      ['a title that is not text', { title: 42 }],
      ['a body with neither a title nor an avenue', {}],
      ['a body with only a field V1 does not take', { targetCourse: '12345' }],
    ])('refuses %s with the validation envelope and keeps the old title', async (_case, body) => {
      const projectId = await create();

      const res = await request(app()).patch(`/api/projects/${projectId}`).send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(projectsRepo.getById(projectId)?.title).toBe('Cell divison practice');
    });

    it("returns 404 for another owner's project and an unknown id, and renames nothing", async () => {
      db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
      projectsRepo.create({ id: 'not-yours', ownerId: 'someone-else', title: 'Not yours' });

      for (const id of ['not-yours', 'no-such-project']) {
        const res = await request(app()).patch(`/api/projects/${id}`).send({ title: 'Taken over' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
      expect(projectsRepo.getById('not-yours')?.title).toBe('Not yours');
      expect(createEventService(createEventsRepo(db)).after('not-yours', 0)).toEqual([]);
    });

    it('renames while a turn is running', async () => {
      const projectId = await create();
      insertTurn('turn-1', projectId, 'running');

      const res = await request(app()).patch(`/api/projects/${projectId}`).send({ title: 'Mitosis review' });

      expect(res.status).toBe(200);
      expect(projectsRepo.getById(projectId)?.title).toBe('Mitosis review');
    });

    it('takes a title and an avenue together, and renames nothing when the avenue change is refused', async () => {
      const projectId = await create();

      const both = await request(app()).patch(`/api/projects/${projectId}`).send({ title: 'Mitosis review', avenue: 'topic' });
      insertTurn('turn-1', projectId, 'running');
      const refused = await request(app()).patch(`/api/projects/${projectId}`).send({ title: 'Something else', avenue: 'scorm' });

      expect(both.body.project).toMatchObject({ title: 'Mitosis review', avenue: 'topic' });
      expect(refused.status).toBe(409);
      expect(projectsRepo.getById(projectId)).toMatchObject({ title: 'Mitosis review', avenue: 'topic' });
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
