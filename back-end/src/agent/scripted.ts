import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildableAvenue, BuildSuggestion } from '@cdk/contract';
import { AVENUE_SKILL, KIT_DIR } from '../kit.js';
import { toolCategory } from './progress.js';
import type {
  AgentDriver,
  AgentEvent,
  AgentSession,
  AgentTurn,
  ProbeResult,
  SessionRequest,
  ToolResult,
  ToolServerSpec,
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
const TITLE = 'Workplace Safety Training';
const TOPIC_TITLE = 'Lab Safety Orientation';

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

/** A file a building scenario writes into out/, and the id of the tool call that writes it. */
interface ScenarioFile {
  name: string;
  callId: string;
  text: string;
}

const TOPIC_INTRO = 'Read the checklist below before your first lab session.';
const TOPIC_NOTES = 'Walk the class to the eye-wash station and the fire blanket during the first session.';
const TOPIC_FOLLOW_UP_NOTES = `${TOPIC_NOTES} Check that every student has signed the safety contract before they handle chemicals.`;

/** Loads the starter's data with a static script tag, which the QA gate rejects for a topic. */
const STATIC_DATA_SCRIPT = '<script src="data.js"></script>\n</head>';

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

const TOPIC_REPLIES: Record<BuildingScenario, string> = {
  ok:
    'I built a lab safety orientation page. Students read the safety checklist and can mark it as read, ' +
    'and instructors also see notes for running the first session.',
  'qa-fail':
    'I built the page, but the check found a problem: it loads its data with a plain script tag, ' +
    'which some courses ignore, so students could see an empty page.',
  'follow-up':
    'I added a reminder about the safety contract to the instructor notes. The revised version passed the check.',
};

const filesByAvenue: Partial<Record<BuildableAvenue, Promise<Record<BuildingScenario, ScenarioFile[]>>>> = {};

/** The files each building scenario writes for `avenue`, made from the kit's starter on first use. */
function scenarioFiles(avenue: BuildableAvenue): Promise<Record<BuildingScenario, ScenarioFile[]>> {
  filesByAvenue[avenue] ??= avenue === 'topic' ? makeTopicFiles() : makeScormFiles();
  return filesByAvenue[avenue];
}

/** The starter file `name` of the skill that builds `avenue`, with Unix line endings. */
async function readStarter(avenue: BuildableAvenue, name: string): Promise<string> {
  const text = await readFile(join(KIT_DIR, 'skills', AVENUE_SKILL[avenue], 'assets', 'starter', name), 'utf8');
  return text.replace(/\r\n/g, '\n');
}

async function makeScormFiles(): Promise<Record<BuildingScenario, ScenarioFile[]>> {
  const [starterHtml, starterManifest] = await Promise.all([readStarter('scorm', 'index.html'), readStarter('scorm', 'imsmanifest.xml')]);
  const manifest = replaceRequired(starterManifest, 'RENAME ME', TITLE);
  const html = replaceRequired(replaceRequired(starterHtml, 'RENAME ME', TITLE), questionsBlock(STARTER_QUESTIONS), questionsBlock(QUESTIONS));
  const files = (indexHtml: string): ScenarioFile[] => [
    { name: 'index.html', callId: 'write-index', text: indexHtml },
    { name: 'imsmanifest.xml', callId: 'write-manifest', text: manifest },
  ];
  return {
    ok: files(html),
    'qa-fail': files(replaceRequired(html, '</body>', `${COMPLETED_ON_LOAD}</body>`)),
    'follow-up': files(replaceRequired(html, questionsBlock(QUESTIONS), questionsBlock(FOLLOW_UP_QUESTIONS))),
  };
}

async function makeTopicFiles(): Promise<Record<BuildingScenario, ScenarioFile[]>> {
  const starterHtml = await readStarter('topic', 'index.html');
  const html = replaceRequired(
    replaceRequired(
      replaceRequired(starterHtml, 'RENAME ME', TOPIC_TITLE),
      'Replace this with your activity. The wiring below is the part worth keeping.',
      TOPIC_INTRO,
    ),
    'Notes, exemplars or marking guidance go here.',
    TOPIC_NOTES,
  );
  const files = (indexHtml: string): ScenarioFile[] => [{ name: 'index.html', callId: 'write-index', text: indexHtml }];
  return {
    ok: files(html),
    'qa-fail': files(replaceRequired(html, '</head>', STATIC_DATA_SCRIPT)),
    'follow-up': files(replaceRequired(html, TOPIC_NOTES, TOPIC_FOLLOW_UP_NOTES)),
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
  if (!text.includes(from)) throw new Error(`The kit's starter no longer contains: ${from.slice(0, 60)}`);
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

/** A message that makes the scripted agent pick a content topic for a project with no avenue. */
const ASKS_FOR_TOPIC = /student and instructor views|content topic/i;

/** A message that makes the scripted agent record `SUGGESTIONS`, the phrase the front end's stub answers the same way. */
const ASKS_FOR_SUGGESTIONS = 'with design suggestions';

/** The suggestions the scripted agent records, the same as the front end's stub. */
export const SUGGESTIONS: BuildSuggestion[] = [
  {
    framework: 'tilt',
    principle: 'Criteria',
    suggestion: 'Show an example of a strong response before the activity.',
    reason: 'Students can compare their work with the criteria before submitting.',
  },
  {
    framework: 'udl',
    principle: 'Action & Expression',
    suggestion: 'Let students explain their answer in writing or with a labeled diagram.',
    reason: 'Multiple response formats give students more ways to show what they know.',
  },
];

/** The sentence a reply adds about recorded suggestions. */
const SUGGESTIONS_SENTENCE = 'I left two optional design suggestions on the build card.';

/** The sentence that opens the reply of a turn that picked the avenue. */
const PICK_REASONS: Record<BuildableAvenue, string> = {
  scorm: 'I made this a SCORM package so scores reach the gradebook.',
  topic: 'I made this a content topic so students and instructors can have separate views.',
};

/** Calls the session's `cdk` tool `name`, as an agent would. */
function callTool(tools: ToolServerSpec, name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = tools.tools.find((def) => def.name === name);
  if (!tool) throw new Error(`The session has no ${name} tool`);
  return tool.handler(input);
}

/** The project's avenue as `get_project` reports it: null before one is set. */
async function projectAvenue(tools: ToolServerSpec): Promise<BuildableAvenue | null> {
  const { avenue } = JSON.parse((await callTool(tools, 'get_project')).content) as { avenue: BuildableAvenue | null };
  return avenue;
}

/** How the scripted agent describes building from each avenue's starter. */
const BUILDING_STATUS: Record<BuildableAvenue, string> = {
  scorm: 'Building from the SCORM starter',
  topic: 'Building from the content-topic starter',
};

async function* runScenario(
  text: string,
  tools: ToolServerSpec,
  outDir: string,
  signal: AbortSignal,
  resolveResult: (result: TurnResult) => void,
  sessionId: string,
): AsyncGenerator<AgentEvent> {
  try {
    const scenario = scenarioFor(text);
    const failure = FAILURES[scenario];
    if (failure) {
      yield { kind: 'status', text: 'Connecting to the agent', category: 'other' };
      await delay(300, signal);
      resolveResult({ status: 'failed', sessionId, text: '', error: failure, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0 } });
      return;
    }

    yield { kind: 'message_start' };
    yield { kind: 'status', text: 'Reading the request', category: 'reading' };
    await delay(400, signal);

    const stored = await projectAvenue(tools);
    const avenue = stored ?? (ASKS_FOR_TOPIC.test(text) ? 'topic' : 'scorm');
    if (!stored) {
      const name = `mcp__${tools.name}__set_format`;
      yield { kind: 'tool_start', callId: 'set-format', name, summary: 'Setting the format', category: toolCategory(name, {}) };
      await callTool(tools, 'set_format', { format: avenue });
      yield { kind: 'tool_end', callId: 'set-format', ok: true };
    }

    const suggests = text.includes(ASKS_FOR_SUGGESTIONS);
    if (suggests) {
      const name = `mcp__${tools.name}__record_suggestions`;
      yield { kind: 'tool_start', callId: 'record-suggestions', name, summary: 'Noting suggestions', category: toolCategory(name, {}) };
      await callTool(tools, 'record_suggestions', { suggestions: SUGGESTIONS });
      yield { kind: 'tool_end', callId: 'record-suggestions', ok: true };
    }

    if (scenario === 'cancelled') {
      yield { kind: 'status', text: BUILDING_STATUS[avenue], category: 'building' };
      await delay(200, signal);
      resolveResult({ status: 'cancelled', sessionId, text: '', usage: { inputTokens: 800, outputTokens: 100, costUsd: 0.005, steps: 1 } });
      return;
    }

    yield { kind: 'status', text: BUILDING_STATUS[avenue], category: 'building' };
    await delay(scenario === 'long-step' ? LONG_STEP_MS : 800, signal);

    const building: BuildingScenario = scenario === 'qa-fail' || scenario === 'follow-up' ? scenario : 'ok';
    const files = (await scenarioFiles(avenue))[building];
    await mkdir(outDir, { recursive: true });

    for (const file of files) {
      yield { kind: 'tool_start', callId: file.callId, name: 'Write', summary: `Writing ${file.name}`, category: toolCategory('Write', {}) };
      await writeFile(join(outDir, file.name), file.text, 'utf8');
      await delay(200, signal);
      yield { kind: 'tool_end', callId: file.callId, ok: true };
    }

    const built = (avenue === 'topic' ? TOPIC_REPLIES : REPLIES)[building];
    const reply = [stored ? '' : PICK_REASONS[avenue], built, suggests ? SUGGESTIONS_SENTENCE : ''].filter(Boolean).join(' ');
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

function createScriptedSession(sessionId: string, workspaceDir: string, tools: ToolServerSpec): AgentSession {
  return {
    get sessionId() {
      return sessionId;
    },

    send(input: TurnInput, _limits: TurnLimits, signal: AbortSignal): AgentTurn {
      let resolveResult!: (result: TurnResult) => void;
      const result = new Promise<TurnResult>((resolve) => {
        resolveResult = resolve;
      });
      const events = runScenario(input.text, tools, join(workspaceDir, 'out'), signal, resolveResult, sessionId);
      return { events, result };
    },

    async close(): Promise<void> {},
  };
}

/**
 * An agent for development and tests that replays fixed turns with no AI
 * calls. It builds the project's avenue, which it reads with `get_project`.
 * For a project with none it first sets one with `set_format`: a content
 * topic when the message mentions a content topic or student and instructor
 * views, and a SCORM package otherwise. A message asking for the turn
 * "with design suggestions" records `SUGGESTIONS`. The marker in the instructor's
 * message picks the scenario; the same scenario always gives the same events
 * and files.
 */
export function createScriptedAgentDriver(): AgentDriver {
  return {
    name: 'scripted',

    async probe(): Promise<ProbeResult> {
      return { ok: true };
    },

    signIn() {},

    endSignIn() {},

    async open(req: SessionRequest): Promise<AgentSession> {
      return createScriptedSession(req.sessionId ?? SESSION_ID, req.workspaceDir, req.tools);
    },
  };
}
