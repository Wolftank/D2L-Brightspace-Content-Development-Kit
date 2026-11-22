import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BuildableAvenue, BuildSuggestion } from '@cdk/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ToolResult, ToolServerSpec } from '../agent/AgentDriver.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { testDb } from '../db/test-db.js';
import { createTurnsRepo } from '../db/turns.js';
import { createUsersRepo } from '../db/users.js';
import { KIT_DIR } from '../kit.js';
import { createEventService, type EventService } from '../pipeline/events.js';
import { createSuggestionStore, type SuggestionStore } from '../pipeline/suggestions.js';
import { createAvenueService, type AvenueService } from '../services/avenues.js';
import { createBuildService, type BuildService } from '../services/builds.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';
import { createCdkTools } from './index.js';

const CRITERIA: BuildSuggestion = { framework: 'tilt', principle: 'Criteria', suggestion: 'Name what a strong answer includes.', reason: 'Students do better when they see the criteria first.' };
const PURPOSE: BuildSuggestion = { framework: 'tilt', principle: 'Purpose', suggestion: 'Say what the quiz prepares students for.', reason: 'Knowing why the work matters raises motivation.' };
const ENGAGEMENT: BuildSuggestion = { framework: 'udl', principle: 'Engagement', suggestion: 'Open with a real case.', reason: 'A relevant case recruits interest.' };

