import { isAbsolute, join } from 'node:path';
import type { Project } from '../db/schema.js';

export interface ProjectInstructionsInput {
  project: Pick<Project, 'id' | 'title'>;
  /** Absolute path returned by the workspace service's pathFor(projectId). */
  workspaceDir: string;
  shell: 'bash' | 'powershell';
}

/** Renders project context and the kit's build/check/fix workflow for one request. */
export function renderProjectInstructions({ project, workspaceDir, shell }: ProjectInstructionsInput): string {
  if (!isAbsolute(workspaceDir) || /[\r\n\0]/.test(workspaceDir)) {
    throw new Error('workspaceDir must be an absolute, single-line path');
  }
  const kitDir = join(workspaceDir, 'kit');
  const outDir = join(workspaceDir, 'out');
  const checker = join(kitDir, 'harness', 'lint', 'lint.js');
  const quote = (value: string) => `'${value.replaceAll("'", shell === 'powershell' ? "''" : "'\\''")}'`;
  const command = `node ${quote(checker)} ${quote(outDir)} --avenue scorm`;

  return `# Project instructions

Project ID: ${code(project.id)}
Project title: ${code(project.title)}
V1 output format: SCORM. Build from the instructor request supplied in the message input. Use the SCORM path directly and proceed without the prototype's output-selection interview.

## Workspace and kit

- Workspace: ${code(workspaceDir)}
- Source material (files/): ${code(join(workspaceDir, 'files'))}
- Generated output (out/): ${code(outDir)}
- Prepared kit: ${code(kitDir)}

Keep source material and kit files unchanged. Write the activity and its assets only into out/.
Read and follow these existing guides for content rules and tenant constraints:
- SCORM skill: ${code(join(kitDir, 'skills', 'd2l-scorm-package', 'SKILL.md'))}
- QA skill: ${code(join(kitDir, 'skills', 'd2l-tenant-qa', 'SKILL.md'))}
- SCORM starter: ${code(join(kitDir, 'skills', 'd2l-scorm-package', 'assets', 'starter'))}
- Tenant profile: ${code(join(kitDir, 'harness', 'tenant-profile.json'))}

Resolve harness paths in the guides from the prepared kit directory and skill-relative assets from the corresponding skill directory. Use the starter already provisioned in out/ as the starting point for the activity.

## Build, check, and fix within this request

1. Build the requested SCORM activity in out/ using the guides and source material.
2. Run this check in ${shell} from the workspace:

\`\`\`${shell}
${command}
\`\`\`

3. Inspect the findings and their explanations. Fix errors you can address in out/ and rerun the same checker during this request. Review warnings and report any remaining limitations. If the checker cannot run or errors remain, clearly describe the failure and unresolved findings; do not claim a passing package.
4. Return a concise description of the activity, the check result, and any unresolved issues. Leave the output for the backend build/download step, which saves a version, independently validates the saved output, and packages passing builds with the manifest at the ZIP root. That backend step owns final packaging and download eligibility; the agent's check is preliminary. In this V1 flow, hand off out/ in place of the guides' standalone packaging and deployment steps.
`;
}

/** Formats literal project data and paths as Markdown code spans. */
function code(value: string): string {
  const literal = value.replaceAll('\r', '\\r').replaceAll('\n', '\\n');
  const delimiter = '`'.repeat(Math.max(0, ...(literal.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  return `${delimiter} ${literal} ${delimiter}`;
}
