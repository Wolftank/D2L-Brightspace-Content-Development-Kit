# back-end

The back end (`src/`): runs turns with the agent, runs the QA gate and the pedagogy check against `kit/`, creates builds, deploys to D2L, and translates findings into plain language for the front end.

`kit/` is the actual D2L Content Development Kit — the skills, lint/harness, and probes carried over from the internship prototype. It's hardened and extended in place as part of this project, not treated as a frozen reference copy. It stays plain CommonJS JavaScript (its own `kit/package.json` sets `"type": "commonjs"`) and is not part of the TypeScript toolchain below.

`config/` holds the mode (local / hosted) and the agent (Claude / Copilot) as configuration, so the same back end runs in either mode without a code fork.

## Setup

Requires Node 20+.

```
npm install
npm run dev
```

`npm run dev` starts the server from source with `tsx watch` and logs the port it's listening on. It reads `DATA_DIR` (default `%LOCALAPPDATA%\CDK` on Windows) and `PORT` (default `3000`) from the environment; see [`src/config.ts`](src/config.ts).

## Scripts

- `npm run dev` — run the server from source, restarting on change
- `npm test` — run the Vitest suite in `src/`
- `npm run lint` — ESLint over `src/` (`kit/` is excluded; it's plain JS with its own conventions)
- `npm run typecheck` — `tsc --noEmit`

## Inside `src/`

- `server.ts` — starts the HTTP server, wires up the routes from `../docs/architecture.md`
- `config.ts` — the zod-validated config read from the environment
- `routes/` — one file per endpoint's handler logic
- `agent/` — the `AgentDriver` interface, `ClaudeAgentDriver`, and (later) `CopilotAgentDriver`
- `pipeline/` — the runner and the session service, emitting events to the event stream
- `tilt-udl/` — the pedagogy check
- `deploy/` — the D2L API client; see its own README for why this is the piece most likely to need real design work

Everything under `src/` beyond `config.ts` and `server.ts` is a stub right now — real implementation TBD by the back-end track, starting with V1 ([`../docs/v1.md`](../docs/v1.md)).
