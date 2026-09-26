import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceMissing } from '../errors.js';
import {
  BuildVersionExists,
  LOCK_RETRY_ATTEMPTS,
  createWorkspaceService,
  type WorkspaceService,
} from './workspaces.js';

const execFileAsync = promisify(execFile);

type CpFn = typeof import('node:fs/promises').cp;

// `node:fs/promises`'s namespace can't be spied on directly in ESM ("Cannot
// redefine property"), so the mock factory below routes `cp` through this
// swappable box, which tests point at a fake implementation and restore
// afterwards.
const cpControl = vi.hoisted(() => ({ impl: undefined as unknown as CpFn, original: undefined as unknown as CpFn }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  cpControl.original = actual.cp;
  cpControl.impl = actual.cp;
  return { ...actual, cp: ((...args) => cpControl.impl(...args)) as CpFn };
});

describe('workspace service', () => {
  let dataDir: string;
  let workspaces: WorkspaceService;
  let projectId: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(join(tmpdir(), 'cdk-workspaces-'));
    workspaces = createWorkspaceService({ dataDir });
    projectId = 'proj-1';
  });

  afterEach(async () => {
    cpControl.impl = cpControl.original;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('resolves the workspace path under the data dir', () => {
    expect(workspaces.pathFor(projectId)).toBe(join(dataDir, 'projects', projectId, 'workspace'));
  });

  describe('create', () => {
    it('provisions files/, out/ with the SCORM starter, kit/, and a sibling builds/ dir', async () => {
      await workspaces.create(projectId);
      const workspaceDir = workspaces.pathFor(projectId);

      expect((await fs.stat(join(workspaceDir, 'files'))).isDirectory()).toBe(true);
      expect(await fs.readdir(join(workspaceDir, 'files'))).toEqual([]);

      const outFiles = await fs.readdir(join(workspaceDir, 'out'));
      expect(outFiles).toContain('imsmanifest.xml');
      expect(outFiles).toContain('index.html');

      const skillNames = await fs.readdir(join(workspaceDir, 'kit', 'skills'));
      expect(skillNames).toContain('d2l-scorm-package');
      expect(skillNames).toContain('d2l-tenant-qa');

      const harnessFiles = await fs.readdir(join(workspaceDir, 'kit', 'harness'));
      expect(harnessFiles).toContain('lint');
      expect(harnessFiles).toContain('tenant-profile.json');
      expect(await fs.readdir(join(workspaceDir, 'kit', 'harness', 'lint'))).toContain('lint.js');

      const kitPackageJson = JSON.parse(
        await fs.readFile(join(workspaceDir, 'kit', 'package.json'), 'utf8'),
      );
      expect(kitPackageJson.type).toBe('commonjs');

      const projectDir = join(dataDir, 'projects', projectId);
      expect((await fs.stat(join(projectDir, 'builds'))).isDirectory()).toBe(true);
      expect(await fs.readdir(join(projectDir, 'builds'))).toEqual([]);
    });

    it('never writes agent-specific files', async () => {
      await workspaces.create(projectId);
      const workspaceDir = workspaces.pathFor(projectId);

      await expect(fs.access(join(workspaceDir, 'CLAUDE.md'))).rejects.toThrow();
      await expect(fs.access(join(workspaceDir, '.claude'))).rejects.toThrow();
    });

    it('retries a copy past a transient Windows lock, then succeeds', async () => {
      const realCp = cpControl.original;
      let calls = 0;
      cpControl.impl = (...args) => {
        calls++;
        if (calls === 1) {
          const err = new Error('locked') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        }
        return realCp(...args);
      };

      await expect(workspaces.create(projectId)).resolves.toBeUndefined();
      expect(calls).toBeGreaterThan(1);
    });

    it('propagates the error once retries are exhausted', async () => {
      let calls = 0;
      cpControl.impl = () => {
        calls++;
        const err = new Error('locked') as NodeJS.ErrnoException;
        err.code = 'EBUSY';
        throw err;
      };

      await expect(workspaces.create(projectId)).rejects.toMatchObject({ code: 'EBUSY' });
      expect(calls).toBe(LOCK_RETRY_ATTEMPTS);
    });

    it('does not retry, and propagates immediately, for a non-lock error', async () => {
      let calls = 0;
      cpControl.impl = () => {
        calls++;
        const err = new Error('nope') as NodeJS.ErrnoException;
        err.code = 'ENOSPC';
        throw err;
      };

      await expect(workspaces.create(projectId)).rejects.toMatchObject({ code: 'ENOSPC' });
      expect(calls).toBe(1);
    });
  });

  describe('remove', () => {
    it('removes the workspace and builds, and does nothing for a project with no directory', async () => {
      await workspaces.create(projectId);
      await workspaces.copyOutput(projectId, '1');

      await workspaces.remove(projectId);

      await expect(fs.access(join(dataDir, 'projects', projectId))).rejects.toThrow();
      await expect(workspaces.remove(projectId)).resolves.toBeUndefined();
    });
  });

  describe('locate', () => {
    it('returns the workspace path once it is provisioned', async () => {
      await workspaces.create(projectId);
      await expect(workspaces.locate(projectId)).resolves.toBe(workspaces.pathFor(projectId));
    });

    it('throws WorkspaceMissing when create() has not run', async () => {
      await expect(workspaces.locate(projectId)).rejects.toThrow(WorkspaceMissing);
    });
  });

  describe('the provisioned checker', () => {
    it('runs against out/ from the workspace and passes on the unchanged starter', async () => {
      await workspaces.create(projectId);
      const workspaceDir = workspaces.pathFor(projectId);

      const { stdout } = await execFileAsync(
        process.execPath,
        ['kit/harness/lint/lint.js', 'out', '--avenue', 'scorm', '--json'],
        { cwd: workspaceDir },
      );

      const result = JSON.parse(stdout);
      expect(result.pass).toBe(true);
      expect(result.errorCount).toBe(0);
    });
  });

  describe('hashOutput', () => {
    it('throws WorkspaceMissing when create() has not run', async () => {
      await expect(workspaces.hashOutput(projectId)).rejects.toThrow(WorkspaceMissing);
    });

    it('is stable across calls when out/ is unchanged', async () => {
      await workspaces.create(projectId);
      const first = await workspaces.hashOutput(projectId);
      const second = await workspaces.hashOutput(projectId);
      expect(second).toBe(first);
    });

    it('changes when a file under out/ is edited', async () => {
      await workspaces.create(projectId);
      const outDir = join(workspaces.pathFor(projectId), 'out');
      const before = await workspaces.hashOutput(projectId);

      const target = join(outDir, 'index.html');
      await fs.writeFile(target, (await fs.readFile(target, 'utf8')) + '\n<!-- edited -->');

      expect(await workspaces.hashOutput(projectId)).not.toBe(before);
    });

    it('changes when a file is added under out/', async () => {
      await workspaces.create(projectId);
      const outDir = join(workspaces.pathFor(projectId), 'out');
      const before = await workspaces.hashOutput(projectId);

      await fs.writeFile(join(outDir, 'extra.txt'), 'new file');

      expect(await workspaces.hashOutput(projectId)).not.toBe(before);
    });

    it('changes when a file is deleted under out/', async () => {
      await workspaces.create(projectId);
      const outDir = join(workspaces.pathFor(projectId), 'out');
      const before = await workspaces.hashOutput(projectId);

      await fs.rm(join(outDir, 'index.html'));

      expect(await workspaces.hashOutput(projectId)).not.toBe(before);
    });

    it('changes when a file under out/ is renamed', async () => {
      await workspaces.create(projectId);
      const outDir = join(workspaces.pathFor(projectId), 'out');
      const before = await workspaces.hashOutput(projectId);

      await fs.rename(join(outDir, 'index.html'), join(outDir, 'renamed.html'));

      expect(await workspaces.hashOutput(projectId)).not.toBe(before);
    });
  });

  describe('copyOutput', () => {
    it('throws WorkspaceMissing when create() has not run', async () => {
      await expect(workspaces.copyOutput(projectId, '1')).rejects.toThrow(WorkspaceMissing);
    });

    it('copies out/ into builds/<version>/, containing only the generated output', async () => {
      await workspaces.create(projectId);
      const dest = await workspaces.copyOutput(projectId, '1');

      expect(dest).toBe(join(dataDir, 'projects', projectId, 'builds', '1'));
      const copied = (await fs.readdir(dest)).sort();
      const outFiles = (await fs.readdir(join(workspaces.pathFor(projectId), 'out'))).sort();
      expect(copied).toEqual(outFiles);
      expect(copied).not.toContain('kit');
      expect(copied).not.toContain('files');
    });

    it('is unaffected by later edits to the workspace', async () => {
      await workspaces.create(projectId);
      const dest = await workspaces.copyOutput(projectId, '1');
      const originalContent = await fs.readFile(join(dest, 'index.html'), 'utf8');

      const outDir = join(workspaces.pathFor(projectId), 'out');
      await fs.writeFile(join(outDir, 'index.html'), 'changed after the build was copied');

      expect(await fs.readFile(join(dest, 'index.html'), 'utf8')).toBe(originalContent);
    });

    it('refuses to overwrite an existing build version', async () => {
      await workspaces.create(projectId);
      await workspaces.copyOutput(projectId, '1');

      await expect(workspaces.copyOutput(projectId, '1')).rejects.toThrow(BuildVersionExists);
    });
  });
});
