import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, TurnResult } from './AgentDriver.js';

const BARE_FILE_AND_WEB_TOOL_NAMES = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];

/** Replays `messages` through mapClaudeStream. `readAt[i]` is how many
 *  messages had been read from the stream when `events[i]` was emitted. */
async function replay(messages: unknown[]) {
  const { mapClaudeStream } = await import('./claude.js');
  let read = 0;
  async function* source(): AsyncGenerator<SDKMessage> {
    for (const message of messages) {
      read++;
      yield message as SDKMessage;
    }
  }

  let result: TurnResult | undefined;
  const events: AgentEvent[] = [];
  const readAt: number[] = [];
  for await (const event of mapClaudeStream(
    source(),
    new AbortController().signal,
    (r) => {
      result = r;
    },
    () => {},
  )) {
    events.push(event);
    readAt.push(read);
  }
  return { events, readAt, result };
}

function streamEvent(event: unknown, parentToolUseId: string | null = null) {
  return { type: 'stream_event', event, parent_tool_use_id: parentToolUseId };
}

function toolUseStart(index: number, id: string, name: string, parentToolUseId: string | null = null) {
  return streamEvent(
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
    parentToolUseId,
  );
}

function inputDelta(index: number, partialJson: string, parentToolUseId: string | null = null) {
  return streamEvent(
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } },
    parentToolUseId,
  );
}

function assistantToolUse(id: string, name: string, input: unknown, parentToolUseId: string | null = null) {
  return {
    type: 'assistant',
    parent_tool_use_id: parentToolUseId,
    message: { content: [{ type: 'tool_use', id, name, input }] },
  };
}

function toolResult(id: string, parentToolUseId: string | null = null) {
  return {
    type: 'user',
    parent_tool_use_id: parentToolUseId,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
  };
}

describe('buildAllowedTools', () => {
  it('never contains a bare file or web tool name', async () => {
    const { buildAllowedTools } = await import('./claude.js');
    const result = buildAllowedTools(['mcp__cdk__create_build', 'mcp__cdk__get_project']);

    for (const bareName of BARE_FILE_AND_WEB_TOOL_NAMES) {
      expect(result).not.toContain(bareName);
    }
  });

  it('mirrors every mutating rule from settings.json and appends MCP tool names as-is', async () => {
    const { buildAllowedTools, MUTATING_TOOL_RULES, WORKSPACE_SETTINGS } = await import('./claude.js');
    const result = buildAllowedTools(['mcp__cdk__create_build']);

    for (const rule of MUTATING_TOOL_RULES) {
      expect(WORKSPACE_SETTINGS.permissions.allow).toContain(rule);
      expect(result).toContain(rule);
    }
    expect(result).toContain('mcp__cdk__create_build');
  });

  it("does not mirror settings.json's Read rule, which auto-approves on its own", async () => {
    const { buildAllowedTools, WORKSPACE_SETTINGS } = await import('./claude.js');
    expect(WORKSPACE_SETTINGS.permissions.allow).toContain('Read(/**)');
    expect(buildAllowedTools([])).not.toContain('Read(/**)');
  });
});

describe('the shell', () => {
  async function importOnPlatform(platform: NodeJS.Platform) {
    vi.resetModules();
    vi.doMock('node:os', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:os')>()),
      platform: () => platform,
    }));
    return import('./claude.js');
  }

  afterEach(() => {
    vi.doUnmock('node:os');
    vi.resetModules();
  });

  it('loads PowerShell, not Bash, on Windows and allows every PowerShell command', async () => {
    const { BUILT_IN_TOOLS, agentEnv, buildAllowedTools } = await importOnPlatform('win32');

    expect(BUILT_IN_TOOLS).toContain('PowerShell');
    expect(BUILT_IN_TOOLS).not.toContain('Bash');
    expect(buildAllowedTools([])).toContain('PowerShell');
    expect(agentEnv()).toMatchObject({ CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' });
  });

  it('loads Bash, not PowerShell, elsewhere and allows every Bash command', async () => {
    const { BUILT_IN_TOOLS, agentEnv, buildAllowedTools } = await importOnPlatform('linux');

    expect(BUILT_IN_TOOLS).toContain('Bash');
    expect(BUILT_IN_TOOLS).not.toContain('PowerShell');
    expect(buildAllowedTools([])).toContain('Bash');
    expect(agentEnv()).not.toHaveProperty('CLAUDE_CODE_USE_POWERSHELL_TOOL');
  });
});

