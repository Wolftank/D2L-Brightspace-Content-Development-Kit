# back-end

The orchestration API (`src/`): dispatches builds to the AI agent, runs the QA gate and the automated TILT/UDL check against `kit/`, deploys to D2L, and translates results into plain language for the front end.

`kit/` is the actual D2L Content Development Kit — the skills, lint/harness, and probes carried over from the internship prototype. It's hardened and extended in place as part of this project, not treated as a frozen reference copy.

`config/` holds the hosting target (local machine / hosted VM) and AI agent (Claude / Copilot) as configuration, so the same back end runs in either mode without a code fork.

## Inside `src/`

- `server.js` — starts the HTTP server, wires up the routes from `../docs/architecture.md`
- `routes/` — one file per endpoint's handler logic
- `agent/` — the `AgentDriver` interface, `ClaudeAgentDriver`, and (later) `CopilotAgentDriver`
- `pipeline/` — the main build flow: agent dispatch → QA gate → TILT/UDL check → deploy, emitting progress events along the way
- `tilt-udl/` — the automated pedagogical check itself
- `deploy/` — the D2L API client; see its own README for why this is the piece most likely to need real design work

Everything under `src/` is a stub right now — real implementation TBD by the back-end track, starting with the Sprint 1 MVP.
