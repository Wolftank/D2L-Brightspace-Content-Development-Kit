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

## Browser tests

Include `[long-feed]` in a stub request to emit 60 progress lines. The feed scrolls within a responsive maximum height, follows while at the bottom, pauses when scrolled up, and resumes through Jump to latest, returning to the bottom, or a new turn. Tab reaches the named Build progress log; Home/End and arrow keys scroll it. The working indicator and reply remain outside its scroll area. New lines and failed tool updates use one live region; following and scrolling do not alter its contents.

Manual NVDA check: run `[long-feed]`, scroll back and jump to latest; verify each new line is announced once, successful tool completion is silent, failed calls are announced once when updated, scrolling is silent, and the reply is announced.

Include `[long-step]` in a stub request to pause for 20 seconds after the current step. The working indicator counts from the recorded turn start, including after reload or event replay in another tab. A disconnected stream shows reconnecting status; after 30 seconds without recovery it closes and asks the instructor to reload. A permanently closed stream shows that message immediately. The elapsed time is outside live regions, and the animation stops under reduced motion.

Manual accessibility check: with NVDA running, submit `[long-step]`, keep focus on the Build button, and verify that the step is announced but timer ticks are silent and focus stays put. This check requires NVDA and remains manual.

The Playwright tests in `e2e/` run the app in Chromium and Firefox against the stub. Install the browsers once per machine:

```
npx playwright install chromium firefox
```

Then run:

```
npm run test:e2e
```

This starts the stub and `dev:stub` automatically, or reuses them if they are already running. If a test fails, `npx playwright show-report` opens the HTML report.

The `e2e` job in `.github/workflows/ci.yml` runs this suite in both browsers on every pull request. When it fails, the run keeps a `playwright-report` artifact for 7 days; download and unzip it, then run `npx playwright show-report <unzipped folder>/playwright-report` to open the report and the failing test's trace.

## Scripts

- `npm run dev` — serve the app, proxying `/api` to the back end
- `npm run dev:stub` — serve the app, proxying `/api` to the stub
- `npm run stub` — run the stub back end (`stub/server.ts`) on port 3001
- `npm test` — run the Vitest suite in `src/`
- `npm runt test:e2e` - run the Playwright browser tests in `e2e/` against the stub
- `npm run lint` — ESLint over the project
- `npm run typecheck` — `tsc --noEmit`

## Inside this folder

- `index.html`, `src/main.tsx`, `src/App.tsx` — the app entry
- `src/api/types.ts` — the HTTP API and event stream shapes, transcribed from [`docs/architecture.md`](../docs/architecture.md)
- `src/test/setup.ts` — Testing Library matchers and cleanup for Vitest
- `stub/server.ts` — the stub back end, until the real routes land
- `vite.config.ts` — the dev server proxy and the Vitest configuration
- `.env.stub` — the proxy target used by `dev:stub`
- `e2e/` - Playwright browser tests
- `Playwright.config.ts` - the Playwright configuration: which browsers to test, and the stub and dev server it starts

## V1 configurator

The V1 screen follows [`docs/v1.md`](../docs/v1.md): it collects a project title and one instructor request, creates a SCORM project, submits the request, displays Server-Sent Event progress, and renders the returned build and QA findings. The build card provides the download endpoint when the QA gate passes.

## Build preview

Ready builds offer **Preview** beside **Download**. The panel keeps the selected build and version until it closes or another build is selected. Restart and retry replace the player and create a fresh simulated Student attempt. Closing restores focus to the opening button, or the build panel heading if that button has been removed.

With the real back end, previews come from its preview origin, `http://preview.localhost:3000`, which `.env.development` sets as `VITE_PREVIEW_ORIGIN`. If the back end runs on another `PORT`, set `VITE_PREVIEW_ORIGIN=http://preview.localhost:<PORT>` in `.env.development.local`. In stub mode, `npm run stub` also starts a preview server at `http://127.0.0.1:3002`, and `.env.stub` points `VITE_PREVIEW_ORIGIN` there. The player installs the kit's unchanged `d2l-emulator.js` with `tenant-profile.json` before loading the activity in its child frame. The app accepts status messages only from its active frame, preview origin, build ID, and attempt ID. A 20-second startup timeout offers retry when the service cannot respond.

The stub uses the saved starter fixture in `stub/fixtures/preview/` for all ready builds and serves its matching `preview.zip` for download. The activity includes an external stylesheet to exercise relative asset loading. Regenerate both from the kit starter with `python stub/create-preview-fixture.py`; commit the directory and ZIP together. Preview interactions never modify these files or the build's QA result. This fixture does not represent generated instructor content.

### Backend integration contract

The back end's preview origin serves the player (`back-end/preview/`), the kit's emulator, and the files of ready builds, with the routes and checks in [`docs/architecture.md`](../docs/architecture.md#preview-origin). F4 (#82) supplies event and build state through useProjectEvents. Preview selection remains independent, so a newer build does not replace an open preview.

The stub is a local fixture server with an explicit file allowlist; it reads the same player files from `back-end/preview/`. Allow framing only by the configured app origin and the preview origin; keep the player and activity on the same preview origin for SCORM API access. The application refuses its own origin as a preview origin. Do not proxy the player through the app origin.

The wrapper reports `{ type: 'cdk-preview', buildId, attempt, status: 'ready' | 'error', reason?: 'unavailable' | 'launch' }` with `postMessage` to the exact `parentOrigin` supplied by the app. Configure and validate that allowed parent origin in the service. No scores or learner data are sent to the app or Brightspace.

Run `npm test` for the focused component tests and `npm run test:e2e` for the starter interaction, asset loading, restart, selected-version stability, focus restoration, origin isolation, unchanged download/QA, and retry checks in Chromium and Firefox. The Playwright specs run against the stub.
