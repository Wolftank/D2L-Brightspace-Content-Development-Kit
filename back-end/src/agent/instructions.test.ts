import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderProjectInstructions, type ProjectInstructionsInput } from './instructions.js';

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
    expect(markdown).toContain('alt text');
    expect(markdown).toContain('lang="en"');
    expect(markdown).toContain('headings follow a sequential order');
    expect(markdown).toContain('plain text only');
    expect(markdown).toContain('no markdown headings');
    expect(markdown).toContain('Leave out file names');
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
