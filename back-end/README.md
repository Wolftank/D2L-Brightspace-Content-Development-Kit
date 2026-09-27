# back-end

The back end (`src/`): runs turns with the agent, runs the QA gate and the pedagogy check against `kit/`, creates builds, deploys to D2L, and translates findings into plain language for the front end.

`kit/` is the actual D2L Content Development Kit — the skills, lint/harness, and probes carried over from the internship prototype. It's hardened and extended in place as part of this project, not treated as a frozen reference copy. It stays plain CommonJS JavaScript (its own `kit/package.json` sets `"type": "commonjs"`) and is not part of the TypeScript toolchain below.

## Setup

Requires Node ^20.19, ^22.13, or 24+.

```
npm install
npm start
```

`npm start` runs the server from source and logs its address and data directory. `npm run dev` does the same and restarts the server when a file under `src/` changes; a restart fails any running turn as `interrupted`, so use `npm start` when running real turns.

The agent needs a Claude sign-in on this machine (sign in once with the Claude CLI) or `ANTHROPIC_API_KEY` set in the environment or in `.env`. `GET /api/me` reports whether the agent is ready; each call sends the agent one small, billed request.

### Settings

Every setting is optional. To change one, copy the example and uncomment its line:

```
Copy-Item .env.example .env
```

`back-end/.env` is read at startup and ignored by git. A variable already set in the environment wins over the file, so `$env:PORT=4000; npm start` overrides a `PORT` in `.env`. Restart the back end after editing `.env`; `npm run dev` does not watch it. An invalid value stops startup with a message naming each setting and its rule.

| Setting | Default | Rule |
|---|---|---|
| `AGENT_DRIVER` | `claude` | The agent that runs turns. Supported: `claude` |
| `AGENT_MODEL` | the agent's default for the account | A model name, such as `claude-sonnet-5`. The agent checks the name on each turn and on `GET /api/me`, not at startup |
| `AGENT_EFFORT` | the agent's default | `low`, `medium`, `high`, `xhigh`, or `max` |
| `PORT` | `3000` | A whole number from 1 to 65535. When you change it, start the front end with `API_TARGET=http://127.0.0.1:<port>` |
| `DATA_DIR` | `%LOCALAPPDATA%\CDK` on Windows, `~/.cdk` elsewhere | Where the database, workspaces, and builds are stored. A relative path is resolved against `back-end/` |

`ANTHROPIC_API_KEY` is read by the Claude CLI, not by the back end. The agent's shell commands can read it too.

## Scripts

- `npm start` — run the server from source
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
- `config.ts` — loads `back-end/.env` and validates the settings in the environment
- `db/` — the Drizzle schema, migrations, `openDb`, and the repositories
- `routes/` — one file per resource's routes, each calling one service
- `services/` — the project, turn, workspace, and build services the routes and the pipeline call
- `agent/` — the `AgentDriver` interface, the Claude driver, and `createAgentDriver`, which builds the driver `AGENT_DRIVER` names
- `pipeline/` — the runner and the session service, emitting events to the event stream
- `tilt-udl/` — the pedagogy check
- `deploy/` — the D2L API client; see its own README for why this is the piece most likely to need real design work

Wiring lives in one `createApp(deps)` function; `server.ts` calls it with real dependencies, tests call it with fakes. Full design in [`../docs/architecture.md`](../docs/architecture.md); the first slice being built is scoped in [`../docs/v1.md`](../docs/v1.md).
