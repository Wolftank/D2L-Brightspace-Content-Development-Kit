import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createApp } from './app.js';
import { createBuildsRepo, type BuildsRepo } from './db/builds.js';
import { createEventsRepo } from './db/events.js';
import type { Db } from './db/index.js';
import { createProjectsRepo, type ProjectsRepo } from './db/projects.js';
import { users as usersTable, type User } from './db/schema.js';
import { testDb } from './db/test-db.js';
import { createTurnsRepo } from './db/turns.js';
import { createUsersRepo } from './db/users.js';
import type { Deps } from './deps.js';
import { NotFound } from './errors.js';
import { createEventService } from './pipeline/events.js';
import { createBuildService } from './services/builds.js';
import { createProjectService } from './services/projects.js';
import { createTurnService } from './services/turns.js';
import { createWorkspaceService, type WorkspaceService } from './services/workspaces.js';

/**
 * R3 (#63): the app, identity, and the error envelope, rerun through the real
 * app from `app.ts` with real services over an in-memory database. Each test
 * names the Sprint 2 cases it covers.
 */

const MESSAGE = { content: [{ type: 'text', text: 'Build a self-check on mitosis' }] };
const ENVELOPE_FIELDS = ['code', 'message', 'details'];

/** A stack frame such as `at handle (/app/src/routes/projects.ts:21:5)`. */
const STACK_FRAME = /\bat .+:\d+:\d+/;

/**
 * Asserts `res` is the shared error envelope from `errors.ts`,
 * `{ error: { code, message, details? } }`, with `status` and `code`, and
 * carries no stack trace.
 */
function expectEnvelope(res: request.Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/json/);
  expect(Object.keys(res.body)).toEqual(['error']);

  const { error } = res.body as { error: Record<string, unknown> };
  expect(Object.keys(error).filter((field) => !ENVELOPE_FIELDS.includes(field))).toEqual([]);
  expect(error.code).toBe(code);
  expect(error.message).toEqual(expect.any(String));
  expect(error.message).not.toBe('');
  if ('details' in error) expect(error.details).toEqual(expect.any(Object));

  expect(res.text).not.toMatch(STACK_FRAME);
  expect(res.text).not.toContain('"stack"');
}

