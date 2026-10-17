import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import type { Build as ApiBuild, BuildError, QaReport } from '@cdk/contract';
import type { BuildsRepo, FinishBuildInput } from '../db/builds.js';
import type { ProjectsRepo } from '../db/projects.js';
import type { Build, Project } from '../db/schema.js';
import { BuildFailed, BuildIncomplete, BuildNotFound, BuildNotReady } from '../errors.js';
import { KIT_DIR } from '../kit.js';
import type { EventService } from '../pipeline/events.js';
import type { WorkspaceService } from './workspaces.js';

const AVENUE = 'scorm';
const MANIFEST = 'imsmanifest.xml';
const QA_REPORT_FILE = 'qa.json';
const DEFAULT_GATE_TIMEOUT_MS = 60_000;
const GATE_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** What the instructor reads when a build fails, and the one thing to do next, by error code. */
export const BUILD_ERRORS = {
  qa_failed: { message: 'The QA check found problems in this build.', nextStep: 'ask_for_fix' },
  interrupted: { message: 'The app closed before this build was checked.', nextStep: 'send_again' },
  copy_failed: { message: "This build couldn't be saved.", nextStep: 'send_again' },
  gate_crashed: { message: "The QA check couldn't finish on this build.", nextStep: 'send_again' },
  gate_invalid_output: { message: "The QA check couldn't finish on this build.", nextStep: 'send_again' },
  gate_inconsistent: { message: "The QA check couldn't finish on this build.", nextStep: 'send_again' },
} satisfies Record<string, Omit<BuildError, 'code'>>;

type BuildErrorCode = keyof typeof BUILD_ERRORS;

function buildError(code: BuildErrorCode): BuildError {
  return { code, ...BUILD_ERRORS[code] };
}

/** The part of the QA gate's `--json` output a build stores. Unlisted fields are dropped. */
const gateReportSchema = z.object({
  pass: z.boolean(),
  findings: z.array(
    z.object({
      rule: z.string(),
      severity: z.enum(['error', 'warn']),
      file: z.string(),
      line: z
        .number()
        .int()
        .nonnegative()
        .transform((line) => (line === 0 ? null : line)),
      message: z.string(),
      because: z.string().optional(),
    }),
  ),
});

export interface BuildServiceDeps {
  builds: BuildsRepo;
  projects: ProjectsRepo;
  workspaces: WorkspaceService;
  events: EventService;
  /** The kit whose QA gate runs on each build. Defaults to `back-end/kit`. */
  kitDir?: string;
  /** How long the QA gate may run before it is killed and the build fails. */
  gateTimeoutMs?: number;
}

export interface BuildDownload {
  filename: string;
  stream: Readable;
  /** Stops producing the zip and releases its open files. For a client that disconnects mid-download. */
  cancel(): void;
}

export interface BuildService {
  /**
   * Stores the next build version as `checking`, copies the project's output
   * into it, runs the QA gate on the copy, and returns the finished build.
   * Emits `build.created` once the build is stored, and `build.updated` once
   * its final status is stored. A failed copy finishes the build as `failed`.
   */
  create(projectId: string, turnId?: string): Promise<ApiBuild>;

  /** The build, if it belongs to one of `ownerId`'s projects; otherwise throws `BuildNotFound`. */
  get(ownerId: string, buildId: string): ApiBuild;

  /** Unscoped lookup of the project's highest build version, for pipeline code acting on a project a route has already authorized. */
  latest(projectId: string): Build | undefined;

  /**
   * A zip of a `ready` build with `imsmanifest.xml` at its root, named after
   * the project's title and the build version. Throws `BuildNotFound`,
   * `BuildNotReady`, `BuildFailed`, or `BuildIncomplete` before any byte
   * is streamed.
   */
  download(ownerId: string, buildId: string): Promise<BuildDownload>;

  /**
   * The absolute path of the file at `path` (its segments, as a URL gives
   * them) in a `ready` build of one of `ownerId`'s projects. Only the files
   * the download contains can be named, so the QA report, links, and anything
   * outside the build throw `BuildNotFound`, as does a build that isn't ready.
   */
  previewFile(ownerId: string, buildId: string, path: string[]): Promise<string>;

  /** Fails every build left `checking` with code `interrupted`, emitting `build.updated` for each. Call once at startup, after the back end holds its port and before it handles a request. */
  failInterrupted(): void;

  /**
   * Runs the QA gate on the project's output in place, recording nothing.
   * Throws `WorkspaceMissing` when the project has no workspace.
   */
  checkOutput(projectId: string): Promise<OutputCheck>;
}

/** The QA gate's report on a folder, or the plain error that kept it from reporting. */
export type OutputCheck = { qa: QaReport } | { error: BuildError };

