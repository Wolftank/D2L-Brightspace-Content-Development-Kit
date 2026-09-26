import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentSession, TurnErrorCode, TurnInput, TurnResult } from '../agent/AgentDriver.js';
import type { MessagesRepo } from '../db/messages.js';
import type { Turn } from '../db/schema.js';
import type { FinishTurnInput, TurnsRepo } from '../db/turns.js';
import { WorkspaceMissing } from '../errors.js';
import type { BuildService } from '../services/builds.js';
import type { WorkspaceService } from '../services/workspaces.js';
import type { AppEventKind, EventService } from './events.js';
import type { SessionService } from './sessions.js';

type RunnerErrorCode = TurnErrorCode | 'workspace_missing' | 'interrupted' | 'internal_error';

/** What the instructor reads when a turn fails, by error code. */
const ERROR_MESSAGES: Record<RunnerErrorCode, string> = {
  agent_error: 'The agent stopped with an error before it finished. Send the request again.',
  agent_signed_out: "The agent isn't signed in, or its account can't be used. Sign in to the agent, then send the request again.",
  agent_billing: "The agent's account has a billing or account problem. Check the account, then send the request again.",
  agent_busy: "The agent's account is busy or has reached its usage limit. Try again later.",
  max_steps_exceeded: 'The request needed more steps than allowed. Try a smaller request.',
  max_budget_exceeded: 'The request reached its spending limit. Try a smaller request.',
  no_result: 'The agent stopped unexpectedly before it finished. Send the request again.',
  driver_error: 'The agent stopped unexpectedly before it finished. Send the request again.',
  workspace_missing: "This project's files are missing, so the request could not run.",
  interrupted: 'The app closed before this request finished. Changes already made are kept; send the request again.',
  internal_error: 'Something went wrong while running this request. Send it again.',
};

export interface RunnerDeps {
  turns: TurnsRepo;
  messages: Pick<MessagesRepo, 'get' | 'create'>;
  events: Pick<EventService, 'append'>;
  sessions: SessionService;
  workspaces: Pick<WorkspaceService, 'hashOutput'>;
  builds: Pick<BuildService, 'create' | 'latest'>;
}

/** Runs instructor requests through the agent, one turn at a time per project. */
export interface Runner {
  /**
   * Runs a `queued` turn to one final status and one final event, and does
   * nothing for any other turn. Never rejects: failures are stored on the
   * turn and reported through the event stream.
   */
  executeTurn(turnId: string): Promise<void>;
  /** Fails every `queued` or `running` turn with code `interrupted`. Call once at startup, before accepting requests. */
  failInterrupted(): void;
}

/** The code for an error thrown while running a turn. */
function thrownCode(err: unknown): RunnerErrorCode {
  return err instanceof WorkspaceMissing ? 'workspace_missing' : 'internal_error';
}

interface Conversation {
  result: TurnResult;
  /** Every text delta the agent streamed, joined. */
  streamed: string;
}

export function createRunner(deps: RunnerDeps): Runner {
  function append(turn: Turn, kind: AppEventKind, payload: unknown): void {
    deps.events.append({ projectId: turn.projectId, turnId: turn.id, kind, payload });
  }

  function failure(turn: Turn, code: RunnerErrorCode, detail: unknown, rest: Omit<FinishTurnInput, 'status'> = {}): FinishTurnInput {
    console.error(`Turn ${turn.id} failed (${code}):`, detail);
    return { ...rest, status: 'failed', error: { code, message: ERROR_MESSAGES[code] } };
  }

  function instructorInput(turn: Turn): TurnInput {
    const message = deps.messages.get(turn.messageId);
    if (!message) throw new Error(`Turn ${turn.id} has no instructor message ${turn.messageId}`);
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
    return { text, attachments: [] };
  }

  function progress(turn: Turn, replyId: string, event: AgentEvent, summaries: Map<string, string>): void {
    switch (event.kind) {
      case 'text_delta':
        append(turn, 'message.delta', { turnId: turn.id, messageId: replyId, text: event.text });
        return;
      case 'tool_start':
        summaries.set(event.callId, event.summary);
        append(turn, 'tool.started', { turnId: turn.id, callId: event.callId, name: event.name, summary: event.summary });
        return;
      case 'tool_end': {
        const summary = summaries.get(event.callId) ?? 'Using a tool';
        append(turn, 'tool.finished', {
          turnId: turn.id,
          callId: event.callId,
          ok: event.ok,
          summary: event.ok ? summary : `Failed: ${summary}`,
        });
        return;
      }
      case 'notice':
        append(turn, 'turn.status', { turnId: turn.id, text: event.text });
        return;
    }
  }

  /** Sends the request and reports the agent's progress. On a thrown error the turn's agent work is aborted. */
  async function converse(turn: Turn, session: AgentSession, input: TurnInput, replyId: string): Promise<Conversation> {
    const controller = new AbortController();
    const summaries = new Map<string, string>();
    let streamed = '';
    try {
      const agentTurn = session.send(input, {}, controller.signal);
      for await (const event of agentTurn.events) {
        if (event.kind === 'text_delta') streamed += event.text;
        progress(turn, replyId, event, summaries);
      }
      return { result: await agentTurn.result, streamed };
    } catch (err) {
      controller.abort();
      throw err;
    }
  }

  /** Acquires the project's session for the conversation, then releases it after a completed result and closes it otherwise. */
  async function converseInSession(turn: Turn, input: TurnInput, replyId: string): Promise<Conversation> {
    const session = await deps.sessions.acquire(turn.projectId);
    let conversation: Conversation | undefined;
    try {
      conversation = await converse(turn, session, input, replyId);
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
  async function buildIfChanged(turn: Turn, startHash: string): Promise<void> {
    const outputHash = await deps.workspaces.hashOutput(turn.projectId);
    const latest = deps.builds.latest(turn.projectId);
    if (outputHash === (latest ? latest.outputHash : startHash)) return;
    append(turn, 'turn.status', { turnId: turn.id, text: 'Checking your build' });
    await deps.builds.create(turn.projectId, turn.id);
  }

  async function run(turn: Turn): Promise<FinishTurnInput> {
    append(turn, 'turn.started', { turnId: turn.id });
    const startHash = await deps.workspaces.hashOutput(turn.projectId);
    const input = instructorInput(turn);
    const replyId = randomUUID();
    const { result, streamed } = await converseInSession(turn, input, replyId);

    if (result.status === 'cancelled') return { status: 'cancelled', usage: result.usage };
    if (result.status === 'failed') {
      const error = result.error ?? { code: 'agent_error', message: 'The driver reported no error' };
      return failure(turn, error.code, error.message, { usage: result.usage });
    }

    const text = result.text.trim() === '' ? streamed : result.text;
    const reply = deps.messages.create({
      id: replyId,
      projectId: turn.projectId,
      role: 'agent',
      content: [{ type: 'text', text }],
      turnId: turn.id,
    });
    try {
      append(turn, 'message.completed', { message: reply });
      await buildIfChanged(turn, startHash);
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
