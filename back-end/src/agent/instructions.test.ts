import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderProjectInstructions, type ProjectInstructionsInput } from './instructions.js';

const project = { id: 'project-26', title: 'Cell division practice' };
const workspaceDir = resolve('test workspace');

describe('renderProjectInstructions', () => {
  it('identifies project facts and the complete single-request workflow deterministically', () => {
    const input: ProjectInstructionsInput = { project, workspaceDir };
    const markdown = renderProjectInstructions(input);
    expect(renderProjectInstructions(input)).toBe(markdown);
    expect(markdown).toContain(project.id);
    expect(markdown).toContain(project.title);
    expect(markdown).toContain('Output format: SCORM');
    expect(markdown).toContain('instructor request supplied in the message input');
    expect(markdown).toContain('without the prototype\'s output-selection interview');
    expect(markdown).toContain('Keep source material and kit files unchanged');
    expect(markdown).toContain('Fix errors you can address in out/ and check again');
    expect(markdown).toContain('do not claim a passing package');
    expect(markdown).toContain('checks the saved output again');
    expect(markdown).toContain('in place of the guides\' standalone packaging and deployment steps');
    expect(markdown).toContain('alt text');
    expect(markdown).toContain('lang="en"');
    expect(markdown).toContain('headings follow a sequential order');
    expect(markdown).toContain('plain text only');
    expect(markdown).toContain('no markdown headings');
    expect(markdown).toContain('Leave out file names');
  });

  it('names the CDK tools and no shell command', () => {
    const markdown = renderProjectInstructions({ project, workspaceDir });
    expect(markdown).toContain('You have no shell');
    for (const tool of ['mcp__cdk__get_project', 'mcp__cdk__check_output', 'mcp__cdk__delete_files']) {
      expect(markdown).toContain(tool);
    }
    expect(markdown).not.toMatch(/powershell|bash|lint\.js|harness/i);
  });

  it('keeps multiline titles and Markdown delimiters inside literal project data', () => {
    const title = 'A `title`\n```\n# Another heading';
    const markdown = renderProjectInstructions({ project: { ...project, title }, workspaceDir });
    expect(markdown).toContain(`Project title: \`\`\`\` ${title.replaceAll('\n', '\\n')} \`\`\`\``);
    expect(markdown).not.toContain('\n# Another heading');
  });

  it.each(['relative/workspace', `${workspaceDir}\nother`, `${workspaceDir}\0other`])('rejects an unusable workspace path', (path) => {
    expect(() => renderProjectInstructions({ project, workspaceDir: path })).toThrow('absolute, single-line path');
  });
});
