# Architecture (draft)

## The split

- **Front end** — a local browser interface. A small local server serves a configuration page and a preview that mirrors D2L's own content restrictions. Owns: configurator UI, starter-template selection, preview rendering, and displaying the plain-language build status, accessibility findings, and TILT/UDL flags the back end returns. Does not run those checks itself.
- **Back end** — takes a build configuration from the front end and drives the AI agent (Claude now, Copilot in a later phase — a config choice, see `back-end/config/`) to generate content via `back-end/kit/`'s skill guides. Owns: the orchestration API, the QA gate (`back-end/kit/harness/`), the automated TILT/UDL check, D2L deployment and verification, and the translation layer that turns kit findings into instructor-facing language.

## The contract between them (draft — team fills in during Module 2)

```
POST /api/builds                     submit a build config (content type, source material, TILT/UDL on/off, target course)
GET  /api/builds/:id/stream          live build status (SSE/WebSocket) — "Generating…" → "Checking accessibility…" → "Checking TILT/UDL…" → "Ready to review"
GET  /api/builds/:id/preview         the rendered result, served under D2L-equivalent restrictions
```

This file is the thing the front-end and back-end tracks actually agree on before building in parallel — keeping it accurate is more important than keeping it complete on day one.
