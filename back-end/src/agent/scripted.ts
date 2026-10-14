import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AgentDriver,
  AgentEvent,
  AgentSession,
  AgentTurn,
  ProbeResult,
  SessionRequest,
  TurnInput,
  TurnLimits,
  TurnResult,
} from './AgentDriver.js';

type Scenario = 'ok' | 'qa-fail' | 'follow-up' | 'signed-out' | 'busy' | 'long-step' | 'cancelled';

const BACK_END_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTER_DIR = join(BACK_END_DIR, 'kit', 'skills', 'd2l-scorm-package', 'assets', 'starter');

function scenarioFor(text: string): Scenario {
  if (text.includes('[cancelled]')) return 'cancelled';
  if (text.includes('[signed-out]')) return 'signed-out';
  if (text.includes('[busy]')) return 'busy';
  if (text.includes('[qa-fail]')) return 'qa-fail';
  if (text.includes('[long-step]')) return 'long-step';
  if (text.includes('[follow-up]')) return 'follow-up';
  return 'ok';
}

const GOOD_HTML = readFileSync(join(STARTER_DIR, 'index.html'), 'utf8')
  .replace(/RENAME ME/g, 'Workplace Safety Training')
  .replace(
    `var QUESTIONS = [
    { q: 'Replace this question.', opts: ['Right answer', 'Wrong answer'], correct: 0 },
    { q: 'And this one.', opts: ['Wrong', 'Right', 'Also wrong'], correct: 1 },
    { q: 'And this one too.', opts: ['Right', 'Wrong'], correct: 0 }
  ];`,
    `var QUESTIONS = [
    { q: 'What is the first step when you discover a chemical spill?', opts: ['Clean it up immediately', 'Evacuate the area and alert others', 'Ignore it'], correct: 1 },
    { q: 'Which PPE is required when handling corrosive chemicals?', opts: ['Safety glasses only', 'Chemical splash goggles, gloves, and apron', 'Hard hat'], correct: 1 },
    { q: 'How often must fire extinguishers be inspected?', opts: ['Every 5 years', 'Monthly', 'Only after use'], correct: 1 },
    { q: 'What does an SDS describe?', opts: ['Employee schedules', 'Chemical hazards and safe handling', 'Building floor plans'], correct: 1 },
    { q: 'Where should compressed gas cylinders be stored?', opts: ['Laying on their side', 'Upright, secured, and away from heat', 'In any available space'], correct: 1 }
  ];`,
  );

const GOOD_MANIFEST = readFileSync(join(STARTER_DIR, 'imsmanifest.xml'), 'utf8').replace(
  /RENAME ME/g,
  'Workplace Safety Training',
);

const BAD_HTML = GOOD_HTML.replace(
  "S('cmi.core.lesson_status', 'completed');",
  "api.LMSInitialize('');\n    S('cmi.core.lesson_status', 'completed');",
);

const FOLLOWUP_HTML = GOOD_HTML.replace(
  "{ q: 'Where should compressed gas cylinders be stored?', opts: ['Laying on their side', 'Upright, secured, and away from heat', 'In any available space'], correct: 1 }",
  `{ q: 'Where should compressed gas cylinders be stored?', opts: ['Laying on their side', 'Upright, secured, and away from heat', 'In any available space'], correct: 1 },
    { q: 'What is the GHS pictogram for flammable materials?', opts: ['Skull and crossbones', 'Flame', 'Exclamation mark'], correct: 1 },
    { q: 'What should you do before entering a confined space?', opts: ['Check your phone', 'Test the atmosphere and obtain a permit', 'Nothing special'], correct: 1 }`,
);

const REPLY_OK =
  'I built a five-question multiple-choice practice set on workplace safety. ' +
  'It covers chemical spills, PPE requirements, fire extinguisher inspections, SDS documents, and compressed gas storage. ' +
  'Students can retake it, and the best score is written to the gradebook.';

const REPLY_QA_FAIL =
  'I built the activity, but the QA gate found an issue with how completion is reported. ' +
  'The activity calls LMSInitialize a second time during submission, which would reset the SCORM session.';

const REPLY_FOLLOWUP =
  'I updated the activity with two additional questions on GHS pictograms and confined space entry. ' +
  'The revised version now has seven questions and passed the QA gate.';

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('cancelled')); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error('cancelled')); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function writeScormFiles(outDir: string, html: string, manifest: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'index.html'), html, 'utf8');
  await writeFile(join(outDir, 'imsmanifest.xml'), manifest, 'utf8');
}

