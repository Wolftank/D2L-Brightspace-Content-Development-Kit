import type { BuildSuggestion } from '@cdk/contract';

/**
 * Holds the suggestions the agent records during a project's request until
 * the runner takes them for the build made at the request's end.
 */
export interface SuggestionStore {
  /** Replaces the project's recorded suggestions with `suggestions`. */
  record(projectId: string, suggestions: BuildSuggestion[]): void;
  /** Returns the project's recorded suggestions and clears them; empty when none are recorded. */
  take(projectId: string): BuildSuggestion[];
}

export function createSuggestionStore(): SuggestionStore {
  const recorded = new Map<string, BuildSuggestion[]>();
  return {
    record(projectId, suggestions) {
      recorded.set(projectId, suggestions);
    },
    take(projectId) {
      const suggestions = recorded.get(projectId) ?? [];
      recorded.delete(projectId);
      return suggestions;
    },
  };
}
