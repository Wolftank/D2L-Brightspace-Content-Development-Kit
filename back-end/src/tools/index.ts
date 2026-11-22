import { readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z, type ZodRawShape } from 'zod';
import type { BuildableAvenue, BuildSuggestion } from '@cdk/contract';
import type { ToolDef, ToolResult, ToolServerSpec } from '../agent/AgentDriver.js';
import type { ProjectsRepo } from '../db/projects.js';
import { AVENUE_SKILL, BUILDABLE_AVENUES, KIT_DIR, pickedAvenue, SUGGESTIONS_SKILL } from '../kit.js';
import type { SuggestionStore } from '../pipeline/suggestions.js';
import type { AvenueService } from '../services/avenues.js';
import type { BuildService } from '../services/builds.js';
import type { WorkspaceService } from '../services/workspaces.js';

/**
 * The tenant profile's sections that apply to each avenue. A content topic
 * leaves out `scorm` and gains `brightspaceApi`, which it can reach; the
 * notes in `fileLoading`, `storage`, and `rendering` say where an HTML topic
 * differs from a SCORM package.
 */
const TENANT_SECTIONS: Record<BuildableAvenue, string[]> = {
  scorm: ['scorm', 'fileLoading', 'storage', 'rendering'],
  topic: ['fileLoading', 'storage', 'brightspaceApi', 'rendering'],
};

/** The most suggestions one build keeps. */
const MAX_SUGGESTIONS = 3;

const suggestionText = { suggestion: z.string().min(1), reason: z.string().min(1) };

/** One suggestion, whose principle must belong to its framework. */
const suggestionSchema = z.discriminatedUnion('framework', [
  z.object({ framework: z.literal('tilt'), principle: z.enum(['Purpose', 'Task', 'Criteria']), ...suggestionText }),
  z.object({ framework: z.literal('udl'), principle: z.enum(['Engagement', 'Representation', 'Action & Expression']), ...suggestionText }),
]) satisfies z.ZodType<BuildSuggestion>;

export interface CdkToolsDeps {
  projects: Pick<ProjectsRepo, 'getById'>;
  avenues: Pick<AvenueService, 'set'>;
  workspaces: Pick<WorkspaceService, 'locate'>;
  builds: Pick<BuildService, 'latest' | 'listByProject' | 'checkOutput'>;
  suggestions: Pick<SuggestionStore, 'record'>;
}

/**
 * CDK's tools for one project, served to its agent as the `cdk` server. Each
 * tool acts only on `projectId`, so the agent can't reach another project.
 */
export function createCdkTools(deps: CdkToolsDeps, projectId: string): ToolServerSpec {
  const getProject = defineTool({
    name: 'get_project',
    description:
      "The project's title and avenue, the latest build's version, status, QA findings, and error, what the D2L tenant allows for this avenue, and earlierSuggestions: every suggestion the instructor has already seen on an earlier build. The avenue and the tenant limits are null until a format is set.",
    summary: 'Reading the project',
    input: {},
    async handler() {
      const project = deps.projects.getById(projectId);
      if (!project) return failed('This project no longer exists.');
      const latest = deps.builds.latest(projectId);
      const avenue = pickedAvenue(project);
      return json({
        title: project.title,
        avenue,
        latestBuild: latest ? { version: latest.version, status: latest.status, qa: latest.qa, error: latest.error } : null,
        tenant: avenue ? await tenantLimits(avenue) : null,
        earlierSuggestions: earlierSuggestions(deps.builds.listByProject(projectId).flatMap((build) => build.suggestions)),
      });
    },
  });

  const setFormat = defineTool({
    name: 'set_format',
    description:
      "Sets the project's output format: `scorm` for a SCORM package, `topic` for a content topic. Replaces out/ with that format's starter, so read anything you need from out/ first, and returns the skill to build with and what the D2L tenant allows for the format. Change a format that is already set only when the instructor asks for the other one.",
    summary: 'Setting the format',
    input: { format: z.enum(BUILDABLE_AVENUES) },
    async handler({ format }) {
      const project = deps.projects.getById(projectId);
      if (!project) return failed('This project no longer exists.');
      await deps.avenues.set(projectId, format);
      return json({
        format,
        out: project.avenue === format ? 'Unchanged: the project already had this format.' : "Replaced with this format's starter.",
        skill: AVENUE_SKILL[format],
        tenant: await tenantLimits(format),
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
      const project = deps.projects.getById(projectId);
      if (!project) return failed('This project no longer exists.');
      if (!pickedAvenue(project)) return failed('This project has no output format yet. Set one with set_format first.');
      const result = await deps.builds.checkOutput(projectId);
      return 'error' in result ? failed(result.error.message) : json(result.qa);
    },
  });

  const recordSuggestions = defineTool({
    name: 'record_suggestions',
    description:
      `Records up to ${MAX_SUGGESTIONS} optional TILT or UDL design suggestions for the activity, most useful first, as the ${SUGGESTIONS_SKILL} skill describes. ` +
      "CDK keeps the last list recorded in a request and stores it with the build it makes when the request ends, so record an empty list when nothing needs changing. Recording changes nothing in out/ and never affects the build's QA result or download.",
    summary: 'Noting suggestions',
    input: { suggestions: z.array(suggestionSchema).max(MAX_SUGGESTIONS) },
    async handler({ suggestions }) {
      deps.suggestions.record(projectId, suggestions);
      return { content: `Recorded ${suggestions.length} suggestion(s) for the build made when this request ends.` };
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

  return { name: 'cdk', tools: [getProject, setFormat, checkOutput, recordSuggestions, deleteFiles] };
}

/** Keeps a tool's input fields and its handler's argument type in step. */
function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

/** Each distinct suggestion in `suggestions`, by its framework, principle, and text, without its reason. */
function earlierSuggestions(suggestions: BuildSuggestion[]): Array<Omit<BuildSuggestion, 'reason'>> {
  const seen = new Map<string, Omit<BuildSuggestion, 'reason'>>();
  for (const { framework, principle, suggestion } of suggestions) {
    seen.set(JSON.stringify([framework, principle, suggestion]), { framework, principle, suggestion });
  }
  return [...seen.values()];
}

function json(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function failed(message: string): ToolResult {
  return { content: message, isError: true };
}

/** The tenant profile's sections for `avenue`, as the QA gate enforces them. */
async function tenantLimits(avenue: BuildableAvenue): Promise<Record<string, unknown>> {
  const profile = JSON.parse(await readFile(join(KIT_DIR, 'qa', 'tenant-profile.json'), 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(TENANT_SECTIONS[avenue].map((section) => [section, profile[section]]));
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
