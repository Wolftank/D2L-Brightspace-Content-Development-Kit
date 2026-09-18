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

## V1 configurator

The V1 screen follows [`docs/v1.md`](../docs/v1.md): it collects a project title and one instructor request, creates a SCORM project, submits the request, displays Server-Sent Event progress, and renders the returned build and QA findings. The build card provides the download endpoint when the QA gate passes.