interface GateRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  failure?: string;
}

/** A build's final status, QA gate report, and error. */
type Verdict = Omit<FinishBuildInput, 'outputHash'>;

export function createBuildService(deps: BuildServiceDeps): BuildService {
  const gateScript = join(deps.kitDir ?? KIT_DIR, 'harness', 'lint', 'lint.js');
  const gateTimeoutMs = deps.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;

  function runGate(buildDir: string): Promise<GateRun> {
    return new Promise((done) => {
      execFile(
        process.execPath,
        [gateScript, buildDir, '--avenue', AVENUE, '--json'],
        { timeout: gateTimeoutMs, maxBuffer: GATE_MAX_OUTPUT_BYTES, windowsHide: true },
        (err, stdout, stderr) => {
          if (!err) {
            done({ exitCode: 0, stdout, stderr });
            return;
          }
          const exitCode = typeof err.code === 'number' ? err.code : null;
          const failure = exitCode === null ? (err.signal ? `killed by ${err.signal}` : err.message) : undefined;
          done({ exitCode, stdout, stderr, failure });
        },
      );
    });
  }

  /** Runs the QA gate on `dir` and reads its report. */
  async function inspect(dir: string): Promise<OutputCheck> {
    const run = await runGate(dir);
    const detail = run.failure ?? firstLine(run.stderr) ?? `exited with code ${run.exitCode}`;

    if (run.exitCode !== 0 && run.exitCode !== 1) {
      return { error: loggedError('gate_crashed', `The QA gate did not finish: ${detail}`) };
    }

    let output: unknown;
    try {
      output = JSON.parse(run.stdout);
    } catch {
      return run.exitCode === 0
        ? { error: loggedError('gate_invalid_output', 'The QA gate did not print a JSON report') }
        : { error: loggedError('gate_crashed', `The QA gate did not finish: ${detail}`) };
    }

    const parsed = gateReportSchema.safeParse(output);
    if (!parsed.success) {
      return { error: loggedError('gate_invalid_output', 'The QA gate printed a report in an unexpected shape') };
    }

    const { pass, findings } = parsed.data;
    const errorCount = findings.filter((f) => f.severity === 'error').length;
    if (pass !== (run.exitCode === 0) || pass !== (errorCount === 0)) {
      return {
        error: loggedError(
          'gate_inconsistent',
          `The QA gate's report (pass: ${pass}, ${errorCount} error(s)) contradicts its exit code ${run.exitCode}`,
        ),
      };
    }
    return { qa: { passed: pass, findings } };
  }

  /** Checks a build's copy of the output and stores the QA report beside it. */
  async function check(buildDir: string): Promise<Verdict> {
    const result = await inspect(buildDir);
    if ('error' in result) return { status: 'failed', qa: null, error: result.error };

    await fs.writeFile(join(buildDir, QA_REPORT_FILE), JSON.stringify(result.qa, null, 2));
    return result.qa.passed
      ? { status: 'ready', qa: result.qa, error: null }
      : { status: 'failed', qa: result.qa, error: buildError('qa_failed') };
  }

  async function checkOutput(projectId: string): Promise<OutputCheck> {
    const outDir = join(await deps.workspaces.locate(projectId), 'out');
    try {
      return await inspect(outDir);
    } catch (err) {
      return { error: loggedError('gate_crashed', `The QA gate could not run: ${(err as Error).message}`) };
    }
  }

  /** The build and its project, if the project is `ownerId`'s; otherwise throws `BuildNotFound`. */
  function owned(ownerId: string, buildId: string): { build: Build; project: Project } {
    const build = deps.builds.get(buildId);
    const project = build && deps.projects.get(ownerId, build.projectId);
    if (!build || !project) {
      throw new BuildNotFound();
    }
    return { build, project };
  }

  async function copyAndCheck(projectId: string, version: number): Promise<FinishBuildInput> {
    let buildDir: string;
    let outputHash: string;
    try {
      outputHash = await deps.workspaces.hashOutput(projectId);
      buildDir = await deps.workspaces.copyOutput(projectId, String(version));
    } catch (err) {
      const verdict = failure('copy_failed', `The output could not be copied into the build: ${(err as Error).message}`);
      return { ...verdict, outputHash: null };
    }
    try {
      return { ...(await check(buildDir)), outputHash };
    } catch (err) {
      return { ...failure('gate_crashed', `The QA gate could not run: ${(err as Error).message}`), outputHash };
    }
  }

  async function create(projectId: string, turnId?: string): Promise<ApiBuild> {
    // No await between choosing the version and storing the row, so concurrent
    // calls never pick the same version and a failed copy uses its version up.
    const version = deps.builds.nextVersion(projectId);
    const build = deps.builds.create({ projectId, version, avenue: AVENUE, turnId });
    deps.events.append({ projectId, turnId, kind: 'build.created', payload: { build: toApi(build) } });

    const result = await copyAndCheck(projectId, version);
    const finished = toApi(deps.builds.finish(build.id, result));
    deps.events.append({ projectId, turnId, kind: 'build.updated', payload: { build: finished } });
    return finished;
  }

  async function download(ownerId: string, buildId: string): Promise<BuildDownload> {
    const { build, project } = owned(ownerId, buildId);
    if (build.status === 'failed') {
      throw new BuildFailed();
    }
    if (build.status !== 'ready') {
      throw new BuildNotReady();
    }

    const buildDir = deps.workspaces.buildPathFor(build.projectId, String(build.version));
    const missing = await missingManifestFiles(buildDir);
    if (missing.length > 0) {
      throw new BuildIncomplete(missing);
    }

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.directory(buildDir, false, (entry) => (isPackageFile(entry.name) ? entry : false));
    // A failure also reaches the consumer as the stream's 'error' event.
    archive.finalize().catch(() => {});
    return {
      filename: downloadFilename(project.title, build.version),
      stream: archive,
      cancel: () => {
        // abort drops the queued files; resume drains the file being read so its handle closes.
        archive.unpipe();
        archive.abort();
        archive.resume();
      },
    };
  }

  async function previewFile(ownerId: string, buildId: string, path: string[]): Promise<string> {
    const { build } = owned(ownerId, buildId);
    if (build.status !== 'ready') {
      throw new BuildNotFound();
    }
    const buildDir = deps.workspaces.buildPathFor(build.projectId, String(build.version));
    const wanted = path.join('/');
    if (!(await packageFiles(buildDir)).includes(wanted)) {
      throw new BuildNotFound();
    }
    return join(buildDir, ...wanted.split('/'));
  }

  function failInterrupted(): void {
    const error = buildError('interrupted');
    for (const build of deps.builds.failChecking(error)) {
      deps.events.append({
        projectId: build.projectId,
        turnId: build.turnId ?? undefined,
        kind: 'build.updated',
        payload: { build: toApi(build) },
      });
    }
  }

  return {
    create,
    get: (ownerId, buildId) => toApi(owned(ownerId, buildId).build),
    latest: (projectId) => deps.builds.latest(projectId),
    download,
    previewFile,
    failInterrupted,
    checkOutput,
  };
}

