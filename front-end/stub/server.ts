/**
 * Stand-in for the back end while the real routes are built. Serves the six V1
 * endpoints plus /api/health and /api/me with the shapes from docs/architecture.md,
 * and plays a scripted turn on the event stream.
 *
 * Deleted in the PR that lands B12.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type {
  ApiErrorBody,
  Build,
  BuildResponse,
  ContentBlock,
  CreateProjectRequest,
  CreateProjectResponse,
  EventKind,
  EventPayloads,
  MeResponse,
  Message,
  Project,
  ProjectResponse,
  QaFinding,
  SendMessageRequest,
  SendMessageResponse,
  Turn,
  User,
} from '../src/api/types';

const HOST = '127.0.0.1';
const PORT = Number(process.env.STUB_PORT ?? 3001);
const KEEPALIVE_MS = 15_000;

/** Bytes of a valid zip archive with no entries, so the Download link produces a file. */
const EMPTY_ZIP = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]);

const user: User = { id: 'stub-user', displayName: 'Stub Instructor', email: null, role: 'instructor' };

type Scenario = 'ok' | 'qa-fail' | 'turn-fail';

interface StoredEvent {
  seq: number;
  kind: EventKind;
  payload: unknown;
}

interface ProjectState {
  project: Project;
  messages: Message[];
  builds: Build[];
  events: StoredEvent[];
  subscribers: Set<(event: StoredEvent) => void>;
  activeTurn: Turn | null;
}

const projects = new Map<string, ProjectState>();
const builds = new Map<string, { state: ProjectState; build: Build }>();

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: HttpError): void {
  const body: ApiErrorBody = {
    error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
  };
  sendJson(res, error.status, body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Invalid JSON body');
  }
}

function getProject(projectId: string): ProjectState {
  const state = projects.get(projectId);
  if (!state) throw new HttpError(404, 'not_found', 'Project not found');
  return state;
}

function append<K extends EventKind>(state: ProjectState, kind: K, payload: EventPayloads[K]): void {
  const event: StoredEvent = { seq: state.events.length + 1, kind, payload };
  state.events.push(event);
  for (const subscriber of state.subscribers) subscriber(event);
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function scenarioFor(text: string): Scenario {
  if (text.includes('[turn-fail]')) return 'turn-fail';
  if (text.includes('[qa-fail]')) return 'qa-fail';
  return 'ok';
}

const FAILED_FINDINGS: QaFinding[] = [
  {
    rule: 'scorm/completed-on-load',
    severity: 'error',
    file: 'index.html',
    line: 42,
    message: 'lesson_status is set to "completed" during load; D2L will lock the learner out after one attempt.',
  },
  {
    rule: 'scorm/suspend-data-budget',
    severity: 'warn',
    file: 'index.html',
    line: 118,
    message: 'suspend_data can exceed 4000 characters; the tenant discards writes over 4096.',
  },
];

const REPLY_CHUNKS = [
  'I built a ten-question multiple-choice practice set on cell division. ',
  'Students can retake it, and the best score is written to the gradebook. ',
  'Each question gives feedback after an answer, and progress is saved between sessions. ',
  'The package passed the QA gate, so it is ready to download and upload to your course.',
];

/** Plays one turn's events over about seven seconds. */
function runTurn(state: ProjectState, turn: Turn, scenario: Scenario): void {
  const { project } = state;
  const replyId = randomUUID();
  const callId = randomUUID();
  let build: Build | null = null;

  const steps: Array<[number, () => void]> = [
    [
      0,
      () => {
        turn.status = 'running';
        turn.startedAt = Date.now();
        append(state, 'turn.started', { turnId: turn.id });
      },
    ],
    [400, () => append(state, 'turn.status', { turnId: turn.id, text: 'Reading your request' })],
    [1200, () => append(state, 'turn.status', { turnId: turn.id, text: 'Building from the SCORM starter' })],
    ...REPLY_CHUNKS.map(
      (text, index): [number, () => void] => [
        2000 + index * 400,
        () => append(state, 'message.delta', { turnId: turn.id, messageId: replyId, text }),
      ],
    ),
    [
      4000,
      () => append(state, 'tool.started', { turnId: turn.id, callId, name: 'Bash', summary: 'Running the QA gate' }),
    ],
  ];

  if (scenario === 'turn-fail') {
    steps.push([
      4800,
      () => {
        turn.status = 'failed';
        turn.finishedAt = Date.now();
        turn.error = { code: 'agent_error', message: 'The agent stopped before it finished.' };
        state.activeTurn = null;
        append(state, 'turn.failed', { turnId: turn.id, error: turn.error });
      },
    ]);
  } else {
    const passed = scenario === 'ok';
    steps.push(
      [
        4800,
        () =>
          append(state, 'tool.finished', {
            turnId: turn.id,
            callId,
            ok: passed,
            summary: passed ? 'QA gate passed' : `QA gate reported ${FAILED_FINDINGS.length} findings`,
          }),
      ],
      [
        5200,
        () => {
          build = {
            id: randomUUID(),
            projectId: project.id,
            version: state.builds.length + 1,
            status: 'checking',
            avenue: project.avenue ?? 'scorm',
            qa: null,
            pedagogy: null,
            turnId: turn.id,
            createdAt: Date.now(),
          };
          state.builds.push(build);
          builds.set(build.id, { state, build });
          append(state, 'build.created', { build: { ...build } });
        },
      ],
      [
        6200,
        () => {
          if (!build) return;
          build.status = passed ? 'ready' : 'failed';
          build.qa = { passed, findings: passed ? [] : FAILED_FINDINGS };
          append(state, 'build.updated', { build: { ...build } });
        },
      ],
      [
        6600,
        () => {
          const content: ContentBlock[] = [{ type: 'text', text: REPLY_CHUNKS.join('') }];
          if (build) content.push({ type: 'build_ref', buildId: build.id });
          const message: Message = {
            id: replyId,
            projectId: project.id,
            seq: state.messages.length + 1,
            role: 'agent',
            content,
            turnId: turn.id,
            createdAt: Date.now(),
          };
          state.messages.push(message);
          turn.replyId = message.id;
          append(state, 'message.completed', { message });
        },
      ],
      [
        7000,
        () => {
          turn.status = 'completed';
          turn.finishedAt = Date.now();
          turn.usage = { inputTokens: 4200, outputTokens: 900, costUsd: 0.03, steps: 4 };
          state.activeTurn = null;
          append(state, 'turn.completed', { turnId: turn.id, usage: turn.usage });
        },
      ],
    );
  }

  for (const [delay, step] of steps) setTimeout(step, delay);
}

function createProject(body: unknown): CreateProjectResponse {
  const input = body as Partial<CreateProjectRequest>;
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw new HttpError(400, 'invalid_request', 'title is required');
  }
  const now = Date.now();
  const project: Project = {
    id: randomUUID(),
    ownerId: user.id,
    title: input.title.trim(),
    avenue: input.avenue ?? 'scorm',
    targetCourse: input.targetCourse ?? null,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
  };
  projects.set(project.id, {
    project,
    messages: [],
    builds: [],
    events: [],
    subscribers: new Set(),
    activeTurn: null,
  });
  return { project };
}

