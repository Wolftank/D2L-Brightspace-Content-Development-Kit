import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';
import {
  query,
  type Options,
  type SDKMessage,
  type SDKPermissionDeniedMessage,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentDriver,
  AgentEvent,
  AgentSession,
  AgentTurn,
  ProbeResult,
  SessionRequest,
  TurnInput,
  TurnLimits,
  TurnResult,
} from './AgentDriver.js';

/**
 * Built-in file-editing tools that `.claude/settings.json` allows for the
 * whole workspace. Confirmed 2026-09-15 (docs/drivers.md, "Permissions,
 * confirmed"): `dontAsk` does not honor these from settings alone — the
 * identical scoped pattern must also be listed in `options.allowedTools`,
 * so `MUTATING_TOOL_RULES` is mirrored into both places. `Read` is not
 * included here: it auto-approves from settings.json alone.
 */
export const MUTATING_TOOL_RULES = ['Edit(/**)', 'Write(/**)'];

/** The agent's shell: PowerShell on Windows, so instructors need no Git for
 *  Windows, and Bash elsewhere. */
const SHELL_TOOL = platform() === 'win32' ? 'PowerShell' : 'Bash';

export const WORKSPACE_SETTINGS = {
  permissions: {
    allow: ['Read(/**)', ...MUTATING_TOOL_RULES],
  },
};

const RESULT_ERROR_CODES: Record<string, string> = {
  error_max_turns: 'max_steps_exceeded',
  error_max_budget_usd: 'max_budget_exceeded',
};

/** Builds `options.allowedTools`: the mirrored file-tool patterns, every
 *  command in `SHELL_TOOL`, then the MCP tool names as-is. File tools are
 *  never listed by bare name: a bare name would override settings.json's
 *  path-scoped rules, including denies. */
export function buildAllowedTools(mcpToolNames: string[]): string[] {
  return [...MUTATING_TOOL_RULES, SHELL_TOOL, ...mcpToolNames];
}

/**
 * Query options that leave `SHELL_TOOL` as the agent's only shell. On
 * Windows the CLI offers Bash whenever Git for Windows is installed, and
 * PowerShell only when `CLAUDE_CODE_USE_POWERSHELL_TOOL`, a missing Git, or
 * an account flag enables it (docs/drivers.md, "Shell").
 */
export function shellOptions(): Pick<Options, 'env' | 'disallowedTools'> {
  if (SHELL_TOOL === 'Bash') return {};
  return {
    env: { ...process.env, CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
    disallowedTools: ['Bash'],
  };
}

/** `query()` takes a single string prompt; attachments are referenced by
 *  path in it, the way the Copilot driver will need to for its own agent
 *  (see docs/architecture.md's Sessions section). */
function buildPrompt(input: TurnInput): string {
  if (input.attachments.length === 0) return input.text;
  const list = input.attachments.map((a) => `- ${a.name} (${a.mime}): ${a.path}`).join('\n');
  return `${input.text}\n\nAttached files:\n${list}`;
}

/** Confirmed 2026-09-15 (docs/drivers.md, "Cancellation"): an aborted query
 *  throws a plain `Error('Operation aborted')`, not a DOMException. Checking
 *  `signal.aborted` alongside the message covers a race between the two. */
function isAbortedError(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.message === 'Operation aborted');
}

function describePermissionDenied(message: SDKPermissionDeniedMessage): string {
  const reason = message.decision_reason_type ? ` (${message.decision_reason_type})` : '';
  return `Denied ${message.tool_name}${reason}: ${message.message}`;
}

function mapResult(message: SDKResultMessage, textFallback: string): TurnResult {
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    costUsd: message.total_cost_usd,
    steps: message.num_turns,
  };

  if (message.subtype === 'success') {
    return { status: 'completed', sessionId: message.session_id, text: message.result, usage };
  }

  const code = RESULT_ERROR_CODES[message.subtype] ?? 'agent_error';
  const detail = message.errors.length > 0 ? message.errors.join('; ') : message.subtype;
  return {
    status: 'failed',
    sessionId: message.session_id,
    text: textFallback,
    error: { code, message: detail },
    usage,
  };
}

