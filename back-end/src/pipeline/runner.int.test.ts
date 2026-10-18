import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentEvent, AgentSession, TurnErrorCode, TurnLimits, TurnResult } from '../agent/AgentDriver.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createMessagesRepo, type MessagesRepo } from '../db/messages.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { turns as turnsTable } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import { createMessageService } from '../services/messages.js';
import { createBuildService } from '../services/builds.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';
import { createEventService, type EventService } from './events.js';
import { createRunner, type Runner } from './runner.js';
import { createSessionService, type SessionService } from './sessions.js';
import { captureLog } from '../test/log.js';
import type { Build as ApiBuild } from '@cdk/contract';

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
            if (input.text.includes('multi-message')) {
              yield { kind: 'message_start' };
              yield { kind: 'text_delta', text: 'I will write the notes.' };
            }
            yield { kind: 'tool_start', callId: 'call-1', name: 'Write', summary: 'Writing notes.txt', category: 'writing' as const };
            await fs.writeFile(notes, input.text);
            yield { kind: 'tool_end', callId: 'call-1', ok: true };
            yield { kind: 'message_start' };
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

const STEP_COST_USD = 1;

/**
 * A driver whose agent takes the number of steps its request asks for, such
 * as "Take 3 steps", at `STEP_COST_USD` a step, and stops at the turn's
 * limits the way the SDK does: before a step past `maxSteps`, and after the
 * step whose cost passes `maxBudgetUsd`.
 */
