import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import type { ChatMessage } from '@cdk/contract';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromBufferPromise } from 'yauzl';
import type { AgentDriver, AgentEvent, TurnResult } from '../agent/AgentDriver.js';
import { createApp } from '../app.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createMessagesRepo } from '../db/messages.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { messages as messagesTable, projects as projectsTable, users as usersTable } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { KIT_DIR } from '../kit.js';
import { createEventService, type EventService } from '../pipeline/events.js';
import { createRunner } from '../pipeline/runner.js';
import { createSessionService, type SessionService } from '../pipeline/sessions.js';
import { createBuildService, type BuildService } from '../services/builds.js';
import { createMessageService } from '../services/messages.js';
import { createProjectService } from '../services/projects.js';
import { createTurnService } from '../services/turns.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';
import { captureLog, type LogRecord } from '../test/log.js';

/**
 * R8 (#68): the project, message and build routes, including every error
 * case, run through the real app wired as `server.ts` wires it, with real
 * workspaces, runner, QA gate and zip download. Only the agent is fake.
 */

const STARTER = join(KIT_DIR, 'skills', 'd2l-scorm-package', 'assets', 'starter');
const BAD_SCORM = join(KIT_DIR, 'harness', 'lint', 'fixtures', 'bad-scorm');
const WORKSPACE_MISSING_ERROR = {
  code: 'workspace_missing',
  message: "This project's files are missing, so the request couldn't run.",
  nextStep: 'new_project',
};

type TurnStatus = NonNullable<ChatMessage['turn']>['status'];

/**
 * An agent that writes the request into `out/notes.txt` and replies "Done.".
 * A request containing `[qa-fail]` copies the kit's bad SCORM fixture into
 * `out/` instead, so the QA gate fails the build. A request containing
 * `[hold]` stays running until `release()` is called.
 */
function fakeAgent(): { driver: Pick<AgentDriver, 'open'>; release(): void } {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const driver: Pick<AgentDriver, 'open'> = {
    async open(req) {
      return {
        sessionId: null,
        send(input) {
          let resolveResult!: (result: TurnResult) => void;
          const result = new Promise<TurnResult>((resolve) => {
            resolveResult = resolve;
          });
          const out = join(req.workspaceDir, 'out');
          const events = (async function* (): AsyncGenerator<AgentEvent> {
            yield { kind: 'tool_start', callId: 'call-1', name: 'Write', summary: 'Writing the activity' };
            if (input.text.includes('[hold]')) await held;
            if (input.text.includes('[qa-fail]')) await fs.cp(BAD_SCORM, out, { recursive: true, force: true });
            else await fs.writeFile(join(out, 'notes.txt'), input.text);
            yield { kind: 'tool_end', callId: 'call-1', ok: true };
            yield { kind: 'text_delta', text: 'Done.' };
            resolveResult({ status: 'completed', sessionId: null, text: 'Done.', usage: { steps: 1 } });
          })();
          return { events, result };
        },
        async close() {},
      };
    },
  };
  return { driver, release: () => release() };
}