/**
 * Maps one query()'s message stream to AgentEvents and resolves `result`.
 * Exported separately from `send` so the fixture-replay test can drive it
 * directly against a recorded stream instead of a live SDK call.
 */
export async function* mapClaudeStream(
  messages: AsyncIterable<SDKMessage>,
  signal: AbortSignal,
  resolveResult: (result: TurnResult) => void,
  onSessionId: (sessionId: string) => void,
): AsyncGenerator<AgentEvent> {
  let textBuf = '';
  try {
    for await (const message of messages) {
      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            onSessionId(message.session_id);
          } else if (message.subtype === 'permission_denied') {
            yield { kind: 'notice', text: describePermissionDenied(message) };
          }
          break;
        case 'stream_event': {
          const event = message.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            textBuf += event.delta.text;
            yield { kind: 'text_delta', text: event.delta.text };
          }
          break;
        }
        case 'assistant':
          for (const block of message.message.content) {
            if (block.type === 'tool_use') {
              yield { kind: 'tool_start', callId: block.id, name: block.name, input: block.input };
            }
          }
          break;
        case 'user': {
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result') {
                yield {
                  kind: 'tool_end',
                  callId: block.tool_use_id,
                  ok: !block.is_error,
                  output: block.content,
                };
              }
            }
          }
          break;
        }
        case 'result':
          onSessionId(message.session_id);
          resolveResult(mapResult(message, textBuf));
          return;
        default:
          break;
      }
    }
    resolveResult({
      status: 'failed',
      sessionId: null,
      text: textBuf,
      error: { code: 'no_result', message: 'Claude ended the turn without a result message' },
    });
  } catch (err) {
    if (isAbortedError(err, signal)) {
      resolveResult({ status: 'cancelled', sessionId: null, text: textBuf });
      return;
    }
    resolveResult({
      status: 'failed',
      sessionId: null,
      text: textBuf,
      error: { code: 'driver_error', message: err instanceof Error ? err.message : String(err) },
    });
  }
}

function createClaudeSession(req: SessionRequest): AgentSession {
  let sessionId = req.sessionId;

  return {
    get sessionId() {
      return sessionId;
    },

    send(input: TurnInput, limits: TurnLimits, signal: AbortSignal): AgentTurn {
      const controller = new AbortController();
      if (signal.aborted) controller.abort();
      signal.addEventListener('abort', () => controller.abort(), { once: true });

      const options: Options = {
        cwd: req.workspaceDir,
        ...(sessionId ? { resume: sessionId } : {}),
        permissionMode: 'dontAsk',
        settingSources: ['project'],
        maxTurns: limits.maxSteps,
        maxBudgetUsd: limits.maxBudgetUsd,
        includePartialMessages: true,
        allowedTools: buildAllowedTools(req.allowedTools),
        ...shellOptions(),
        abortController: controller,
      };

      let resolveResult!: (result: TurnResult) => void;
      const result = new Promise<TurnResult>((resolve) => {
        resolveResult = resolve;
      });

      // query() itself never throws synchronously (it returns an async
      // generator); a spawn failure surfaces from the first `for await` step.
      const stream = query({ prompt: buildPrompt(input), options });
      const events = mapClaudeStream(stream, signal, resolveResult, (id) => {
        sessionId = id;
      });

      // Wrap the result so it always reports the session id we ended up
      // with, even though mapClaudeStream (shared with the fixture test,
      // which has no session to update) doesn't know about `this` session.
      const sessionAwareResult = result.then((turnResult) => ({
        ...turnResult,
        sessionId: turnResult.sessionId ?? sessionId,
      }));

      return { events, result: sessionAwareResult };
    },

    async close(): Promise<void> {
      // No-op in V1: each turn opens its own query(), so there is no
      // long-lived process for this session to release.
    },
  };
}

