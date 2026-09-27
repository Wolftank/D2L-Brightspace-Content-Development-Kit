import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDriver, AgentName } from './AgentDriver.js';
import { createClaudeAgentDriver } from './claude.js';

/** The drivers this back end can run. */
export const AGENT_DRIVERS = ['claude'] as const satisfies readonly AgentName[];

/** The reasoning effort levels an agent can run with. */
export const AGENT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[];

/** Which agent runs turns and how. An omitted field keeps the agent's own default. */
export interface AgentSettings {
  driver: (typeof AGENT_DRIVERS)[number];
  model?: string;
  effort?: (typeof AGENT_EFFORTS)[number];
}

/** Builds the driver `settings.driver` names, configured with the rest of `settings`. */
export function createAgentDriver(settings: AgentSettings): AgentDriver {
  switch (settings.driver) {
    case 'claude':
      return createClaudeAgentDriver({ model: settings.model, effort: settings.effort });
  }
}
