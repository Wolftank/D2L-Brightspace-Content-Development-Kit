import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentSession, TurnResult } from '../agent/AgentDriver.js';
import type { CreateMessageInput } from '../db/messages.js';
import type { Build, Event, Message, Turn } from '../db/schema.js';
import type { FinishTurnInput } from '../db/turns.js';
import { WorkspaceMissing } from '../errors.js';
import type { AppendEventInput } from './events.js';
import { createRunner, type RunnerDeps } from './runner.js';

const INSTRUCTOR_MESSAGE: Message = {
  id: 'message-1',
  projectId: 'project-1',
  seq: 1,
  role: 'instructor',
  content: [{ type: 'text', text: 'Build a self-check on mitosis' }],
  turnId: 'turn-1',
  createdAt: 1,
};

const COMPLETED: TurnResult = {
  status: 'completed',
  sessionId: 'session-1',
  text: 'Built a five-question self-check.',
  usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.5, steps: 3 },
};

function queuedTurn(id: string): Turn {
  return {
    id,
    projectId: 'project-1',
    messageId: INSTRUCTOR_MESSAGE.id,
    replyId: null,
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    error: null,
    usage: null,
  };
}

function scriptedSession(events: AgentEvent[], result: TurnResult | Promise<TurnResult>) {
  const signals: AbortSignal[] = [];
  const session = {
    sessionId: null,
    send: vi.fn((_input, _limits, signal: AbortSignal) => {
      signals.push(signal);
      return {
        events: (async function* () {
          yield* events;
        })(),
        result: Promise.resolve(result),
      };
    }),
    close: vi.fn(async () => {}),
  } satisfies AgentSession;
  return { session, signals };
}

