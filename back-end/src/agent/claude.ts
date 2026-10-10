import { cp, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  query,
  type EffortLevel,
  type HookCallback,
  type HookJSONOutput,
  type Options,
  type SDKAssistantMessageError,
  type SDKMessage,
  type SDKPermissionDeniedMessage,
  type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { Allow, parse as parsePartialJson } from 'partial-json';
import type {
  AgentDriver,
  AgentEvent,
  AgentSession,
  AgentTurn,
  ProbeResult,
  SessionRequest,
  TurnErrorCode,
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

/**
 * Claude's built-in tools the agent loads: the file tools, the shell, and the
 * Skill tool for the kit's skills. Passed as `options.tools`, which sets the
 * whole built-in tool set.
 */
export const BUILT_IN_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', SHELL_TOOL, 'Skill'];

/**
 * Variables the agent's process takes from the back end's environment: what
 * the OS, the shell, the network, and the agent's own sign-in need.
 */
export const INHERITED_ENV = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'TMPDIR',
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'PATHEXT',
  'PSModulePath',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
];

/**
 * Variables the driver sets for the agent: no bundled skills, no built-in
 * subagents, no auto memory, and PowerShell as the shell on Windows
 * (docs/drivers.md, "What the agent can use").
 */
export const AGENT_SETTINGS_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
  CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  ...(SHELL_TOOL === 'PowerShell' ? { CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' } : {}),
};

export const WORKSPACE_SETTINGS = {
  permissions: {
    allow: ['Read(/**)', ...MUTATING_TOOL_RULES],
  },
};

const RESULT_ERROR_CODES: Record<string, TurnErrorCode> = {
  error_max_turns: 'max_steps_exceeded',
  error_max_budget_usd: 'max_budget_exceeded',
};

/** Provider refusals the SDK reports on an assistant message, by the code a failed turn carries. */
const ASSISTANT_ERROR_CODES: Partial<Record<SDKAssistantMessageError, TurnErrorCode>> = {
  authentication_failed: 'agent_signed_out',
  oauth_org_not_allowed: 'agent_signed_out',
  verification_required: 'agent_signed_out',
  billing_error: 'agent_billing',
  account_on_hold: 'agent_billing',
  rate_limit: 'agent_busy',
  overloaded: 'agent_busy',
};

/** Builds `options.allowedTools`: the mirrored file-tool patterns, every
 *  command in `SHELL_TOOL`, then the MCP tool names as-is. File tools are
 *  never listed by bare name: a bare name would override settings.json's
 *  path-scoped rules, including denies. */
export function buildAllowedTools(mcpToolNames: string[]): string[] {
  return [...MUTATING_TOOL_RULES, SHELL_TOOL, ...mcpToolNames];
}

/**
 * The agent process's whole environment: the `INHERITED_ENV` variables the
 * back end has, plus `AGENT_SETTINGS_ENV`. `options.env` replaces the
 * process's environment rather than adding to it.
 */
export function agentEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...AGENT_SETTINGS_ENV };
}

/** What a session may load. */
export interface AllowedCapabilities {
  /** Every tool, built-in and `cdk`, by the name Claude reports it under. */
  tools: string[];
  skills: string[];
  mcpServers: string[];
}

/** The tools, skills, and MCP servers a session for `req` may load. */
export function allowedCapabilities(req: Pick<SessionRequest, 'tools' | 'skills'>): AllowedCapabilities {
  return {
    tools: [...BUILT_IN_TOOLS, ...req.tools.tools.map((tool) => `mcp__${req.tools.name}__${tool.name}`)],
    skills: req.skills,
    mcpServers: [req.tools.name],
  };
}

/** What a session reports loading, in the fields of its `init` message. */
export interface LoadedCapabilities {
  tools: string[];
  skills: string[];
  mcp_servers: Array<{ name: string }>;
  agents?: string[];
  plugins: Array<{ name: string }>;
}

/**
 * Compares what a session loaded with what it may load.
 *
 * Returns:
 *   One line per kind of difference, such as "unexpected tools: WebFetch";
 *   empty when the session loaded exactly its allowed tools and skills, no
 *   other MCP server, no subagent, and no plugin.
 */