/** Whether the file at `path`, relative to the build with `/` separators, belongs in the package. */
function isPackageFile(path: string): boolean {
  return path !== QA_REPORT_FILE;
}

/** The package's regular files, as paths relative to `buildDir` with `/` separators. Links are left out. */
async function packageFiles(buildDir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(join(buildDir, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && isPackageFile(path)) {
        files.push(path);
      }
    }
  }
  await walk('');
  return files;
}

function toApi(build: Build): ApiBuild {
  return { ...build, pedagogy: null };
}

/**
 * `<title>-v<version>.zip`, with the title folded to lowercase ASCII letters
 * and digits joined by dashes, or `build` when none are left.
 */
export function downloadFilename(title: string, version: number): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'build'}-v${version}.zip`;
}

/** `code`'s plain error. The technical `detail` goes to the server log. */
function loggedError(code: BuildErrorCode, detail: string): BuildError {
  console.error(`Build service error (${code}): ${detail}`);
  return buildError(code);
}

/** A failed build with `code`'s plain error. The technical `detail` goes to the server log. */
function failure(code: BuildErrorCode, detail: string): Verdict {
  return { status: 'failed', qa: null, error: loggedError(code, detail) };
}

function firstLine(text: string): string | undefined {
  return text.split(/\r?\n/).find((line) => line.trim() !== '')?.trim();
}

/**
 * The manifest itself when it is absent, otherwise every local `<file href>`
 * it declares that is not a file inside `buildDir`. Declarations are read the
 * same way the QA gate's `scorm/manifest` rule reads them.
 */
async function missingManifestFiles(buildDir: string): Promise<string[]> {
  let manifest: string;
  try {
    manifest = await fs.readFile(join(buildDir, MANIFEST), 'utf8');
  } catch {
    return [MANIFEST];
  }

  const declared = [...manifest.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<file\s+href\s*=\s*"([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((href) => !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href));

  const missing: string[] = [];
  for (const href of declared) {
    if (!(await isFileInside(buildDir, href))) missing.push(href);
  }
  return missing;
}

async function isFileInside(dir: string, href: string): Promise<boolean> {
  const target = resolve(dir, href);
  const rel = relative(dir, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}
