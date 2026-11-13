# back-end/src/routes

One file per resource defined in [`../../../docs/architecture.md`](../../../docs/architecture.md)'s HTTP API. A route parses and validates input, calls one service, and shapes the response:

- `me.ts` and `health.ts`: identity and liveness.
- `agent.ts`: start the agent's sign-in.
- `projects.ts`: create a project and read its state.
- `messages.ts`: accept an instructor message and start its turn.
- `turns.ts`: cancel a turn.
- `builds.ts`: read a build and download it as a zip.
- `events.ts`: a project's event stream over Server-Sent Events.