export function capabilityDifferences(loaded: LoadedCapabilities, allowed: AllowedCapabilities): string[] {
  return [
    listing('unexpected tools', without(loaded.tools, allowed.tools)),
    listing('missing tools', without(allowed.tools, loaded.tools)),
    listing('unexpected skills', without(loaded.skills, allowed.skills)),
    listing('missing skills', without(allowed.skills, loaded.skills)),
    listing('unexpected MCP servers', without(loaded.mcp_servers.map((server) => server.name), allowed.mcpServers)),
    listing('unexpected subagents', loaded.agents ?? []),
    listing('unexpected plugins', loaded.plugins.map((plugin) => plugin.name)),
  ].filter((line) => line !== '');
}

function without(items: string[], excluded: string[]): string[] {
  return items.filter((item) => !excluded.includes(item));
}

function listing(label: string, items: string[]): string {
  return items.length > 0 ? `${label}: ${items.join(', ')}` : '';
}

/** A session loaded something other than exactly its allowed tools and skills. */
export class UnapprovedCapabilities extends Error {
  constructor(differences: string[]) {
    super(`The agent session did not load exactly its allowed tools and skills: ${differences.join('; ')}`);
    this.name = 'UnapprovedCapabilities';
  }
}

/**
 * Passes a turn's messages through, and stops the turn when a session's
 * `init` message shows it loaded anything other than `allowed`.
 *
 * Raises:
 *   UnapprovedCapabilities: after aborting `controller`, on the first `init`
 *   message that differs from `allowed`.
 */
export async function* enforceCapabilities(
  messages: AsyncIterable<SDKMessage>,
  allowed: AllowedCapabilities,
  controller: AbortController,
): AsyncGenerator<SDKMessage> {
  for await (const message of messages) {
    if (message.type === 'system' && message.subtype === 'init') {
      const differences = capabilityDifferences(message, allowed);
      if (differences.length > 0) {
        controller.abort();
        throw new UnapprovedCapabilities(differences);
      }
    }
    yield message;
  }
}

/**
 * The paths a file tool call names, resolved against the workspace. Glob's
 * pattern is resolved against its search directory, so an absolute or `..`
 * pattern counts as the path it reaches.
 */
function pathsInFileToolCall(toolName: string, input: unknown, workspaceDir: string): string[] {
  const fields = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const field = (name: string) => {
    const value = fields[name];
    return typeof value === 'string' ? value : undefined;
  };
  const searchDir = resolve(workspaceDir, field('path') ?? '.');
  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit': {
      const filePath = field('file_path');
      return filePath === undefined ? [] : [resolve(workspaceDir, filePath)];
    }
    case 'Glob': {
      const pattern = field('pattern');
      return pattern === undefined ? [searchDir] : [searchDir, resolve(searchDir, pattern)];
    }
    case 'Grep':
      return [searchDir];
    default:
      return [];
  }
}

/**
 * The real path of `path`, or, for a path that does not exist yet, the real
 * path of its nearest existing ancestor joined with the rest.
 *
 * Returns:
 *   The path, or `undefined` when an entry exists but has no real path, such
 *   as a link to a missing target or a link loop.
 */
async function realPathOf(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    if (await lstat(path).then(() => true, () => false)) return undefined;
    const parent = dirname(path);
    if (parent === path) return path;
    const realParent = await realPathOf(parent);
    return realParent === undefined ? undefined : join(realParent, basename(path));
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function denyToolCall(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  };
}

/**
 * A pre-tool hook that denies any file tool call naming a path outside
 * `workspaceDir`, compared by real path so `..` and links cannot leave it.
 * Calls to other tools pass through.
 */