async function* runScenario(
  scenario: Scenario,
  outDir: string,
  signal: AbortSignal,
  resolveResult: (result: TurnResult) => void,
  sessionId: string,
): AsyncGenerator<AgentEvent> {
  const callId = randomUUID();

  try {
    if (scenario === 'signed-out') {
      yield { kind: 'status', text: 'Connecting to the agent' };
      await delay(300, signal);
      resolveResult({
        status: 'failed',
        sessionId,
        text: '',
        error: { code: 'agent_signed_out', message: "The agent isn't signed in." },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 },
      });
      return;
    }

    if (scenario === 'busy') {
      yield { kind: 'status', text: 'Connecting to the agent' };
      await delay(300, signal);
      resolveResult({
        status: 'failed',
        sessionId,
        text: '',
        error: { code: 'agent_busy', message: "The agent's account is busy or rate-limited." },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 },
      });
      return;
    }

    yield { kind: 'message_start' };
    yield { kind: 'status', text: 'Reading the request' };
    await delay(400, signal);

    if (scenario === 'cancelled') {
      yield { kind: 'status', text: 'Building from the SCORM starter' };
      await delay(200, signal);
      resolveResult({
        status: 'cancelled',
        sessionId,
        text: '',
        usage: { inputTokens: 800, outputTokens: 100, costUsd: 0.005, steps: 1 },
      });
      return;
    }

    yield { kind: 'status', text: 'Building from the SCORM starter' };
    await delay(scenario === 'long-step' ? 5000 : 800, signal);

    const html = scenario === 'qa-fail' ? BAD_HTML : scenario === 'follow-up' ? FOLLOWUP_HTML : GOOD_HTML;
    await writeScormFiles(outDir, html, GOOD_MANIFEST);

    yield { kind: 'tool_start', callId, name: 'Write', summary: 'Writing index.html' };
    await delay(200, signal);
    yield { kind: 'tool_end', callId, ok: true };

    const callId2 = randomUUID();
    yield { kind: 'tool_start', callId: callId2, name: 'Write', summary: 'Writing imsmanifest.xml' };
    await delay(200, signal);
    yield { kind: 'tool_end', callId: callId2, ok: true };

    const replyText =
      scenario === 'qa-fail' ? REPLY_QA_FAIL : scenario === 'follow-up' ? REPLY_FOLLOWUP : REPLY_OK;

    for (const chunk of splitIntoChunks(replyText, 60)) {
      yield { kind: 'text_delta', text: chunk };
      await delay(100, signal);
    }

    resolveResult({
      status: 'completed',
      sessionId,
      text: replyText,
      usage: { inputTokens: 4200, outputTokens: 900, costUsd: 0.03, steps: 4 },
    });
  } catch {
    if (signal.aborted) {
      resolveResult({ status: 'cancelled', sessionId, text: '' });
    } else {
      resolveResult({
        status: 'failed',
        sessionId,
        text: '',
        error: { code: 'driver_error', message: 'Scripted scenario interrupted unexpectedly' },
      });
    }
  }
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

function createScriptedSession(sessionId: string, workspaceDir: string): AgentSession {
  return {
    get sessionId() {
      return sessionId;
    },

    send(input: TurnInput, _limits: TurnLimits, signal: AbortSignal): AgentTurn {
      const scenario = scenarioFor(input.text);
      const outDir = join(workspaceDir, 'out');

      let resolveResult!: (result: TurnResult) => void;
      const result = new Promise<TurnResult>((resolve) => {
        resolveResult = resolve;
      });

      const events = runScenario(scenario, outDir, signal, resolveResult, sessionId);

      return { events, result };
    },

    async close(): Promise<void> {},
  };
}

export function createScriptedAgentDriver(): AgentDriver {
  return {
    name: 'scripted',

    async probe(): Promise<ProbeResult> {
      return { ok: true, version: 'scripted' };
    },

    async open(req: SessionRequest): Promise<AgentSession> {
      const sessionId = req.sessionId ?? `scripted-${randomUUID()}`;
      return createScriptedSession(sessionId, req.workspaceDir);
    },
  };
}