describe('the agent environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the agent's sign-in and leaves out every other variable from the back end", async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('CDK_TEST_SECRET', 'back-end-secret');
    vi.stubEnv('GITHUB_TOKEN', 'ghp-back-end-token');
    const { agentEnv } = await import('./claude.js');

    const env = agentEnv();

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
    expect(env).not.toHaveProperty('CDK_TEST_SECRET');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(Object.values(env)).not.toContain('back-end-secret');
  });

  it("holds only the inherited variables and the driver's own settings", async () => {
    const { AGENT_SETTINGS_ENV, INHERITED_ENV, agentEnv } = await import('./claude.js');
    const known = [...INHERITED_ENV, ...Object.keys(AGENT_SETTINGS_ENV)];

    for (const name of Object.keys(agentEnv())) {
      expect(known).toContain(name);
    }
  });

  it('turns off bundled skills, built-in subagents, and auto memory', async () => {
    const { agentEnv } = await import('./claude.js');

    expect(agentEnv()).toMatchObject({
      CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
      CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    });
  });
});

const SKILLS = ['d2l-scorm-package', 'd2l-tenant-qa'];

/** An `init` message reporting exactly what a session with `SKILLS` and no `cdk` tools may load. */
async function initMessage() {
  const { BUILT_IN_TOOLS } = await import('./claude.js');
  return {
    type: 'system',
    subtype: 'init',
    session_id: 'session-1',
    tools: BUILT_IN_TOOLS,
    mcp_servers: [] as Array<{ name: string; status: string }>,
    skills: SKILLS,
    agents: [] as string[],
    plugins: [] as Array<{ name: string; path: string }>,
  };
}

type InitMessage = Awaited<ReturnType<typeof initMessage>>;

describe('allowedCapabilities', () => {
  it("allows the built-in tools, each cdk tool by its qualified name, the request's skills, and the cdk server", async () => {
    const { BUILT_IN_TOOLS, allowedCapabilities } = await import('./claude.js');
    const createBuild = {
      name: 'create_build',
      description: 'Copies out/ and runs the QA gate',
      inputSchema: z.object({}),
      handler: async () => ({ content: '' }),
    };

    expect(allowedCapabilities({ tools: { name: 'cdk', tools: [createBuild] }, skills: SKILLS })).toEqual({
      tools: [...BUILT_IN_TOOLS, 'mcp__cdk__create_build'],
      skills: SKILLS,
      mcpServers: ['cdk'],
    });
  });
});

describe('capabilityDifferences', () => {
  async function differences(change: (init: InitMessage) => Partial<InitMessage>) {
    const { allowedCapabilities, capabilityDifferences } = await import('./claude.js');
    const allowed = allowedCapabilities({ tools: { name: 'cdk', tools: [] }, skills: SKILLS });
    const init = await initMessage();
    return capabilityDifferences({ ...init, ...change(init) }, allowed);
  }

  it('finds none when the session loaded exactly what it may', async () => {
    expect(await differences(() => ({}))).toEqual([]);
  });

  const cases: Array<[string, (init: InitMessage) => Partial<InitMessage>, string]> = [
    ['an extra tool', (init) => ({ tools: [...init.tools, 'WebFetch'] }), 'unexpected tools: WebFetch'],
    ['a missing tool', (init) => ({ tools: init.tools.filter((tool) => tool !== 'Skill') }), 'missing tools: Skill'],
    ['an extra skill', () => ({ skills: [...SKILLS, 'code-review'] }), 'unexpected skills: code-review'],
    ['a missing skill', () => ({ skills: ['d2l-scorm-package'] }), 'missing skills: d2l-tenant-qa'],
    [
      'an outside connector',
      () => ({ mcp_servers: [{ name: 'claude.ai Notion', status: 'needs-auth' }] }),
      'unexpected MCP servers: claude.ai Notion',
    ],
    ['a subagent', () => ({ agents: ['general-purpose'] }), 'unexpected subagents: general-purpose'],
    ['a plugin', () => ({ plugins: [{ name: 'helper', path: '/plugins/helper' }] }), 'unexpected plugins: helper'],
  ];

  it.each(cases)('names %s', async (_case, change, expected) => {
    expect(await differences(change)).toEqual([expected]);
  });
});