describe('R3 regression: app, identity, error envelope', () => {
  let dataDir: string;
  let db: Db;
  let owner: User;
  let projectsRepo: ProjectsRepo;
  let buildsRepo: BuildsRepo;
  let workspaces: WorkspaceService;
  let deps: Deps;
  let consoleError: MockInstance<typeof console.error>;

  function app() {
    return createApp(deps);
  }

  /** Stores a finished build for `projectId` without copying any output, so it has no files on disk. */
  function storedBuild(projectId: string, status: 'ready' | 'failed') {
    const build = buildsRepo.create({ projectId, version: buildsRepo.nextVersion(projectId), avenue: 'scorm' });
    return buildsRepo.finish(build.id, {
      status,
      qa: { passed: status === 'ready', findings: [] },
      error: status === 'ready' ? null : { code: 'qa_failed', message: 'The QA gate reported 1 error(s)' },
      outputHash: null,
    });
  }

  beforeEach(async () => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-r3-'));
    db = testDb();
    projectsRepo = createProjectsRepo(db);
    buildsRepo = createBuildsRepo(db);
    const turnsRepo = createTurnsRepo(db);
    workspaces = createWorkspaceService({ dataDir });
    const events = createEventService(createEventsRepo(db));
    deps = {
      users: createUsersRepo(db),
      projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns: turnsRepo }),
      turns: createTurnService({ projects: projectsRepo, turns: turnsRepo, runner: { executeTurn: async () => {} } }),
      builds: createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events }),
      events,
      driver: { name: 'claude', probe: async () => ({ ok: true, version: '0.0.0' }) },
      preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
    };

    owner = deps.users.ensureLocalUser();
    await workspaces.create('mine');
    projectsRepo.create({ id: 'mine', ownerId: owner.id, title: 'Cell division practice', avenue: 'scorm' });
    db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
    await workspaces.create('not-mine');
    projectsRepo.create({ id: 'not-mine', ownerId: 'someone-else', title: 'Not yours', avenue: 'scorm' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('identity', () => {
    it('sets req.user to the local stub user before the route handler runs, on every request (F14)', async () => {
      const ensureLocalUser = vi.spyOn(deps.users, 'ensureLocalUser');

      const me = await request(app()).get('/api/me');
      const project = await request(app()).get('/api/projects/mine');
      await request(app()).get('/api/does-not-exist');
      await request(app()).get('/not-an-api-route');

      expect(me.status).toBe(200);
      expect(me.body.user).toEqual(owner);
      expect(project.status).toBe(200);
      expect(project.body.project.ownerId).toBe(owner.id);
      expect(ensureLocalUser).toHaveBeenCalledTimes(4);
    });
  });

  describe('routes outside /api', () => {
    it('get the Express default 404, with no JSON envelope (F20)', async () => {
      const res = await request(app()).get('/not-an-api-route');

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.text).toContain('Cannot GET /not-an-api-route');
      expect(res.text).not.toContain('"error"');
      expect(res.text).not.toMatch(STACK_FRAME);
    });
  });

  describe('errors a route throws', () => {
    it('returns 404 not_found, keeping the message of the NotFound the route threw (F22)', async () => {
      deps.projects = {
        ...deps.projects,
        get: () => {
          throw new NotFound('Project archived-7 not found');
        },
      };

      const res = await request(app()).get('/api/projects/archived-7');

      expectEnvelope(res, 404, 'not_found');
      expect(res.body.error.message).toBe('Project archived-7 not found');
    });

    it("returns 404 not_found for a real route's unknown and another owner's id (F22)", async () => {
      expectEnvelope(await request(app()).get('/api/projects/no-such-project'), 404, 'not_found');
      expectEnvelope(await request(app()).get('/api/projects/not-mine'), 404, 'not_found');
    });

    it('returns 500 internal_error for an unexpected error, logged on the server and never sent to the client (F23, NF6)', async () => {
      const unexpected = new Error('SQLITE_CORRUPT: database disk image is malformed at C:\\Users\\instructor\\cdk.db');
      deps.projects = {
        ...deps.projects,
        get: () => {
          throw unexpected;
        },
      };

      const res = await request(app()).get('/api/projects/mine');

      expectEnvelope(res, 500, 'internal_error');
      expect(res.body.error).toEqual({ code: 'internal_error', message: 'Internal server error' });
      expect(res.text).not.toContain('SQLITE_CORRUPT');
      expect(res.text).not.toContain('cdk.db');
      expect(consoleError).toHaveBeenCalledWith(unexpected);
    });

    it('returns 500 internal_error for an unexpected rejection in an async route, logged on the server only (F23, NF6)', async () => {
      const unexpected = new Error('spawn claude ENOENT');
      deps.driver = {
        ...deps.driver,
        probe: async () => {
          throw unexpected;
        },
      };

      const res = await request(app()).get('/api/me');

      expectEnvelope(res, 500, 'internal_error');
      expect(res.body.error).toEqual({ code: 'internal_error', message: 'Internal server error' });
      expect(res.text).not.toContain('ENOENT');
      expect(consoleError).toHaveBeenCalledWith(unexpected);
    });
  });

  describe('every API error uses the envelope (NF5, NF6)', () => {
    it('for the Sprint 2 errors: unknown route, malformed JSON, and a body over the limit (F19, F21)', async () => {
      expectEnvelope(await request(app()).get('/api/does-not-exist'), 404, 'not_found');
      expectEnvelope(
        await request(app()).post('/api/projects').set('Content-Type', 'application/json').send('{"title": '),
        400,
        'invalid_json',
      );
      expectEnvelope(
        await request(app()).post('/api/projects').send({ title: 'x'.repeat(150_000) }),
        413,
        'payload_too_large',
      );
    });

    it('for the project routes: 400 for an invalid body, 404 for an unknown or unowned id', async () => {
      for (const body of [{}, { title: '   ' }, { title: 7 }, { title: 'Quiz', avenue: 'widget' }]) {
        const res = await request(app()).post('/api/projects').send(body);
        expectEnvelope(res, 400, 'invalid_request');
        expect(res.body.error.details.issues).toEqual(expect.any(Array));
      }
      expectEnvelope(await request(app()).get('/api/projects/no-such-project'), 404, 'not_found');
      expectEnvelope(await request(app()).get('/api/projects/not-mine'), 404, 'not_found');
    });

    it('for the message route: 400 for an invalid body, 404 for an unknown or unowned id, 409 while a turn is active', async () => {
      for (const body of [{}, { content: [] }, { content: [{ type: 'text', text: '  ' }] }, { content: [{ type: 'image' }] }]) {
        expectEnvelope(await request(app()).post('/api/projects/mine/messages').send(body), 400, 'invalid_request');
      }
      expectEnvelope(await request(app()).post('/api/projects/no-such-project/messages').send(MESSAGE), 404, 'not_found');
      expectEnvelope(await request(app()).post('/api/projects/not-mine/messages').send(MESSAGE), 404, 'not_found');

      const first = await request(app()).post('/api/projects/mine/messages').send(MESSAGE);
      const second = await request(app()).post('/api/projects/mine/messages').send(MESSAGE);

      expect(first.status).toBe(202);
      expectEnvelope(second, 409, 'turn_active');
      expect(second.body.error.details).toEqual({ turnId: first.body.turn.id });
    });

    it('for the build routes: 404 for an unknown or unowned build, 409 for a build that cannot be downloaded', async () => {
      const failed = storedBuild('mine', 'failed');
      const incomplete = storedBuild('mine', 'ready');
      const unowned = storedBuild('not-mine', 'ready');

      expectEnvelope(await request(app()).get('/api/builds/no-such-build'), 404, 'not_found');
      expectEnvelope(await request(app()).get(`/api/builds/${unowned.id}`), 404, 'not_found');
      expectEnvelope(await request(app()).get('/api/builds/no-such-build/download'), 404, 'not_found');
      expectEnvelope(await request(app()).get(`/api/builds/${unowned.id}/download`), 404, 'not_found');

      const notReady = await request(app()).get(`/api/builds/${failed.id}/download`);
      expectEnvelope(notReady, 409, 'build_not_ready');
      expect(notReady.body.error.details).toEqual({ status: 'failed' });

      const missingFiles = await request(app()).get(`/api/builds/${incomplete.id}/download`);
      expectEnvelope(missingFiles, 409, 'build_incomplete');
      expect(missingFiles.body.error.details.missing).toContain('imsmanifest.xml');
    });

    it('for the event stream: 400 for a malformed cursor, 404 for an unknown or unowned project', async () => {
      expectEnvelope(await request(app()).get('/api/projects/mine/events?after=abc'), 400, 'invalid_request');
      expectEnvelope(await request(app()).get('/api/projects/no-such-project/events'), 404, 'not_found');
      expectEnvelope(await request(app()).get('/api/projects/not-mine/events'), 404, 'not_found');
    });
  });
});
