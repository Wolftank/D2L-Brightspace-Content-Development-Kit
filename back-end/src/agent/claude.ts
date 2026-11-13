import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { cp, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createSdkMcpServer,
  query,
  tool,
  type EffortLevel,
  type HookCallback,
  type HookJSONOutput,
  type McpSdkServerConfigWithInstance,
  type Options,
  type Query,
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
  ToolServerSpec,
  TurnErrorCode,
  TurnInput,
  TurnLimits,
  TurnResult,
} from './AgentDriver.js';
import { log } from '../log.js';
import { toolCategory } from './progress.js';

/**
 * Built-in file-editing tools that `.claude/settings.json` allows inside the
 * workspace's `out/`. Confirmed 2026-09-15 (docs/drivers.md, "Permissions,
 * confirmed"): `dontAsk` does not honor these from settings alone — the
 * identical scoped pattern must also be listed in `options.allowedTools`,
 * so `MUTATING_TOOL_RULES` is mirrored into both places. `Read` is not
 * included here: it auto-approves from settings.json alone.
 */
export const MUTATING_TOOL_RULES = ['Edit(/out/**)', 'Write(/out/**)'];

/** The built-in tools that change files, which may write only inside the workspace's `out/`. */
const MUTATING_TOOLS = new Set(['Edit', 'Write']);

/**
 * Claude's built-in tools the agent loads: the file tools and the Skill tool
 * for the kit's skills. Passed as `options.tools`, which sets the whole
 * built-in tool set, so the agent has no shell.
 */
export const BUILT_IN_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'];

/**
 * Variables the agent's process takes from the back end's environment: what
 * the OS, the network, and the agent's own sign-in need.
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
 * subagents, and no auto memory (docs/drivers.md, "What the agent can use").
 */
export const AGENT_SETTINGS_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
  CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
};

/**
 * The plugins built into the Claude CLI. Each loads, on by default, whenever a
 * server-side feature flag for the signed-in account makes it available.
 */
export const BUILT_IN_PLUGINS = ['sec-default', 'agents-md', 'plugin-authoring', 'tips', 'diff', 'claude-test'];

/**
 * The workspace's `.claude/settings.json`: reads and searches allowed inside
 * the workspace and refused outside it, edits allowed inside `out/`, and every
 * built-in plugin off.
 */
export const WORKSPACE_SETTINGS = {
  permissions: {
    allow: ['Read(/**)', ...MUTATING_TOOL_RULES],
    blockReadsOutsideWorkingDirectories: true,
  },
  enabledPlugins: Object.fromEntries(BUILT_IN_PLUGINS.map((name) => [`${name}@builtin`, false])),
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

/** Builds `options.allowedTools`: the mirrored file-tool patterns, then the
 *  MCP tool names as-is. File tools are never listed by bare name: a bare
 *  name would override settings.json's path-scoped rules, including denies. */
export function buildAllowedTools(mcpToolNames: string[]): string[] {
  return [...MUTATING_TOOL_RULES, ...mcpToolNames];
}

/** `spec`'s tools by the names Claude calls them: `mcp__<server>__<tool>`. */
function qualifiedToolNames(spec: ToolServerSpec): string[] {
  return spec.tools.map((def) => `mcp__${spec.name}__${def.name}`);
}

/** Serves `spec`'s tools to the agent in-process, as the MCP server named `spec.name`. */
function toolServer(spec: ToolServerSpec): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: spec.name,
    tools: spec.tools.map((def) =>
      tool(def.name, def.description, def.input, async (input) => {
        try {
          const result = await def.handler(input);
          return { content: [{ type: 'text', text: result.content }], isError: result.isError ?? false };
        } catch (err) {
          log.error({ tool: `mcp__${spec.name}__${def.name}`, err }, 'A CDK tool failed');
          return { content: [{ type: 'text', text: 'The tool failed to run.' }], isError: true };
        }
      }),
    ),
  });
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
    tools: [...BUILT_IN_TOOLS, ...qualifiedToolNames(req.tools)],
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
 * Extra skills are not a difference: `init` also lists the CLI's built-in
 * commands, some of them depending on the signed-in account, and the CLI
 * keeps the model from invoking any skill outside `options.skills`.
 *
 * Returns:
 *   One line per kind of difference, such as "unexpected tools: WebFetch";
 *   empty when the session loaded exactly its allowed tools, every allowed
 *   skill, no other MCP server, no subagent, and no plugin.
 */
