# back-end/src/agent

The `AgentDriver` interface and the drivers — `ClaudeAgentDriver` first, `CopilotAgentDriver` in a later phase. This is what makes "same back end, different agent" a config choice instead of a fork: the runner and the session service only ever call the interface, never a specific agent's SDK directly.

Interface: [`AgentDriver.ts`](AgentDriver.ts). The session lifecycle and the workspace each session runs in: [`docs/architecture.md`](../../../docs/architecture.md). What was verified about each agent, and the gaps each driver must absorb: [`docs/drivers.md`](../../../docs/drivers.md).
