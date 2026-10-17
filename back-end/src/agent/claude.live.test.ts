import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import { createProjectsRepo } from '../db/projects.js';
import { testDb } from '../db/test-db.js';
import { createUsersRepo } from '../db/users.js';
import { KIT_DIR, SCORM_SKILLS } from '../kit.js';
import { createEventService } from '../pipeline/events.js';
import { createBuildService } from '../services/builds.js';
import { createWorkspaceService } from '../services/workspaces.js';
import { createCdkTools } from '../tools/index.js';
import { createClaudeAgentDriver } from './claude.js';
import { renderProjectInstructions } from './instructions.js';
import type { AgentEvent, SessionRequest, ToolServerSpec } from './AgentDriver.js';

const driver = createClaudeAgentDriver();

beforeAll(async () => {
  const result = await driver.probe();
  if (!result.ok) {
    throw new Error(
      `Cannot run live tests: the Claude CLI is not signed in.\n` +
      `probe() reported: ${result.detail}\n` +
      `Sign in with \`claude login\` and try again.`,
    );
  }
}, 20_000);

function baseRequest(workspaceDir: string, skillsDir: string, sessionId: string | null = null): SessionRequest {
  return {
    workspaceDir,
    sessionId,
    instructions: 'You are helping build D2L course content. Follow instructions exactly and briefly.',
    skillsDir,
    skills: [],
    tools: { name: 'cdk', tools: [] },
  };
}

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

/** The `tool_end` events of every call to the tool `name`. */
function toolEnds(events: AgentEvent[], name: string): Array<Extract<AgentEvent, { kind: 'tool_end' }>> {
  const callIds = new Set(events.flatMap((event) => (event.kind === 'tool_start' && event.name === name ? [event.callId] : [])));
  return events.filter(
    (event): event is Extract<AgentEvent, { kind: 'tool_end' }> => event.kind === 'tool_end' && callIds.has(event.callId),
  );
}

