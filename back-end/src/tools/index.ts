import { readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z, type ZodRawShape } from 'zod';
import type { ToolDef, ToolResult, ToolServerSpec } from '../agent/AgentDriver.js';
import type { ProjectsRepo } from '../db/projects.js';
import { KIT_DIR } from '../kit.js';
import type { BuildService } from '../services/builds.js';
import type { WorkspaceService } from '../services/workspaces.js';

/** The tenant profile's sections that apply to SCORM output. */
const SCORM_TENANT_SECTIONS = ['scorm', 'fileLoading', 'storage', 'rendering'];

export interface CdkToolsDeps {
  projects: Pick<ProjectsRepo, 'getById'>;
  workspaces: Pick<WorkspaceService, 'locate'>;
  builds: Pick<BuildService, 'latest' | 'checkOutput'>;
}

/**
 * CDK's tools for one project, served to its agent as the `cdk` server. Each
 * tool acts only on `projectId`, so the agent can't reach another project.
 */
export function createCdkTools(deps: CdkToolsDeps, projectId: string): ToolServerSpec {
  const getProject = defineTool({
    name: 'get_project',
    description:
      "The project's title and avenue, the latest build's version, status, QA findings, and error, and what the D2L tenant allows for this avenue.",
    summary: 'Reading the project',
    input: {},
    async handler() {
      const project = deps.projects.getById(projectId);
      if (!project) return failed('This project no longer exists.');
      const latest = deps.builds.latest(projectId);
      return json({
        title: project.title,
        avenue: project.avenue,
        latestBuild: latest ? { version: latest.version, status: latest.status, qa: latest.qa, error: latest.error } : null,
        tenant: await tenantLimits(),
      });
    },
  });

  const checkOutput = defineTool({
    name: 'check_output',
    description:
      'Runs the QA checker on out/ as it is now and returns its findings. It records nothing: CDK builds and checks out/ again after your turn.',
    summary: 'Checking the activity',
    input: {},
    async handler() {
      const result = await deps.builds.checkOutput(projectId);
      return 'error' in result ? failed(result.error.message) : json(result.qa);
    },
  });

  const deleteFiles = defineTool({
    name: 'delete_files',
    description: 'Deletes files or folders inside out/. Paths are relative to out/.',
    summary: 'Deleting files',
    input: { paths: z.array(z.string().min(1)).min(1) },
    async handler({ paths }) {
      const outDir = await realpath(join(await deps.workspaces.locate(projectId), 'out'));
      const deleted: string[] = [];
      const missing: string[] = [];
      const refused: string[] = [];
      for (const path of paths) {
        const target = await pathInside(outDir, path);
        if (target === undefined) {
          refused.push(path);
          continue;
        }
        try {
          await rm(target, { recursive: true });
          deleted.push(path);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          missing.push(path);
        }
      }
      const lines = [
        deleted.length > 0 && `Deleted: ${deleted.join(', ')}`,
        missing.length > 0 && `Not found: ${missing.join(', ')}`,
        refused.length > 0 && `Refused, not inside out/: ${refused.join(', ')}`,
      ].filter((line): line is string => typeof line === 'string');
      return { content: lines.join('\n'), isError: refused.length > 0 };
    },
  });

  return { name: 'cdk', tools: [getProject, checkOutput, deleteFiles] };
}

/** Keeps a tool's input fields and its handler's argument type in step. */
function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

function json(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function failed(message: string): ToolResult {
  return { content: message, isError: true };
}

/** The tenant profile's sections for SCORM output, as the QA gate enforces them. */
async function tenantLimits(): Promise<Record<string, unknown>> {
  const profile = JSON.parse(await readFile(join(KIT_DIR, 'qa', 'tenant-profile.json'), 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(SCORM_TENANT_SECTIONS.map((section) => [section, profile[section]]));
}

/**
 * `path`, resolved against `outDir` with its parent's links resolved, when it
 * names an entry strictly inside `outDir`; otherwise `undefined`.
 */
async function pathInside(outDir: string, path: string): Promise<string | undefined> {
  const full = resolve(outDir, path.trim());
  if (!isStrictlyInside(outDir, full)) return undefined;
  const parent = await realpath(dirname(full)).catch(() => dirname(full));
  const target = join(parent, basename(full));
  return isStrictlyInside(outDir, target) ? target : undefined;
}

function isStrictlyInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
