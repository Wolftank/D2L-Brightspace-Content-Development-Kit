# back-end/src/routes

One file per resource defined in [`../../../docs/architecture.md`](../../../docs/architecture.md)'s HTTP API. A route parses and validates input, calls one service, and shapes the response:

- `me.ts` and `health.ts`: identity and liveness.
- `projects.ts`: create a project and read its state.
- `builds.ts`: read a build and download it as a zip.
- `events.ts`: a project's event stream over Server-Sent Events.
