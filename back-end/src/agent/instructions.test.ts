import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceService } from '../services/workspaces.js';
import { renderProjectInstructions, type ProjectInstructionsInput } from './instructions.js';

const execFileAsync = promisify(execFile);
const project = { id: 'project-26', title: 'Cell division practice' };
const workspaceDir = resolve('test workspace');

function checkCommand(markdown: string): string {
  const command = /```(?:bash|powershell)\n([^\n]+)\n```/.exec(markdown)?.[1];
  if (!command) throw new Error('Instructions are missing the check command');
  return command;
}

describe('renderProjectInstructions', () => {
  it('identifies project facts and the complete single-request workflow deterministically', () => {
    const input: ProjectInstructionsInput = { project, workspaceDir, shell: 'bash' };
    const markdown = renderProjectInstructions(input);
    expect(renderProjectInstructions(input)).toBe(markdown);
    expect(markdown).toContain(project.id);
    expect(markdown).toContain(project.title);
    expect(markdown).toContain('V1 output format: SCORM');
    expect(markdown).toContain('instructor request supplied in the message input');
    expect(markdown).toContain('without the prototype\'s output-selection interview');
    expect(markdown).toContain('Keep source material and kit files unchanged');
    expect(markdown).toContain('Fix errors you can address in out/ and rerun');
    expect(markdown).toContain('do not claim a passing package');
    expect(markdown).toContain('independently validates the saved output');
    expect(markdown).toContain('in place of the guides\' standalone packaging and deployment steps');
    expect(markdown).not.toContain('build-scorm.ps1');
  });

  it('keeps multiline titles and Markdown delimiters inside literal project data', () => {
    const title = 'A `title`\n```\n# Another heading';
    const markdown = renderProjectInstructions({ project: { ...project, title }, workspaceDir, shell: 'bash' });
    expect(markdown).toContain(`Project title: \`\`\`\` ${title.replaceAll('\n', '\\n')} \`\`\`\``);
    expect(markdown).not.toContain('\n# Another heading');
  });

  it.each(['bash', 'powershell'] as const)('quotes shell-sensitive paths literally for %s', (shell) => {
    const path = join(workspaceDir, "instructor's $HOME & `project` (1)");
    const command = checkCommand(renderProjectInstructions({ project, workspaceDir: path, shell }));
    const escaped = path.replaceAll("'", shell === 'powershell' ? "''" : "'\\''");
    expect(command).toBe(`node '${join(escaped, 'kit', 'harness', 'lint', 'lint.js')}' '${join(escaped, 'out')}' --avenue scorm`);
  });

  it.each(['relative/workspace', `${workspaceDir}\nother`, `${workspaceDir}\0other`])('rejects an unusable workspace path', (path) => {
    expect(() => renderProjectInstructions({ project, workspaceDir: path, shell: 'bash' })).toThrow('absolute, single-line path');
  });
});

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
    const command = checkCommand(markdown);
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
