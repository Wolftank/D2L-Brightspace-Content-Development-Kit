import { randomUUID } from 'node:crypto';
import type { EventKind, EventPayloads, ProgressCategory } from '@cdk/contract';
import type { AgentEvent, AgentSession, TurnErrorCode, TurnInput, TurnLimits, TurnResult } from '../agent/AgentDriver.js';
import type { MessagesRepo } from '../db/messages.js';
import type { Turn } from '../db/schema.js';
import type { FinishedTurnDetails, FinishTurnInput, RunningTurn, TurnsRepo } from '../db/turns.js';
import { WorkspaceMissing } from '../errors.js';
import type { BuildService } from '../services/builds.js';
import type { WorkspaceService } from '../services/workspaces.js';
import type { EventService } from './events.js';
import type { SessionService } from './sessions.js';

type RunnerErrorCode = TurnErrorCode | 'workspace_missing' | 'interrupted' | 'internal_error';

/** What the instructor reads when a turn fails, by error code. */
const ERROR_MESSAGES: Record<RunnerErrorCode, string> = {
  agent_error: 'The agent stopped with an error before it finished. Send the request again.',
  agent_signed_out: "The agent isn't signed in, or its account can't be used. Sign in to the agent, then send the request again.",
  agent_billing: "The agent's account has a billing or account problem. Check the account, then send the request again.",
  agent_busy: "The agent's account is busy or has reached its usage limit. Try again later.",
  agent_unrestricted: "The agent started with tools or skills CDK doesn't allow, so the request was stopped before it ran.",
  max_steps_exceeded: 'The request needed more steps than allowed. Try a smaller request.',
  max_budget_exceeded: 'The request reached its spending limit. Try a smaller request.',
  no_result: 'The agent stopped unexpectedly before it finished. Send the request again.',
  driver_error: 'The agent stopped unexpectedly before it finished. Send the request again.',
  workspace_missing: "This project's files are missing, so the request could not run.",
  interrupted: 'The app closed before this request finished. Changes already made are kept; send the request again.',
  internal_error: 'Something went wrong while running this request. Send it again.',
};

export interface RunnerDeps {
  turns: Pick<TurnsRepo, 'start' | 'finish' | 'failActive'>;
  messages: Pick<MessagesRepo, 'get' | 'create'>;
  events: Pick<EventService, 'append'>;
  sessions: SessionService;
  workspaces: Pick<WorkspaceService, 'hashOutput'>;
  builds: Pick<BuildService, 'create' | 'latest'>;
  /** The caps on every turn. */
  turnLimits: TurnLimits;
}

/** Runs instructor requests through the agent, one turn at a time per project. */
export interface Runner {
  /**
   * Runs a `queued` turn to one final status and one final event, and does
   * nothing for any other turn. Never rejects: failures are stored on the
   * turn and reported through the event stream.
   */
  executeTurn(turnId: string): Promise<void>;
  /** Fails every `queued` or `running` turn with code `interrupted`. Call once at startup, after the back end holds its port and before it handles a request. */
  failInterrupted(): void;
}

/** The code for an error thrown while running a turn. */
function thrownCode(err: unknown): RunnerErrorCode {
  return err instanceof WorkspaceMissing ? 'workspace_missing' : 'internal_error';
}

interface StatusFeed {
  replyStarted(): void;
  status(text: string, category: ProgressCategory): void;
  toolStarted(callId: string, name: string, summary: string, category: Exclude<ProgressCategory, 'thinking'>): void;
  toolFinished(callId: string, ok: boolean): void;
  /** Finishes every started call that has no `tool.finished` with `ok: false`. */
  failUnfinished(): void;
}

interface StreamedReply {
  id: string;
  text: string;
}

interface Conversation {
  result: TurnResult;
  replies: StreamedReply[];
}

