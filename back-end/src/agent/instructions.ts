import { isAbsolute, join } from 'node:path';
import type { Project } from '../db/schema.js';

export interface ProjectInstructionsInput {
  project: Pick<Project, 'id' | 'title'>;
  /** Absolute path returned by the workspace service's pathFor(projectId). */
  workspaceDir: string;
}

/** Renders project context and the kit's build/check/fix workflow for one request. */
export function renderProjectInstructions({ project, workspaceDir }: ProjectInstructionsInput): string {
  if (!isAbsolute(workspaceDir) || /[\r\n\0]/.test(workspaceDir)) {
    throw new Error('workspaceDir must be an absolute, single-line path');
  }
  const outDir = join(workspaceDir, 'out');

  return `# Project instructions

Project ID: ${code(project.id)}
Project title: ${code(project.title)}
Output format: SCORM. Build from the instructor request supplied in the message input. Use the SCORM path directly and proceed without the prototype's output-selection interview.

## Workspace and skills

- Workspace: ${code(workspaceDir)}
- Source material (files/): ${code(join(workspaceDir, 'files'))}
- Generated output (out/): ${code(outDir)}

Keep source material unchanged. Write the activity and its assets only into out/.
Follow these skills for content rules:
- ${code('d2l-scorm-package')} to build the SCORM activity
- ${code('d2l-tenant-qa')} to check it against what the D2L tenant allows

Use the starter already provisioned in out/ as the starting point for the activity.

## Tools

You have no shell. Work with your file tools and these CDK tools:
- ${code('mcp__cdk__get_project')} returns the project's details, its latest build with its QA findings, and what the D2L tenant allows. Read the tenant limits before you build.
- ${code('mcp__cdk__check_output')} runs the QA checker on out/ as it is now and returns its findings.
- ${code('mcp__cdk__delete_files')} deletes files or folders inside out/.

## Build, check, and fix within this request

1. Build the requested SCORM activity in out/ using the skills and source material. Ensure all images have alt text, the page declares lang="en", and headings follow a sequential order without skipping levels. The checker enforces these accessibility rules.
2. Check out/ with ${code('mcp__cdk__check_output')}.
3. Inspect the findings and their explanations. Fix errors you can address in out/ and check again during this request. Review warnings and report any remaining limitations. If the checker cannot run or errors remain, clearly describe the failure and unresolved findings; do not claim a passing package.
4. Return a concise description of the activity, the check result, and any unresolved issues. When your turn ends, CDK saves out/ as a new version, checks the saved output again, and packages a passing build with the manifest at the ZIP root. That step owns final packaging and download eligibility. Hand off out/ in place of the skills' standalone packaging and deployment steps.

## How to reply

Write a short summary of what was built, in a few plain sentences. Describe what students will do, what the activity covers, and what changed from the last version. Leave out file names, tool names, command output, code, and QA rule IDs. Use plain text only: no markdown headings, bold, bullet lists, tables, backticks, or code blocks. If the checker found a problem you could not fix, say plainly what is wrong and what the instructor should do next. Clarifying questions to the instructor follow the same style: short and plain.
`;
}

/** Formats literal project data and paths as Markdown code spans. */
function code(value: string): string {
  const literal = value.replaceAll('\r', '\\r').replaceAll('\n', '\\n');
  const delimiter = '`'.repeat(Math.max(0, ...(literal.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  return `${delimiter} ${literal} ${delimiter}`;
}
