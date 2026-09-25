import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { WorkspaceMissing } from '../errors.js';
import { KIT_DIR } from '../kit.js';

// Windows can hold a file open for a moment (the preview server, antivirus)
// right after it was written. Three attempts, 100ms apart, clears that
// without masking a real failure.
export const COPY_RETRY_ATTEMPTS = 3;
const COPY_RETRY_DELAY_MS = 100;

export interface WorkspaceServiceDeps {
  /** Where projects live on disk; `config.DATA_DIR`. */
  dataDir: string;
  /** The kit's root directory. Defaults to `back-end/kit`. */
  kitDir?: string;
}

export interface WorkspaceService {
  /** The project's workspace directory: `<dataDir>/projects/<projectId>/workspace`. */
  pathFor(projectId: string): string;

  /** A build version's directory: `<dataDir>/projects/<projectId>/builds/<version>`. */
  buildPathFor(projectId: string, version: string): string;

  /**
   * Provisions a fresh workspace: an empty `files/` for instructor uploads,
   * the SCORM starter copied into `out/`, the shared kit copied into `kit/`,
   * and the sibling `builds/` directory. Writes nothing agent-specific.
   */
  create(projectId: string): Promise<void>;

  /**
   * A content hash over the sorted relative paths and contents of `out/`.
   * Stable across runs when `out/` is unchanged; changes on any add, edit,
   * delete, or rename under it. Never affected by file mtimes.
   */
  hashOutput(projectId: string): Promise<string>;

  /**
   * Copies `out/` into `builds/<version>/` and returns that path. Refuses to
   * overwrite an existing build version.
   */
  copyOutput(projectId: string, version: string): Promise<string>;
}

/** `copyOutput` was asked to create a build version that already exists on disk. */
export class BuildVersionExists extends Error {
  constructor(public readonly version: string) {
    super(`Build version "${version}" already exists`);
    this.name = 'BuildVersionExists';
  }
}

export function createWorkspaceService(deps: WorkspaceServiceDeps): WorkspaceService {
  const kitDir = deps.kitDir ?? KIT_DIR;
  const starterDir = join(kitDir, 'skills', 'd2l-scorm-package', 'assets', 'starter');

  function projectDir(projectId: string): string {
    return join(deps.dataDir, 'projects', projectId);
  }

  function pathFor(projectId: string): string {
    return join(projectDir(projectId), 'workspace');
  }

  function buildsDir(projectId: string): string {
    return join(projectDir(projectId), 'builds');
  }

  function buildPathFor(projectId: string, version: string): string {
    return join(buildsDir(projectId), version);
  }

  /** Throws `WorkspaceMissing` rather than silently provisioning one, per `create`'s contract. */
  async function assertProvisioned(projectId: string): Promise<string> {
    const workspaceDir = pathFor(projectId);
    if (!(await pathExists(join(workspaceDir, 'out')))) {
      throw new WorkspaceMissing(`No workspace provisioned for project "${projectId}"`);
    }
    return workspaceDir;
  }

  async function create(projectId: string): Promise<void> {
    const workspaceDir = pathFor(projectId);
    await fs.mkdir(join(workspaceDir, 'files'), { recursive: true });
    await copyWithRetry(starterDir, join(workspaceDir, 'out'));
    await copyKit(workspaceDir);
    await fs.mkdir(buildsDir(projectId), { recursive: true });
  }

  async function copyKit(workspaceDir: string): Promise<void> {
    const kitTargetDir = join(workspaceDir, 'kit');
    await fs.mkdir(kitTargetDir, { recursive: true });
    // Whole subtrees, so the kit's internal layout (skill assets, harness
    // fixtures, etc.) is preserved exactly.
    await copyWithRetry(join(kitDir, 'skills'), join(kitTargetDir, 'skills'));
    await copyWithRetry(join(kitDir, 'harness'), join(kitTargetDir, 'harness'));
    // The checker is CommonJS; this "type": "commonjs" is what keeps `require`
    // working once the kit is copied out from under back-end's own ESM package.json.
    await copyWithRetry(join(kitDir, 'package.json'), join(kitTargetDir, 'package.json'));
  }

  async function hashOutput(projectId: string): Promise<string> {
    const workspaceDir = await assertProvisioned(projectId);
    const outDir = join(workspaceDir, 'out');
    const relPaths = (await collectRelativePaths(outDir)).sort();

    const hash = createHash('sha256');
    for (const rel of relPaths) {
      hash.update(rel);
      hash.update('\0');
      hash.update(await fs.readFile(join(outDir, rel)));
      hash.update('\0');
    }
    return hash.digest('hex');
  }

  async function copyOutput(projectId: string, version: string): Promise<string> {
    const workspaceDir = await assertProvisioned(projectId);
    const dest = buildPathFor(projectId, version);
    if (await pathExists(dest)) {
      throw new BuildVersionExists(version);
    }
    await copyWithRetry(join(workspaceDir, 'out'), dest);
    return dest;
  }

  return { pathFor, buildPathFor, create, hashOutput, copyOutput };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Relative, `/`-joined paths of every file under `dir`, in no particular order. */
async function collectRelativePaths(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await collectRelativePaths(join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** Copies `src` to `dest`, retrying past transient Windows EBUSY/EPERM locks. */
async function copyWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.cp(src, dest, { recursive: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= COPY_RETRY_ATTEMPTS || (code !== 'EBUSY' && code !== 'EPERM')) throw err;
      await delay(COPY_RETRY_DELAY_MS);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