export function capabilityDifferences(loaded: LoadedCapabilities, allowed: AllowedCapabilities): string[] {
  return [
    listing('unexpected tools', without(loaded.tools, allowed.tools)),
    listing('missing tools', without(allowed.tools, loaded.tools)),
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

/** A session loaded a tool, MCP server, subagent, or plugin it may not, or lacks an allowed tool or skill. */
export class UnapprovedCapabilities extends Error {
  constructor(differences: string[]) {
    super(`The agent session did not load exactly its allowed tools and skills: ${differences.join('; ')}`);
    this.name = 'UnapprovedCapabilities';
  }
}

/**
 * Passes a turn's messages through, and stops the turn when a session's
 * `init` message differs from `allowed` (see `capabilityDifferences`).
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
    return typeof value === 'string' ? cliPath(value) : undefined;
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

/** `raw` the way the CLI reads a path argument: trimmed, with a leading `~` meaning the home directory. */
function cliPath(raw: string): string {
  const path = raw.trim();
  if (path === '~') return homedir();
  return path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path;
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
 * `workspaceDir`, and any `Edit` or `Write` naming a path outside its `out/`,
 * compared by real path so `..` and links cannot leave them. Calls to other
 * tools pass through.
 */
export function confineToWorkspace(workspaceDir: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const paths = pathsInFileToolCall(input.tool_name, input.tool_input, workspaceDir);
    if (paths.length === 0) return {};
    const outDir = join(workspaceDir, 'out');
    const mutating = MUTATING_TOOLS.has(input.tool_name);
    try {
      const root = await realpath(mutating ? outDir : workspaceDir);
      for (const path of paths) {
        const real = await realPathOf(path);
        if (real === undefined || !isInside(root, real)) {
          return denyToolCall(
            mutating
              ? `${path} is outside out/. Write the activity's files inside ${outDir}.`
              : `${path} is outside the project workspace. Use files inside ${workspaceDir}.`,
          );
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

/** How long an interrupted turn may take to end before its query is aborted. */
export const INTERRUPT_GRACE_MS = 3_000;

/** Interrupts the turn as Claude Code's Esc key does, aborting the query if that fails or takes longer than `INTERRUPT_GRACE_MS`. */
function interrupt(stream: Query, controller: AbortController, ended: Promise<unknown>): void {
  const fallback = setTimeout(() => controller.abort(), INTERRUPT_GRACE_MS);
  void ended.finally(() => clearTimeout(fallback));
  stream.interrupt().catch(() => controller.abort());
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
function knownSummary(name: string, input: unknown, toolSummaries: ReadonlyMap<string, string>): string | undefined {
  const fields = (typeof input === 'object' && input !== null ? input : {}) as { file_path?: unknown; skill?: unknown };
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return typeof fields.file_path === 'string' ? `${FILE_TOOL_VERBS[name]} ${fileName(fields.file_path)}` : undefined;
    case 'Skill':
      return typeof fields.skill === 'string' && fields.skill.trim() ? `Using skill ${fields.skill}` : undefined;
    case 'Glob':
    case 'Grep':
      return 'Searching the files';
    default:
      return toolSummaries.get(name) ?? `Using ${name}`;
  }
}

/**
 * A plain-language line for the instructor describing one of Claude's tool
 * calls, given its complete input. `toolSummaries` holds the lines for the
 * session's own tools, by the names Claude calls them.
 */
export function summarizeTool(name: string, input: unknown, toolSummaries: ReadonlyMap<string, string> = new Map()): string {
  return knownSummary(name, input, toolSummaries) ?? (name === 'Skill' ? 'Using a skill' : `${FILE_TOOL_VERBS[name]} a file`);
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
 * A failed result after `signal` fires resolves `cancelled`.
 */
export async function* mapClaudeStream(
  messages: AsyncIterable<SDKMessage>,
  signal: AbortSignal,
  resolveResult: (result: TurnResult) => void,
  onSessionId: (sessionId: string) => void,
  toolSummaries: ReadonlyMap<string, string> = new Map(),
): AsyncGenerator<AgentEvent> {
  let textBuf = '';
  let assistantError: SDKAssistantMessageError | undefined;
  const startedCallIds = new Set<string>();
  const streamingCalls = new Map<number, StreamingToolCall>();

  function toolStart(callId: string, name: string, summary: string, input: unknown): AgentEvent {
    startedCallIds.add(callId);
    return { kind: 'tool_start', callId, name, summary, category: toolCategory(name, input) };
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
              if (message.status === 'requesting') yield { kind: 'status', text: THINKING, category: 'thinking' };
              if (message.status === 'compacting') yield { kind: 'status', text: CONDENSING, category: 'other' };
              break;
            case 'api_retry':
              yield { kind: 'status', text: RETRYING, category: 'other' };
              break;
          }
          break;
        case 'stream_event': {
          if (message.parent_tool_use_id) break;
          const event = message.event;
          if (event.type === 'message_start') {
            textBuf = '';
            streamingCalls.clear();
            yield { kind: 'message_start' };
          } else if (event.type === 'content_block_start') {
            const block = event.content_block;
            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
              yield { kind: 'status', text: THINKING, category: 'thinking' };
            } else if (block.type === 'text') {
              yield { kind: 'status', text: 'Updating you', category: 'other' };
            } else if (block.type === 'tool_use') {
              const summary = knownSummary(block.name, block.input, toolSummaries);
              if (summary) yield toolStart(block.id, block.name, summary, block.input);
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
              const summary = knownSummary(call.name, parseCompleteFields(call.inputJson), toolSummaries);
              if (summary) {
                streamingCalls.delete(event.index);
                yield toolStart(call.callId, call.name, summary, parseCompleteFields(call.inputJson));
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
              yield toolStart(block.id, block.name, summarizeTool(block.name, block.input, toolSummaries), block.input);
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
        case 'result': {
          onSessionId(message.session_id);
          const result = mapResult(message, textBuf, assistantError);
          resolveResult(
            signal.aborted && result.status === 'failed'
              ? { status: 'cancelled', sessionId: result.sessionId, text: textBuf, usage: result.usage }
              : result,
          );
          return;
        }
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

/** The model Claude runs with when no model is set. */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** The model and reasoning effort Claude runs with. An omitted model is `DEFAULT_MODEL`; an omitted effort keeps Claude's default. */
export interface ClaudeSettings {
  model?: string;
  effort?: EffortLevel;
}

/** The query options for a model and effort, leaving out an unset effort. */
function modelOptions({ model = DEFAULT_MODEL, effort }: ClaudeSettings): Pick<Options, 'model' | 'effort'> {
  return { model, ...(effort ? { effort } : {}) };
}

function createClaudeSession(req: SessionRequest, settings: ClaudeSettings): AgentSession {
  let sessionId = req.sessionId;
  const toolNames = qualifiedToolNames(req.tools);
  const toolSummaries = new Map(req.tools.tools.map((def, i) => [toolNames[i]!, def.summary]));

  return {
    get sessionId() {
      return sessionId;
    },

    send(input: TurnInput, limits: TurnLimits, signal: AbortSignal): AgentTurn {
      const controller = new AbortController();
      if (signal.aborted) controller.abort();

      const options: Options = {
        cwd: req.workspaceDir,
        ...(sessionId ? { resume: sessionId } : {}),
        permissionMode: 'dontAsk',
        settingSources: ['project'],
        tools: BUILT_IN_TOOLS,
        skills: req.skills,
        mcpServers: { [req.tools.name]: toolServer(req.tools) },
        strictMcpConfig: true,
        env: agentEnv(),
        stderr: (output) => log.warn({ workspaceDir: req.workspaceDir, output: output.trimEnd() }, 'Agent process error output'),
        hooks: { PreToolUse: [{ hooks: [confineToWorkspace(req.workspaceDir)] }] },
        maxTurns: limits.maxSteps,
        maxBudgetUsd: limits.maxBudgetUsd,
        includePartialMessages: true,
        allowedTools: buildAllowedTools(toolNames),
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
      signal.addEventListener('abort', () => interrupt(stream, controller, result), { once: true });
      const checked = enforceCapabilities(stream, allowedCapabilities(req), controller);
      const events = mapClaudeStream(
        checked,
        signal,
        resolveResult,
        (id) => {
          sessionId = id;
        },
        toolSummaries,
      );

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

/** How long `claude auth status` may take to answer. */
const PROBE_TIMEOUT_MS = 15_000;

/** The packaged Claude Code the SDK runs: the binary in the SDK's package for this platform. */
function claudeExecutable(): string {
  const sdk = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const require = createRequire(import.meta.url);
  for (const candidate of [sdk, `${sdk}-musl`]) {
    try {
      return require.resolve(`${candidate}/${binary}`);
    } catch {
      continue;
    }
  }
  throw new Error(`The packaged Claude Code for ${process.platform}-${process.arch} is not installed`);
}

/** Reads sign-in from `claude auth status`, which answers from the stored login. */
function probeClaude(): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const options = { env: agentEnv(), windowsHide: true, timeout: PROBE_TIMEOUT_MS };
    execFile(claudeExecutable(), ['auth', 'status'], options, (err, stdout) => {
      try {
        const { loggedIn } = JSON.parse(stdout) as { loggedIn: boolean };
        resolve(loggedIn ? { ok: true } : { ok: false, detail: 'Claude Code is not signed in' });
      } catch {
        resolve({ ok: false, detail: err?.message ?? 'Claude Code did not report its sign-in status' });
      }
    });
  });
}

export function createClaudeAgentDriver(settings: ClaudeSettings = {}): AgentDriver {
  let signIn: ChildProcess | undefined;

  function endSignIn(): void {
    signIn?.kill();
    signIn = undefined;
  }

  return {
    name: 'claude',

    async probe(): Promise<ProbeResult> {
      try {
        return await probeClaude();
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },

    signIn() {
      endSignIn();
      const child = spawn(claudeExecutable(), ['auth', 'login', '--claudeai'], { env: agentEnv(), stdio: 'ignore', windowsHide: true });
      child.on('error', (err) => log.error({ err }, 'Claude sign-in could not start'));
      child.on('exit', (code) => log.info({ code }, 'Claude sign-in ended'));
      signIn = child;
    },

    endSignIn,

    async open(req: SessionRequest): Promise<AgentSession> {
      // Written on every open(), including a reopen of an existing
      // sessionId: that's how an agent switch or a skill fix reaches a
      // project already in progress.
      await writeWorkspaceFiles(req);
      return createClaudeSession(req, settings);
    },
  };
}
