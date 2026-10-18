import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolResult, ToolServerSpec } from '../agent/AgentDriver.js';
import { createBuildsRepo } from '../db/builds.js';
import { createEventsRepo } from '../db/events.js';
import { createProjectsRepo, type ProjectsRepo } from '../db/projects.js';
import { testDb } from '../db/test-db.js';
import { createUsersRepo } from '../db/users.js';
import { createEventService } from '../pipeline/events.js';
import { createBuildService, type BuildService } from '../services/builds.js';
import { createWorkspaceService, type WorkspaceService } from '../services/workspaces.js';
import { createCdkTools } from './index.js';

describe('CDK tools', () => {
  let dataDir: string;
  let projects: ProjectsRepo;
  let workspaces: WorkspaceService;
  let builds: BuildService;

  async function addProject(id: string, title: string): Promise<string> {
    const ownerId = createUsersRepo(db).ensureLocalUser().id;
    projects.create({ id, ownerId, title, avenue: 'scorm' });
    await workspaces.create(id);
    return join(workspaces.pathFor(id), 'out');
  }

  function call(tools: ToolServerSpec, name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No tool named ${name}`);
    return tool.handler(input);
  }

  let db: ReturnType<typeof testDb>;

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-tools-'));
    db = testDb();
    projects = createProjectsRepo(db);
    workspaces = createWorkspaceService({ dataDir });
    builds = createBuildService({ builds: createBuildsRepo(db), projects, workspaces, events: createEventService(createEventsRepo(db)) });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  function toolsFor(projectId: string): ToolServerSpec {
    return createCdkTools({ projects, workspaces, builds }, projectId);
  }

  it('serves get_project, check_output, and delete_files as the cdk server, each with a status line', async () => {
    await addProject('p1', 'Cell division practice');
    const tools = toolsFor('p1');

    expect(tools.name).toBe('cdk');
    expect(tools.tools.map((tool) => [tool.name, tool.summary])).toEqual([
      ['get_project', 'Reading the project'],
      ['check_output', 'Checking the activity'],
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