describe('CDK tools', () => {
  let dataDir: string;
  let projects: ProjectsRepo;
  let workspaces: WorkspaceService;
  let builds: BuildService;
  let events: EventService;
  let avenues: AvenueService;
  let suggestions: SuggestionStore;

  async function addProject(id: string, title: string, avenue: BuildableAvenue | null = 'scorm'): Promise<string> {
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    projects.create({ id, ownerId, title, avenue });
    await workspaces.create(id, avenue);
    return join(workspaces.pathFor(id), 'out');
  }

  function call(tools: ToolServerSpec, name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No tool named ${name}`);
    return tool.handler(input);
  }

  let db: ReturnType<typeof testDb>;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-tools-'));
    db = testDb();
    projects = createProjectsRepo(db);
    workspaces = createWorkspaceService({ dataDir });
    events = createEventService(createEventsRepo(db));
    builds = createBuildService({ builds: createBuildsRepo(db), projects, workspaces, events });
    avenues = createAvenueService({ projects, workspaces, turns: createTurnsRepo(db), events });
    suggestions = createSuggestionStore();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function toolsFor(projectId: string): ToolServerSpec {
    return createCdkTools({ projects, avenues, workspaces, builds, suggestions }, projectId);
  }

  it('serves get_project, set_format, check_output, record_suggestions, and delete_files as the cdk server, each with a status line', async () => {
    await addProject('p1', 'Cell division practice');
    const tools = toolsFor('p1');

    expect(tools.name).toBe('cdk');
    expect(tools.tools.map((tool) => [tool.name, tool.summary])).toEqual([
      ['get_project', 'Reading the project'],
      ['set_format', 'Setting the format'],
      ['check_output', 'Checking the activity'],
      ['record_suggestions', 'Noting suggestions'],
      ['delete_files', 'Deleting files'],
    ]);
  });

  describe('get_project', () => {
    it("reports the project, its latest build, and the tenant's limits for SCORM", async () => {
      await addProject('p1', 'Cell division practice');
      const before = JSON.parse((await call(toolsFor('p1'), 'get_project')).content);

      expect(before).toMatchObject({ title: 'Cell division practice', avenue: 'scorm', latestBuild: null });
      expect(Object.keys(before.tenant)).toEqual(['scorm', 'fileLoading', 'storage', 'rendering']);
      expect(before.tenant.scorm).toHaveProperty('suspendDataMaxChars');

      await builds.create('p1');
      const after = JSON.parse((await call(toolsFor('p1'), 'get_project')).content);
      expect(after.latestBuild).toMatchObject({ version: 1, status: 'ready', qa: { passed: true }, error: null });
    });

    it('leaves out who measured the tenant and the sections for other avenues', async () => {
      await addProject('p1', 'Cell division practice');
      const { content } = await call(toolsFor('p1'), 'get_project');

      expect(content).not.toContain('measuredBy');
      expect(content).not.toContain('homepageWidget');
      expect(content).not.toContain('brightspaceApi');
    });

    it("reports a content topic's tenant limits, with the Brightspace API and without SCORM", async () => {
      await addProject('t1', 'Campus map', 'topic');

      const project = JSON.parse((await call(toolsFor('t1'), 'get_project')).content);

      expect(project).toMatchObject({ title: 'Campus map', avenue: 'topic', latestBuild: null });
      expect(Object.keys(project.tenant)).toEqual(['fileLoading', 'storage', 'brightspaceApi', 'rendering']);
      expect(project.tenant.brightspaceApi.roleDetection.value).toContain('myenrollments');
      expect(project.tenant.storage.sharedAcrossEntireLms.note).toContain('HTML topics');
    });
  });

  describe('get_project, earlierSuggestions', () => {
    it('lists each suggestion on the earlier builds once, without its reason, and none before the first build', async () => {
      await addProject('p1', 'Cell division practice');
      const read = async () => JSON.parse((await call(toolsFor('p1'), 'get_project')).content).earlierSuggestions;
      expect(await read()).toEqual([]);

      await builds.create('p1', undefined, [CRITERIA, ENGAGEMENT]);
      await builds.create('p1');
      await builds.create('p1', undefined, [{ ...CRITERIA, reason: 'Worded another way.' }, PURPOSE]);

      expect(await read()).toEqual([CRITERIA, ENGAGEMENT, PURPOSE].map(({ framework, principle, suggestion }) => ({ framework, principle, suggestion })));
    });
  });

  describe('record_suggestions', () => {
    function inputOf(name: string): z.ZodObject {
      return z.object(toolsFor('p1').tools.find((tool) => tool.name === name)!.input);
    }

    it('keeps the last list recorded for its own project, and changes nothing in out/', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      await addProject('p2', 'Photosynthesis');
      const before = await workspaces.hashOutput('p1');

      await call(toolsFor('p1'), 'record_suggestions', { suggestions: [CRITERIA, ENGAGEMENT] });
      const result = await call(toolsFor('p1'), 'record_suggestions', { suggestions: [PURPOSE] });

      expect(result.isError).toBeFalsy();
      expect(suggestions.take('p1')).toEqual([PURPOSE]);
      expect(suggestions.take('p2')).toEqual([]);
      expect(await workspaces.hashOutput('p1')).toBe(before);
      expect(await fs.readdir(outDir)).not.toContain('suggestions.json');
    });

    it('takes up to three suggestions whose principle belongs to their framework, and an empty list', () => {
      const input = inputOf('record_suggestions');

      expect(input.safeParse({ suggestions: [] }).success).toBe(true);
      expect(input.safeParse({ suggestions: [CRITERIA, PURPOSE, ENGAGEMENT] }).success).toBe(true);
      expect(input.safeParse({ suggestions: [CRITERIA, PURPOSE, ENGAGEMENT, CRITERIA] }).success).toBe(false);
      expect(input.safeParse({ suggestions: [{ ...CRITERIA, framework: 'udl' }] }).success).toBe(false);
      expect(input.safeParse({ suggestions: [{ ...ENGAGEMENT, principle: 'Fairness' }] }).success).toBe(false);
      expect(input.safeParse({ suggestions: [{ ...CRITERIA, reason: '' }] }).success).toBe(false);
    });
  });

  describe('set_format', () => {
    it("gives a project with no format the picked one, with its starter, skill, and tenant limits", async () => {
      const outDir = await addProject('p1', 'Campus map', null);
      const tools = toolsFor('p1');
      expect(JSON.parse((await call(tools, 'get_project')).content)).toMatchObject({ avenue: null, tenant: null });
      expect((await call(tools, 'check_output')).isError).toBe(true);

      const result = JSON.parse((await call(tools, 'set_format', { format: 'topic' })).content);

      expect(result).toMatchObject({ format: 'topic', skill: 'd2l-content-topic' });
      expect(Object.keys(result.tenant)).toContain('brightspaceApi');
      expect(await fs.readdir(outDir)).toEqual(['data.js', 'index.html']);
      expect(projects.getById('p1')?.avenue).toBe('topic');
      expect(events.after('p1', 0).map((event) => [event.kind, event.payload])).toEqual([
        ['project.updated', { project: expect.objectContaining({ id: 'p1', avenue: 'topic' }) }],
      ]);
      expect(JSON.parse((await call(tools, 'check_output')).content)).toMatchObject({ passed: true });
    });

    it('keeps out/ for the format the project has, and replaces it for the other one', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      await fs.writeFile(join(outDir, 'notes.html'), '<p>draft</p>');
      const tools = toolsFor('p1');

      await call(tools, 'set_format', { format: 'scorm' });
      expect(await fs.readdir(outDir)).toContain('notes.html');
      expect(events.after('p1', 0)).toEqual([]);

      await call(tools, 'set_format', { format: 'topic' });
      expect(await fs.readdir(outDir)).toEqual(['data.js', 'index.html']);
      expect(JSON.parse((await call(tools, 'get_project')).content)).toMatchObject({ avenue: 'topic' });
    });
  });

  describe('check_output', () => {
    it('passes the starter and records nothing', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      const before = await fs.readdir(outDir);

      const result = await call(toolsFor('p1'), 'check_output');

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content)).toMatchObject({ passed: true });
      expect(builds.latest('p1')).toBeUndefined();
      expect(await fs.readdir(outDir)).toEqual(before);
    });

    it('returns the findings of an output that fails the QA gate', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      await fs.rm(join(outDir, 'imsmanifest.xml'));

      const result = await call(toolsFor('p1'), 'check_output');

      const report = JSON.parse(result.content);
      expect(report.passed).toBe(false);
      expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'scorm/manifest', severity: 'error' }));
    });

    it('checks a content topic with the topic rules, so the untouched starter passes', async () => {
      await addProject('t1', 'Campus map', 'topic');

      const report = JSON.parse((await call(toolsFor('t1'), 'check_output')).content);

      expect(report).toMatchObject({ passed: true });
      expect(report.findings.filter((f: { rule: string }) => f.rule.startsWith('scorm/'))).toEqual([]);
    });

    it('returns the topic findings of a content topic that fails the QA gate', async () => {
      const outDir = await addProject('t1', 'Campus map', 'topic');
      await fs.rm(outDir, { recursive: true });
      await fs.cp(join(KIT_DIR, 'qa', 'lint', 'fixtures', 'bad-topic'), outDir, { recursive: true });

      const report = JSON.parse((await call(toolsFor('t1'), 'check_output')).content);

      expect(report.passed).toBe(false);
      const rules = report.findings.map((f: { rule: string }) => f.rule);
      expect(rules).toContain('topic/no-static-script-src');
      expect(rules.filter((rule: string) => rule.startsWith('scorm/'))).toEqual([]);
    });

    it('checks only its own project', async () => {
      await addProject('p1', 'Cell division practice');
      const otherOut = await addProject('p2', 'Photosynthesis quiz');
      await fs.rm(join(otherOut, 'imsmanifest.xml'));

      expect(JSON.parse((await call(toolsFor('p1'), 'check_output')).content)).toMatchObject({ passed: true });
    });
  });

  describe('delete_files', () => {
    it('deletes files and folders inside out/ and reports the ones it did not find', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      await fs.mkdir(join(outDir, 'assets'));
      await fs.writeFile(join(outDir, 'assets', 'old.svg'), '<svg/>');
      await fs.writeFile(join(outDir, 'scratch.html'), '<p>draft</p>');

      const result = await call(toolsFor('p1'), 'delete_files', { paths: ['scratch.html', 'assets', 'missing.css'] });

      expect(result).toEqual({ content: 'Deleted: scratch.html, assets\nNot found: missing.css', isError: false });
      expect(await fs.readdir(outDir)).toEqual(['imsmanifest.xml', 'index.html']);
    });

    it('refuses paths outside out/, including out/ itself, and deletes nothing there', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      const workspaceDir = workspaces.pathFor('p1');
      await fs.writeFile(join(workspaceDir, 'files', 'notes.txt'), 'source');

      const result = await call(toolsFor('p1'), 'delete_files', { paths: ['../files/notes.txt', '.', join(workspaceDir, 'files')] });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Refused, not inside out/');
      expect(await fs.readFile(join(workspaceDir, 'files', 'notes.txt'), 'utf8')).toBe('source');
      expect(await fs.readdir(outDir)).toEqual(['imsmanifest.xml', 'index.html']);
    });

    it('refuses a path through a link in out/ that leads outside it', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      const outside = join(dataDir, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(join(outside, 'keep.txt'), 'keep');
      await fs.symlink(outside, join(outDir, 'link'), 'junction');

      const result = await call(toolsFor('p1'), 'delete_files', { paths: ['link/keep.txt'] });

      expect(result.isError).toBe(true);
      expect(await fs.readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    });

    it('deletes a link in out/ and leaves what it leads to', async () => {
      const outDir = await addProject('p1', 'Cell division practice');
      const outside = join(dataDir, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(join(outside, 'keep.txt'), 'keep');
      await fs.symlink(outside, join(outDir, 'link'), 'junction');

      const result = await call(toolsFor('p1'), 'delete_files', { paths: ['link'] });

      expect(result).toEqual({ content: 'Deleted: link', isError: false });
      expect(await fs.readdir(outDir)).toEqual(['imsmanifest.xml', 'index.html']);
      expect(await fs.readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    });

    it("refuses another project's files", async () => {
      await addProject('p1', 'Cell division practice');
      const otherOut = await addProject('p2', 'Photosynthesis quiz');

      const result = await call(toolsFor('p1'), 'delete_files', { paths: ['../../../p2/workspace/out/index.html', join(otherOut, 'index.html')] });

      expect(result.isError).toBe(true);
      expect(await fs.readdir(otherOut)).toContain('index.html');
    });
  });
});
