import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentEvent, AgentSession, TurnResult } from '../agent/AgentDriver.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createMessagesRepo, type MessagesRepo } from '../db/messages.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { turns as turnsTable } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import { createBuildService } from '../services/builds.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';
import { createEventService, type EventService } from './events.js';
import { createRunner, type Runner } from './runner.js';
import { createSessionService, type SessionService } from './sessions.js';

/** A driver whose agent writes the request into out/notes.txt and replies "Done." */
function writingDriver(): Pick<AgentDriver, 'open'> {
  return {
    async open(req) {
      let sessionId = req.sessionId;
      const session: AgentSession = {
        get sessionId() {
          return sessionId;
        },
        send(input) {
          let resolveResult!: (result: TurnResult) => void;
          const result = new Promise<TurnResult>((resolve) => {
            resolveResult = resolve;
          });
          const notes = join(req.workspaceDir, 'out', 'notes.txt');
          const events = (async function* (): AsyncGenerator<AgentEvent> {
            yield { kind: 'tool_start', callId: 'call-1', name: 'Write', input: { file_path: notes }, summary: 'Writing notes.txt' };
            await fs.writeFile(notes, input.text);
            yield { kind: 'tool_end', callId: 'call-1', ok: true };
            yield { kind: 'text_delta', text: 'Done.' };
            sessionId = 'agent-session-1';
            resolveResult({ status: 'completed', sessionId, text: 'Done.', usage: { steps: 2 } });
          })();
          return { events, result };
        },
        async close() {},
      };
      return session;
    },
  };
}

describe('runner, end to end', () => {
  let dataDir: string;
  let db: Db;
  let projects: ProjectsRepo;
  let messages: MessagesRepo;
  let events: EventService;
  let workspaces: WorkspaceService;
  let sessions: SessionService;
  let runner: Runner;
  let projectId: string;

  function queueTurn(turnId: string, status: 'queued' | 'running' = 'queued'): void {
    const messageId = `message-${turnId}`;
    messages.create({
      id: messageId,
      projectId,
      role: 'instructor',
      content: [{ type: 'text', text: `Request for ${turnId}` }],
      turnId,
    });
    db.insert(turnsTable).values({ id: turnId, projectId, messageId, status }).run();
  }

  function turnRow(turnId: string) {
    return db.select().from(turnsTable).all().find((turn) => turn.id === turnId)!;
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-runner-'));
    db = testDb();
    projects = createProjectsRepo(db);
    messages = createMessagesRepo(db);
    events = createEventService(createEventsRepo(db));
    workspaces = createWorkspaceService({ dataDir });
    sessions = createSessionService({ projects, workspaces, driver: writingDriver() });
    const builds = createBuildService({ builds: createBuildsRepo(db), projects, workspaces, events });
    runner = createRunner({ turns: createTurnsRepo(db), messages, events, sessions, workspaces, builds });

    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    projectId = projects.create({ ownerId, title: 'Cell division practice', avenue: 'scorm' }).id;
    await workspaces.create(projectId);
  });

  afterEach(async () => {
    await sessions.close(projectId);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('stores the progress, reply, build, and session id of a turn that changed the output', async () => {
    queueTurn('turn-1');

    await runner.executeTurn('turn-1');

    const stored = events.after(projectId, 0);
    expect(stored.map((event) => event.kind)).toEqual([
      'turn.started',
      'tool.started',
      'tool.finished',
      'message.delta',
      'message.completed',
      'turn.status',
      'build.created',
      'build.updated',
      'turn.completed',
    ]);
    const turn = turnRow('turn-1');
    expect(turn).toMatchObject({ status: 'completed', usage: { steps: 2 } });
    expect(messages.get(turn.replyId!)?.content).toEqual([{ type: 'text', text: 'Done.' }]);

    const build = (stored.at(-2)!.payload as { build: { turnId: string; outputHash: string } }).build;
    expect(build.turnId).toBe('turn-1');
    expect(build.outputHash).toBe(await workspaces.hashOutput(projectId));
    expect(projects.getById(projectId)?.sessionId).toBe('agent-session-1');
  });

  it('fails interrupted turns on startup, keeping their messages and output, then runs the next turn', async () => {
    queueTurn('queued');
    queueTurn('running', 'running');
    const leftover = join(workspaces.pathFor(projectId), 'out', 'leftover.txt');
    await fs.writeFile(leftover, 'written before the app closed');

    runner.failInterrupted();

    for (const turnId of ['queued', 'running']) {
      expect(turnRow(turnId)).toMatchObject({ status: 'failed', error: { code: 'interrupted' } });
      expect(turnRow(turnId).finishedAt).toBeTypeOf('number');
      expect(messages.get(`message-${turnId}`)).toBeDefined();
    }
    expect(events.after(projectId, 0).map((event) => event.kind)).toEqual(['turn.failed', 'turn.failed']);
    expect(await fs.readFile(leftover, 'utf8')).toBe('written before the app closed');

    queueTurn('next');
    await runner.executeTurn('next');

    expect(turnRow('next').status).toBe('completed');
    const active = db
      .select()
      .from(turnsTable)
      .where(inArray(turnsTable.status, ['queued', 'running']))
      .all();
    expect(active).toEqual([]);
  });
});