async function writeWorkspaceFiles(req: SessionRequest): Promise<void> {
  await mkdir(req.workspaceDir, { recursive: true });
  await writeFile(join(req.workspaceDir, 'CLAUDE.md'), req.instructions, 'utf8');

  const skillsDest = join(req.workspaceDir, '.claude', 'skills');
  await rm(skillsDest, { recursive: true, force: true });
  await mkdir(join(req.workspaceDir, '.claude'), { recursive: true });
  await cp(req.skillsDir, skillsDest, { recursive: true });

  const settingsPath = join(req.workspaceDir, '.claude', 'settings.json');
  await writeFile(settingsPath, JSON.stringify(WORKSPACE_SETTINGS, null, 2), 'utf8');
}

/** How long probe() waits for the CLI to report readiness before giving up.
 *  A missing/misconfigured binary can otherwise hang indefinitely instead
 *  of settling. */
export const PROBE_TIMEOUT_MS = 15_000;

/**
 * Probes the bundled CLI, aborting as soon as the stream proves the session
 * is live rather than waiting for a full reply. A real turn is the only
 * verified way to learn sign-in status — the SDK has no dedicated
 * zero-cost credential check (an earlier design tried holding a
 * streaming-input query open and calling the control-request `accountInfo()`
 * without ever sending a prompt; recording the fixture for this PR showed
 * that hangs even against a signed-in CLI, so it was dropped). Recording
 * that same fixture also showed the message order: `system/init`, a couple
 * of housekeeping `system` messages, then `rate_limit_event` — a live,
 * per-account signal — arriving *before* the first `stream_event` content
 * delta. Aborting on whichever of `rate_limit_event`, `stream_event`,
 * `assistant`, or `result` arrives first keeps the spend to at most the
 * first partial chunk of a one-word reply, capped again by `maxBudgetUsd`.
 */
async function probeClaude(): Promise<ProbeResult> {
  const controller = new AbortController();

  const attempt = async (): Promise<ProbeResult> => {
    const q = query({
      prompt: 'Reply with the single word: ready',
      options: {
        maxTurns: 1,
        maxBudgetUsd: 0.01,
        settingSources: [],
        permissionMode: 'dontAsk',
        abortController: controller,
      },
    });

    let version: string | undefined;
    for (;;) {
      const next = await q.next();
      if (next.done) {
        return { ok: false, detail: 'Claude CLI exited before reporting readiness' };
      }

      const message = next.value;
      if (message.type === 'system' && message.subtype === 'init') {
        version = message.claude_code_version;
        continue;
      }
      if (message.type === 'stream_event' || message.type === 'rate_limit_event') {
        return { ok: true, version };
      }
      if (message.type === 'assistant') {
        if (message.error) {
          return { ok: false, detail: `Claude CLI reported ${message.error}` };
        }
        return { ok: true, version };
      }
      if (message.type === 'result') {
        if (message.subtype === 'success') return { ok: true, version };
        const detail = message.errors.length > 0 ? message.errors.join('; ') : message.subtype;
        return { ok: false, detail };
      }
      // Other telemetry (system/status, thinking_tokens, ...) settles
      // nothing either way; keep waiting for a decisive message.
    }
  };

  const timeout = new Promise<ProbeResult>((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, detail: `Claude CLI did not respond within ${PROBE_TIMEOUT_MS}ms` }),
      PROBE_TIMEOUT_MS,
    );
    timer.unref?.();
  });

  try {
    return await Promise.race([attempt(), timeout]);
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    controller.abort();
  }
}

export function createClaudeAgentDriver(): AgentDriver {
  return {
    name: 'claude',

    probe(): Promise<ProbeResult> {
      return probeClaude();
    },

    async open(req: SessionRequest): Promise<AgentSession> {
      // Written on every open(), including a reopen of an existing
      // sessionId: that's how an agent switch or a skill fix reaches a
      // project already in progress.
      await writeWorkspaceFiles(req);
      return createClaudeSession(req);
    },
  };
}

// The tools layer (back-end/src/tools/) adds `options.mcpServers` in a
// later phase; `req.tools` is unused here in V1.
