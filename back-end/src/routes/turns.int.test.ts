import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage } from '@cdk/contract';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDriver, AgentEvent, TurnResult } from '../agent/AgentDriver.js';
import { createApp } from '../app.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import type { Db } from '../db/index.js';
import { createMessagesRepo } from '../db/messages.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { turns as turnsTable, users as usersTable } from '../db/schema.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo, type TurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import type { Deps } from '../deps.js';
import { createEventService, type EventService } from '../pipeline/events.js';
import { createRunner } from '../pipeline/runner.js';
import { createSessionService, type SessionService } from '../pipeline/sessions.js';
import { createBuildService } from '../services/builds.js';
import { createMessageService } from '../services/messages.js';
import { createProjectService } from '../services/projects.js';
import { createTurnService } from '../services/turns.js';
import { createWorkspaceService } from '../services/workspaces.js';

/** An agent that writes the request into out/draft.txt, then works until cancelled. */
function stoppableAgent(): Pick<AgentDriver, 'open'> {
  return {
    async open(req) {
      return {
        sessionId: null,
        send(input, _limits, signal) {
          let resolveResult!: (result: TurnResult) => void;
          const result = new Promise<TurnResult>((resolve) => {
            resolveResult = resolve;
          });
          const events = (async function* (): AsyncGenerator<AgentEvent> {
            yield { kind: 'tool_start', callId: 'call-1', name: 'Write', summary: 'Writing draft.txt', category: 'writing' as const };
            await fs.writeFile(join(req.workspaceDir, 'out', 'draft.txt'), input.text);
            if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
            resolveResult({ status: 'cancelled', sessionId: null, text: '' });
          })();
          return { events, result };
        },
        async close() {},
      };
    },
  };
}

const MESSAGE = { content: [{ type: 'text', text: 'Write a draft of the practice set.' }] };

describe('POST /api/turns/:turnId/cancel', () => {
  let dataDir: string;
  let db: Db;
  let projectsRepo: ProjectsRepo;
  let turnsRepo: TurnsRepo;
  let events: EventService;
  let sessions: SessionService;
  let deps: Deps;

  function app() {
    return createApp(deps);
  }

  function cancel(turnId: string) {
    return request(app()).post(`/api/turns/${turnId}/cancel`);
  }

  /** Creates a project and sends it a message, resolving once the agent is working on it. */
  async function startTurn(): Promise<{ projectId: string; turnId: string }> {
    const created = await request(app()).post('/api/projects').send({ title: 'Cell division practice' });
    const projectId: string = created.body.project.id;
    const sent = await request(app()).post(`/api/projects/${projectId}/messages`).send(MESSAGE);
    expect(sent.status).toBe(202);
    await vi.waitFor(() => expect(events.after(projectId, 0).map((event) => event.kind)).toContain('tool.started'));
    return { projectId, turnId: sent.body.turn.id };
  }

  /** The status the message list reports for `turnId`. */
  async function listedStatus(projectId: string, turnId: string) {
    const res = await request(app()).get(`/api/projects/${projectId}/messages`);
    return (res.body.items as ChatMessage[]).find((message) => message.turn?.id === turnId)?.turn?.status;
  }

  async function untilCancelled(projectId: string, turnId: string): Promise<void> {
    await vi.waitFor(async () => expect(await listedStatus(projectId, turnId)).toBe('cancelled'), { timeout: 5_000, interval: 20 });
  }

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-cancel-'));
    db = testDb();
    projectsRepo = createProjectsRepo(db);
    turnsRepo = createTurnsRepo(db);
    const buildsRepo = createBuildsRepo(db);
    const messagesRepo = createMessagesRepo(db);
    events = createEventService(createEventsRepo(db));
    const workspaces = createWorkspaceService({ dataDir });
    const builds = createBuildService({ builds: buildsRepo, projects: projectsRepo, workspaces, events });
    sessions = createSessionService({ projects: projectsRepo, workspaces, driver: stoppableAgent(), tools: () => ({ name: 'cdk', tools: [] }) });
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
      driver: { name: 'claude', probe: async () => ({ ok: true }) },
      preview: { origin: 'http://preview.localhost:3000', appOrigin: 'http://127.0.0.1:5173' },
    };
    deps.users.ensureLocalUser();
  });

  afterEach(async () => {
    await sessions.closeAll();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('answers 202 at once, then the running turn ends cancelled with turn.cancelled, keeping its output, and the project takes a new message', async () => {
    const { projectId, turnId } = await startTurn();

    const res = await cancel(turnId);

    expect(res.status).toBe(202);
    expect(res.text).toBe('');
    await untilCancelled(projectId, turnId);
    expect(events.after(projectId, 0).at(-1)).toMatchObject({ kind: 'turn.cancelled', payload: { turnId } });
    const project = await request(app()).get(`/api/projects/${projectId}`);
    expect(project.body.activeTurn).toBeUndefined();
    expect(project.body.builds).toEqual([]);
    const workspaceDir = join(dataDir, 'projects', projectId, 'workspace');
    expect(await fs.readFile(join(workspaceDir, 'out', 'draft.txt'), 'utf8')).toBe(MESSAGE.content[0]!.text);
    const next = await request(app()).post(`/api/projects/${projectId}/messages`).send(MESSAGE);
    expect(next.status).toBe(202);
    expect((await cancel(next.body.turn.id)).status).toBe(202);
    await untilCancelled(projectId, next.body.turn.id);
  });

  it('answers 202 for a turn that has ended and leaves it as it is, so a second click is harmless', async () => {
    const { projectId, turnId } = await startTurn();
    await cancel(turnId);
    await untilCancelled(projectId, turnId);
    const completedId = 'completed-turn';
    db.insert(turnsTable).values({ id: completedId, projectId, messageId: 'message-completed', status: 'completed' }).run();
    const stored = events.after(projectId, 0);

    for (const id of [turnId, completedId]) expect((await cancel(id)).status).toBe(202);

    expect(turnsRepo.get(turnId)?.status).toBe('cancelled');
    expect(turnsRepo.get(completedId)?.status).toBe('completed');
    expect(events.after(projectId, 0)).toEqual(stored);
  });

  it("answers an unknown turn and another instructor's turn with the same 404 turn_not_found, cancelling nothing", async () => {
    db.insert(usersTable).values({ id: 'someone-else', displayName: 'Someone Else', email: null, role: 'instructor' }).run();
    projectsRepo.create({ id: 'not-mine', ownerId: 'someone-else', title: 'Not yours', avenue: 'scorm' });
    db.insert(turnsTable).values({ id: 'their-turn', projectId: 'not-mine', messageId: 'message-theirs', status: 'queued' }).run();

    const unknown = await cancel('no-such-turn');
    const notMine = await cancel('their-turn');

    for (const res of [unknown, notMine]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual({ code: 'turn_not_found', message: "This request doesn't exist.", nextStep: 'send_again' });
    }
    expect(notMine.body).toEqual(unknown.body);
    expect(turnsRepo.get('their-turn')?.status).toBe('queued');
  });
});
