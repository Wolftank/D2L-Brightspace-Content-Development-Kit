import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { z } from 'zod';
import type { BuildsRepo, FinishBuildInput } from '../db/builds.js';
import type { ProjectsRepo } from '../db/projects.js';
import type { Build } from '../db/schema.js';
import { BuildIncomplete, BuildNotReady, NotFound } from '../errors.js';
import { KIT_DIR } from '../kit.js';
import type { EventService } from '../pipeline/events.js';
import type { QaReport } from '../types/qa.js';
import type { WorkspaceService } from './workspaces.js';

const AVENUE = 'scorm';
const MANIFEST = 'imsmanifest.xml';
const QA_REPORT_FILE = 'qa.json';
const DEFAULT_GATE_TIMEOUT_MS = 60_000;
const GATE_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

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
}

export interface BuildService {
  /**
   * Stores the next build version as `checking`, copies the project's output
   * into it, runs the QA gate on the copy, and returns the finished build.
   * Emits `build.created` once the build is stored, and `build.updated` once
   * its final status is stored. A failed copy finishes the build as `failed`.
   */
  create(projectId: string, turnId?: string): Promise<Build>;

  /** The build, if it belongs to one of `ownerId`'s projects; otherwise throws `NotFound`. */
  get(ownerId: string, buildId: string): Build;

  /** Unscoped lookup of the project's highest build version, for pipeline code acting on a project a route has already authorized. */
  latest(projectId: string): Build | undefined;

  /**
   * A zip of a `ready` build with `imsmanifest.xml` at its root. Throws
   * `NotFound`, `BuildNotReady`, or `BuildIncomplete` before any byte is
   * streamed.
   */
  download(ownerId: string, buildId: string): Promise<BuildDownload>;

  /** Fails every build left `checking` with code `interrupted`, emitting `build.updated` for each. Call once at startup, before accepting requests. */
  failInterrupted(): void;
}

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

  async function check(buildDir: string): Promise<Verdict> {
    const run = await runGate(buildDir);
    const detail = run.failure ?? firstLine(run.stderr) ?? `exited with code ${run.exitCode}`;

    if (run.exitCode !== 0 && run.exitCode !== 1) {
      return failure('gate_crashed', `The QA gate did not finish: ${detail}`);
    }

    let output: unknown;
    try {
      output = JSON.parse(run.stdout);
    } catch {
      return run.exitCode === 0
        ? failure('gate_invalid_output', 'The QA gate did not print a JSON report')
        : failure('gate_crashed', `The QA gate did not finish: ${detail}`);
    }

    const parsed = gateReportSchema.safeParse(output);
    if (!parsed.success) {
      return failure('gate_invalid_output', 'The QA gate printed a report in an unexpected shape');
    }

    const { pass, findings } = parsed.data;
    const errorCount = findings.filter((f) => f.severity === 'error').length;
    if (pass !== (run.exitCode === 0) || pass !== (errorCount === 0)) {
      return failure(
        'gate_inconsistent',
        `The QA gate's report (pass: ${pass}, ${errorCount} error(s)) contradicts its exit code ${run.exitCode}`,
      );
    }

    const qa: QaReport = { passed: pass, findings };
    await fs.writeFile(join(buildDir, QA_REPORT_FILE), JSON.stringify(qa, null, 2));
    return pass
      ? { status: 'ready', qa, error: null }
      : { status: 'failed', qa, error: { code: 'qa_failed', message: `The QA gate reported ${errorCount} error(s)` } };
  }

  function get(ownerId: string, buildId: string): Build {
    const build = deps.builds.get(buildId);
    if (!build || !deps.projects.get(ownerId, build.projectId)) {
      throw new NotFound();
    }
    return build;
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

  async function create(projectId: string, turnId?: string): Promise<Build> {
    // No await between choosing the version and storing the row, so concurrent
    // calls never pick the same version and a failed copy uses its version up.
    const version = deps.builds.nextVersion(projectId);
    const build = deps.builds.create({ projectId, version, avenue: AVENUE, turnId });
    deps.events.append({ projectId, turnId, kind: 'build.created', payload: { build } });

    const result = await copyAndCheck(projectId, version);
    const finished = deps.builds.finish(build.id, result);
    deps.events.append({ projectId, turnId, kind: 'build.updated', payload: { build: finished } });
    return finished;
  }

  async function download(ownerId: string, buildId: string): Promise<BuildDownload> {
    const build = get(ownerId, buildId);
    if (build.status !== 'ready') {
      throw new BuildNotReady(build.status);
    }

    const buildDir = deps.workspaces.buildPathFor(build.projectId, String(build.version));
    const missing = await missingManifestFiles(buildDir);
    if (missing.length > 0) {
      throw new BuildIncomplete(missing);
    }

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.directory(buildDir, false, (entry) => (entry.name === QA_REPORT_FILE ? false : entry));
    // A failure also reaches the consumer as the stream's 'error' event.
    archive.finalize().catch(() => {});
    return { filename: `build-${build.version}.zip`, stream: archive };
  }

  function failInterrupted(): void {
    const error = { code: 'interrupted', message: 'The app closed before this build was checked' };
    for (const build of deps.builds.failChecking(error)) {
      deps.events.append({
        projectId: build.projectId,
        turnId: build.turnId ?? undefined,
        kind: 'build.updated',
        payload: { build },
      });
    }
  }

  return { create, get, latest: (projectId) => deps.builds.latest(projectId), download, failInterrupted };
}

function failure(code: string, message: string): Verdict {
  return { status: 'failed', qa: null, error: { code, message } };
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