/** The relative paths of every file under `dir`, sorted, with `/` separators. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll('\\', '/'))
    .sort();
}

describe('R8 regression: project, message and build routes', () => {
  let dataDir: string;
  let db: Db;
  let projectsRepo: ProjectsRepo;
  let workspaces: WorkspaceService;
  let events: EventService;
  let builds: BuildService;
  let sessions: SessionService;
  let agent: ReturnType<typeof fakeAgent>;
  let deps: Deps;
  let logRecords: LogRecord[];

  function app() {
    return createApp(deps);
  }

  async function createProject(): Promise<string> {
    const res = await request(app()).post('/api/projects').send({ title: 'Cell division practice' });
    expect(res.status).toBe(201);
    return res.body.project.id;
  }

  async function listMessages(projectId: string): Promise<ChatMessage[]> {
    const res = await request(app()).get(`/api/projects/${projectId}/messages`);
    expect(res.status).toBe(200);
    return res.body.items;
  }

  /** Resolves with the turn, as the message list reports it, once `reached` is true of its status. */
  async function waitForTurn(projectId: string, turnId: string, reached: (status: TurnStatus) => boolean) {
    let turn: ChatMessage['turn'];
    await vi.waitFor(
      async () => {
        turn = (await listMessages(projectId)).find((message) => message.turn?.id === turnId)?.turn;
        expect(turn && reached(turn.status)).toBe(true);
      },
      { timeout: 15_000, interval: 50 },
    );
    return turn!;
  }

  /** Sends `content` as a message and resolves with its turn once the turn has finished. */
  async function runTurn(projectId: string, content: string) {
    const res = await request(app())
      .post(`/api/projects/${projectId}/messages`)
      .send({ content: [{ type: 'text', text: content }] });
    expect(res.status).toBe(202);
    return waitForTurn(projectId, res.body.turn.id, (status) => status !== 'queued' && status !== 'running');
  }

  async function latestBuild(projectId: string) {
    const res = await request(app()).get(`/api/projects/${projectId}`);
    return res.body.builds.at(-1);
  }

  async function download(buildId: string) {
    return request(app())
      .get(`/api/builds/${buildId}/download`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
  }

  beforeEach(async () => {
    logRecords = captureLog();
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-r8-'));
    db = testDb();
    projectsRepo = createProjectsRepo(db);
    const buildsRepo = createBuildsRepo(db);
    const turnsRepo = createTurnsRepo(db);
    const messagesRepo = createMessagesRepo(db);
    events = createEventService(createEventsRepo(db));
    workspaces = createWorkspaceService({ dataDir });
    builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });
    agent = fakeAgent();
    sessions = createSessionService({ projects: projectsRepo, workspaces, driver: agent.driver, tools: () => ({ name: 'cdk', tools: [] }) });
    const runner = createRunner({
      turns: turnsRepo,
      messages: messagesRepo,
      events,
      sessions,
      workspaces,
      builds,
      turnLimits: { maxSteps: 60, maxBudgetUsd: 10 },
    });
    deps = {
      users: createUsersRepo(db),
      projects: createProjectService({ projects: projectsRepo, workspaces, builds: buildsRepo, turns: turnsRepo }),
      turns: createTurnService({ projects: projectsRepo, turns: turnsRepo, runner }),
      messages: createMessageService({ projects: projectsRepo, messages: messagesRepo }),
      builds,
      events,
      driver: { name: 'claude', probe: async () => ({ ok: true, version: '0.0.0' }) },
      preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
    };
    deps.users.ensureLocalUser();
  });

  afterEach(async () => {
    agent.release();
    for (const project of db.select().from(projectsTable).all()) await sessions.close(project.id);
    vi.restoreAllMocks();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  describe('projects', () => {
    it.each([
      ['a blank title', { title: '   ' }],
      ['a missing title', {}],
      ['a title that is not text', { title: 42 }],
      ['another avenue', { title: 'Cell division practice', avenue: 'topic' }],
    ])('rejects %s with 400 invalid_request and creates no project or workspace', async (_, body) => {
      const res = await request(app()).post('/api/projects').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(db.select().from(projectsTable).all()).toEqual([]);
      await expect(fs.readdir(join(dataDir, 'projects'))).rejects.toThrow();
    });

    it('creates a project with 201, and its workspace out/ holds exactly the SCORM starter', async () => {
      const projectId = await createProject();

      const out = join(workspaces.pathFor(projectId), 'out');
      const starterFiles = await filesUnder(STARTER);
      expect(starterFiles).toContain('imsmanifest.xml');
      expect(await filesUnder(out)).toEqual(starterFiles);
      for (const file of starterFiles) {
        expect(await fs.readFile(join(out, file), 'utf8'), file).toBe(await fs.readFile(join(STARTER, file), 'utf8'));
      }
    });
  });

  describe("an unknown id and another owner's id get the same 404", () => {
    let othersBuildId: string;

    beforeEach(async () => {
      db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
      await workspaces.create('not-mine');
      projectsRepo.create({ id: 'not-mine', ownerId: 'someone-else', title: 'Not yours', avenue: 'scorm' });
      const othersBuild = await builds.create('not-mine');
      expect(othersBuild.status).toBe('ready');
      othersBuildId = othersBuild.id;
    });

    const message = { content: [{ type: 'text', text: 'Create a practice set on cell division.' }] };

    it.each([
      ['GET /api/projects/:projectId', (id: string) => request(app()).get(`/api/projects/${id}`)],
      ['GET /api/projects/:projectId/messages', (id: string) => request(app()).get(`/api/projects/${id}/messages`)],
      ['POST /api/projects/:projectId/messages', (id: string) => request(app()).post(`/api/projects/${id}/messages`).send(message)],
    ])('%s', async (_, call) => {
      const unknown = await call('no-such-project');
      const notMine = await call('not-mine');

      for (const res of [unknown, notMine]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('not_found');
      }
      expect(notMine.body).toEqual(unknown.body);
      expect(db.select().from(messagesTable).all()).toEqual([]);
    });

    it.each([
      ['GET /api/builds/:buildId', (id: string) => request(app()).get(`/api/builds/${id}`)],
      ['GET /api/builds/:buildId/download', (id: string) => request(app()).get(`/api/builds/${id}/download`)],
    ])('%s, even for a ready build', async (_, call) => {
      const unknown = await call('no-such-build');
      const notMine = await call(othersBuildId);

      for (const res of [unknown, notMine]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('build_not_found');
      }
      expect(notMine.body).toEqual(unknown.body);
    });
  });

  describe('messages', () => {
    it("rejects a second message during a running turn with 409 turn_active and the running turn's id, storing nothing", async () => {
      const projectId = await createProject();
      const first = await request(app())
        .post(`/api/projects/${projectId}/messages`)
        .send({ content: [{ type: 'text', text: '[hold] Create a practice set on cell division.' }] });
      expect(first.status).toBe(202);
      await waitForTurn(projectId, first.body.turn.id, (status) => status === 'running');

      const second = await request(app())
        .post(`/api/projects/${projectId}/messages`)
        .send({ content: [{ type: 'text', text: 'Make it shorter.' }] });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('turn_active');
      expect(second.body.error.details).toEqual({ turnId: first.body.turn.id });
      expect(await listMessages(projectId)).toHaveLength(1);

      agent.release();
      expect((await waitForTurn(projectId, first.body.turn.id, (status) => status === 'completed')).status).toBe('completed');
      expect((await runTurn(projectId, 'Make it shorter.')).status).toBe('completed');
    });

    it('fails the turn with workspace_missing, not 500 or internal_error, when the workspace folder is gone, and does not recreate it', async () => {
      const projectId = await createProject();
      const workspaceDir = workspaces.pathFor(projectId);
      await fs.rm(workspaceDir, { recursive: true, force: true });

      const turn = await runTurn(projectId, 'Create a practice set on cell division.');

      expect(turn).toMatchObject({ status: 'failed', error: WORKSPACE_MISSING_ERROR });
      const failed = events.after(projectId, 0).find((event) => event.kind === 'turn.failed');
      expect(failed?.payload).toEqual({ turnId: turn.id, error: WORKSPACE_MISSING_ERROR });
      await expect(fs.access(workspaceDir)).rejects.toThrow();
      expect(await latestBuild(projectId)).toBeUndefined();
      expect(logRecords).toContainEqual(expect.objectContaining({ msg: 'Turn failed', turnId: turn.id, code: 'workspace_missing' }));
    });

    it("lists messages oldest first, each instructor message carrying its turn's status and error, paging with nextCursor", async () => {
      const projectId = await createProject();
      const completed = await runTurn(projectId, 'Create a practice set on cell division.');
      const qaFailed = await runTurn(projectId, '[qa-fail] Add a timer.');
      await fs.rm(workspaces.pathFor(projectId), { recursive: true, force: true });
      const failed = await runTurn(projectId, 'Add hints.');

      const pages: ChatMessage[][] = [];
      let cursor: string | undefined;
      do {
        const res = await request(app())
          .get(`/api/projects/${projectId}/messages`)
          .query({ limit: 2, ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        pages.push(res.body.items);
        cursor = res.body.nextCursor;
      } while (cursor);

      expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
      const items = pages.flat();
      expect(items.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(items.map((message) => message.role)).toEqual(['instructor', 'agent', 'instructor', 'agent', 'instructor']);
      expect(items.filter((message) => message.role === 'instructor').map((message) => message.turn)).toEqual([
        { id: completed.id, status: 'completed', error: null },
        { id: qaFailed.id, status: 'completed', error: null },
        { id: failed.id, status: 'failed', error: WORKSPACE_MISSING_ERROR },
      ]);
      for (const reply of items.filter((message) => message.role === 'agent')) {
        expect(reply).not.toHaveProperty('turn');
      }
    });

    it.each([
      ['limit', '0'],
      ['limit', '201'],
      ['limit', 'abc'],
      ['limit', '1.5'],
      ['cursor', '-1'],
      ['cursor', 'abc'],
      ['cursor', '1.5'],
    ])('rejects %s=%s with 400 invalid_request', async (name, value) => {
      const projectId = await createProject();

      const res = await request(app()).get(`/api/projects/${projectId}/messages`).query({ [name]: value });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    });
  });

  describe('builds', () => {
    it('refuses to download a build the QA gate failed, with 409 build_failed', async () => {
      const projectId = await createProject();
      await runTurn(projectId, '[qa-fail] Create a practice set on cell division.');
      const build = await latestBuild(projectId);
      expect(build.status).toBe('failed');

      const res = await request(app()).get(`/api/builds/${build.id}/download`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('build_failed');
      expect(res.body.error.nextStep).toBe('ask_for_fix');
    });

    it('downloads a ready build as a zip with imsmanifest.xml at its root and every file the manifest declares', async () => {
      const projectId = await createProject();
      await runTurn(projectId, 'Create a practice set on cell division.');
      const build = await latestBuild(projectId);
      expect(build.status).toBe('ready');

      const res = await download(build.id);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      const zip = await fromBufferPromise(res.body as Buffer, { lazyEntries: true, autoClose: false });
      const contents = new Map<string, string>();
      for await (const entry of zip.eachEntry()) {
        if (!entry.fileName.endsWith('/')) contents.set(entry.fileName, await text(await zip.openReadStreamPromise(entry)));
      }
      zip.close();

      const manifest = contents.get('imsmanifest.xml');
      expect(manifest).toContain('<manifest');
      const declared = [...manifest!.matchAll(/<file\s+href="([^"]+)"/g)].map((match) => match[1]!);
      expect(declared.length).toBeGreaterThan(0);
      for (const file of declared) expect(contents.has(file), file).toBe(true);
      expect(contents.get('notes.txt')).toBe('Create a practice set on cell division.');
      expect(contents.has('qa.json')).toBe(false);
    });
  });
});
