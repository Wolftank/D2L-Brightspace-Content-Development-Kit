import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KIT_DIR } from '../kit.js';
import type {
  AgentDriver,
  AgentEvent,
  AgentSession,
  AgentTurn,
  ProbeResult,
  SessionRequest,
  TurnErrorCode,
  TurnInput,
  TurnLimits,
  TurnResult,
} from './AgentDriver.js';

type Scenario = 'ok' | 'qa-fail' | 'follow-up' | 'turn-fail' | 'signed-out' | 'busy' | 'long-step' | 'cancelled';

type BuildingScenario = 'ok' | 'qa-fail' | 'follow-up';

/** Each scenario's marker in the instructor's message. `ok` plays when none is present. */
const MARKERS: Array<[string, Scenario]> = [
  ['[cancelled]', 'cancelled'],
  ['[turn-fail]', 'turn-fail'],
  ['[signed-out]', 'signed-out'],
  ['[busy]', 'busy'],
  ['[qa-fail]', 'qa-fail'],
  ['[long-step]', 'long-step'],
  ['[follow-up]', 'follow-up'],
];

/** The scenarios that fail the turn before anything is built. */
const FAILURES: Partial<Record<Scenario, { code: TurnErrorCode; message: string }>> = {
  'turn-fail': { code: 'agent_error', message: 'The agent stopped before it finished.' },
  'signed-out': { code: 'agent_signed_out', message: "The agent isn't signed in." },
  busy: { code: 'agent_busy', message: "The agent's account is busy or rate-limited." },
};

/** The silent pause in `[long-step]`, the same as the front-end stub's. */
const LONG_STEP_MS = 20_000;

const SESSION_ID = 'scripted-session';
const STARTER_DIR = join(KIT_DIR, 'skills', 'd2l-scorm-package', 'assets', 'starter');
const TITLE = 'Workplace Safety Training';

const STARTER_QUESTIONS = [
  "{ q: 'Replace this question.', opts: ['Right answer', 'Wrong answer'], correct: 0 }",
  "{ q: 'And this one.', opts: ['Wrong', 'Right', 'Also wrong'], correct: 1 }",
  "{ q: 'And this one too.', opts: ['Right', 'Wrong'], correct: 0 }",
];

const QUESTIONS = [
  "{ q: 'What is the first step when you discover a chemical spill?', opts: ['Clean it up immediately', 'Evacuate the area and alert others', 'Ignore it'], correct: 1 }",
  "{ q: 'Which PPE is required when handling corrosive chemicals?', opts: ['Safety glasses only', 'Chemical splash goggles, gloves, and apron', 'Hard hat'], correct: 1 }",
  "{ q: 'How often must fire extinguishers be inspected?', opts: ['Every 5 years', 'Monthly', 'Only after use'], correct: 1 }",
  "{ q: 'What does an SDS describe?', opts: ['Employee schedules', 'Chemical hazards and safe handling', 'Building floor plans'], correct: 1 }",
  "{ q: 'Where should compressed gas cylinders be stored?', opts: ['Laying on their side', 'Upright, secured, and away from heat', 'In any available space'], correct: 1 }",
];

const FOLLOW_UP_QUESTIONS = [
  ...QUESTIONS,
  "{ q: 'What is the GHS pictogram for flammable materials?', opts: ['Skull and crossbones', 'Flame', 'Exclamation mark'], correct: 1 }",
  "{ q: 'What should you do before entering a confined space?', opts: ['Check your phone', 'Test the atmosphere and obtain a permit', 'Nothing special'], correct: 1 }",
];

/** A script that marks the activity completed as soon as it loads, which the QA gate rejects. */
const COMPLETED_ON_LOAD = `<script>
  var lms = window.parent && window.parent.API;
  if (lms) lms.LMSSetValue('cmi.core.lesson_status', 'completed');
</script>
`;

const REPLIES: Record<BuildingScenario, string> = {
  ok:
    'I built a five-question multiple-choice practice set on workplace safety. ' +
    'It covers chemical spills, PPE requirements, fire extinguisher inspections, SDS documents, and compressed gas storage. ' +
    'Students can retake it, and the best score is written to the gradebook.',
  'qa-fail':
    'I built the activity, but the check found a problem: it marks itself complete as soon as it opens, ' +
    'which would lock students out of later attempts.',
  'follow-up':
    'I updated the activity with two additional questions on GHS pictograms and confined space entry. ' +
    'The revised version now has seven questions and passed the check.',
};

let filesByScenario: Promise<Record<BuildingScenario, { html: string; manifest: string }>> | undefined;

/** The SCORM files each building scenario writes, made from the kit's starter on first use. */
function scenarioFiles(): Promise<Record<BuildingScenario, { html: string; manifest: string }>> {
  filesByScenario ??= makeScenarioFiles();
  return filesByScenario;
}