export function createRunner(deps: RunnerDeps): Runner {
  function append<K extends EventKind>(turn: Turn, kind: K, payload: EventPayloads[K]): void {
    deps.events.append({ projectId: turn.projectId, turnId: turn.id, kind, payload });
  }

  function failure(turn: Turn, code: RunnerErrorCode, detail: unknown, rest: FinishedTurnDetails = {}): FinishTurnInput {
    console.error(`Turn ${turn.id} failed (${code}):`, detail);
    return { ...rest, status: 'failed', error: { code, message: ERROR_MESSAGES[code] } };
  }

  function instructorInput(turn: Turn): TurnInput {
    const message = deps.messages.get(turn.messageId);
    if (!message) throw new Error(`Turn ${turn.id} has no instructor message ${turn.messageId}`);
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
    return { text, attachments: [] };
  }

  /**
   * The turn's status feed: its `turn.status`, `tool.started` and
   * `tool.finished` lines. A `turn.status` repeating the latest line is not
   * stored.
   */
  function statusFeed(turn: Turn): StatusFeed {
    const unfinishedCalls = new Map<string, { summary: string; category: Exclude<ProgressCategory, 'thinking'> }>();
    let latestLine: string | undefined;

    function line<K extends 'turn.status' | 'tool.started' | 'tool.finished'>(kind: K, payload: EventPayloads[K], text: string): void {
      append(turn, kind, payload);
      latestLine = text;
    }

    function toolFinished(callId: string, ok: boolean): void {
      const { summary, category } = unfinishedCalls.get(callId) ?? { summary: 'Using a tool', category: 'other' as const };
      unfinishedCalls.delete(callId);
      const text = ok ? summary : `Failed: ${summary}`;
      line('tool.finished', { turnId: turn.id, callId, ok, summary: text, category }, text);
    }

    return {
      replyStarted() { latestLine = undefined; },
      status(text, category) {
        if (text !== latestLine) line('turn.status', { turnId: turn.id, text, category }, text);
      },
      toolStarted(callId, name, summary, category) {
        unfinishedCalls.set(callId, { summary, category });
        line('tool.started', { turnId: turn.id, callId, name, summary, category }, summary);
      },
      toolFinished,
      failUnfinished() {
        for (const callId of [...unfinishedCalls.keys()]) toolFinished(callId, false);
      },
    };
  }

  function progress(turn: Turn, replyId: string, event: AgentEvent, feed: StatusFeed): void {
    switch (event.kind) {
      case 'message_start':
        return;
      case 'text_delta':
        feed.replyStarted();
        append(turn, 'message.delta', { turnId: turn.id, messageId: replyId, text: event.text });
        return;
      case 'tool_start':
        feed.toolStarted(event.callId, event.name, event.summary, event.category);
        return;
      case 'tool_end':
        feed.toolFinished(event.callId, event.ok);
        return;
      case 'status':
        feed.status(event.text, event.category);
        return;
      case 'notice':
        feed.status(event.text, 'other');
        return;
    }
  }

  /** Sends the request and reports the agent's progress, failing any tool call left unfinished when the agent's events end. On a thrown error the turn's agent work is aborted. */
  async function converse(turn: Turn, session: AgentSession, input: TurnInput, replyId: string, feed: StatusFeed): Promise<Conversation> {
    const controller = new AbortController();
    const replies: StreamedReply[] = [{ id: replyId, text: '' }];
    try {
      const agentTurn = session.send(input, deps.turnLimits, controller.signal);
      for await (const event of agentTurn.events) {
        if (event.kind === 'message_start' && replies.at(-1)!.text !== '') {
          replies.push({ id: randomUUID(), text: '' });
        }
        const current = replies.at(-1)!;
        if (event.kind === 'text_delta') current.text += event.text;
        progress(turn, current.id, event, feed);
      }
      feed.failUnfinished();
      return { result: await agentTurn.result, replies };
    } catch (err) {
      controller.abort();
      throw err;
    }
  }

  /** Acquires the project's session for the conversation, then releases it after a completed result and closes it otherwise. */
  async function converseInSession(turn: Turn, input: TurnInput, replyId: string, feed: StatusFeed): Promise<Conversation> {
    const session = await deps.sessions.acquire(turn.projectId);
    let conversation: Conversation | undefined;
    try {
      conversation = await converse(turn, session, input, replyId, feed);
      return conversation;
    } finally {
      if (conversation?.result.status === 'completed') {
        deps.sessions.release(turn.projectId);
      } else {
        await deps.sessions.close(turn.projectId).catch((err: unknown) => {
          console.error(`Failed to close the session for project ${turn.projectId}:`, err);
        });
      }
    }
  }

  /** Builds the output when it differs from the latest build's, or from `startHash` before the project's first build. */
  async function buildIfChanged(turn: Turn, startHash: string, feed: StatusFeed): Promise<void> {
    const outputHash = await deps.workspaces.hashOutput(turn.projectId);
    const latest = deps.builds.latest(turn.projectId);
    if (outputHash === (latest ? latest.outputHash : startHash)) return;
    feed.status('Checking your build', 'checking');
    await deps.builds.create(turn.projectId, turn.id);
  }

  async function run(turn: RunningTurn): Promise<FinishTurnInput> {
    append(turn, 'turn.started', { turnId: turn.id, startedAt: turn.startedAt });
    const startHash = await deps.workspaces.hashOutput(turn.projectId);
    const input = instructorInput(turn);
    let replyId: string = randomUUID();
    const feed = statusFeed(turn);
    const { result, replies } = await converseInSession(turn, input, replyId, feed);

    if (result.status === 'cancelled') return { status: 'cancelled', usage: result.usage };
    if (result.status === 'failed') {
      const error = result.error ?? { code: 'agent_error', message: 'The driver reported no error' };
      return failure(turn, error.code, error.message, { usage: result.usage });
    }

    const finalReply = replies.at(-1)!;
    if (result.text.trim() !== '') finalReply.text = result.text;
    const savedReplies = replies.filter(reply => reply.text.trim() !== '');
    if (savedReplies.length === 0) savedReplies.push(finalReply);
    for (const streamedReply of savedReplies) {
      replyId = streamedReply.id;
      const reply = deps.messages.create({
        id: replyId,
        projectId: turn.projectId,
        role: 'agent',
        content: [{ type: 'text', text: streamedReply.text }],
        turnId: turn.id,
      });
      try {
        append(turn, 'message.completed', { message: reply });
      } catch (err) {
        return failure(turn, thrownCode(err), err, { usage: result.usage, replyId });
      }
    }
    try {
      await buildIfChanged(turn, startHash, feed);
    } catch (err) {
      return failure(turn, thrownCode(err), err, { usage: result.usage, replyId });
    }
    return { status: 'completed', usage: result.usage, replyId };
  }

  function finish(turn: Turn, outcome: FinishTurnInput): void {
    deps.turns.finish(turn.id, outcome);
    switch (outcome.status) {
      case 'completed':
        append(turn, 'turn.completed', { turnId: turn.id, usage: outcome.usage });
        return;
      case 'failed':
        append(turn, 'turn.failed', { turnId: turn.id, error: outcome.error });
        return;
      case 'cancelled':
        append(turn, 'turn.cancelled', { turnId: turn.id });
        return;
    }
  }

  return {
    async executeTurn(turnId) {
      try {
        const turn = deps.turns.start(turnId);
        if (!turn) return;
        let outcome: FinishTurnInput;
        try {
          outcome = await run(turn);
        } catch (err) {
          outcome = failure(turn, thrownCode(err), err);
        }
        finish(turn, outcome);
      } catch (err) {
        console.error(`Failed to run turn ${turnId}:`, err);
      }
    },

    failInterrupted() {
      const error = { code: 'interrupted', message: ERROR_MESSAGES.interrupted };
      for (const turn of deps.turns.failActive(error)) {
        append(turn, 'turn.failed', { turnId: turn.id, error });
      }
    },
  };
}
