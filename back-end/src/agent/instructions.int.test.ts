import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceService } from '../services/workspaces.js';
import { renderProjectInstructions } from './instructions.js';

const execFileAsync = promisify(execFile);
const project = { id: 'project-26', title: 'Cell division practice' };

describe('instructions against a provisioned workspace', () => {
  let dataDir: string | undefined;
  afterEach(async () => { if (dataDir) await rm(dataDir, { recursive: true, force: true }); });

  it('resolves kit references and runs the rendered check through a pass/fail/fix cycle', async () => {
    dataDir = await mkdtemp(join(tmpdir(), "cdk instructions ' $ & ` (1) "));
    const workspaces = createWorkspaceService({ dataDir });
    await workspaces.create(project.id);
    const workspace = workspaces.pathFor(project.id);
    const shell = process.platform === 'win32' ? 'powershell' : 'bash';
    const markdown = renderProjectInstructions({ project, workspaceDir: workspace, shell });
    const references = [
      'files', 'out', 'kit',
      'kit/skills/d2l-scorm-package/SKILL.md', 'kit/skills/d2l-tenant-qa/SKILL.md',
      'kit/skills/d2l-scorm-package/assets/starter', 'kit/harness/tenant-profile.json',
    ];
    for (const reference of references) {
      const path = join(workspace, reference);
      await access(path);
      expect(markdown).toContain(path);
    }
    const command = /```(?:bash|powershell)\n([^\n]+)\n```/.exec(markdown)?.[1];
    if (!command) throw new Error('Instructions are missing the check command');
    const run = () => execFileAsync(
      shell === 'powershell' ? 'powershell.exe' : 'bash',
      shell === 'powershell'
        ? ['-NoProfile', '-NonInteractive', '-Command', `${command}; exit $LASTEXITCODE`]
        : ['-c', command],
      { cwd: workspace, timeout: 20_000 },
    );
    const originalHash = await workspaces.hashOutput(project.id);
    await expect(run()).resolves.toMatchObject({ stderr: '' });
    expect(await workspaces.hashOutput(project.id)).toBe(originalHash);
    const manifest = join(workspace, 'out', 'imsmanifest.xml');
    const original = await readFile(manifest, 'utf8');
    await rm(manifest);
    await expect(run()).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('scorm/manifest') });
    await writeFile(manifest, original);
    await expect(run()).resolves.toMatchObject({ stderr: '' });
    expect(await workspaces.hashOutput(project.id)).toBe(originalHash);
  }, 30_000);
});
