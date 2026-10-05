import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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

  function request(): SessionRequest {
    return {
      workspaceDir: join(dir, 'workspace'),
      sessionId: null,
      instructions: 'Follow instructions exactly.',
      skillsDir: join(dir, 'skills'),
      tools: { name: 'cdk', tools: [] },
      allowedTools: [],
    };
  }

  async function runTurn(settings: object): Promise<Record<string, unknown>> {
    const { createClaudeAgentDriver } = await import('./claude.js');
    const session = await createClaudeAgentDriver(settings).open(request());
    const turn = session.send({ text: 'Hi', attachments: [] }, {}, new AbortController().signal);
    for await (const event of turn.events) void event;
    await turn.result;
    return calls[0]!.options;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cdk-claude-turn-'));
    await fs.mkdir(join(dir, 'skills'));
    calls = [];
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: (call: { options: Record<string, unknown> }) => {
        calls.push(call);
        return (async function* () {
          yield RESULT;
        })();
      },
    }));
  });

  afterEach(async () => {
    vi.doUnmock('@anthropic-ai/claude-agent-sdk');
    vi.resetModules();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('runs a turn with the configured model and effort', async () => {
    const options = await runTurn({ model: 'claude-sonnet-5', effort: 'medium' });

    expect(options).toMatchObject({ model: 'claude-sonnet-5', effort: 'medium' });
  });

  it("leaves model and effort to the account's defaults when unset", async () => {
    const options = await runTurn({});

    expect(options).not.toHaveProperty('model');
    expect(options).not.toHaveProperty('effort');
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
      {
        kind: 'tool_start',
        callId: 'toolu_018tyabejV94NG5tssLuXjyE',
        name: 'Write',
        input: {
          file_path: 'C:\\Users\\benja\\AppData\\Local\\Temp\\cdk-fixture-workspace-fGQ0EP\\hello.txt',
          content: 'hello',
        },
        summary: 'Writing hello.txt',
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
