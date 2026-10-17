# back-end/src/agent

The `AgentDriver` interface, the Claude driver (`createClaudeAgentDriver` in [`claude.ts`](claude.ts)), and `createAgentDriver` in [`drivers.ts`](drivers.ts), which builds the driver the `AGENT_DRIVER` setting names. A new driver is added to `AGENT_DRIVERS` and to `createAgentDriver`. This is what makes "same back end, different agent" a config choice instead of a fork: the runner and the session service only ever call the interface, never a specific agent's SDK directly.

Interface: [`AgentDriver.ts`](AgentDriver.ts). The session lifecycle and the workspace each session runs in: [`docs/architecture.md`](../../../docs/architecture.md). What was verified about each agent, and the gaps each driver must absorb: [`docs/drivers.md`](../../../docs/drivers.md).

## Project instructions

`renderProjectInstructions` in [`instructions.ts`](instructions.ts) returns deterministic Markdown from a project's `id` and `title` and the absolute workspace path returned by `workspaces.pathFor(project.id)`. The renderer reads and writes no files.

The session service supplies the result as `SessionRequest.instructions`, the kit's skills directory as `skillsDir`, `SCORM_SKILLS` as `skills`, and the project's `cdk` tools from [`tools/`](../tools/) as `tools`. The driver delivers the Markdown, only those skills, and the tools using its own conventions (Claude writes `CLAUDE.md` and `.claude/skills/` and serves the tools in-process). What the agent can use, and how each driver holds it to that, is in [`docs/drivers.md`](../../../docs/drivers.md#what-the-agent-can-use). The instructor's request stays in `TurnInput.text`.

The instructions name the SCORM and QA skills, point at the starter already in `out/`, and name the `cdk` tools: `get_project` for the tenant's limits, `check_output` for the QA gate, and `delete_files` for removing files from `out/`. The agent has no shell. It builds, checks, fixes, and checks again within one request, then hands off `out/` to the build service, which saves it as a new version, checks it again, and packages it. This handoff takes precedence over the skills' standalone packaging and deployment steps.
