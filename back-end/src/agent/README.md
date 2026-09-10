# back-end/src/agent

The `AgentDriver` interface and its implementations — `ClaudeAgentDriver` first, `CopilotAgentDriver` in a later phase. This is what makes "same back end, different AI agent" a config choice instead of a fork: the pipeline only ever calls the interface, never a specific agent's SDK directly. Empty stub; not built yet.