export function confineToWorkspace(workspaceDir: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const paths = pathsInFileToolCall(input.tool_name, input.tool_input, workspaceDir);
    if (paths.length === 0) return {};
    try {
      const root = await realpath(workspaceDir);
      for (const path of paths) {
        const real = await realPathOf(path);
        if (real === undefined || !isInside(root, real)) {
          return denyToolCall(`${path} is outside the project workspace. Use files inside ${workspaceDir}.`);
        }
      }
      return {};
    } catch (err) {
      return denyToolCall(`The path could not be checked: ${err instanceof Error ? err.message : String(err)}`);
    }
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

const THINKING = 'Thinking…';
const RETRYING = "The agent's service is busy. Trying again…";
const CONDENSING = 'Condensing the conversation…';

const FILE_TOOL_VERBS: Record<string, string> = { Read: 'Reading', Write: 'Writing', Edit: 'Editing' };

/**
 * The plain-language line for one of Claude's tool calls, built from input
 * that may still be streaming.
 *
 * Returns:
 *   The line, or `undefined` while `input` lacks the field the line is
 *   built from. A line returned here never changes as more input arrives.
 */
function knownSummary(name: string, input: unknown): string | undefined {
  const fields = (typeof input === 'object' && input !== null ? input : {}) as {
    description?: unknown;
    file_path?: unknown;
  };
  switch (name) {
    case 'PowerShell':
    case 'Bash':
      return typeof fields.description === 'string' && fields.description.trim() !== ''
        ? fields.description
        : undefined;
    case 'Read':
    case 'Write':
    case 'Edit':
      return typeof fields.file_path === 'string' ? `${FILE_TOOL_VERBS[name]} ${fileName(fields.file_path)}` : undefined;
    case 'Glob':
    case 'Grep':
      return 'Searching the files';
    default:
      return `Using ${name}`;
  }
}

/** A plain-language line for the instructor describing one of Claude's tool calls, given its complete input. */
export function summarizeTool(name: string, input: unknown): string {
  return knownSummary(name, input) ?? (FILE_TOOL_VERBS[name] ? `${FILE_TOOL_VERBS[name]} a file` : 'Running a command');
}

/** The last segment of a Windows or POSIX path. */
function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || 'a file';
}

/** The fields of a tool call's partial input JSON whose values are complete. */
function parseCompleteFields(json: string): unknown {
  try {
    return parsePartialJson(json, Allow.OBJ);
  } catch {
    return undefined;
  }
}

function describePermissionDenied(message: SDKPermissionDeniedMessage): string {
  return `The agent was denied permission to use ${message.tool_name}.`;
}

function mapResult(
  message: SDKResultMessage,
  textFallback: string,
  assistantError: SDKAssistantMessageError | undefined,
): TurnResult {
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    costUsd: message.total_cost_usd,
    steps: message.num_turns,
  };
  const providerCode = assistantError ? ASSISTANT_ERROR_CODES[assistantError] : undefined;

  if (message.subtype === 'success' && !message.is_error) {
    return { status: 'completed', sessionId: message.session_id, text: message.result, usage };
  }

  if (message.subtype === 'success') {
    return {
      status: 'failed',
      sessionId: message.session_id,
      text: textFallback,
      error: { code: providerCode ?? 'agent_error', message: message.result || `API error ${message.api_error_status}` },
      usage,
    };
  }

  const code = RESULT_ERROR_CODES[message.subtype] ?? providerCode ?? 'agent_error';
  const detail = message.errors.length > 0 ? message.errors.join('; ') : message.subtype;
  return {
    status: 'failed',
    sessionId: message.session_id,
    text: textFallback,
    error: { code, message: detail },
    usage,
  };
}

/** A tool call whose input is streaming and whose line is not yet known. */
interface StreamingToolCall {
  callId: string;
  name: string;
  inputJson: string;
}

/**
 * Maps one query()'s message stream to AgentEvents and resolves `result`.
 * Exported separately from `send` so the fixture-replay test can drive it
 * directly against a recorded stream instead of a live SDK call.
 *
 * Messages from a subagent (a non-null `parent_tool_use_id`) produce no
 * events. A tool call's `tool_start` is emitted from its streaming input as
 * soon as its summary is known, or else from the completed assistant message.
 */
