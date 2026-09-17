import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeAgentDriver } from './claude.js';
import type { AgentEvent, SessionRequest } from './AgentDriver.js';

/**
 * Re-verifies, through the AgentDriver interface, what the B6 spike (issue
 * #24) proved against the raw SDK: a turn edits files in the workspace, a
 * second turn resumes by session id, and an out-of-allowlist call is denied
 * and surfaces as a notice event. These make a real, billed call, so they
 * only run when `probe()` reports a signed-in CLI; otherwise every test in
 * this file is skipped.
 */
const driver = createClaudeAgentDriver();
let credentialAvailable = false;

beforeAll(async () => {
  const result = await driver.probe();
  credentialAvailable = result.ok;
  if (!result.ok) {
    console.warn(`Skipping claude.live.test.ts: probe() reported ${result.detail}`);
  }
}, 20_000);

function baseRequest(workspaceDir: string, skillsDir: string, sessionId: string | null = null): SessionRequest {
  return {
    workspaceDir,
    sessionId,
    instructions: 'You are helping build D2L course content. Follow instructions exactly and briefly.',
    skillsDir,
    tools: { name: 'cdk', tools: [] },
    allowedTools: [],
  };
}

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe('ClaudeAgentDriver, live SDK', () => {
  let workspaceDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'cdk-claude-live-workspace-'));
    skillsDir = await mkdtemp(join(tmpdir(), 'cdk-claude-live-skills-'));
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(skillsDir, { recursive: true, force: true });
  });

  it('edits a file in the workspace, then resumes the session by id on a second turn', async (ctx) => {
    if (!credentialAvailable) {
      ctx.skip();
    }

    const session = await driver.open(baseRequest(workspaceDir, skillsDir));

    const turn1 = session.send(
      {
        text: "Use the Write tool to create a file named hello.txt in the workspace root, containing exactly the text 'hello'. Do not ask questions; just create it.",
        attachments: [],
      },
      { maxSteps: 6, maxBudgetUsd: 1 },
      new AbortController().signal,
    );
    await drain(turn1.events);
    const result1 = await turn1.result;
    expect(result1.status).toBe('completed');
    expect(result1.sessionId).toBeTruthy();

    const written = await readFile(join(workspaceDir, 'hello.txt'), 'utf8');
    expect(written.trim()).toBe('hello');

    const reopened = await driver.open(baseRequest(workspaceDir, skillsDir, result1.sessionId));

    const turn2 = reopened.send(
      {
        text: 'What is the exact name of the file you just created? Reply with only the filename.',
        attachments: [],
      },
      { maxSteps: 4, maxBudgetUsd: 1 },
      new AbortController().signal,
    );
    await drain(turn2.events);
    const result2 = await turn2.result;
    expect(result2.status).toBe('completed');
    expect(result2.text.toLowerCase()).toContain('hello.txt');
  }, 60_000);

  it('denies a Write outside the workspace and surfaces it as a notice event', async (ctx) => {
    if (!credentialAvailable) {
      ctx.skip();
    }

    // `Write(/**)`/`Edit(/**)` are workspace-relative (docs/drivers.md:
    // "`/` is workspace-relative"), so a path outside workspaceDir matches
    // no allow rule under `dontAsk` and must be denied. This is the
    // reliable out-of-allowlist case: an unscripted attempt to run `git
    // status` via Bash was NOT denied on the installed SDK version despite
    // no Bash rule existing anywhere (see the PR description) — a real
    // discrepancy from drivers.md worth its own investigation, not papered
    // over by this test.
    const outsideDir = await mkdtemp(join(tmpdir(), 'cdk-claude-live-outside-'));
    const outsidePath = join(outsideDir, 'escaped.txt');

    try {
      const session = await driver.open(baseRequest(workspaceDir, skillsDir));

      const turn = session.send(
        {
          text: `Use the Write tool to create a file at the absolute path ${outsidePath} containing the text 'escaped'. If your permissions deny this, that's fine — just report what happened.`,
          attachments: [],
        },
        { maxSteps: 6, maxBudgetUsd: 1 },
        new AbortController().signal,
      );

      const events = await drain(turn.events);
      await turn.result;

      const notices = events.filter((event) => event.kind === 'notice').map((event) => event.text);
      expect(notices.some((text) => /write/i.test(text) && /denied/i.test(text))).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  }, 60_000);
});
