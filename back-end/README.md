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

`npm run dev` starts the server from source with `tsx watch` and logs the port it's listening on. The defaults work as-is; to change a setting, copy the example file and edit your copy:

```
cp .env.example .env      # copy .env.example to .env on Windows
```

`.env` lives next to this README in `back-end/`, is ignored by Git, and is read at startup. A real environment variable (`PORT=4000 npm run dev`) always takes precedence over the file. The settings, validated in [`src/config.ts`](src/config.ts), with startup stopping on an invalid value:

| Setting | Default | Meaning |
|---|---|---|
| `AGENT_DRIVER` | `claude` | The agent that builds the content; `claude` is the only supported value |
| `PORT` | `3000` | The TCP port, an integer from 1 to 65535 |
| `DATA_DIR` | `%LOCALAPPDATA%\CDK` on Windows, `~/.cdk` elsewhere | Where projects, workspaces, builds, and the database live; a relative path is resolved against the starting directory |

## Scripts

- `npm run dev` — run the server from source, restarting on change
- `npm test` — run the Vitest suite in `src/`
- `npm run lint` — ESLint over `src/` (`kit/` is excluded; it's plain JS with its own conventions)
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — generate a Drizzle migration from `src/db/schema.ts` into `src/db/migrations/`, after changing the schema

## Inside `src/`

- `server.ts` — wires the real dependencies (`buildDeps`) and starts `createApp(deps)` listening on `127.0.0.1`
- `app.ts` — `createApp(deps)`: the Express app, without listening
- `deps.ts` — the `Deps` type: one field per service, repository, and driver the app needs
- `identity.ts` — the auth middleware; sets `req.user` to the local-mode stub user
- `errors.ts` — the error classes and the error-handling middleware, mapping to the `{ error: { code, message, details? } }` envelope
- `config.ts` — the zod-validated config read from the environment
- `db/` — the Drizzle schema, migrations, `openDb`, and the repositories
- `routes/` — one file per resource's routes, each calling one service
- `services/` — the projects, workspace, and build services the routes and the pipeline call
- `agent/` — the `AgentDriver` interface, `ClaudeAgentDriver`, and (later) `CopilotAgentDriver`
- `pipeline/` — the runner and the session service, emitting events to the event stream
- `tilt-udl/` — the pedagogy check
- `deploy/` — the D2L API client; see its own README for why this is the piece most likely to need real design work

Wiring lives in one `createApp(deps)` function; `server.ts` calls it with real dependencies, tests call it with fakes. Full design in [`../docs/architecture.md`](../docs/architecture.md); the first slice being built is scoped in [`../docs/v1.md`](../docs/v1.md).