function setup(options: { session?: AgentSession; hashes?: string[] } = {}) {
  const turns = new Map([['turn-1', queuedTurn('turn-1')]]);
  const appended: AppendEventInput[] = [];
  const replies: CreateMessageInput[] = [];
  const finished: Array<{ id: string; input: FinishTurnInput }> = [];
  const hashes = [...(options.hashes ?? ['before', 'after'])];
  const session = options.session ?? scriptedSession([], COMPLETED).session;

  const deps = {
    turns: {
      start: vi.fn((id: string) => {
        const turn = turns.get(id);
        if (!turn || turn.status !== 'queued') return undefined;
        const running = { ...turn, status: 'running' as const, startedAt: 2 };
        turns.set(id, running);
        return running;
      }),
      finish: vi.fn((id: string, input: FinishTurnInput) => {
        finished.push({ id, input });
        return { ...turns.get(id)!, ...input };
      }),
      failActive: vi.fn((): Turn[] => []),
    },
    messages: {
      get: vi.fn((id: string) => (id === INSTRUCTOR_MESSAGE.id ? INSTRUCTOR_MESSAGE : undefined)),
      create: vi.fn((input: CreateMessageInput): Message => {
        replies.push(input);
        return { ...input, seq: 2, createdAt: 3 };
      }),
    },
    events: {
      append: vi.fn((input: AppendEventInput): Event => {
        appended.push(input);
        return { seq: appended.length, projectId: input.projectId, turnId: input.turnId ?? null, kind: input.kind, payload: input.payload, ts: 4 };
      }),
    },
    sessions: {
      acquire: vi.fn(async () => session),
      release: vi.fn(),
      close: vi.fn(async () => {}),
    },
    workspaces: {
      hashOutput: vi.fn(async () => hashes.shift() ?? 'after'),
    },
    builds: {
      latest: vi.fn((): Build | undefined => undefined),
      create: vi.fn(async (projectId: string, turnId?: string) => ({ projectId, turnId, status: 'ready' }) as Build),
    },
  } satisfies RunnerDeps;

  const kinds = () => appended.map((event) => event.kind);
  const payloadsOf = (kind: string) => appended.filter((event) => event.kind === kind).map((event) => event.payload);
  return { deps, runner: createRunner(deps), appended, replies, finished, kinds, payloadsOf };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runner', () => {
  it('streams progress, stores the reply, builds changed output, and completes the turn', async () => {
    const { session } = scriptedSession(
      [
        { kind: 'text_delta', text: 'Reading the guide. ' },
        { kind: 'tool_start', callId: 'call-1', name: 'Write', input: {}, summary: 'Writing index.html' },
        { kind: 'tool_end', callId: 'call-1', ok: true },
        { kind: 'notice', text: 'The agent was denied permission to use WebFetch.' },
      ],
      COMPLETED,
    );
    const { deps, runner, replies, finished, kinds, payloadsOf } = setup({ session });

    await runner.executeTurn('turn-1');

    expect(kinds()).toEqual([
      'turn.started',
      'message.delta',
      'tool.started',
      'tool.finished',
      'turn.status',
      'message.completed',
      'turn.status',
      'turn.completed',
    ]);
    expect(session.send).toHaveBeenCalledWith(
      { text: 'Build a self-check on mitosis', attachments: [] },
      {},
      expect.any(AbortSignal),
    );

    const replyId = replies[0]!.id;
    expect(payloadsOf('message.delta')).toEqual([{ turnId: 'turn-1', messageId: replyId, text: 'Reading the guide. ' }]);
    expect(payloadsOf('tool.started')).toEqual([{ turnId: 'turn-1', callId: 'call-1', name: 'Write', summary: 'Writing index.html' }]);
    expect(payloadsOf('tool.finished')).toEqual([{ turnId: 'turn-1', callId: 'call-1', ok: true, summary: 'Writing index.html' }]);
    expect(payloadsOf('turn.status')).toEqual([
      { turnId: 'turn-1', text: 'The agent was denied permission to use WebFetch.' },
      { turnId: 'turn-1', text: 'Checking your build' },
    ]);
    expect(replies[0]).toMatchObject({ role: 'agent', content: [{ type: 'text', text: COMPLETED.text }], turnId: 'turn-1' });

    expect(deps.builds.create).toHaveBeenCalledWith('project-1', 'turn-1');
    expect(finished).toEqual([{ id: 'turn-1', input: { status: 'completed', usage: COMPLETED.usage, replyId } }]);
    expect(payloadsOf('turn.completed')).toEqual([{ turnId: 'turn-1', usage: COMPLETED.usage }]);
    expect(deps.sessions.release).toHaveBeenCalledOnce();
    expect(deps.sessions.close).not.toHaveBeenCalled();
  });

  it('marks a failed tool call in its finished summary', async () => {
    const { session } = scriptedSession(
      [
        { kind: 'tool_start', callId: 'call-1', name: 'PowerShell', input: {}, summary: 'Run the QA check' },
        { kind: 'tool_end', callId: 'call-1', ok: false },
      ],
      COMPLETED,
    );
    const { runner, payloadsOf } = setup({ session });

    await runner.executeTurn('turn-1');

    expect(payloadsOf('tool.finished')).toEqual([
      { turnId: 'turn-1', callId: 'call-1', ok: false, summary: 'Failed: Run the QA check' },
    ]);
  });

  it('creates no build when the output is unchanged since the turn started', async () => {
    const { deps, runner, kinds } = setup({ hashes: ['same', 'same'] });

    await runner.executeTurn('turn-1');

    expect(deps.builds.create).not.toHaveBeenCalled();
    expect(kinds()).toEqual(['turn.started', 'message.completed', 'turn.completed']);
  });

  it.each([
    ['builds output an earlier turn left unbuilt', 'latest-build', ['same', 'same'], true],
    ['skips output that matches the latest build', 'after', ['before', 'after'], false],
  ])('once the project has a build, compares with it: %s', async (_case, latestHash, hashes, builds) => {
    const { deps, runner } = setup({ hashes });
    deps.builds.latest.mockReturnValue({ outputHash: latestHash } as Build);

    await runner.executeTurn('turn-1');

    expect(deps.builds.create).toHaveBeenCalledTimes(builds ? 1 : 0);
  });

  it('completes the turn when its build fails QA', async () => {
    const { deps, runner, finished, kinds } = setup();
    deps.builds.create.mockResolvedValue({ status: 'failed', error: { code: 'qa_failed', message: 'm' } } as Build);

    await runner.executeTurn('turn-1');

    expect(finished[0]!.input.status).toBe('completed');
    expect(kinds().at(-1)).toBe('turn.completed');
  });

  it('stores the streamed text as the reply when the final message is empty', async () => {
    const { session } = scriptedSession(
      [
        { kind: 'text_delta', text: 'Built it. ' },
        { kind: 'text_delta', text: 'The check passed.' },
      ],
      { ...COMPLETED, text: '' },
    );
    const { runner, replies } = setup({ session });

    await runner.executeTurn('turn-1');

    expect(replies[0]!.content).toEqual([{ type: 'text', text: 'Built it. The check passed.' }]);
  });

  it("fails the turn with a plain message and the driver's code when the agent fails, and closes the session", async () => {
    const { session } = scriptedSession([{ kind: 'text_delta', text: 'Working' }], {
      status: 'failed',
      sessionId: 'session-1',
      text: 'Working',
      error: { code: 'agent_busy', message: 'API Error: 429' },
      usage: { steps: 1 },
    });
    const { deps, runner, finished, kinds, payloadsOf } = setup({ session });

    await runner.executeTurn('turn-1');

    const error = { code: 'agent_busy', message: "The agent's account is busy or has reached its usage limit. Try again later." };
    expect(finished).toEqual([{ id: 'turn-1', input: { status: 'failed', error, usage: { steps: 1 } } }]);
    expect(kinds()).toEqual(['turn.started', 'message.delta', 'turn.failed']);
    expect(payloadsOf('turn.failed')).toEqual([{ turnId: 'turn-1', error }]);
    expect(deps.messages.create).not.toHaveBeenCalled();
    expect(deps.builds.create).not.toHaveBeenCalled();
    expect(deps.sessions.close).toHaveBeenCalledOnce();
    expect(deps.sessions.release).not.toHaveBeenCalled();
  });

  it('reports a cancelled agent result as a cancelled turn and closes the session', async () => {
    const { session } = scriptedSession([], { status: 'cancelled', sessionId: null, text: '' });
    const { deps, runner, finished, kinds } = setup({ session });

    await runner.executeTurn('turn-1');

    expect(finished[0]!.input.status).toBe('cancelled');
    expect(kinds()).toEqual(['turn.started', 'turn.cancelled']);
    expect(deps.sessions.close).toHaveBeenCalledOnce();
  });

  it('fails with workspace_missing before acquiring a session when the workspace is gone', async () => {
    const { deps, runner, finished, kinds } = setup();
    deps.workspaces.hashOutput.mockRejectedValue(new WorkspaceMissing());

    await runner.executeTurn('turn-1');

    expect(finished[0]!.input.error?.code).toBe('workspace_missing');
    expect(kinds()).toEqual(['turn.started', 'turn.failed']);
    expect(deps.sessions.acquire).not.toHaveBeenCalled();
  });

  it('keeps workspace_missing, the usage, and the reply when the output disappears after the agent finishes', async () => {
    const { deps, runner, replies, finished } = setup();
    deps.workspaces.hashOutput.mockResolvedValueOnce('before').mockRejectedValueOnce(new WorkspaceMissing());

    await runner.executeTurn('turn-1');

    expect(finished[0]!.input).toMatchObject({
      status: 'failed',
      error: { code: 'workspace_missing' },
      usage: COMPLETED.usage,
      replyId: replies[0]!.id,
    });
  });

  it('fails without handing a session back when none could be acquired', async () => {
    const { deps, runner, finished } = setup();
    deps.sessions.acquire.mockRejectedValue(new Error('The session for project project-1 is busy'));

    await runner.executeTurn('turn-1');

    expect(finished[0]!.input.error?.code).toBe('internal_error');
    expect(deps.sessions.release).not.toHaveBeenCalled();
    expect(deps.sessions.close).not.toHaveBeenCalled();
  });

  it('closes the session when the agent cannot start', async () => {
    const { session } = scriptedSession([], COMPLETED);
    session.send.mockImplementation(() => {
      throw new Error('spawn claude ENOENT');
    });
    const { deps, runner, finished } = setup({ session });

    await runner.executeTurn('turn-1');

    expect(finished[0]!.input.error?.code).toBe('internal_error');
    expect(deps.sessions.close).toHaveBeenCalledOnce();
  });

  it('aborts the agent and fails once when progress cannot be reported', async () => {
    const { session, signals } = scriptedSession([{ kind: 'text_delta', text: 'Hi' }], new Promise<TurnResult>(() => {}));
    const { deps, runner, appended, kinds } = setup({ session });
    const append = deps.events.append.getMockImplementation()!;
    deps.events.append.mockImplementation((input) => {
      if (input.kind === 'message.delta') throw new Error('disk full');
      return append(input);
    });

    await runner.executeTurn('turn-1');

    expect(signals[0]!.aborted).toBe(true);
    expect(deps.sessions.close).toHaveBeenCalledOnce();
    expect(kinds()).toEqual(['turn.started', 'turn.failed']);
    expect(appended.at(-1)!.payload).toMatchObject({ error: { code: 'internal_error' } });
  });

  it('fails once and keeps the reply when the build step throws', async () => {
    const { deps, runner, replies, finished, kinds } = setup();
    deps.builds.create.mockRejectedValue(new Error('EPERM'));

    await runner.executeTurn('turn-1');

    expect(kinds()).toEqual(['turn.started', 'message.completed', 'turn.status', 'turn.failed']);
    expect(finished).toEqual([
      {
        id: 'turn-1',
        input: {
          status: 'failed',
          error: expect.objectContaining({ code: 'internal_error' }),
          usage: COMPLETED.usage,
          replyId: replies[0]!.id,
        },
      },
    ]);
  });

  it('does nothing for a turn that is not queued', async () => {
    const { deps, runner, appended } = setup();
    await runner.executeTurn('turn-1');
    appended.length = 0;

    await runner.executeTurn('turn-1');

    expect(appended).toEqual([]);
    expect(deps.sessions.acquire).toHaveBeenCalledOnce();
  });

  it('resolves even when the outcome cannot be stored', async () => {
    const { deps, runner } = setup();
    deps.turns.finish.mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(runner.executeTurn('turn-1')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('fails every interrupted turn with code interrupted', () => {
    const { deps, runner, appended } = setup();
    const running = { ...queuedTurn('turn-2'), status: 'running' as const };
    deps.turns.failActive.mockReturnValue([queuedTurn('turn-1'), running]);

    runner.failInterrupted();

    const error = {
      code: 'interrupted',
      message: 'The app closed before this request finished. Changes already made are kept; send the request again.',
    };
    expect(deps.turns.failActive).toHaveBeenCalledWith(error);
    expect(appended).toEqual([
      { projectId: 'project-1', turnId: 'turn-1', kind: 'turn.failed', payload: { turnId: 'turn-1', error } },
      { projectId: 'project-1', turnId: 'turn-2', kind: 'turn.failed', payload: { turnId: 'turn-2', error } },
    ]);
  });
});
