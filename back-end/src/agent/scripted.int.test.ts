import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BuildableAvenue } from '@cdk/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AVENUE_SKILL, KIT_DIR } from '../kit.js';
import { createScriptedAgentDriver, SUGGESTIONS } from './scripted.js';
import type { AgentEvent, AgentSession, SessionRequest, ToolServerSpec } from './AgentDriver.js';

const execFileAsync = promisify(execFile);

/** The `cdk` tools the scripted agent calls, for a project whose avenue starts as `avenue`, keeping each `record_suggestions` input in `recorded`. */
function projectTools(avenue: BuildableAvenue | null, recorded: unknown[] = []): ToolServerSpec {
  const report = async () => ({ content: JSON.stringify({ avenue }) });
  const tool = { description: '', summary: '', input: {} };
  return {
    name: 'cdk',
    tools: [
      { ...tool, name: 'get_project', handler: report },
      {
        ...tool,
        name: 'set_format',
        handler: (input: Record<string, unknown>) => {
          avenue = input.format as BuildableAvenue;
          return report();
        },
      },
      {
        ...tool,
        name: 'record_suggestions',
        handler: async (input: Record<string, unknown>) => {
          recorded.push(input);
          return { content: 'Recorded.' };
        },
      },
    ],
  };
}

function request(workspaceDir: string, sessionId: string | null = null, avenue: BuildableAvenue | null = 'scorm'): SessionRequest {
  return { workspaceDir, sessionId, instructions: '', skillsDir: '', skills: [], tools: projectTools(avenue) };
}

async function play(session: AgentSession, text: string, signal = new AbortController().signal) {
  const turn = session.send({ text, attachments: [] }, {}, signal);
  const events: AgentEvent[] = [];
  for await (const event of turn.events) events.push(event);
  return { events, result: await turn.result };
}

/** The QA gate's report on `outDir` for `avenue`. */
async function gate(outDir: string, avenue: BuildableAvenue = 'scorm'): Promise<{ pass: boolean; findings: Array<{ rule: string; severity: string }> }> {
  const lint = join(KIT_DIR, 'qa', 'lint', 'lint.js');
  try {
    const { stdout } = await execFileAsync(process.execPath, [lint, outDir, '--avenue', avenue, '--json']);
    return JSON.parse(stdout);
  } catch (err) {
    return JSON.parse((err as { stdout: string }).stdout);
  }
}

