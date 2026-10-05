import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { users as usersTable } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { KIT_DIR } from '../kit.js';
import { createEventService } from '../pipeline/events.js';
import { createBuildService, type BuildService } from '../services/builds.js';
import { createProjectService } from '../services/projects.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';

const PREVIEW_HOST = 'preview.localhost:3000';
const APP_ORIGIN = 'http://127.0.0.1:5173';
const BAD_SCORM = join(KIT_DIR, 'harness', 'lint', 'fixtures', 'bad-scorm');

describe('preview origin', () => {
  let rootDir: string;
  let db: Db;
  let projectsRepo: ProjectsRepo;
  let workspaces: WorkspaceService;
  let builds: BuildService;
  let deps: Deps;

  /** A GET addressed to the preview origin. */
  function preview(path: string) {
    return request(createApp(deps)).get(path).set('Host', PREVIEW_HOST);
  }

  async function provisionedProject(id: string, ownerId: string): Promise<void> {
    await workspaces.create(id);
    projectsRepo.create({ id, ownerId, title: id, avenue: 'scorm' });
  }

  beforeEach(async () => {
    // A dot folder, like the default ~/.cdk outside Windows, must not hide the files.
    rootDir = await fs.mkdtemp(join(tmpdir(), 'cdk-preview-'));
    const dataDir = join(rootDir, '.cdk');
    db = testDb();
    projectsRepo = createProjectsRepo(db);
    const buildsRepo = createBuildsRepo(db);
    workspaces = createWorkspaceService({ dataDir });
    const events = createEventService(createEventsRepo(db));
    builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });
    deps = {
      users: createUsersRepo(db),
      projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns: createTurnsRepo(db) }),
      builds,
      events,
      turns: {
        start: () => {
          throw new Error('not used by these tests');
        },
      },
      driver: { name: 'claude', probe: async () => ({ ok: true }) },
      preview: { origin: `http://${PREVIEW_HOST}`, appOrigin: APP_ORIGIN },
    };

    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    await provisionedProject('mine', ownerId);
    db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
    await provisionedProject('not-mine', 'someone-else');
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  describe('player', () => {
    it('serves the player page to the app origin, with the preview headers', async () => {
      const res = await preview(`/preview/player.html?buildId=b&attempt=a&parentOrigin=${encodeURIComponent(APP_ORIGIN)}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.headers['content-security-policy']).toContain(`frame-ancestors ${APP_ORIGIN} 'self'`);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it.each([
      ['no parent origin', '/preview/player.html'],
      ['another parent origin', `/preview/player.html?parentOrigin=${encodeURIComponent('http://evil.example')}`],
    ])('refuses the player page with %s', async (_case, path) => {
      expect((await preview(path)).status).toBe(403);
    });

    it.each([
      ['player.js', /javascript/],
      ['player.css', /^text\/css/],
      ['d2l-emulator.js', /javascript/],
      ['tenant-profile.json', /^application\/json/],
    ])('serves %s', async (file, type) => {
      const res = await preview(`/preview/${file}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(type);
    });

    it('serves the emulator unchanged from the kit', async () => {
      const res = await preview('/preview/d2l-emulator.js');

      expect(res.text).toBe(await fs.readFile(join(KIT_DIR, 'harness', 'd2l-emulator.js'), 'utf8'));
    });

    it('serves nothing else under /preview/', async () => {
      expect((await preview('/preview/server.ts')).status).toBe(404);
    });
  });

  describe('build files', () => {
    it("serves a ready build's launch page and files in subfolders", async () => {
      const build = await builds.create('mine');
      const buildDir = workspaces.buildPathFor('mine', '1');
      await fs.mkdir(join(buildDir, 'css'));
      await fs.writeFile(join(buildDir, 'css', 'site.css'), 'body { margin: 0; }');

      const page = await preview(`/api/builds/${build.id}/preview/index.html`);
      const style = await preview(`/api/builds/${build.id}/preview/css/site.css`);

      expect(page.status).toBe(200);
      expect(page.headers['content-type']).toMatch(/^text\/html/);
      expect(page.text).toBe(await fs.readFile(join(buildDir, 'index.html'), 'utf8'));
      expect(style.headers['content-type']).toMatch(/^text\/css/);
      expect(style.text).toBe('body { margin: 0; }');
    });

    it.each([
      ['the QA report', 'qa.json'],
      ['an encoded parent folder', '..%2f..%2f..%2f..%2fcdk.db'],
      ['an encoded dot-dot', '%2e%2e/%2e%2e/%2e%2e/%2e%2e/cdk.db'],
      ['an encoded backslash', '..%5c..%5c..%5c..%5ccdk.db'],
      ['an absolute path', 'C:%5cWindows%5cwin.ini'],
    ])('refuses %s', async (_case, path) => {
      const build = await builds.create('mine');

      expect((await preview(`/api/builds/${build.id}/preview/${path}`)).status).toBe(404);
    });

    it('refuses a build that is not ready', async () => {
      const outDir = join(workspaces.pathFor('mine'), 'out');
      await fs.rm(outDir, { recursive: true });
      await fs.cp(BAD_SCORM, outDir, { recursive: true });
      const build = await builds.create('mine');

      expect((await preview(`/api/builds/${build.id}/preview/index.html`)).status).toBe(404);
    });

    it("refuses another owner's build", async () => {
      const build = await builds.create('not-mine');

      expect((await preview(`/api/builds/${build.id}/preview/index.html`)).status).toBe(404);
    });
  });

  describe('methods', () => {
    it('answers HEAD without a body', async () => {
      const build = await builds.create('mine');

      const res = await request(createApp(deps)).head(`/api/builds/${build.id}/preview/index.html`).set('Host', PREVIEW_HOST);

      expect(res.status).toBe(200);
      expect(res.text).toBeUndefined();
    });

    it('refuses other methods with 405', async () => {
      const res = await request(createApp(deps)).post('/preview/player.js').set('Host', PREVIEW_HOST);

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
    });
  });

  describe('separation from the app origin', () => {
    it('does not answer the API on the preview origin', async () => {
      expect((await preview('/api/health')).status).toBe(404);
    });

    it('does not serve preview paths on the app origin', async () => {
      const build = await builds.create('mine');
      const app = request(createApp(deps));

      expect((await app.get(`/preview/player.html?parentOrigin=${encodeURIComponent(APP_ORIGIN)}`)).status).toBe(404);
      expect((await app.get(`/api/builds/${build.id}/preview/index.html`)).status).toBe(404);
    });
  });
});
