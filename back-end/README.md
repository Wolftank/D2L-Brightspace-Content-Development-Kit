# back-end

The back end (`src/`): runs turns with the agent, runs the QA gate and the pedagogy check against `kit/`, creates builds, deploys to D2L, and translates findings into plain language for the front end.

`kit/` is the actual D2L Content Development Kit — the skills, lint/harness, and probes carried over from the internship prototype. It's hardened and extended in place as part of this project, not treated as a frozen reference copy.

`config/` holds the mode (local / hosted) and the agent (Claude / Copilot) as configuration, so the same back end runs in either mode without a code fork.

## Inside `src/`

- `server.js` — starts the HTTP server, wires up the routes from `../docs/architecture.md`
- `routes/` — one file per endpoint's handler logic
- `agent/` — the `AgentDriver` interface, `ClaudeAgentDriver`, and (later) `CopilotAgentDriver`
- `pipeline/` — the runner and the session service, emitting events to the event stream
- `tilt-udl/` — the pedagogy check
- `deploy/` — the D2L API client; see its own README for why this is the piece most likely to need real design work

Everything under `src/` is a stub right now — real implementation TBD by the back-end track, starting with V1 ([`../docs/v1.md`](../docs/v1.md)).