export async function* mapClaudeStream(
  messages: AsyncIterable<SDKMessage>,
  signal: AbortSignal,
  resolveResult: (result: TurnResult) => void,
  onSessionId: (sessionId: string) => void,
): AsyncGenerator<AgentEvent> {
  let textBuf = '';
  let assistantError: SDKAssistantMessageError | undefined;
  const startedCallIds = new Set<string>();
  const streamingCalls = new Map<number, StreamingToolCall>();

  function toolStart(callId: string, name: string, summary: string): AgentEvent {
    startedCallIds.add(callId);
    return { kind: 'tool_start', callId, name, summary };
  }

  try {
    for await (const message of messages) {
      switch (message.type) {
        case 'system':
          switch (message.subtype) {
            case 'init':
              onSessionId(message.session_id);
              break;
            case 'permission_denied':
              yield { kind: 'notice', text: describePermissionDenied(message) };
              break;
            case 'status':
              if (message.status === 'requesting') yield { kind: 'status', text: THINKING };
              if (message.status === 'compacting') yield { kind: 'status', text: CONDENSING };
              break;
            case 'api_retry':
              yield { kind: 'status', text: RETRYING };
              break;
          }
          break;
        case 'stream_event': {
          if (message.parent_tool_use_id) break;
          const event = message.event;
          if (event.type === 'message_start') {
            streamingCalls.clear();
          } else if (event.type === 'content_block_start') {
            const block = event.content_block;
            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
              yield { kind: 'status', text: THINKING };
            } else if (block.type === 'tool_use') {
              const summary = knownSummary(block.name, block.input);
              if (summary) yield toolStart(block.id, block.name, summary);
              else streamingCalls.set(event.index, { callId: block.id, name: block.name, inputJson: '' });
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              textBuf += event.delta.text;
              yield { kind: 'text_delta', text: event.delta.text };
            } else if (event.delta.type === 'input_json_delta') {
              const call = streamingCalls.get(event.index);
              if (!call) break;
              call.inputJson += event.delta.partial_json;
              const summary = knownSummary(call.name, parseCompleteFields(call.inputJson));
              if (summary) {
                streamingCalls.delete(event.index);
                yield toolStart(call.callId, call.name, summary);
              }
            }
          }
          break;
        }
        case 'assistant':
          assistantError = message.error ?? assistantError;
          if (message.parent_tool_use_id) break;
          for (const block of message.message.content) {
            if (block.type === 'tool_use' && !startedCallIds.has(block.id)) {
              yield toolStart(block.id, block.name, summarizeTool(block.name, block.input));
            }
          }
          break;
        case 'user': {
          if (message.parent_tool_use_id) break;
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
          resolveResult(mapResult(message, textBuf, assistantError));
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
    if (err instanceof UnapprovedCapabilities) {
      resolveResult({
        status: 'failed',
        sessionId: null,
        text: textBuf,
        error: { code: 'agent_unrestricted', message: err.message },
      });
      return;
    }
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

/** The model and reasoning effort Claude runs with. An omitted field keeps the account's default. */
export interface ClaudeSettings {
  model?: string;
  effort?: EffortLevel;
}

/** The query options for a model and effort, leaving out any that is unset. */
function modelOptions({ model, effort }: ClaudeSettings): Pick<Options, 'model' | 'effort'> {
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

function createClaudeSession(req: SessionRequest, settings: ClaudeSettings): AgentSession {
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
        tools: BUILT_IN_TOOLS,
        skills: req.skills,
        strictMcpConfig: true,
        env: agentEnv(),
        hooks: { PreToolUse: [{ hooks: [confineToWorkspace(req.workspaceDir)] }] },
        maxTurns: limits.maxSteps,
        maxBudgetUsd: limits.maxBudgetUsd,
        includePartialMessages: true,
        allowedTools: buildAllowedTools(req.allowedTools),
        ...modelOptions(settings),
        abortController: controller,
      };

      let resolveResult!: (result: TurnResult) => void;
      const result = new Promise<TurnResult>((resolve) => {
        resolveResult = resolve;
      });

      // query() itself never throws synchronously (it returns an async
      // generator); a spawn failure surfaces from the first `for await` step.
      const stream = query({ prompt: buildPrompt(input), options });
      const checked = enforceCapabilities(stream, allowedCapabilities(req), controller);
      const events = mapClaudeStream(checked, signal, resolveResult, (id) => {
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
  await mkdir(skillsDest, { recursive: true });
  for (const skill of req.skills) {
    await cp(join(req.skillsDir, skill), join(skillsDest, skill), { recursive: true });
  }

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
async function probeClaude(model: string | undefined): Promise<ProbeResult> {
  const controller = new AbortController();

  const attempt = async (): Promise<ProbeResult> => {
    const q = query({
      prompt: 'Reply with the single word: ready',
      options: {
        maxTurns: 1,
        maxBudgetUsd: 0.01,
        settingSources: [],
        permissionMode: 'dontAsk',
        strictMcpConfig: true,
        env: agentEnv(),
        persistSession: false,
        ...modelOptions({ model }),
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

export function createClaudeAgentDriver(settings: ClaudeSettings = {}): AgentDriver {
  return {
    name: 'claude',

    probe(): Promise<ProbeResult> {
      return probeClaude(settings.model);
    },

    async open(req: SessionRequest): Promise<AgentSession> {
      // Written on every open(), including a reopen of an existing
      // sessionId: that's how an agent switch or a skill fix reaches a
      // project already in progress.
      await writeWorkspaceFiles(req);
      return createClaudeSession(req, settings);
    },
  };
}

// The tools layer (back-end/src/tools/) adds `options.mcpServers` from
// `req.tools` in a later phase; `allowedCapabilities` already expects them.