function projectView(state: ProjectState): ProjectResponse {
  return {
    project: state.project,
    builds: state.builds.map(({ id, version, status, createdAt }) => ({ id, version, status, createdAt })),
    ...(state.activeTurn ? { activeTurn: state.activeTurn } : {}),
  };
}

function sendMessage(state: ProjectState, body: unknown): SendMessageResponse {
  const input = body as Partial<SendMessageRequest>;
  if (!Array.isArray(input.content) || !input.content.some((block) => block?.type === 'text')) {
    throw new HttpError(400, 'invalid_request', 'content must include a text block');
  }
  if (state.activeTurn) {
    throw new HttpError(409, 'turn_active', 'A turn is already active for this project', {
      turnId: state.activeTurn.id,
    });
  }
  const message: Message = {
    id: randomUUID(),
    projectId: state.project.id,
    seq: state.messages.length + 1,
    role: 'instructor',
    content: input.content,
    turnId: null,
    createdAt: Date.now(),
  };
  const turn: Turn = {
    id: randomUUID(),
    projectId: state.project.id,
    messageId: message.id,
    replyId: null,
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    error: null,
    usage: null,
  };
  message.turnId = turn.id;
  state.messages.push(message);
  state.activeTurn = turn;
  runTurn(state, turn, scenarioFor(textOf(message.content)));
  return { message, turn };
}

function streamEvents(req: IncomingMessage, res: ServerResponse, state: ProjectState, after: number): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const write = (event: StoredEvent) => {
    res.write(`id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };

  for (const event of state.events) {
    if (event.seq > after) write(event);
  }
  state.subscribers.add(write);
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    state.subscribers.delete(write);
  });
}

function download(res: ServerResponse, buildId: string): void {
  const entry = builds.get(buildId);
  if (!entry) throw new HttpError(404, 'not_found', 'Build not found');
  const name = `${entry.state.project.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-v${entry.build.version}.zip`;
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Content-Length': EMPTY_ZIP.length,
  });
  res.end(EMPTY_ZIP);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const method = req.method ?? 'GET';
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[0] !== 'api') throw new HttpError(404, 'not_found', 'Not found');
  const [, resource, id, sub] = segments;

  if (resource === 'health' && method === 'GET' && !id) return sendJson(res, 200, { ok: true });

  if (resource === 'me' && method === 'GET' && !id) {
    const body: MeResponse = { user, mode: 'local', agent: { name: 'stub', ok: true, version: 'stub' } };
    return sendJson(res, 200, body);
  }

  if (resource === 'projects') {
    if (method === 'POST' && !id) return sendJson(res, 201, createProject(await readJson(req)));
    if (id && !sub && method === 'GET') return sendJson(res, 200, projectView(getProject(id)));
    if (id && sub === 'messages' && method === 'POST') {
      return sendJson(res, 202, sendMessage(getProject(id), await readJson(req)));
    }
    if (id && sub === 'events' && method === 'GET') {
      const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
      return streamEvents(req, res, getProject(id), Number.isFinite(after) ? after : 0);
    }
  }

  if (resource === 'builds' && id && method === 'GET') {
    if (sub === 'download') return download(res, id);
    if (!sub) {
      const entry = builds.get(id);
      if (!entry) throw new HttpError(404, 'not_found', 'Build not found');
      const body: BuildResponse = { build: entry.build, deployments: [] };
      return sendJson(res, 200, body);
    }
  }

  throw new HttpError(404, 'not_found', 'Not found');
}

const server = createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    if (error instanceof HttpError) {
      sendError(res, error);
    } else {
      console.error(error);
      sendError(res, new HttpError(500, 'internal_error', 'Internal server error'));
    }
  });
  res.on('finish', () => console.log(`${req.method} ${req.url} -> ${res.statusCode}`));
});

server.listen(PORT, HOST, () => {
  console.log(`stub back end listening on http://${HOST}:${PORT}`);
  console.log('Scenarios: include [qa-fail] or [turn-fail] in the message text to play a failure.');
});
