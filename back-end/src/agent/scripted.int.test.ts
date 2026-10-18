import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptedAgentDriver } from './scripted.js';
import type { AgentSession, SessionRequest } from './AgentDriver.js';

function stubRequest(workspaceDir: string): SessionRequest {
  return {
    workspaceDir,
    sessionId: null,
    instructions: '',
    skillsDir: '',
    skills: [],
    tools: { name: 'cdk', tools: [] },
    allowedTools: [],
  };
}

async function collectEvents(session: AgentSession, text: string) {
  const turn = session.send({ text, attachments: [] }, {}, new AbortController().signal);
  const events = [];
  for await (const event of turn.events) events.push(event);
  const result = await turn.result;
  return { events, result };
}

describe('scripted agent driver', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scripted-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('probe returns ok', async () => {
    const driver = createScriptedAgentDriver();
    const probe = await driver.probe();
    expect(probe.ok).toBe(true);
    expect(probe.version).toBe('scripted');
  });

  it('name is scripted', () => {
    const driver = createScriptedAgentDriver();
    expect(driver.name).toBe('scripted');
  });

  describe('ok scenario', () => {
    it('writes valid SCORM files and completes', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const { events, result } = await collectEvents(session, 'Create a workplace safety quiz');

      expect(result.status).toBe('completed');
      expect(result.text).toContain('workplace safety');
      expect(result.usage?.steps).toBe(4);
      expect(result.sessionId).toMatch(/^scripted-/);

      const html = await readFile(join(dir, 'out', 'index.html'), 'utf8');
      expect(html).toContain('Workplace Safety Training');
      expect(html).toContain('chemical spill');

      const manifest = await readFile(join(dir, 'out', 'imsmanifest.xml'), 'utf8');
      expect(manifest).toContain('Workplace Safety Training');

      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain('message_start');
      expect(kinds).toContain('text_delta');
      expect(kinds).toContain('tool_start');
      expect(kinds).toContain('tool_end');
    });
  });

  describe('qa-fail scenario', () => {
    it('writes files with a QA issue', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const { result } = await collectEvents(session, 'Build something [qa-fail]');

      expect(result.status).toBe('completed');
      expect(result.text).toContain('QA gate found an issue');

      const html = await readFile(join(dir, 'out', 'index.html'), 'utf8');
      expect(html).toContain('LMSInitialize');
    });
  });

  describe('follow-up scenario', () => {
    it('writes an updated package with more questions', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const { result } = await collectEvents(session, 'Add more content [follow-up]');

      expect(result.status).toBe('completed');
      expect(result.text).toContain('two additional questions');

      const html = await readFile(join(dir, 'out', 'index.html'), 'utf8');
      expect(html).toContain('GHS pictogram');
      expect(html).toContain('confined space');
    });
  });

  describe('signed-out scenario', () => {
    it('fails with agent_signed_out', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const { result } = await collectEvents(session, 'Do something [signed-out]');

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('agent_signed_out');
    });
  });

  describe('busy scenario', () => {
    it('fails with agent_busy', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const { result } = await collectEvents(session, 'Do something [busy]');

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('agent_busy');
    });
  });

  describe('long-step scenario', () => {
    it('completes with a longer delay', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const { result } = await collectEvents(session, 'Build slowly [long-step]');

      expect(result.status).toBe('completed');
      expect(result.text).toContain('workplace safety');
    }, 15_000);
  });

  describe('cancelled scenario', () => {
    it('returns cancelled status', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const { result } = await collectEvents(session, 'Do something [cancelled]');

      expect(result.status).toBe('cancelled');
    });
  });

  describe('abort signal', () => {
    it('cancels a running turn', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open(stubRequest(dir));

      const controller = new AbortController();
      const turn = session.send({ text: 'Build slowly [long-step]', attachments: [] }, {}, controller.signal);

      setTimeout(() => controller.abort(), 100);

      const events = [];
      for await (const event of turn.events) events.push(event);
      const result = await turn.result;

      expect(result.status).toBe('cancelled');
    });
  });

  describe('session reopen', () => {
    it('reuses the given session id', async () => {
      const driver = createScriptedAgentDriver();
      const session = await driver.open({ ...stubRequest(dir), sessionId: 'existing-session-42' });

      expect(session.sessionId).toBe('existing-session-42');

      const { result } = await collectEvents(session, 'Hello');
      expect(result.sessionId).toBe('existing-session-42');
    });
  });

  describe('determinism', () => {
    it('produces the same files for the same scenario', async () => {
      const driver = createScriptedAgentDriver();

      const dir2 = await mkdtemp(join(tmpdir(), 'scripted-test-'));
      try {
        const session1 = await driver.open(stubRequest(dir));
        const session2 = await driver.open(stubRequest(dir2));

        const [r1, r2] = await Promise.all([
          collectEvents(session1, 'Build a quiz'),
          collectEvents(session2, 'Build a quiz'),
        ]);

        expect(r1.result.text).toBe(r2.result.text);

        const html1 = await readFile(join(dir, 'out', 'index.html'), 'utf8');
        const html2 = await readFile(join(dir2, 'out', 'index.html'), 'utf8');
        expect(html1).toBe(html2);
      } finally {
        await rm(dir2, { recursive: true, force: true });
      }
    });
  });
});