describe('scripted agent driver', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scripted-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is named scripted and always signed in', async () => {
    const driver = createScriptedAgentDriver();

    expect(driver.name).toBe('scripted');
    expect(await driver.probe()).toEqual({ ok: true });
  });

  it('builds a package that passes the QA gate when the message has no marker', async () => {
    const session = await createScriptedAgentDriver().open(request(dir));

    const { events, result } = await play(session, 'Create a workplace safety quiz');

    expect(result).toMatchObject({ status: 'completed', sessionId: 'scripted-session', usage: { steps: 4 } });
    expect(result.text).toContain('workplace safety');
    expect(await readFile(join(dir, 'out', 'index.html'), 'utf8')).toContain('chemical spill');
    expect(await readFile(join(dir, 'out', 'imsmanifest.xml'), 'utf8')).toContain('Workplace Safety Training');
    expect(events.filter((event) => event.kind === 'tool_start').map((event) => event.summary)).toEqual([
      'Writing index.html',
      'Writing imsmanifest.xml',
    ]);
    expect(await gate(join(dir, 'out'))).toMatchObject({ pass: true });
  });

  it('records the suggestions for a message asking for design suggestions, and mentions them in one sentence', async () => {
    const recorded: unknown[] = [];
    const session = await createScriptedAgentDriver().open({ ...request(dir), tools: projectTools('scorm', recorded) });

    const { events, result } = await play(session, 'Create a workplace safety quiz with design suggestions');
    const { result: plain } = await play(session, 'Create a workplace safety quiz');

    expect(recorded).toEqual([{ suggestions: SUGGESTIONS }]);
    expect(events).toContainEqual({ kind: 'tool_start', callId: 'record-suggestions', name: 'mcp__cdk__record_suggestions', summary: 'Noting suggestions', category: 'checking' });
    expect(result.text).toBe(`${plain.text} I left two optional design suggestions on the build card.`);
  });

  it('builds a package the QA gate rejects for [qa-fail]', async () => {
    const session = await createScriptedAgentDriver().open(request(dir));

    const { result } = await play(session, 'Build something [qa-fail]');

    expect(result.status).toBe('completed');
    const report = await gate(join(dir, 'out'));
    expect(report.pass).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'scorm/no-completed-on-load', severity: 'error' }));
  });

  it('changes the package for [follow-up], so the runner builds a new version', async () => {
    const session = await createScriptedAgentDriver().open(request(dir));
    await play(session, 'Create a workplace safety quiz');
    const first = await readFile(join(dir, 'out', 'index.html'), 'utf8');

    const { result } = await play(session, 'Add two questions [follow-up]');

    const second = await readFile(join(dir, 'out', 'index.html'), 'utf8');
    expect(result.status).toBe('completed');
    expect(second).not.toBe(first);
    expect(second).toContain('confined space');
    expect(await gate(join(dir, 'out'))).toMatchObject({ pass: true });
  });

  it.each([
    ['[turn-fail]', 'agent_error'],
    ['[signed-out]', 'agent_signed_out'],
    ['[busy]', 'agent_busy'],
  ])('fails the turn for %s with %s', async (marker, code) => {
    const session = await createScriptedAgentDriver().open(request(dir));

    const { result } = await play(session, `Do something ${marker}`);

    expect(result).toMatchObject({ status: 'failed', error: { code } });
  });

  it('reports a cancelled turn for [cancelled]', async () => {
    const session = await createScriptedAgentDriver().open(request(dir));

    expect((await play(session, 'Do something [cancelled]')).result.status).toBe('cancelled');
  });

  it('goes silent during [long-step], and an abort cancels it', async () => {
    const session = await createScriptedAgentDriver().open(request(dir));
    const controller = new AbortController();
    const turn = session.send({ text: 'Build slowly [long-step]', attachments: [] }, {}, controller.signal);
    const events: AgentEvent[] = [];
    const drained = (async () => {
      for await (const event of turn.events) events.push(event);
    })();

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const silent = events.slice();
    controller.abort();
    await drained;

    expect(silent.at(-1)).toEqual({ kind: 'status', text: 'Building from the SCORM starter', category: 'building' });
    expect((await turn.result).status).toBe('cancelled');
  });

  it('keeps the session id it is given', async () => {
    const session = await createScriptedAgentDriver().open(request(dir, 'existing-session-42'));

    expect(session.sessionId).toBe('existing-session-42');
    expect((await play(session, 'Hello')).result.sessionId).toBe('existing-session-42');
  });

  it('gives the same events and files for the same scenario', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'scripted-test-'));
    try {
      const driver = createScriptedAgentDriver();
      const [first, second] = await Promise.all([
        driver.open(request(dir)).then((session) => play(session, 'Build a quiz')),
        driver.open(request(otherDir)).then((session) => play(session, 'Build a quiz')),
      ]);

      expect(second.events).toEqual(first.events);
      expect(second.result).toEqual(first.result);
      expect(await readFile(join(otherDir, 'out', 'index.html'), 'utf8')).toBe(await readFile(join(dir, 'out', 'index.html'), 'utf8'));
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['Create a workplace safety quiz', 'scorm', 'I made this a SCORM package'],
    ['Create a lesson with separate student and instructor views', 'topic', 'I made this a content topic'],
  ] as const)('sets the format of a project with none from the message: %s', async (text, avenue, reason) => {
    const tools = projectTools(null);
    const session = await createScriptedAgentDriver().open({ ...request(dir), tools });

    const { events, result } = await play(session, text);

    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool_start', name: 'mcp__cdk__set_format' }));
    expect(JSON.parse((await tools.tools[0]!.handler({})).content)).toEqual({ avenue });
    expect(result.text).toContain(reason);
  });

  describe('for a content topic', () => {
    /** A session for a content-topic project, in a workspace provisioned with the content-topic starter. */
    async function openTopic(): Promise<AgentSession> {
      await cp(join(KIT_DIR, 'skills', AVENUE_SKILL.topic, 'assets', 'starter'), join(dir, 'out'), { recursive: true });
      return createScriptedAgentDriver().open(request(dir, null, 'topic'));
    }

    it('builds a topic from the content-topic starter that passes the QA gate in topic mode', async () => {
      const session = await openTopic();

      const { events, result } = await play(session, 'Create a lab safety orientation');

      expect(result).toMatchObject({ status: 'completed' });
      expect(result.text).toContain('lab safety orientation');
      expect(events).toContainEqual({ kind: 'status', text: 'Building from the content-topic starter', category: 'building' });
      expect(events.filter((event) => event.kind === 'tool_start').map((event) => event.summary)).toEqual(['Writing index.html']);
      const html = await readFile(join(dir, 'out', 'index.html'), 'utf8');
      expect(html).toContain('<title>Lab Safety Orientation</title>');
      expect(html).toContain('myenrollments');
      expect(await gate(join(dir, 'out'), 'topic')).toMatchObject({ pass: true });
    });

    it('builds a topic the QA gate rejects for [qa-fail]', async () => {
      const session = await openTopic();

      await play(session, 'Build something [qa-fail]');

      const report = await gate(join(dir, 'out'), 'topic');
      expect(report.pass).toBe(false);
      expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'topic/no-static-script-src', severity: 'error' }));
    });

    it('changes the topic for [follow-up], and it still passes', async () => {
      const session = await openTopic();
      await play(session, 'Create a lab safety orientation');
      const first = await readFile(join(dir, 'out', 'index.html'), 'utf8');

      await play(session, 'Add the safety contract [follow-up]');

      const second = await readFile(join(dir, 'out', 'index.html'), 'utf8');
      expect(second).not.toBe(first);
      expect(second).toContain('safety contract');
      expect(await gate(join(dir, 'out'), 'topic')).toMatchObject({ pass: true });
    });
  });
});