describe('enforceCapabilities', () => {
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

  async function runChecked(messages: unknown[]) {
    const { allowedCapabilities, enforceCapabilities, mapClaudeStream } = await import('./claude.js');
    const allowed = allowedCapabilities({ tools: { name: 'cdk', tools: [] }, skills: SKILLS });
    const controller = new AbortController();
    let read = 0;
    async function* source(): AsyncGenerator<SDKMessage> {
      for (const message of messages) {
        read++;
        yield message as SDKMessage;
      }
    }

    let result: TurnResult | undefined;
    const events: AgentEvent[] = [];
    const checked = enforceCapabilities(source(), allowed, controller);
    for await (const event of mapClaudeStream(
      checked,
      new AbortController().signal,
      (r) => {
        result = r;
      },
      () => {},
    )) {
      events.push(event);
    }
    return { result, events, read, aborted: controller.signal.aborted };
  }

  it('runs a turn whose session loaded exactly what it may', async () => {
    const { result, aborted } = await runChecked([await initMessage(), RESULT]);

    expect(result).toMatchObject({ status: 'completed', text: 'Done.' });
    expect(aborted).toBe(false);
  });

  it('stops the agent and fails the turn with a clear error when the session loaded an extra tool', async () => {
    const init = await initMessage();
    const { result, events, read, aborted } = await runChecked([
      { ...init, tools: [...init.tools, 'WebSearch'] },
      { type: 'system', subtype: 'status', status: 'requesting' },
      RESULT,
    ]);

    expect(result).toEqual({
      status: 'failed',
      sessionId: null,
      text: '',
      error: {
        code: 'agent_unrestricted',
        message: 'The agent session did not load exactly its allowed tools and skills: unexpected tools: WebSearch',
      },
    });
    expect(events).toEqual([]);
    expect(read).toBe(1);
    expect(aborted).toBe(true);
  });

  it('stops the agent and fails the turn when the session loaded an extra skill', async () => {
    const { result, aborted } = await runChecked([{ ...(await initMessage()), skills: [...SKILLS, 'debug'] }, RESULT]);

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'agent_unrestricted', message: expect.stringContaining('unexpected skills: debug') },
    });
    expect(aborted).toBe(true);
  });
});

describe('mapClaudeStream: progress', () => {
  it('reports thinking at each model request and at each thinking block', async () => {
    const { events } = await replay([
      { type: 'system', subtype: 'status', status: 'requesting' },
      streamEvent({ type: 'message_start', message: {} }),
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
      streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: '' } }),
    ]);

    expect(events).toEqual([
      { kind: 'status', text: 'Thinking…' },
      { kind: 'status', text: 'Thinking…' },
      { kind: 'status', text: 'Thinking…' },
    ]);
  });

  it('sends a tool line as soon as its summary is known, and only once', async () => {
    const { events, readAt } = await replay([
      toolUseStart(0, 'call-1', 'Write'),
      inputDelta(0, '{"file_path": "/ws/out/ind'),
      inputDelta(0, 'ex.html"'),
      inputDelta(0, ', "content": "<html>'),
      inputDelta(0, '</html>"}'),
      assistantToolUse('call-1', 'Write', { file_path: '/ws/out/index.html', content: '<html></html>' }),
      toolResult('call-1'),
    ]);

    expect(events).toEqual([
      { kind: 'tool_start', callId: 'call-1', name: 'Write', summary: 'Writing index.html' },
      { kind: 'tool_end', callId: 'call-1', ok: true, output: 'ok' },
    ]);
    expect(readAt[0]).toBe(3);
  });

  it('sends a line that needs no input when the call starts', async () => {
    const { events, readAt } = await replay([toolUseStart(0, 'call-1', 'Grep'), inputDelta(0, '{"pattern": "x"}')]);

    expect(events).toEqual([{ kind: 'tool_start', callId: 'call-1', name: 'Grep', summary: 'Searching the files' }]);
    expect(readAt[0]).toBe(1);
  });

  it('sends one line from the completed message when the summary is known only at the end', async () => {
    const { events, readAt } = await replay([
      toolUseStart(0, 'call-1', 'PowerShell'),
      inputDelta(0, '{"command": "node lint.js out"'),
      inputDelta(0, '}'),
      assistantToolUse('call-1', 'PowerShell', { command: 'node lint.js out' }),
    ]);

    expect(events).toEqual([{ kind: 'tool_start', callId: 'call-1', name: 'PowerShell', summary: 'Running a command' }]);
    expect(readAt[0]).toBe(4);
  });

  it('keeps streaming calls apart by block index', async () => {
    const { events } = await replay([
      toolUseStart(0, 'call-1', 'Read'),
      toolUseStart(1, 'call-2', 'Edit'),
      inputDelta(1, '{"file_path": "/ws/out/b.html"'),
      inputDelta(0, '{"file_path": "/ws/out/a.html"'),
    ]);

    expect(events).toEqual([
      { kind: 'tool_start', callId: 'call-2', name: 'Edit', summary: 'Editing b.html' },
      { kind: 'tool_start', callId: 'call-1', name: 'Read', summary: 'Reading a.html' },
    ]);
  });

  it('reports a retried request', async () => {
    const { events } = await replay([
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 500,
        error_status: 529,
        error: 'overloaded',
      },
    ]);

    expect(events).toEqual([{ kind: 'status', text: "The agent's service is busy. Trying again…" }]);
  });

  it('reports condensing when it starts and nothing when it ends', async () => {
    const { events } = await replay([
      { type: 'system', subtype: 'status', status: 'compacting' },
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 180_000 } },
      { type: 'system', subtype: 'status', status: null, compact_result: 'success' },
    ]);

    expect(events).toEqual([{ kind: 'status', text: 'Condensing the conversation…' }]);
  });

  it("reports nothing for a subagent's activity", async () => {
    const agent = 'toolu_agent';
    const { events } = await replay([
      streamEvent({ type: 'message_start', message: {} }, agent),
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, agent),
      streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Looking' } }, agent),
      toolUseStart(2, 'call-sub', 'Read', agent),
      inputDelta(2, '{"file_path": "/ws/out/a.html"}', agent),
      assistantToolUse('call-sub', 'Read', { file_path: '/ws/out/a.html' }, agent),
      toolResult('call-sub', agent),
    ]);

    expect(events).toEqual([]);
  });
});

