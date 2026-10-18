import { expect, it } from 'vitest';
import { toolCategory } from './progress.js';

it.each([
  ['Write', {}, 'writing'],
  ['Edit', {}, 'writing'],
  ['Read', {}, 'reading'],
  ['Skill', {}, 'reading'],
  ['Glob', {}, 'searching'],
  ['Grep', {}, 'searching'],
  ['mcp__cdk__create_build', {}, 'building'],
  ['mcp__cdk__check_output', {}, 'checking'],
  ['mcp__cdk__get_build', {}, 'checking'],
  ['mcp__cdk__check_pedagogy', {}, 'checking'],
  ['PowerShell', { command: 'node kit/scripts/lint.js' }, 'checking'],
  ['Bash', { command: 'ls out/' }, 'reading'],
  ['Bash', { command: 'rg heading out/' }, 'searching'],
  ['PowerShell', { description: 'Writing index.html' }, 'other'],
  ['unknown', { description: 'Checking your build' }, 'other'],
] as const)('classifies %s from identity and input rather than display descriptions', (name, input, category) => {
  expect(toolCategory(name, input)).toBe(category);
});
