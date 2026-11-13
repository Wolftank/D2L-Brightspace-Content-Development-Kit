import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HookCallback, PreToolUseHookInput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, SessionRequest, ToolResult, TurnResult } from './AgentDriver.js';

const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Done.',
  session_id: 'session-1',
  usage: { input_tokens: 1, output_tokens: 1 },
  total_cost_usd: 0,
  num_turns: 1,
};

/** The `cdk` server the fake SDK builds: the request's tools as `tool()` returned them. */
interface FakeToolServer {
  name: string;
  tools: Array<{ name: string; handler: (input: unknown) => Promise<unknown> }>;
}

/** A pre-tool call of `toolName` with `toolInput`, as the CLI sends it to a hook. */
function preToolUse(toolName: string, toolInput: Record<string, unknown>, cwd: string): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'call-1',
    session_id: 'session-1',
    transcript_path: '',
    cwd,
  };
}

describe('Claude turns', () => {
  let dir: string;
  let calls: Array<{ options: Record<string, unknown> }>;
  let messages: unknown[];
  let checkOutput: () => Promise<ToolResult>;

  function request(): SessionRequest {
    return {
      workspaceDir: join(dir, 'workspace'),
      sessionId: null,
      instructions: 'Follow instructions exactly.',
      skillsDir: join(dir, 'skills'),
      skills: ['allowed-skill'],
      tools: {
        name: 'cdk',
        tools: [
          {
            name: 'check_output',
            description: 'Runs the QA checker on out/.',
            summary: 'Checking the activity',
            input: {},
            handler: () => checkOutput(),
          },
        ],
      },
    };
  }

  async function runTurn(settings: object = {}): Promise<{ options: Record<string, unknown>; result: TurnResult }> {
    const { createClaudeAgentDriver } = await import('./claude.js');
    const session = await createClaudeAgentDriver(settings).open(request());
    const turn = session.send({ text: 'Hi', attachments: [] }, {}, new AbortController().signal);
    for await (const event of turn.events) void event;
    return { options: calls[0]!.options, result: await turn.result };
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cdk-claude-turn-'));
    for (const skill of ['allowed-skill', 'other-skill']) {
      await fs.mkdir(join(dir, 'skills', skill), { recursive: true });
      await fs.writeFile(join(dir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: A test skill.\n---\n`);
    }
    calls = [];
    messages = [RESULT];
    checkOutput = async () => ({ content: '{"passed":true,"findings":[]}' });
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (call: { options: Record<string, unknown> }) => {
        calls.push(call);
        return (async function* () {
          yield* messages;
        })();
      },
      createSdkMcpServer: (options: FakeToolServer) => options,
      tool: (name: string, _description: string, _input: unknown, handler: (input: unknown) => Promise<unknown>) => ({ name, handler }),
    }));
  });

  afterEach(async () => {
    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('runs a turn with the configured model and effort', async () => {
    const { options } = await runTurn({ model: 'claude-sonnet-5', effort: 'medium' });

    expect(options).toMatchObject({ model: 'claude-sonnet-5', effort: 'medium' });
  });

  it("runs the default model, and leaves effort to Claude's default, when neither is set", async () => {
    const { options } = await runTurn();

    expect(options).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(options).not.toHaveProperty('effort');
  });

  it("loads only the built-in tools, the request's skills, and the request's own tool server", async () => {
    const { BUILT_IN_TOOLS, MUTATING_TOOL_RULES } = await import('./claude.js');
    const { options } = await runTurn();

    expect(options).toMatchObject({
      permissionMode: 'dontAsk',
      settingSources: ['project'],
      tools: BUILT_IN_TOOLS,
      skills: ['allowed-skill'],
      strictMcpConfig: true,
      allowedTools: [...MUTATING_TOOL_RULES, 'mcp__cdk__check_output'],
    });
    expect(Object.keys(options.mcpServers as object)).toEqual(['cdk']);
    expect(options).not.toHaveProperty('plugins');
    expect(options).not.toHaveProperty('agents');
    expect(options).not.toHaveProperty('additionalDirectories');
  });

  it("delivers only the request's skills into the workspace", async () => {
    await runTurn();

    expect(await fs.readdir(join(dir, 'workspace', '.claude', 'skills'))).toEqual(['allowed-skill']);
  });

  it("starts the agent with only the variables it needs, never a secret from the back end's environment", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('CDK_TEST_SECRET', 'back-end-secret');
    vi.stubEnv('D2L_API_TOKEN', 'd2l-token');
    const { AGENT_SETTINGS_ENV, INHERITED_ENV } = await import('./claude.js');

    const { options } = await runTurn();
    const env = options.env as Record<string, string>;

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(env.PATH).toBe(process.env.PATH);
    expect(env).not.toHaveProperty('CDK_TEST_SECRET');
    expect(env).not.toHaveProperty('D2L_API_TOKEN');
    expect(Object.values(env)).not.toContain('back-end-secret');
    for (const name of Object.keys(env)) {
      expect([...INHERITED_ENV, ...Object.keys(AGENT_SETTINGS_ENV)]).toContain(name);
    }
  });

  it("serves the request's tools in-process, returning each handler's result", async () => {
    const { options } = await runTurn();
    const server = (options.mcpServers as Record<string, FakeToolServer>).cdk!;

    expect(server.name).toBe('cdk');
    expect(server.tools.map((tool) => tool.name)).toEqual(['check_output']);
    expect(await server.tools[0]!.handler({})).toEqual({
      content: [{ type: 'text', text: '{"passed":true,"findings":[]}' }],
      isError: false,
    });
  });

  it('gives the agent a plain error when a tool fails, and logs what went wrong', async () => {
    const { captureLog } = await import('../test/log.js');
    const logRecords = captureLog();
    const failure = new Error('EBUSY: resource busy or locked');
    checkOutput = async () => {
      throw failure;
    };
    const { options } = await runTurn();
    const server = (options.mcpServers as Record<string, FakeToolServer>).cdk!;

    expect(await server.tools[0]!.handler({})).toEqual({ content: [{ type: 'text', text: 'The tool failed to run.' }], isError: true });
    expect(logRecords).toContainEqual(
      expect.objectContaining({ level: 50, msg: 'A CDK tool failed', tool: 'mcp__cdk__check_output', err: expect.objectContaining({ message: failure.message }) }),
    );
  });

  it('logs what the agent process writes to standard error, with its workspace', async () => {
    const { captureLog } = await import('../test/log.js');
    const logRecords = captureLog();
    const { options } = await runTurn();

    (options.stderr as (output: string) => void)('Error: spawn EPERM\n');

    expect(logRecords).toContainEqual(
      expect.objectContaining({ level: 40, msg: 'Agent process error output', workspaceDir: join(dir, 'workspace'), output: 'Error: spawn EPERM' }),
    );
  });

  it('confines the file tools with a pre-tool hook that refuses a path outside the workspace', async () => {
    const { options } = await runTurn();
    const hooks = options.hooks as { PreToolUse: Array<{ hooks: HookCallback[] }> };
    const workspaceDir = join(dir, 'workspace');

    expect(hooks.PreToolUse).toHaveLength(1);
    const output = await hooks.PreToolUse[0]!.hooks[0]!(
      preToolUse('Read', { file_path: join(dir, 'skills', 'other-skill', 'SKILL.md') }, workspaceDir),
      'call-1',
      { signal: new AbortController().signal },
    );
    expect(output).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  });

  it('fails the turn with agent_unrestricted when the session loads a tool it may not', async () => {
    const { BUILT_IN_TOOLS } = await import('./claude.js');
    messages = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'session-1',
        tools: [...BUILT_IN_TOOLS, 'WebFetch'],
        mcp_servers: [],
        skills: ['allowed-skill'],
        agents: [],
        plugins: [],
      },
      RESULT,
    ];

    const { result } = await runTurn();

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'agent_unrestricted', message: expect.stringContaining('unexpected tools: WebFetch') },
    });
  });
});

describe('Claude turns, cancelled', () => {
  let dir: string;
  let queryOptions: Record<string, unknown> | undefined;
  let interrupt: () => Promise<unknown>;
  let afterInit: (signal: AbortSignal) => AsyncIterable<unknown>;

  /** The result the CLI sends for an interrupted turn. */
  const INTERRUPTED = {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: ['[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null'],
    session_id: 'session-1',
    usage: { input_tokens: 5, output_tokens: 2 },
    total_cost_usd: 0.01,
    num_turns: 1,
  };

  /** Works until the query is aborted, then throws as an aborted query does. */
  async function* untilAborted(signal: AbortSignal): AsyncGenerator<unknown> {
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    throw new Error('Operation aborted');
  }

  function queryAborted(): boolean {
    return (queryOptions!.abortController as AbortController).signal.aborted;
  }

  /** Starts a turn in a new session and consumes its events. */
  async function startTurn(signal: AbortSignal) {
    const { createClaudeAgentDriver } = await import('./claude.js');
    const session = await createClaudeAgentDriver().open({
      workspaceDir: join(dir, 'workspace'),
      sessionId: null,
      instructions: 'Follow instructions exactly.',
      skillsDir: join(dir, 'skills'),
      skills: [],
      tools: { name: 'cdk', tools: [] },
    });
    const turn = session.send({ text: 'Write a long essay', attachments: [] }, {}, signal);
    const drained = (async () => {
      for await (const event of turn.events) void event;
    })();
    return { result: turn.result, drained };
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cdk-claude-cancel-'));
    await fs.mkdir(join(dir, 'skills'));
    queryOptions = undefined;
    interrupt = async () => undefined;
    afterInit = untilAborted;
    const { BUILT_IN_TOOLS } = await import('./claude.js');
    const init = { type: 'system', subtype: 'init', session_id: 'session-1', tools: BUILT_IN_TOOLS, mcp_servers: [], skills: [], agents: [], plugins: [] };
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: ({ options }: { options: Record<string, unknown> }) => {
        queryOptions = options;
        const stream = (async function* () {
          yield init;
          yield* afterInit((options.abortController as AbortController).signal);
        })();
        return Object.assign(stream, { interrupt: () => interrupt() });
      },
      createSdkMcpServer: (options: FakeToolServer) => options,
      tool: (name: string) => ({ name }),
    }));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('interrupts the turn when its signal fires and reports it cancelled with its session id and usage, leaving the query unaborted', async () => {
    let interrupted!: () => void;
    const interruption = new Promise<void>((resolve) => {
      interrupted = resolve;
    });
    interrupt = async () => interrupted();
    afterInit = async function* () {
      await interruption;
      yield INTERRUPTED;
    };
    const controller = new AbortController();
    const turn = await startTurn(controller.signal);

    controller.abort();
    await turn.drained;

    expect(await turn.result).toEqual({
      status: 'cancelled',
      sessionId: 'session-1',
      text: '',
      usage: { inputTokens: 5, outputTokens: 2, costUsd: 0.01, steps: 1 },
    });
    expect(queryAborted()).toBe(false);
  });

  it('aborts the query when an interrupted turn has not ended within the grace period', async () => {
    const { INTERRUPT_GRACE_MS } = await import('./claude.js');
    const controller = new AbortController();
    const turn = await startTurn(controller.signal);
    vi.useFakeTimers();

    controller.abort();
    await vi.advanceTimersByTimeAsync(INTERRUPT_GRACE_MS - 1);
    expect(queryAborted()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await turn.drained;

    expect(queryAborted()).toBe(true);
    expect(await turn.result).toEqual({ status: 'cancelled', sessionId: 'session-1', text: '' });
  });
});

describe('Claude sign-in', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(join(tmpdir(), 'cdk-claude-config-'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', configDir);
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', undefined);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock('node:child_process');
    vi.resetModules();
    vi.unstubAllEnvs();
    await fs.rm(configDir, { recursive: true, force: true });
  });

  it('reports the packaged Claude Code signed out with no login, and signed in with one', async () => {
    const { createClaudeAgentDriver } = await import('./claude.js');
    const driver = createClaudeAgentDriver();

    expect(await driver.probe()).toEqual({ ok: false, detail: 'Claude Code is not signed in' });

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-not-a-real-key');
    expect(await driver.probe()).toEqual({ ok: true });
  }, 30_000);

  it("starts the packaged Claude Code's subscription sign-in, replacing one still waiting", async () => {
    const started: Array<{ command: string; args: string[]; kill: ReturnType<typeof vi.fn> }> = [];
    vi.doMock('node:child_process', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:child_process')>()),
      spawn: (command: string, args: string[]) => {
        const child = { command, args, kill: vi.fn(), on: vi.fn() };
        started.push(child);
        return child;
      },
    }));
    const { createClaudeAgentDriver } = await import('./claude.js');
    const driver = createClaudeAgentDriver();

    driver.signIn();
    driver.signIn();

    expect(started).toHaveLength(2);
    expect(started[1]!.command).toMatch(/claude-agent-sdk-[\w-]+[\\/]claude(\.exe)?$/);
    expect(started[1]!.args).toEqual(['auth', 'login', '--claudeai']);
    expect(started[0]!.kill).toHaveBeenCalledOnce();
    expect(started[1]!.kill).not.toHaveBeenCalled();

    driver.endSignIn();
    expect(started[1]!.kill).toHaveBeenCalledOnce();
  });
});

describe('confineToWorkspace', () => {
  let dir: string;
  let workspaceDir: string;
  let outsideDir: string;

  async function decide(toolName: string, toolInput: Record<string, unknown>) {
    const { confineToWorkspace } = await import('./claude.js');
    const input = preToolUse(toolName, toolInput, workspaceDir);
    const output = await confineToWorkspace(workspaceDir)(input, 'call-1', { signal: new AbortController().signal });
    return 'hookSpecificOutput' in output && output.hookSpecificOutput?.hookEventName === 'PreToolUse'
      ? (output.hookSpecificOutput.permissionDecision ?? 'none')
      : 'none';
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cdk-confine-'));
    workspaceDir = join(dir, 'workspace');
    outsideDir = join(dir, 'outside');
    await fs.mkdir(join(workspaceDir, 'out'), { recursive: true });
    await fs.mkdir(outsideDir);
    await fs.writeFile(join(workspaceDir, 'out', 'index.html'), '<html></html>');
    await fs.writeFile(join(outsideDir, 'secret.txt'), 'secret');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lets the file tools use paths inside the workspace, existing or not', async () => {
    expect(await decide('Read', { file_path: join(workspaceDir, 'out', 'index.html') })).toBe('none');
    expect(await decide('Write', { file_path: join(workspaceDir, 'out', 'new', 'page.html'), content: '' })).toBe('none');
    expect(await decide('Edit', { file_path: 'out/index.html', old_string: 'a', new_string: 'b' })).toBe('none');
    expect(await decide('Glob', { pattern: '**/*.html' })).toBe('none');
    expect(await decide('Grep', { pattern: 'html', path: join(workspaceDir, 'out') })).toBe('none');
  });

  it('refuses a read outside the workspace', async () => {
    expect(await decide('Read', { file_path: join(outsideDir, 'secret.txt') })).toBe('deny');
  });

  it('refuses a write outside the workspace', async () => {
    expect(await decide('Write', { file_path: join(outsideDir, 'new.txt'), content: 'x' })).toBe('deny');
  });

  it('refuses a write inside the workspace but outside out/, and still allows reading there', async () => {
    expect(await decide('Write', { file_path: join(workspaceDir, 'files', 'notes.txt'), content: 'x' })).toBe('deny');
    expect(await decide('Edit', { file_path: 'CLAUDE.md', old_string: 'a', new_string: 'b' })).toBe('deny');
    expect(await decide('Write', { file_path: join(workspaceDir, '.claude', 'settings.json'), content: '{}' })).toBe('deny');
    expect(await decide('Edit', { file_path: 'out/../CLAUDE.md', old_string: 'a', new_string: 'b' })).toBe('deny');
    expect(await decide('Read', { file_path: join(workspaceDir, 'CLAUDE.md') })).toBe('none');
  });

  it('refuses a write through a link in out/ that leads elsewhere in the workspace', async () => {
    await fs.mkdir(join(workspaceDir, 'files'));
    await fs.symlink(join(workspaceDir, 'files'), join(workspaceDir, 'out', 'sources'), 'junction');

    expect(await decide('Write', { file_path: join(workspaceDir, 'out', 'sources', 'notes.txt'), content: 'x' })).toBe('deny');
  });

  it('refuses a path that leaves the workspace through ..', async () => {
    expect(await decide('Read', { file_path: join(workspaceDir, 'out', '..', '..', 'outside', 'secret.txt') })).toBe('deny');
    expect(await decide('Edit', { file_path: '../outside/secret.txt', old_string: 'a', new_string: 'b' })).toBe('deny');
  });

  it('refuses a search outside the workspace', async () => {
    expect(await decide('Grep', { pattern: 'secret', path: outsideDir })).toBe('deny');
    expect(await decide('Glob', { pattern: '*.txt', path: outsideDir })).toBe('deny');
    expect(await decide('Glob', { pattern: join(outsideDir, '*.txt') })).toBe('deny');
    expect(await decide('Glob', { pattern: '../outside/**' })).toBe('deny');
  });

  it('refuses a path through a link in the workspace that leads outside it', async () => {
    await fs.symlink(outsideDir, join(workspaceDir, 'link'), 'junction');

    expect(await decide('Read', { file_path: join(workspaceDir, 'link', 'secret.txt') })).toBe('deny');
    expect(await decide('Write', { file_path: join(workspaceDir, 'link', 'new.txt'), content: 'x' })).toBe('deny');
  });

  it('refuses a path through a link whose target does not exist yet', async () => {
    await fs.symlink(join(outsideDir, 'missing'), join(workspaceDir, 'dangling'), 'junction');

    expect(await decide('Write', { file_path: join(workspaceDir, 'dangling', 'new.txt'), content: 'x' })).toBe('deny');
  });

  it('refuses a home-directory path, reading ~ the way the CLI does', async () => {
    expect(await decide('Read', { file_path: '~/.claude/.credentials.json' })).toBe('deny');
    expect(await decide('Read', { file_path: '~\\.claude\\.credentials.json' })).toBe('deny');
    expect(await decide('Glob', { pattern: '*', path: '~' })).toBe('deny');
    expect(await decide('Grep', { pattern: 'token', path: '~' })).toBe('deny');
  });

  it('refuses an outside path padded with whitespace, which the CLI trims', async () => {
    expect(await decide('Read', { file_path: ` ${join(outsideDir, 'secret.txt')}` })).toBe('deny');
    expect(await decide('Write', { file_path: `\n${join(outsideDir, 'new.txt')}`, content: 'x' })).toBe('deny');
  });

  it('leaves the CDK tools, which confine themselves, to their own checks', async () => {
    expect(await decide('mcp__cdk__delete_files', { paths: [join(outsideDir, 'secret.txt')] })).toBe('none');
  });
});

describe('the session check against a recorded unrestricted session', () => {
  it('names every extra the recorded session loaded', async () => {
    const { allowedCapabilities, capabilityDifferences } = await import('./claude.js');
    const init = (await loadFixtureMessages())[0];
    if (init?.type !== 'system' || init.subtype !== 'init') throw new Error('The fixture does not start with an init message');

    const differences = capabilityDifferences(
      init,
      allowedCapabilities({ tools: { name: 'cdk', tools: [] }, skills: ['d2l-scorm-package', 'd2l-tenant-qa'] }),
    );

    expect(differences).toEqual([
      expect.stringMatching(/^unexpected tools: .*\bTask\b.*\bWebFetch\b.*\bWebSearch\b/),
      'missing skills: d2l-scorm-package, d2l-tenant-qa',
      expect.stringMatching(/^unexpected MCP servers: .*claude\.ai Notion/),
      expect.stringMatching(/^unexpected subagents: .*\bgeneral-purpose\b/),
    ]);
  });
});

const FIXTURE_PATH = fileURLToPath(new URL('./__fixtures__/claude-write-file-turn.jsonl', import.meta.url));

async function loadFixtureMessages(): Promise<SDKMessage[]> {
  const raw = await fs.readFile(FIXTURE_PATH, 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as SDKMessage);
}

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe('mapClaudeStream: recorded fixture replay', () => {
  it('maps a real write-a-file turn (recorded 2026-09-17) to the exact events and result', async () => {
    const { mapClaudeStream } = await import('./claude.js');
    const messages = await loadFixtureMessages();

    const controller = new AbortController();
    let result: TurnResult | undefined;
    let sessionId: string | null = null;
    const events: AgentEvent[] = [];

    for await (const event of mapClaudeStream(
      toAsyncIterable(messages),
      controller.signal,
      (r) => {
        result = r;
      },
      (id) => {
        sessionId = id;
      },
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { kind: 'status', text: 'Thinking…', category: 'thinking' as const },
      { kind: 'message_start' },
      { kind: 'status', text: 'Thinking…', category: 'thinking' as const },
      {
        kind: 'tool_start',
        callId: 'toolu_018tyabejV94NG5tssLuXjyE',
        name: 'Write',
        summary: 'Writing hello.txt',
        category: 'writing' as const,
      },
      {
        kind: 'tool_end',
        callId: 'toolu_018tyabejV94NG5tssLuXjyE',
        ok: true,
        output:
          'File created successfully at: C:\\Users\\benja\\AppData\\Local\\Temp\\cdk-fixture-workspace-fGQ0EP\\hello.txt (file state is current in your context — no need to Read it back)',
      },
      { kind: 'status', text: 'Thinking…', category: 'thinking' as const },
      { kind: 'message_start' },
      { kind: 'status', text: 'Updating you', category: 'other' },
      { kind: 'text_delta', text: 'Created' },
      { kind: 'text_delta', text: ' h' },
      { kind: 'text_delta', text: 'ello' },
      { kind: 'text_delta', text: '.txt in' },
      { kind: 'text_delta', text: ' the workspace root with' },
      { kind: 'text_delta', text: ' the content "hello".' },
    ]);

    expect(sessionId).toBe('65391737-39a0-4c11-b632-0789a0298bc3');
    expect(result).toEqual({
      status: 'completed',
      sessionId: '65391737-39a0-4c11-b632-0789a0298bc3',
      text: 'Created hello.txt in the workspace root with the content "hello".',
      usage: {
        inputTokens: 4,
        outputTokens: 201,
        costUsd: 0.1152924,
        steps: 2,
      },
    });
  });

  it("sends the recorded Write call's line once its file name has streamed, before its content", async () => {
    const messages = await loadFixtureMessages();
    const { events, readAt } = await replayCountingReads(messages);

    const lineAt = readAt[events.findIndex((event) => event.kind === 'tool_start')];
    const inputStillStreaming = messages.slice(lineAt).some(
      (message) =>
        message.type === 'stream_event' &&
        message.event.type === 'content_block_delta' &&
        message.event.delta.type === 'input_json_delta',
    );
    expect(inputStillStreaming).toBe(true);
  });
});

/** Replays `messages` through mapClaudeStream. `readAt[i]` is how many
 *  messages had been read from the stream when `events[i]` was emitted. */
async function replayCountingReads(messages: SDKMessage[]) {
  const { mapClaudeStream } = await import('./claude.js');
  let read = 0;
  async function* source(): AsyncGenerator<SDKMessage> {
    for (const message of messages) {
      read++;
      yield message;
    }
  }

  const events: AgentEvent[] = [];
  const readAt: number[] = [];
  for await (const event of mapClaudeStream(source(), new AbortController().signal, () => {}, () => {})) {
    events.push(event);
    readAt.push(read);
  }
  return { events, readAt };
}
