import type { ProgressCategory } from '@cdk/contract';

/** Classifies a tool using its identity and structured input. */
export function toolCategory(name: string, input: unknown): Exclude<ProgressCategory, 'thinking'> {
  if (name === 'Write' || name === 'Edit') return 'writing';
  if (name === 'Read' || name === 'Skill' || name.endsWith('__get_project')) return 'reading';
  if (name === 'Glob' || name === 'Grep') return 'searching';
  if (name.endsWith('__create_build')) return 'building';
  if (name.endsWith('__get_build') || name.endsWith('__check_pedagogy')) return 'checking';
  const command = input && typeof input === 'object' && 'command' in input ? (input as { command: unknown }).command : undefined;
  if ((name === 'Bash' || name === 'PowerShell') && typeof command === 'string') {
    if (/\blint\.js\b|\bnpm\s+(?:run\s+)?(?:test|lint)\b/.test(command)) return 'checking';
    if (/^\s*(?:ls|dir|Get-ChildItem|cat|Get-Content)\b/i.test(command)) return 'reading';
    if (/^\s*(?:rg|grep|find|Select-String)\b/i.test(command)) return 'searching';
  }
  return 'other';
}
