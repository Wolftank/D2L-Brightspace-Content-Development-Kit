import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreToolUseHookInput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, SessionRequest, TurnResult } from './AgentDriver.js';

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

describe('Claude turns', () => {
  let dir: string;
  let calls: Array<{ options: Record<string, unknown> }>;
  let messages: unknown[];

  function request(): SessionRequest {
    return {
      workspaceDir: join(dir, 'workspace'),
      sessionId: null,
      instructions: 'Follow instructions exactly.',
      skillsDir: join(dir, 'skills'),
      skills: ['allowed-skill'],
      tools: { name: 'cdk', tools: [] },
      allowedTools: [],
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
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (call: { options: Record<string, unknown> }) => {
        calls.push(call);
        return (async function* () {
          yield* messages;
        })();
      },
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

  it("leaves model and effort to the account's defaults when unset", async () => {
    const { options } = await runTurn();

    expect(options).not.toHaveProperty('model');
    expect(options).not.toHaveProperty('effort');
  });

  it("loads only the built-in tools, the request's skills, and no outside MCP servers", async () => {
    const { BUILT_IN_TOOLS } = await import('./claude.js');
    const { options } = await runTurn();

    expect(options).toMatchObject({
      permissionMode: 'dontAsk',
      settingSources: ['project'],
      tools: BUILT_IN_TOOLS,
      skills: ['allowed-skill'],
      strictMcpConfig: true,
    });
    expect(options).not.toHaveProperty('mcpServers');
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

  it('confines the file tools with a pre-tool hook', async () => {
    const { options } = await runTurn();

    expect(options.hooks).toEqual({ PreToolUse: [{ hooks: [expect.any(Function)] }] });
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

describe('confineToWorkspace', () => {
  let dir: string;
  let workspaceDir: string;
  let outsideDir: string;

  async function decide(toolName: string, toolInput: Record<string, unknown>) {
    const { confineToWorkspace } = await import('./claude.js');
    const input: PreToolUseHookInput = {
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: toolInput,
      tool_use_id: 'call-1',
      session_id: 'session-1',
      transcript_path: '',
      cwd: workspaceDir,
    };
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

  it('leaves other tools to the permission rules', async () => {
    expect(await decide('Bash', { command: `cat ${join(outsideDir, 'secret.txt')}` })).toBe('none');
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
      expect.stringMatching(/^unexpected skills: .*\bcode-review\b/),
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
      { kind: 'status', text: 'Thinking…' },
      { kind: 'status', text: 'Thinking…' },
      {
        kind: 'tool_start',
        callId: 'toolu_018tyabejV94NG5tssLuXjyE',
        name: 'Write',
        summary: 'Writing hello.txt',
      },
      {
        kind: 'tool_end',
        callId: 'toolu_018tyabejV94NG5tssLuXjyE',
        ok: true,
        output:
          'File created successfully at: C:\\Users\\benja\\AppData\\Local\\Temp\\cdk-fixture-workspace-fGQ0EP\\hello.txt (file state is current in your context — no need to Read it back)',
      },
      { kind: 'status', text: 'Thinking…' },
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