describe('summarizeTool', () => {
  it.each([
    ['PowerShell', { command: 'node lint.js out', description: 'Run the QA check' }, 'Run the QA check'],
    ['Bash', { command: 'ls' }, 'Running a command'],
    ['Read', { file_path: 'C:\\ws\\kit\\skills\\d2l-scorm-package\\SKILL.md' }, 'Reading SKILL.md'],
    ['Write', { file_path: '/ws/out/index.html' }, 'Writing index.html'],
    ['Edit', { file_path: '/ws/out/imsmanifest.xml' }, 'Editing imsmanifest.xml'],
    ['Edit', {}, 'Editing a file'],
    ['Grep', { pattern: 'suspend_data' }, 'Searching the files'],
    ['TodoWrite', { todos: [] }, 'Using TodoWrite'],
  ])('describes %s %j as %j', async (name, input, expected) => {
    const { summarizeTool } = await import('./claude.js');
    expect(summarizeTool(name, input)).toBe(expected);
  });
});

describe('mapClaudeStream: provider failures', () => {
  const errorResult = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: 'API Error: 429 rate limited',
    api_error_status: 429,
    session_id: 'session-1',
    usage: { input_tokens: 3, output_tokens: 0 },
    total_cost_usd: 0,
    num_turns: 1,
  };

  it.each([
    ['rate_limit', 'agent_busy'],
    ['overloaded', 'agent_busy'],
    ['authentication_failed', 'agent_signed_out'],
    ['oauth_org_not_allowed', 'agent_signed_out'],
    ['verification_required', 'agent_signed_out'],
    ['billing_error', 'agent_billing'],
    ['account_on_hold', 'agent_billing'],
    ['server_error', 'agent_error'],
  ])('fails a result the provider marked as an error after a %s message with code %s', async (assistantError, code) => {
    const { result } = await replay([{ type: 'assistant', error: assistantError, message: { content: [] } }, errorResult]);

    expect(result).toMatchObject({ status: 'failed', error: { code, message: 'API Error: 429 rate limited' } });
  });

  it('fails a result the provider marked as an error with no assistant error as agent_error', async () => {
    const { result } = await replay([errorResult]);

    expect(result).toMatchObject({ status: 'failed', error: { code: 'agent_error' } });
  });

  it('reports a denied tool call as a plain notice', async () => {
    const { events } = await replay([
      {
        type: 'system',
        subtype: 'permission_denied',
        tool_name: 'Write',
        decision_reason_type: 'mode',
        message: 'Permission to use Write has been denied because Claude Code is running in don\'t ask mode.',
      },
    ]);

    expect(events).toEqual([{ kind: 'notice', text: 'The agent was denied permission to use Write.' }]);
  });
});

