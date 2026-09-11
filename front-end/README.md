# Frontend configurator — Sprint 1

A local Node server and a plain HTML/CSS/JavaScript configurator. No dependencies or backend are needed.

## Run

With Node.js 20 or newer installed, open a terminal in `front-end`:

```sh
npm start
```

Open http://127.0.0.1:3000. Set `PORT` to use a different port. Stop with Ctrl+C.

```sh
npm test
```

The tests use Node's built-in runner and check static asset serving, missing routes, method handling, and source-file isolation. CI continues to use `npm test`; it does not start a long-running development server.

## Sprint demo

1. Click **Use example** to populate course, title, and source notes.
2. Select a content type and TILT/UDL preferences.
3. Click **Preview sample** to render the entered notes and requested structure.
4. Change an option and update the preview. Try submitting empty or whitespace-only required fields.
5. Click **Reset** to return to the empty configurator.

The preview is a static layout built from the user's text, not generated material, a SCORM export, or a D2L emulator. No authentication, AI requests, accessibility checks, TILT/UDL evaluation, or deployment runs. Inputs exist only in page memory and disappear on refresh. There is no browser storage or backend request. User-entered text is rendered with `textContent`.

## Working together

- `src/public/index.html` and `styles.css`: form structure, responsive layout, labels, and visual design.
- `src/public/app.js`: validation, example/reset behavior, sample rendering, and configuration collection.
- `src/server.js`: loopback-only static server, using an explicit public route list.
- `test/server.test.js`: server regression checks.

A practical two-person split is UI/layout and browser behavior/integration. Agree on form field names before editing the same controls.

## Backend handoff

`readConfiguration()` collects a **frontend-only draft model**: `contentType`, `targetCourse`, `title`, `sourceMaterial`, `tiltEnabled`, and `udlEnabled`. These names are not a new API contract. Keep the team's draft in `../docs/architecture.md` authoritative.

In a later sprint, agree on the request/response schema together, then replace the sample submit behavior with `POST /api/builds`, display progress from `GET /api/builds/:id/stream`, and load the backend preview from `GET /api/builds/:id/preview`. Decide the backend origin/proxy and preview isolation policy during integration. Quality checks and plain-language results remain backend responsibilities. Agent selection stays in backend configuration.
