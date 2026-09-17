import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, TurnResult } from './AgentDriver.js';

const BARE_BUILTIN_TOOL_NAMES = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch'];

const FIXTURE_PATH = fileURLToPath(new URL('./__fixtures__/claude-write-file-turn.jsonl', import.meta.url));

async function loadFixtureMessages(): Promise<SDKMessage[]> {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as SDKMessage);
}

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe('buildAllowedTools', () => {
  it('never contains a bare/unscoped built-in tool name', async () => {
    const { buildAllowedTools } = await import('./claude.js');
    const result = buildAllowedTools(['mcp__cdk__create_build', 'mcp__cdk__get_project']);

    for (const bareName of BARE_BUILTIN_TOOL_NAMES) {
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

function fakePreToolUseInput(toolName: string, toolInput: unknown) {
  return {
    hook_event_name: 'PreToolUse' as const,
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/workspace',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: 'toolu_1',
  };
}

const HOOK_CALL_OPTIONS = { signal: new AbortController().signal };

describe('createShellDenyHook: PreToolUse backstop for Bash/PowerShell', () => {
  it("denies a Bash call when no rule grants it — the regression test for the SDK's own non-denial", async () => {
    const { createShellDenyHook } = await import('./claude.js');
    const hook = createShellDenyHook([]);

    const result = await hook(fakePreToolUseInput('Bash', { command: 'git status' }), 'toolu_1', HOOK_CALL_OPTIONS);

    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('PreToolUse hook'),
      },
    });
  });

  it('denies a PowerShell call the same way', async () => {
    const { createShellDenyHook } = await import('./claude.js');
    const hook = createShellDenyHook([]);

    const result = await hook(
      fakePreToolUseInput('PowerShell', { command: 'Get-ChildItem' }),
      'toolu_1',
      HOOK_CALL_OPTIONS,
    );

    expect((result as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision).toBe(
      'deny',
    );
  });

  it('does not deny a Bash call that matches a granted exact-command rule', async () => {
    const { createShellDenyHook } = await import('./claude.js');
    const hook = createShellDenyHook(['Bash(git status)']);

    const result = await hook(fakePreToolUseInput('Bash', { command: 'git status' }), 'toolu_1', HOOK_CALL_OPTIONS);

    expect(result).toEqual({});
  });

  it('does not deny a Bash call that matches a granted prefix rule', async () => {
    const { createShellDenyHook } = await import('./claude.js');
    const hook = createShellDenyHook(['Bash(npm *)']);

    const result = await hook(fakePreToolUseInput('Bash', { command: 'npm test' }), 'toolu_1', HOOK_CALL_OPTIONS);

    expect(result).toEqual({});
  });

  it('still denies a Bash call whose command does not match the granted prefix', async () => {
    const { createShellDenyHook } = await import('./claude.js');
    const hook = createShellDenyHook(['Bash(npm *)']);

    const result = await hook(fakePreToolUseInput('Bash', { command: 'git status' }), 'toolu_1', HOOK_CALL_OPTIONS);

    expect((result as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision).toBe(
      'deny',
    );
  });

  it('leaves every non-shell tool alone (defers to the normal permission engine)', async () => {
    const { createShellDenyHook } = await import('./claude.js');
    const hook = createShellDenyHook([]);

    const result = await hook(
      fakePreToolUseInput('Write', { file_path: '/workspace/out/index.html', content: 'hi' }),
      'toolu_1',
      HOOK_CALL_OPTIONS,
    );

    expect(result).toEqual({});
  });
});

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
      {
        kind: 'tool_start',
        callId: 'toolu_018tyabejV94NG5tssLuXjyE',
        name: 'Write',
        input: {
          file_path: 'C:\\Users\\benja\\AppData\\Local\\Temp\\cdk-fixture-workspace-fGQ0EP\\hello.txt',
          content: 'hello',
        },
      },
      {
        kind: 'tool_end',
        callId: 'toolu_018tyabejV94NG5tssLuXjyE',
        ok: true,
        output:
          'File created successfully at: C:\\Users\\benja\\AppData\\Local\\Temp\\cdk-fixture-workspace-fGQ0EP\\hello.txt (file state is current in your context — no need to Read it back)',
      },
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