describe('mapClaudeStream: cancellation', () => {
  it("resolves 'cancelled' on the SDK's plain abort error", async () => {
    const { mapClaudeStream } = await import('./claude.js');

    async function* abortingStream(): AsyncGenerator<SDKMessage> {
      throw new Error('Operation aborted');
    }

    const controller = new AbortController();
    let result: TurnResult | undefined;
    const events: AgentEvent[] = [];

    for await (const event of mapClaudeStream(
      abortingStream(),
      controller.signal,
      (r) => {
        result = r;
      },
      () => {},
    )) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(result).toEqual({ status: 'cancelled', sessionId: null, text: '' });
  });

  it('resolves cancelled (not failed) when signal.aborted is already true, even for a differently-worded error', async () => {
    const { mapClaudeStream } = await import('./claude.js');

    async function* obscureFailure(): AsyncGenerator<SDKMessage> {
      throw new Error('stream closed');
    }

    const controller = new AbortController();
    controller.abort();
    let result: TurnResult | undefined;
    const events: AgentEvent[] = [];

    for await (const event of mapClaudeStream(
      obscureFailure(),
      controller.signal,
      (r) => {
        result = r;
      },
      () => {},
    )) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(result?.status).toBe('cancelled');
  });

  it('resolves failed for a non-abort error', async () => {
    const { mapClaudeStream } = await import('./claude.js');

    async function* brokenStream(): AsyncGenerator<SDKMessage> {
      throw new Error('ECONNRESET');
    }

    const controller = new AbortController();
    let result: TurnResult | undefined;
    const events: AgentEvent[] = [];

    for await (const event of mapClaudeStream(
      brokenStream(),
      controller.signal,
      (r) => {
        result = r;
      },
      () => {},
    )) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(result).toEqual({
      status: 'failed',
      sessionId: null,
      text: '',
      error: { code: 'driver_error', message: 'ECONNRESET' },
    });
  });
});

/** Builds a fake `Query` (as returned by `query()`) that yields `messages`
 *  in order, then hangs — matching how a real query never "completes" on
 *  its own once aborted; probeClaude() is expected to abort and return
 *  before ever exhausting it. */
function fakeQuery(messages: unknown[]) {
  let i = 0;
  return {
    next: async () => {
      if (i < messages.length) return { done: false, value: messages[i++] };
      return new Promise(() => {}); // no more messages; never resolves
    },
  };
}

const INIT_MESSAGE = {
  type: 'system',
  subtype: 'init',
  session_id: 'session-1',
  claude_code_version: '1.2.3',
};

describe('createClaudeAgentDriver().probe()', () => {
  it.each([
    ['the configured model', { model: 'claude-sonnet-5' }, { model: 'claude-sonnet-5' }],
    ['no model when none is configured', {}, {}],
  ])('probes with %s, saves no transcript, and loads no outside connectors', async (_case, settings, expected) => {
    vi.resetModules();
    const calls: Array<{ options: Record<string, unknown> }> = [];
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (call: { options: Record<string, unknown> }) => {
        calls.push(call);
        return fakeQuery([INIT_MESSAGE, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }]);
      },
    }));

    const { createClaudeAgentDriver } = await import('./claude.js');
    await createClaudeAgentDriver(settings).probe();

    const { agentEnv } = await import('./claude.js');
    expect(calls[0]!.options).toMatchObject({ persistSession: false, strictMcpConfig: true, env: agentEnv(), ...expected });
    if (!('model' in expected)) expect(calls[0]!.options).not.toHaveProperty('model');

    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
  });

  it('returns ok: false with a non-empty detail when the turn fails to authenticate', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () =>
        fakeQuery([INIT_MESSAGE, { type: 'assistant', error: 'authentication_failed', message: { content: [] } }]),
    }));

    const { createClaudeAgentDriver } = await import('./claude.js');
    const result = await createClaudeAgentDriver().probe();

    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
    expect(result.detail).toContain('authentication_failed');

    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
  });

  it('returns ok: true with the CLI version once the stream shows the session is live', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQuery([INIT_MESSAGE, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }]),
    }));

    const { createClaudeAgentDriver } = await import('./claude.js');
    const result = await createClaudeAgentDriver().probe();

    expect(result).toEqual({ ok: true, version: '1.2.3' });

    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
  });

  it('resolves ok: false instead of hanging when the CLI never responds', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => fakeQuery([]),
    }));

    const { createClaudeAgentDriver, PROBE_TIMEOUT_MS } = await import('./claude.js');
    const probePromise = createClaudeAgentDriver().probe();

    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    const result = await probePromise;

    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();

    vi.useRealTimers();
    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
  });

  it('never throws: a spawn failure resolves ok: false with a readable detail', async () => {
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: () => {
        throw new Error('spawn claude ENOENT');
      },
    }));

    const { createClaudeAgentDriver } = await import('./claude.js');
    const result = await createClaudeAgentDriver().probe();

    expect(result).toEqual({ ok: false, detail: 'spawn claude ENOENT' });

    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
  });
});
