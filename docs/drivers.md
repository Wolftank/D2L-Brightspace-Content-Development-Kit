# Drivers

Terms are defined in [architecture.md](architecture.md#terms). This file records what was verified about each agent, from its official documentation, so each driver is designed from facts rather than assumptions. Anything marked *unverified* was not found in the documentation read on 2026-09-10 and must be checked before it is relied on. Codex was evaluated for comparison and is not planned.

## At a glance

| | Claude | Copilot | Codex (evaluated only) |
|---|---|---|---|
| Package | `@anthropic-ai/claude-agent-sdk`, bundles the agent binary | `@github/copilot-sdk`, GA since June 2026; needs the Copilot CLI installed and signed in | `@openai/codex-sdk`, spawns the Codex CLI |
| How it runs | The SDK spawns the bundled binary in-process | The SDK spawns the CLI as a JSON-RPC server over stdio | The SDK spawns the CLI per run, JSONL over stdio |
| Workspace | `cwd` per `query()` | `cwd` on the client, so one client per workspace | `workingDirectory` per thread |
| Session id | `session_id` on the first system message | Chosen by the caller in `createSession({ sessionId })` | `thread_id` in the first event of a run |
| Reopen | `resume: id` | `resumeSession(id)`, across restarts | `resumeThread(id)` |
| State on disk | `~/.claude/projects/<workspace>/<id>.jsonl`, pruned after `cleanupPeriodDays` | `~/.copilot/session-state/<id>/` | `~/.codex/sessions` |
| Configuration directory | `~/.claude`, override `CLAUDE_CONFIG_DIR` | `~/.copilot`, override `COPILOT_HOME` | `~/.codex`, override `CODEX_HOME` |
| Text streaming | `includePartialMessages`, then `stream_event` messages | `streaming: true`, then `assistant.message_delta` events | `runStreamed()`; delta granularity *unverified* |
| Tools in-process | `createSdkMcpServer` and `tool()`, zod schemas | `defineTool`, JSON Schema or zod | *unverified*; MCP servers via `config.toml` |
| MCP servers | `mcpServers` option | `mcpServers` option, stdio or http | `[mcp_servers]` in `config.toml` |
| Instructions and skills | `CLAUDE.md`, `.claude/skills/`, and `.claude/settings.json`, written into the workspace by the driver and loaded with `settingSources: ['project']` | `systemMessage` and `skillDirectories` session options; the SDK discovers nothing in the workspace | `AGENTS.md` in the workspace; skills location *unverified* |
| Permission model | `permissionMode`, `allowedTools`, rules in settings | `onPermissionRequest` handler, `availableTools`, `excludedTools` | `--ask-for-approval on-request \| never` |
| Path confinement hook | `PreToolUse` hook, in-process, can deny | Hooks at pre/post tool use exist; signature *unverified* | *unverified* |
| OS sandbox | macOS, Linux, WSL2. Not native Windows | Experimental: macOS 15+, Linux with bubblewrap, recent Windows 11. Shell commands only | macOS, Linux, native Windows, WSL2 |
| Turn limits | `maxTurns`, `maxBudgetUsd` | *unverified* | *unverified* |
| Sign-in | The instructor's Claude account | A GitHub account with a Copilot subscription, or bring-your-own-key | An OpenAI account |

## Claude

**Running a turn.** `query({ prompt, options })` returns an async iterable of messages. `options.cwd` sets the workspace. `options.resume` reopens a session by id; `options.continue` reopens the most recent one; `options.forkSession` branches. The session id is on the first message, `type: 'system', subtype: 'init'`, and on the final `result` message, which also carries `subtype` (`success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`), `usage`, `total_cost_usd`, and `num_turns`. With `includePartialMessages: true` the stream includes `stream_event` messages carrying text deltas.

**Keeping a session open.** The prompt may be an async iterable of user messages instead of a string. The query then stays alive across several instructor messages, which the SDK documents as the mode to use for chat. This is what lets the Claude driver keep a process alive inside an open session and drop it on idle timeout.

**Tools.** `createSdkMcpServer({ name, tools: [tool(name, description, zodSchema, handler)] })`, passed as `options.mcpServers`. The agent sees each as `mcp__<server>__<tool>`, and each must be listed in `options.allowedTools`.

**Permissions.** `permissionMode: 'dontAsk'` denies anything not pre-approved without prompting; `acceptEdits` auto-approves edits and common filesystem commands inside the workspace only. Rules live in the workspace's `.claude/settings.json` under `permissions.allow`, `deny`, and `ask`, with the syntax `Read(pattern)`, `Edit(pattern)`, `Write(pattern)`, `Bash(prefix *)`; `//` is an absolute path, `/` is workspace-relative, `~/` is home. `settingSources: ['project']` loads that file and the workspace's `.claude/skills/`. `permissions.additionalDirectories` widens file access without loading configuration from those directories.

**Instructions and skills.** Claude reads `CLAUDE.md`, `.claude/skills/`, and `.claude/settings.json` from the workspace when `settingSources: ['project']` is set, so the driver writes the instructions, a copy of the kit's skills, and the permission rules there at every `open`.

**Hooks.** `options.hooks.PreToolUse` and `PostToolUse` are in-process callbacks. A pre-tool hook denies a call by returning `hookSpecificOutput.permissionDecision: 'deny'` with a `permissionDecisionReason`. This is layer 3 of the confinement.

**Sandbox.** `sandbox.enabled` in settings confines shell writes to the workspace and blocks network access except `sandbox.network.allowedDomains`; `sandbox.failIfUnavailable` makes an unsupported host refuse to run. Supported on macOS, Linux, and WSL2, not on native Windows.

**Limits.** `maxTurns` and `maxBudgetUsd` are enforced by the SDK. There is no wall-clock option; the runner's abort signal covers it.

**State.** Transcripts are stored per workspace under the configuration directory and pruned after `cleanupPeriodDays`. `CLAUDE_CONFIG_DIR` relocates transcripts, settings, and sign-in together.

**Windows.** The SDK bundles the binary. The shell tool uses Git for Windows when present and PowerShell otherwise.

**Gaps.** No OS sandbox on native Windows, so local mode on Windows runs layers 1 to 3 only. The turn boundary inside a kept-open query, a `result` message per instructor message, is what the driver relies on and must be confirmed in the first spike.

## Copilot

**Running the agent.** `new CopilotClient({ cwd, cliPath?, cliUrl?, env?, autoStart, autoRestart, useStdio })` spawns the CLI as a server and manages its lifetime; `cliUrl` attaches to one already running. The workspace is set on the client, not the session, so the driver holds one client per workspace and one session inside it.

**Sessions.** `client.createSession({ sessionId, model, tools, mcpServers, systemMessage, streaming, onPermissionRequest, availableTools, excludedTools })`. The caller chooses `sessionId`, so the driver can use the project id and the Project's `sessionId` is deterministic. `client.resumeSession(id, { onPermissionRequest })` reopens a session, including after the client and CLI have restarted; the full message thread, cached tool results, and the agent's planning state are restored, and tools keep their registration but not their in-memory state. `listSessions()`, `deleteSession(id)`, and `disconnect()` (release memory, keep disk state) exist. State lives in `~/.copilot/session-state/<id>/`.

**Turns.** `session.send({ prompt })` returns when the message is accepted; `session.sendAndWait({ prompt })` returns the final `assistant.message`. Events via `session.on(kind, handler)`: `assistant.message_delta` with `data.deltaContent`, `assistant.message` with `data.content`, `tool.executionStart`, `tool.executionComplete`, `session.idle` when the turn is done, `session.error`. `session.abort()` stops a running turn; `session.destroy()` tears it down.

**Tools.** `defineTool(name, { description, parameters, handler })` with parameters as JSON Schema or a zod schema; handlers return a value or `{ textResultForLlm, resultType, error? }`. MCP servers are passed per session as `{ type: 'stdio' | 'local', command, args, env?, cwd?, tools? }` or `{ type: 'http' | 'sse', url, headers?, tools? }`, with a `tools` array to select which of a server's tools are exposed.

**Instructions and skills.** The SDK takes instructions as `systemMessage` and loads skills only from the directories listed in `skillDirectories`; it does not discover `.github/skills`, `.claude/skills`, or `.agents/skills` in the workspace. The driver therefore points `skillDirectories` at the kit and writes nothing into the workspace. The CLI on its own behaves differently: it reads `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, and `.github/instructions/*.instructions.md` from the working directory and discovers skills in all three project locations.

**Permissions.** `onPermissionRequest` is required on every session. The SDK ships an `approveAll` helper, which this project never uses; the driver's handler allows the allowlist and denies everything else. The GA release notes list hooks at pre and post tool use, session start, MCP tool calls, and permission requests.

**Sandbox.** Local sandboxing is experimental, enabled per session with `/sandbox enable` behind the `--experimental` flag, configured under the `sandbox` key of `settings.json`. It isolates shell commands, file search, and optionally MCP and language servers, using Seatbelt on macOS 15+, bubblewrap on Linux, and a process container on recent Windows 11 builds. The CLI's own built-in file tools run in-process and are not covered by it.

**CLI without the SDK.** `copilot -p "prompt"` runs one prompt and exits, with `--allow-tool`, `--deny-tool`, `--allow-all-tools`, `--add-dir`, `--allow-all-paths`, `--model`, `--no-ask-user`, and `-s` for bare output. Tool kinds are `shell`, `write`, `read`, `url`, `memory`, and MCP server names, each with a filter such as `shell(git:*)`. No machine-readable output mode is documented for the CLI, which is why the driver uses the SDK.

**State.** `COPILOT_HOME` relocates the configuration directory, which holds `config.json` (with `trustedFolders`), `settings.json`, and `session-state/`.

**Gaps and unverified points.** The custom decision shape returned by `onPermissionRequest` beyond `approveAll`. The signature of pre-tool hooks and whether one can deny a call, which layer 3 depends on. Per-turn limits equivalent to `maxTurns` and `maxBudgetUsd`. Whether the CLI process the SDK spawns also reads instruction files from the workspace, which would matter only when a `CLAUDE.md` written by the Claude driver is still present after an install switched agents. Sandbox support on the Windows builds instructors actually run. Billing and model availability on a shared service account in hosted mode.

## Codex, for comparison

`codex.startThread({ workingDirectory, skipGitRepoCheck })` and `codex.resumeThread(threadId)`; `thread.run(prompt)` or `thread.runStreamed(prompt)`, which the SDK executes by spawning the CLI and exchanging JSONL over stdio. The CLI equivalent is `codex exec --json`, whose first event is `thread.started` with `thread_id`, and `codex exec resume <id>`. Threads persist under `~/.codex/sessions`. The sandbox modes are `read-only`, `workspace-write` (network off unless `[sandbox_workspace_write] network_access = true`), and `danger-full-access`; approvals are `on-request` or `never`. The sandbox uses Seatbelt on macOS, bubblewrap with seccomp on Linux, and a native implementation on Windows, with WSL2 inheriting the Linux one. MCP servers are registered in `~/.codex/config.toml` under `[mcp_servers]` or with `codex mcp add`. Its native Windows sandbox is the one capability the two planned agents lack in local mode.

## Sources

Claude: [Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools), [permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [streaming input vs single message](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [hooks](https://code.claude.com/docs/en/hooks), [sandboxing](https://code.claude.com/docs/en/sandboxing), [settings reference](https://code.claude.com/docs/en/settings-reference), [permission rules](https://code.claude.com/docs/en/permissions), [permission modes](https://code.claude.com/docs/en/permission-modes), [Windows installation notes](https://code.claude.com/docs/en/troubleshoot-install), [devcontainer](https://code.claude.com/docs/en/devcontainer).

Copilot: [SDK getting started](https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started), [SDK and MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/mcp), [SDK session persistence](https://github.com/github/copilot-sdk/blob/main/docs/features/session-persistence.md), [SDK GA announcement](https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/), [CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference), [CLI configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli), [CLI session data](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/chronicle), [local sandboxes](https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes), [local sandbox settings](https://docs.github.com/en/copilot/how-tos/cloud-and-local-sandboxes/configuring-local-sandbox-settings), [SDK custom skills](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/skills), [CLI custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions), [about agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [Node.js SDK instructions in awesome-copilot](https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md).

Codex: [SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md), [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security).
