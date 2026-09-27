import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRequest } from './AgentDriver.js';

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
