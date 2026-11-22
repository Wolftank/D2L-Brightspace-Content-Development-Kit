import type { BuildSuggestion } from '@cdk/contract';
import { describe, expect, it } from 'vitest';
import { createSuggestionStore } from './suggestions.js';

const CRITERIA: BuildSuggestion = { framework: 'tilt', principle: 'Criteria', suggestion: 'Name what a strong answer includes.', reason: 'Students do better when they see the criteria first.' };
const ENGAGEMENT: BuildSuggestion = { framework: 'udl', principle: 'Engagement', suggestion: 'Open with a real case.', reason: 'A relevant case recruits interest.' };

describe('suggestion store', () => {
  it('gives an empty list for a project with none recorded', () => {
    expect(createSuggestionStore().take('p1')).toEqual([]);
  });

  it('keeps the last list recorded for a project', () => {
    const store = createSuggestionStore();
    store.record('p1', [CRITERIA, ENGAGEMENT]);
    store.record('p1', [ENGAGEMENT]);

    expect(store.take('p1')).toEqual([ENGAGEMENT]);
  });

  it('clears what it takes, and keeps each project apart', () => {
    const store = createSuggestionStore();
    store.record('p1', [CRITERIA]);
    store.record('p2', [ENGAGEMENT]);

    expect(store.take('p1')).toEqual([CRITERIA]);
    expect(store.take('p1')).toEqual([]);
    expect(store.take('p2')).toEqual([ENGAGEMENT]);
  });
});
