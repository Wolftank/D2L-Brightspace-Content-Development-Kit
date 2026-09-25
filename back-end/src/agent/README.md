# back-end/src/agent

The `AgentDriver` interface and the drivers — `ClaudeAgentDriver` first, `CopilotAgentDriver` in a later phase. This is what makes "same back end, different agent" a config choice instead of a fork: the runner and the session service only ever call the interface, never a specific agent's SDK directly.

Interface: [`AgentDriver.ts`](AgentDriver.ts). The session lifecycle and the workspace each session runs in: [`docs/architecture.md`](../../../docs/architecture.md). What was verified about each agent, and the gaps each driver must absorb: [`docs/drivers.md`](../../../docs/drivers.md).

## Project instructions

`renderProjectInstructions` in [`instructions.ts`](instructions.ts) returns deterministic Markdown from a project's `id` and `title`, the absolute workspace path returned by `workspaces.pathFor(project.id)`, and the selected shell (`bash` or `powershell`). It uses the provisioned `workspace/kit/` layout from the workspace service. The renderer reads and writes no files.

The B9 session service supplies the result as `SessionRequest.instructions` and the prepared `workspace/kit/skills` directory as `skillsDir`. The driver delivers the Markdown using its own conventions (Claude writes `CLAUDE.md`) and enables shell access. The instructor's request stays in `TurnInput.text`.

The instructions refer to the existing SCORM and QA guides, starter, and tenant profile, and provide a literal-quoted checker command for the selected shell. The agent builds, checks, fixes, and reruns within one request, then hands off `out/` to the B5 build/download service for final saved-build validation and packaging. This V1 handoff takes precedence over the guides' standalone packaging/deployment steps.

`instructions.test.ts` runs the rendered command against a real provisioned workspace with spaces, apostrophes, and shell-sensitive characters in its path. It verifies an initial pass, a missing-manifest failure, and a pass after repair. The integration test uses Windows PowerShell on Windows and Bash on other hosts; unit cases cover quoting for both shells. Live agent execution and permission setup are covered by B9, not the renderer.
