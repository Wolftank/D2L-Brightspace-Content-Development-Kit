import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromBufferPromise } from 'yauzl';
import { createApp } from '../app.js';
import { createBuildsRepo, type BuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { users as usersTable } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { createEventService } from '../pipeline/events.js';
import { createBuildService, type BuildService } from '../services/builds.js';
import { createProjectService } from '../services/projects.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';

describe('build routes', () => {
  let dataDir: string;
  let db: Db;
  let projectsRepo: ProjectsRepo;
  let buildsRepo: BuildsRepo;
  let workspaces: WorkspaceService;
  let builds: BuildService;
  let deps: Deps;

  async function provisionedProject(id: string, ownerId: string, title: string): Promise<void> {
    await workspaces.create(id);
    projectsRepo.create({ id, ownerId, title, avenue: 'scorm' });
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-build-routes-'));
    db = testDb();
    projectsRepo = createProjectsRepo(db);
    buildsRepo = createBuildsRepo(db);
    workspaces = createWorkspaceService({ dataDir });
    const events = createEventService(createEventsRepo(db));
    builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });
    deps = {
      users: createUsersRepo(db),
      projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns: createTurnsRepo(db) }),
      builds,
      events,
      driver: { probe: async () => ({ ok: true }) },
    };

    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    await provisionedProject('mine', ownerId, 'Cell division practice');
    db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
    await provisionedProject('not-mine', 'someone-else', 'Not yours');
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('GET /api/builds/:buildId', () => {
    it('returns the build with its QA report and no deployments', async () => {
      const build = await builds.create('mine');

      const res = await request(createApp(deps)).get(`/api/builds/${build.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ build, deployments: [] });
      expect(res.body.build.qa.passed).toBe(true);
      expect(res.body.build.pedagogy).toBeNull();
    });

    it("returns 404 for another owner's build and for an unknown id", async () => {
      const others = await builds.create('not-mine');

      for (const id of [others.id, 'no-such-build']) {
        const res = await request(createApp(deps)).get(`/api/builds/${id}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
    });
  });

  describe('GET /api/builds/:buildId/download', () => {
    it('streams the zip as an attachment named after the project, without the QA report', async () => {
      const build = await builds.create('mine');

      const res = await request(createApp(deps))
        .get(`/api/builds/${build.id}/download`)
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toBe('attachment; filename="cell-division-practice-v1.zip"');
      const zip = await fromBufferPromise(res.body as Buffer, { lazyEntries: true });
      const names: string[] = [];
      for await (const entry of zip.eachEntry()) names.push(entry.fileName);
      expect(names).toContain('imsmanifest.xml');
      expect(names).not.toContain('qa.json');
    });

    it('releases the zip when the client disconnects mid-download', async () => {
      const build = await builds.create('mine');
      const buildDir = workspaces.buildPathFor('mine', String(build.version));
      for (let i = 0; i < 4; i++) {
        await fs.writeFile(join(buildDir, `media-${i}.bin`), randomBytes(4 * 1024 * 1024));
      }
      let archiveClosed: Promise<unknown> | undefined;
      const server = createApp({
        ...deps,
        builds: {
          get: builds.get,
          download: async (ownerId, buildId) => {
            const download = await builds.download(ownerId, buildId);
            archiveClosed = once(download.stream, 'close');
            return download;
          },
        },
      }).listen(0, '127.0.0.1');

      try {
        await once(server, 'listening');
        const { port } = server.address() as AddressInfo;
        await new Promise<void>((resolve) => {
          const req = http.get(`http://127.0.0.1:${port}/api/builds/${build.id}/download`, (res) => {
            res.once('data', () => {
              req.destroy();
              resolve();
            });
          });
          req.on('error', () => {});
        });

        await archiveClosed;
      } finally {
        server.close();
      }
    });

    it('refuses a build that is not ready', async () => {
      const checking = buildsRepo.create({ projectId: 'mine', version: 1, avenue: 'scorm' });

      const res = await request(createApp(deps)).get(`/api/builds/${checking.id}/download`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('build_not_ready');
    });

    it("returns 404 for another owner's build, even when it is ready", async () => {
      const others = await builds.create('not-mine');

      const res = await request(createApp(deps)).get(`/api/builds/${others.id}/download`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    });
  });
});
