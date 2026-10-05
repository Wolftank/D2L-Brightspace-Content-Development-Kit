import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('allows every PowerShell command on Windows and withholds Bash, keeping the inherited environment', async () => {
    const { buildAllowedTools, shellOptions } = await importOnPlatform('win32');

    expect(buildAllowedTools([])).toContain('PowerShell');
    expect(shellOptions()).toEqual({
      env: { ...process.env, CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' },
      disallowedTools: ['Bash'],
    });
  });

  it('allows every Bash command elsewhere and leaves the environment to the SDK', async () => {
    const { buildAllowedTools, shellOptions } = await importOnPlatform('linux');

    expect(buildAllowedTools([])).toContain('Bash');
    expect(shellOptions()).toEqual({});
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
  ])('probes with %s and saves no transcript', async (_case, settings, expected) => {
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

    expect(calls[0]!.options).toMatchObject({ persistSession: false, ...expected });
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
