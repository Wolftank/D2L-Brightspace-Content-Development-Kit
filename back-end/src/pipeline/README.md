# back-end/src/pipeline

The components that run turns, specified in [`../../../docs/architecture.md`](../../../docs/architecture.md):

- `events.ts`: the event service. It stores each event, then pushes it to the project's live event-stream subscribers.
- `sessions.ts`: the session service. It opens a session in a project's workspace through the driver, keeps it open between turns, saves the agent's session id on the Project, and closes it after 15 idle minutes.
- `runner.ts`: the runner. It runs one queued turn: it acquires the project's session, sends the instructor's message, writes each driver event through the event service, hands the session back, stores the agent's message, builds the output when it differs from the latest build (or from the turn's start, before the first build), and ends the turn with exactly one final status and event. At startup, `failInterrupted` fails every turn left queued or running.

The QA gate runs in every build, which the runner makes at turn end; during a turn the agent checks its work with the `check_output` tool, which records nothing. The pedagogy check and deployment proposals will be tools the agent calls during a turn, not steps here.