function steppingDriver(): Pick<AgentDriver, 'open'> {
  return {
    async open(req) {
      const session: AgentSession = {
        sessionId: req.sessionId,
        send(input, limits) {
          const wanted = Number(/Take (\d+) steps?/.exec(input.text)?.[1] ?? 1);
          let resolveResult!: (result: TurnResult) => void;
          const result = new Promise<TurnResult>((resolve) => {
            resolveResult = resolve;
          });
          const stopped = (code: TurnErrorCode, steps: number): TurnResult => ({
            status: 'failed',
            sessionId: null,
            text: '',
            error: { code, message: `The SDK stopped the turn after ${steps} steps` },
            usage: { steps, costUsd: steps * STEP_COST_USD },
          });
          const events = (async function* (): AsyncGenerator<AgentEvent> {
            let steps = 0;
            while (steps < wanted) {
              if (steps === limits.maxSteps) {
                resolveResult(stopped('max_steps_exceeded', steps));
                return;
              }
              steps++;
              yield { kind: 'status', text: `Step ${steps}`, category: 'other' as const };
              if (limits.maxBudgetUsd !== undefined && steps * STEP_COST_USD > limits.maxBudgetUsd) {
                resolveResult(stopped('max_budget_exceeded', steps));
                return;
              }
            }
            yield { kind: 'text_delta', text: 'Done.' };
            resolveResult({ status: 'completed', sessionId: null, text: 'Done.', usage: { steps, costUsd: steps * STEP_COST_USD } });
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

  function queueTurn(turnId: string, status: 'queued' | 'running' = 'queued', text = `Request for ${turnId}`): void {
    const messageId = `message-${turnId}`;
    messages.create({
      id: messageId,
      projectId,
      role: 'instructor',
      content: [{ type: 'text', text }],
      turnId,
    });
    db.insert(turnsTable).values({ id: turnId, projectId, messageId, status }).run();
  }

  function turnRow(turnId: string) {
    return db.select().from(turnsTable).all().find((turn) => turn.id === turnId)!;
  }

  /** Runs turns with `driver`'s agent, capped by `turnLimits`. */
  function useAgent(driver: Pick<AgentDriver, 'open'>, turnLimits: TurnLimits): void {
    sessions = createSessionService({ projects, workspaces, driver, tools: () => ({ name: 'cdk', tools: [] }) });
    const builds = createBuildService({ builds: createBuildsRepo(db), projects, workspaces, events });
    runner = createRunner({ turns: createTurnsRepo(db), messages, events, sessions, workspaces, builds, turnLimits });
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-runner-'));
    db = testDb();
    projects = createProjectsRepo(db);
    messages = createMessagesRepo(db);
    events = createEventService(createEventsRepo(db));
    workspaces = createWorkspaceService({ dataDir });
    useAgent(writingDriver(), { maxSteps: 60, maxBudgetUsd: 10 });

    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    projectId = projects.create({ id: 'project-1', ownerId, title: 'Cell division practice', avenue: 'scorm' }).id;
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

        const build = (stored.at(-2)!.payload as { build: ApiBuild }).build;
    expect(build.turnId).toBe('turn-1');
    expect(build.outputHash).toBe(await workspaces.hashOutput(projectId));
    expect(build.qa).toMatchObject({ passed: expect.any(Boolean), findings: expect.any(Array) });
    expect(createBuildsRepo(db).listByProject(projectId)).toHaveLength(1);
    expect(projects.getById(projectId)?.sessionId).toBe('agent-session-1');
  });


  it('creates no build for a turn that leaves the output unchanged', async () => {
    useAgent(steppingDriver(), { maxSteps: 60, maxBudgetUsd: 10 });
    queueTurn('reply-only', 'queued', 'Take 1 step');

    await runner.executeTurn('reply-only');

    expect(turnRow('reply-only').status).toBe('completed');
    expect(createBuildsRepo(db).listByProject(projectId)).toEqual([]);
    expect(events.after(projectId, 0).map((event) => event.kind)).not.toContain('build.created');
  });

  it('stores separate ordered replies around tool calls for history and event replay', async () => {
    queueTurn('multi-message');
    await runner.executeTurn('multi-message');
    const stored = events.after(projectId, 0);
    const deltas = stored.filter(event => event.kind === 'message.delta').map(event => event.payload as { messageId: string; text: string });
    const completed = stored.filter(event => event.kind === 'message.completed').map(event => (event.payload as { message: { id: string; seq: number } }).message);
    expect(deltas.map(delta => delta.text)).toEqual(['I will write the notes.', 'Done.']);
    expect(completed.map(message => message.id)).toEqual(deltas.map(delta => delta.messageId));
    expect(completed.map(message => message.seq)).toEqual([2, 3]);
    const reopened = createMessagesRepo(db);
    expect(completed.map(message => reopened.get(message.id)?.content)).toEqual([
      [{ type: 'text', text: 'I will write the notes.' }], [{ type: 'text', text: 'Done.' }],
    ]);
    expect(turnRow('multi-message').replyId).toBe(completed[1]!.id);
    const history = createMessageService({ projects, messages: reopened });
    const ownerId = projects.getById(projectId)!.ownerId;
    const firstPage = history.list(ownerId, projectId, { limit: 2 });
    expect(firstPage.items.map(message => message.role)).toEqual(['instructor', 'agent']);
    expect(firstPage.items[0]!.turn?.status).toBe('completed');
    const nextPage = history.list(ownerId, projectId, { limit: 2, cursor: Number(firstPage.nextCursor) });
    expect(nextPage.items.map(message => message.id)).toEqual([completed[1]!.id]);
    expect(nextPage.nextCursor).toBeUndefined();
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

  it.each([
    ['step', { maxSteps: 3, maxBudgetUsd: 10 }, 'max_steps_exceeded', 'The request needed more steps than allowed.'],
    ['spending', { maxSteps: 60, maxBudgetUsd: 2.5 }, 'max_budget_exceeded', 'The request reached its spending limit.'],
  ] as const)('ends a turn at its %s limit with the plain message and a smaller request as the next step, then runs the next request', async (_limit, turnLimits, code, message) => {
    useAgent(steppingDriver(), turnLimits);
    queueTurn('too-big', 'queued', 'Take 5 steps');

    await runner.executeTurn('too-big');

    const error = { code, message, nextStep: 'smaller_request' };
    expect(turnRow('too-big')).toMatchObject({ status: 'failed', error });
    expect(events.after(projectId, 0).at(-1)).toMatchObject({ kind: 'turn.failed', payload: { error } });

    queueTurn('smaller', 'queued', 'Take 2 steps');
    await runner.executeTurn('smaller');

    expect(turnRow('smaller')).toMatchObject({ status: 'completed', usage: { steps: 2 } });
  });

  describe('its log', () => {
    const REQUEST = 'Create a practice set on cell division for my biology students.';

    /** A driver whose agent ends every turn with `result` and no events. */
    function endingDriver(result: TurnResult): Pick<AgentDriver, 'open'> {
      return {
        async open(req) {
          return {
            sessionId: req.sessionId,
            send: () => ({ events: (async function* (): AsyncGenerator<AgentEvent> {})(), result: Promise.resolve(result) }),
            async close() {},
          };
        },
      };
    }

    it("logs a completed turn and its build under the project's and turn's IDs, with message text only at debug", async () => {
      const info = captureLog('info');
      const debug = captureLog('debug');
      queueTurn('turn-1', 'queued', REQUEST);

      await runner.executeTurn('turn-1');

      const ids = { projectId, turnId: 'turn-1' };
      expect(info.map(({ msg }) => msg)).toEqual(['Turn started', 'Build created', 'Build checked', 'Turn completed']);
      expect(info).toEqual([
        expect.objectContaining({ ...ids, level: 30, msg: 'Turn started' }),
        expect.objectContaining({ ...ids, buildId: expect.any(String), version: 1, msg: 'Build created' }),
        expect.objectContaining({ ...ids, buildId: expect.any(String), status: expect.any(String), qaPassed: expect.any(Boolean), msg: 'Build checked' }),
        expect.objectContaining({ ...ids, usage: { steps: 2 }, msg: 'Turn completed' }),
      ]);
      expect(JSON.stringify(info)).not.toContain(REQUEST);
      expect(JSON.stringify(info)).not.toContain('Done.');
      expect(debug).toContainEqual(expect.objectContaining({ ...ids, level: 20, msg: 'Instructor message', text: REQUEST }));
      expect(debug).toContainEqual(expect.objectContaining({ ...ids, level: 20, msg: 'Agent reply', text: 'Done.' }));
    });

    it('logs a failed turn with its code and the technical detail the instructor does not see', async () => {
      const records = captureLog('info');
      useAgent(steppingDriver(), { maxSteps: 2, maxBudgetUsd: 10 });
      queueTurn('limited', 'queued', 'Take 3 steps');

      await runner.executeTurn('limited');

      expect(records).toContainEqual(
        expect.objectContaining({
          level: 50,
          msg: 'Turn failed',
          projectId,
          turnId: 'limited',
          code: 'max_steps_exceeded',
          err: 'The SDK stopped the turn after 2 steps',
        }),
      );
    });

    it('logs a cancelled turn', async () => {
      const records = captureLog('info');
      useAgent(endingDriver({ status: 'cancelled', sessionId: null, text: '', usage: { steps: 1 } }), { maxSteps: 60, maxBudgetUsd: 10 });
      queueTurn('stopped');

      await runner.executeTurn('stopped');

      expect(records.map(({ msg }) => msg)).toEqual(['Turn started', 'Turn cancelled']);
      expect(records.at(-1)).toMatchObject({ projectId, turnId: 'stopped', usage: { steps: 1 } });
    });

    it('logs each turn failed at startup because the back end stopped while it ran', () => {
      const records = captureLog('info');
      queueTurn('running', 'running');

      runner.failInterrupted();

      expect(records).toEqual([expect.objectContaining({ level: 40, projectId, turnId: 'running', code: 'interrupted' })]);
    });
  });
});