describe('ClaudeAgentDriver, live SDK', () => {
  let workspaceDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'cdk-claude-live-workspace-'));
    skillsDir = await mkdtemp(join(tmpdir(), 'cdk-claude-live-skills-'));
    await mkdir(join(workspaceDir, 'out'));
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(skillsDir, { recursive: true, force: true });
  });

  it('edits a file in the workspace, then resumes the session by id on a second turn', async () => {
    const session = await driver.open(baseRequest(workspaceDir, skillsDir));

    const turn1 = session.send(
      {
        text: "Use the Write tool to create a file named hello.txt in the out folder, containing exactly the text 'hello'. Do not ask questions; just create it.",
        attachments: [],
      },
      { maxSteps: 6, maxBudgetUsd: 1 },
      new AbortController().signal,
    );
    await drain(turn1.events);
    const result1 = await turn1.result;
    expect(result1.status).toBe('completed');
    expect(result1.sessionId).toBeTruthy();

    const written = await readFile(join(workspaceDir, 'out', 'hello.txt'), 'utf8');
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

  it('refuses a Write outside the workspace', async () => {
    // `Write(/**)`/`Edit(/**)` are workspace-relative (docs/drivers.md:
    // "`/` is workspace-relative"), so a path outside workspaceDir matches
    // no allow rule under `dontAsk` and must be denied.
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

      const writeEnds = toolEnds(events, 'Write');
      expect(writeEnds.length).toBeGreaterThan(0);
      expect(writeEnds.every((event) => !event.ok)).toBe(true);
      await expect(access(outsidePath)).rejects.toThrow();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses a Write inside the workspace but outside out/', async () => {
    const session = await driver.open(baseRequest(workspaceDir, skillsDir));
    const notesPath = join(workspaceDir, 'notes.txt');

    const turn = session.send(
      {
        text: `Use the Write tool to create a file at the absolute path ${notesPath} containing the text 'notes'. If your permissions deny this, that's fine — just report what happened.`,
        attachments: [],
      },
      { maxSteps: 4, maxBudgetUsd: 1 },
      new AbortController().signal,
    );

    const events = await drain(turn.events);
    await turn.result;

    const writeEnds = toolEnds(events, 'Write');
    expect(writeEnds.length).toBeGreaterThan(0);
    expect(writeEnds.every((event) => !event.ok)).toBe(true);
    await expect(access(notesPath)).rejects.toThrow();
  }, 60_000);

  it('refuses a read outside the workspace through the file tools', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'cdk-claude-live-outside-'));
    const outsidePath = join(outsideDir, 'secret.txt');
    await writeFile(outsidePath, 'cdk-outside-marker');

    try {
      const session = await driver.open(baseRequest(workspaceDir, skillsDir));
      const turn = session.send(
        {
          text: `Use the Read tool, and only the Read tool, to read the file at the absolute path ${outsidePath}. Do not use the shell. If the read is refused, just report that.`,
          attachments: [],
        },
        { maxSteps: 4, maxBudgetUsd: 1 },
        new AbortController().signal,
      );

      const events = await drain(turn.events);
      const result = await turn.result;
      expect(result.status).toBe('completed');

      const readEnds = toolEnds(events, 'Read');
      expect(readEnds.length).toBeGreaterThan(0);
      expect(readEnds.every((event) => !event.ok)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('ClaudeAgentDriver, live SDK, in a provisioned SCORM workspace', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cdk-claude-live-data-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  /** The project's cdk tools, with whether each `check_output` call passed recorded in `checks`. */
  function recordingChecks(tools: ToolServerSpec, checks: boolean[]): ToolServerSpec {
    return {
      ...tools,
      tools: tools.tools.map((def) => def.name !== 'check_output' ? def : {
        ...def,
        handler: async (input) => {
          const result = await def.handler(input);
          checks.push(result.isError ? false : (JSON.parse(result.content) as { passed: boolean }).passed);
          return result;
        },
      }),
    };
  }

  /** Opens a session for a new SCORM project, with `prepare` run on its workspace first. */
  async function openProject(prepare: (outDir: string) => Promise<void> = async () => {}) {
    const db = testDb();
    const projects = createProjectsRepo(db);
    const workspaces = createWorkspaceService({ dataDir });
    const builds = createBuildService({ builds: createBuildsRepo(db), projects, workspaces, events: createEventService(createEventsRepo(db)) });
    const project = projects.create({ id: 'live-project', ownerId: createUsersRepo(db).ensureLocalUser().id, title: 'Photosynthesis check', avenue: 'scorm' });
    await workspaces.create(project.id);
    const workspaceDir = workspaces.pathFor(project.id);
    await prepare(join(workspaceDir, 'out'));
    const checks: boolean[] = [];
    const session = await driver.open({
      workspaceDir,
      sessionId: null,
      instructions: renderProjectInstructions({ project, workspaceDir }),
      skillsDir: join(KIT_DIR, 'skills'),
      skills: SCORM_SKILLS,
      tools: recordingChecks(createCdkTools({ projects, workspaces, builds }, project.id), checks),
    });
    return { project, workspaces, workspaceDir, builds, checks, session };
  }

  it('passes the session check with the allowed tools and the SCORM skills, or the turn would fail with agent_unrestricted', async () => {
    const { session } = await openProject();

    const turn = session.send(
      { text: 'Reply with the single word: ready', attachments: [] },
      { maxSteps: 2, maxBudgetUsd: 1 },
      new AbortController().signal,
    );
    await drain(turn.events);
    const result = await turn.result;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe('completed');
  }, 60_000);

  it('has no shell, so a request to run a command runs nothing', async () => {
    const { session } = await openProject();

    const turn = session.send(
      { text: 'Run the command `node --version` and reply with its exact output. If you cannot run commands, say so.', attachments: [] },
      { maxSteps: 4, maxBudgetUsd: 1 },
      new AbortController().signal,
    );
    const events = await drain(turn.events);
    const result = await turn.result;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe('completed');
    const shellEnds = [...toolEnds(events, 'Bash'), ...toolEnds(events, 'PowerShell')];
    expect(shellEnds.every((event) => !event.ok)).toBe(true);
    expect(result.text).not.toContain(process.version);
  }, 60_000);

  it('fixes what its first check finds, and the turn\'s build passes the QA gate', async () => {
    const { project, builds, checks, session } = await openProject(async (outDir) => {
      const page = await readFile(join(outDir, 'index.html'), 'utf8');
      const broken = '<img src="leaf.svg">\n<script>var answers = [;</script>\n</body>';
      await writeFile(join(outDir, 'index.html'), page.replace('</body>', broken));
      await writeFile(join(outDir, 'leaf.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="green"/></svg>');
    });

    const turn = session.send(
      { text: 'Check the activity with check_output before you change anything, then fix every error it reports.', attachments: [] },
      { maxSteps: 30, maxBudgetUsd: 3 },
      new AbortController().signal,
    );
    await drain(turn.events);
    const result = await turn.result;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe('completed');
    expect(checks[0]).toBe(false);
    expect(checks.at(-1)).toBe(true);
    expect(await builds.create(project.id)).toMatchObject({ status: 'ready', qa: { passed: true } });
  }, 600_000);

  it('builds an activity that passes the QA gate, checking it with check_output', async () => {
    const { project, workspaces, builds, checks, session } = await openProject();
    const startingHash = await workspaces.hashOutput(project.id);

    const turn = session.send(
      {
        text: 'Build a three-question multiple-choice practice quiz on photosynthesis for first-year biology students, graded automatically.',
        attachments: [],
      },
      { maxSteps: 60, maxBudgetUsd: 5 },
      new AbortController().signal,
    );
    await drain(turn.events);
    const result = await turn.result;
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('completed');
    expect(await workspaces.hashOutput(project.id)).not.toBe(startingHash);
    expect(checks.length).toBeGreaterThan(0);
    expect(await builds.create(project.id)).toMatchObject({ status: 'ready', qa: { passed: true } });
  }, 900_000);
});