async function makeScenarioFiles(): Promise<Record<BuildingScenario, { html: string; manifest: string }>> {
  const read = async (name: string) => (await readFile(join(STARTER_DIR, name), 'utf8')).replace(/\r\n/g, '\n');
  const [starterHtml, starterManifest] = await Promise.all([read('index.html'), read('imsmanifest.xml')]);
  const manifest = replaceRequired(starterManifest, 'RENAME ME', TITLE);
  const html = replaceRequired(replaceRequired(starterHtml, 'RENAME ME', TITLE), questionsBlock(STARTER_QUESTIONS), questionsBlock(QUESTIONS));
  return {
    ok: { html, manifest },
    'qa-fail': { html: replaceRequired(html, '</body>', `${COMPLETED_ON_LOAD}</body>`), manifest },
    'follow-up': { html: replaceRequired(html, questionsBlock(QUESTIONS), questionsBlock(FOLLOW_UP_QUESTIONS)), manifest },
  };
}

/** The starter's `QUESTIONS` declaration holding `questions`, laid out as the starter lays it out. */
function questionsBlock(questions: string[]): string {
  return `var QUESTIONS = [\n    ${questions.join(',\n    ')}\n  ];`;
}

/**
 * `text` with every `from` replaced by `to`.
 *
 * Raises:
 *   Error: when `text` has no `from`, so a changed starter fails loudly
 *   instead of silently writing the wrong files.
 */
function replaceRequired(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`The SCORM starter no longer contains: ${from.slice(0, 60)}`);
  return text.split(from).join(to);
}

function scenarioFor(text: string): Scenario {
  return MARKERS.find(([marker]) => text.includes(marker))?.[1] ?? 'ok';
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('cancelled'));
    }, { once: true });
  });
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) chunks.push(text.slice(i, i + maxLen));
  return chunks;
}

async function* runScenario(
  scenario: Scenario,
  outDir: string,
  signal: AbortSignal,
  resolveResult: (result: TurnResult) => void,
  sessionId: string,
): AsyncGenerator<AgentEvent> {
  try {
    const failure = FAILURES[scenario];
    if (failure) {
      yield { kind: 'status', text: 'Connecting to the agent' };
      await delay(300, signal);
      resolveResult({ status: 'failed', sessionId, text: '', error: failure, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 } });
      return;
    }

    yield { kind: 'message_start' };
    yield { kind: 'status', text: 'Reading the request' };
    await delay(400, signal);

    if (scenario === 'cancelled') {
      yield { kind: 'status', text: 'Building from the SCORM starter' };
      await delay(200, signal);
      resolveResult({ status: 'cancelled', sessionId, text: '', usage: { inputTokens: 800, outputTokens: 100, costUsd: 0.005, steps: 1 } });
      return;
    }

    yield { kind: 'status', text: 'Building from the SCORM starter' };
    await delay(scenario === 'long-step' ? LONG_STEP_MS : 800, signal);

    const building: BuildingScenario = scenario === 'qa-fail' || scenario === 'follow-up' ? scenario : 'ok';
    const { html, manifest } = (await scenarioFiles())[building];
    await mkdir(outDir, { recursive: true });

    yield { kind: 'tool_start', callId: 'write-index', name: 'Write', summary: 'Writing index.html' };
    await writeFile(join(outDir, 'index.html'), html, 'utf8');
    await delay(200, signal);
    yield { kind: 'tool_end', callId: 'write-index', ok: true };

    yield { kind: 'tool_start', callId: 'write-manifest', name: 'Write', summary: 'Writing imsmanifest.xml' };
    await writeFile(join(outDir, 'imsmanifest.xml'), manifest, 'utf8');
    await delay(200, signal);
    yield { kind: 'tool_end', callId: 'write-manifest', ok: true };

    const reply = REPLIES[building];
    for (const chunk of splitIntoChunks(reply, 60)) {
      yield { kind: 'text_delta', text: chunk };
      await delay(100, signal);
    }

    resolveResult({ status: 'completed', sessionId, text: reply, usage: { inputTokens: 4200, outputTokens: 900, costUsd: 0.03, steps: 4 } });
  } catch {
    resolveResult(
      signal.aborted
        ? { status: 'cancelled', sessionId, text: '' }
        : { status: 'failed', sessionId, text: '', error: { code: 'driver_error', message: 'The scripted scenario stopped unexpectedly.' } },
    );
  }
}

function createScriptedSession(sessionId: string, workspaceDir: string): AgentSession {
  return {
    get sessionId() {
      return sessionId;
    },

    send(input: TurnInput, _limits: TurnLimits, signal: AbortSignal): AgentTurn {
      let resolveResult!: (result: TurnResult) => void;
      const result = new Promise<TurnResult>((resolve) => {
        resolveResult = resolve;
      });
      const events = runScenario(scenarioFor(input.text), join(workspaceDir, 'out'), signal, resolveResult, sessionId);
      return { events, result };
    },

    async close(): Promise<void> {},
  };
}

/**
 * An agent for development and tests that replays fixed SCORM turns with no
 * AI calls. The marker in the instructor's message picks the scenario; the
 * same scenario always gives the same events and files.
 */
export function createScriptedAgentDriver(): AgentDriver {
  return {
    name: 'scripted',

    async probe(): Promise<ProbeResult> {
      return { ok: true, version: 'scripted' };
    },

    async open(req: SessionRequest): Promise<AgentSession> {
      return createScriptedSession(req.sessionId ?? SESSION_ID, req.workspaceDir);
    },
  };
}
