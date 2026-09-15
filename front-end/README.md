# front-end

The browser app: chat, configurator, build panel, preview. It displays the plain-language turn status, QA gate findings, and pedagogy check findings the back end produces; the checks themselves live in `back-end/src`, not here. It has no server of its own: the Vite dev server serves it in development, and the back end serves the built files when the app is bundled.

## Setup

Requires Node 20.19+, Node 22.13+, or Node 24+.

```
npm install
npm run dev
```

`npm run dev` serves the app on `http://127.0.0.1:5173` and proxies `/api` to the back end on `http://127.0.0.1:3000`. To develop against the stub instead, run these in two terminals:

```
npm run stub
npm run dev:stub
```

`dev:stub` starts Vite in the `stub` mode, whose `.env.stub` points the proxy at the stub on port 3001.

The `allowScripts` field in `package.json` is npm 11's allowlist for packages that run install scripts; esbuild is approved there so `npm install` builds it without prompting. npm 10, which Node 20 ships with, ignores the field.

## Scripts

- `npm run dev` — serve the app, proxying `/api` to the back end
- `npm run dev:stub` — serve the app, proxying `/api` to the stub
- `npm run stub` — run the stub back end (`stub/server.ts`) on port 3001
- `npm test` — run the Vitest suite in `src/`
- `npm run lint` — ESLint over the project
- `npm run typecheck` — `tsc --noEmit`

## Inside this folder

- `index.html`, `src/main.tsx`, `src/App.tsx` — the app entry
- `src/api/types.ts` — the HTTP API and event stream shapes, transcribed from [`docs/architecture.md`](../docs/architecture.md)
- `src/test/setup.ts` — Testing Library matchers and cleanup for Vitest
- `stub/server.ts` — the stub back end, until the real routes land
- `vite.config.ts` — the dev server proxy and the Vitest configuration
- `.env.stub` — the proxy target used by `dev:stub`

## The stub back end

The stub serves the six V1 endpoints plus `/api/health` and `/api/me` with the shapes from the architecture doc, keeps everything in memory, and plays a scripted turn on the event stream over about seven seconds. The stream honors `Last-Event-ID` and `?after=`, so reconnecting replays what was missed. The Download link returns a valid, empty zip.

To see the failure states, include a keyword in the message text:

- `[qa-fail]` — the build finishes with status `failed` and two QA gate findings
- `[turn-fail]` — the turn ends with `turn.failed` and no build

The stub is deleted in the PR that lands the message route (B12), when `dev:stub` goes away and `dev` is the only mode.
