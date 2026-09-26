# back-end/src/pipeline

The components that run turns, specified in [`../../../docs/architecture.md`](../../../docs/architecture.md):

- `events.ts`: the event service. It stores each event, then pushes it to the project's live event-stream subscribers.
- `sessions.ts`: the session service. It opens a session in a project's workspace through the driver, keeps it open between turns, saves the agent's session id on the Project, and closes it after 15 idle minutes.
- The runner, which executes one turn at a time per project: it acquires a session, sends the instructor's message, writes each driver event through the event service, stores the agent's message, and creates a build at turn end if the turn changed the output.

The QA gate, the pedagogy check, and deployment proposals are tools the agent calls during a turn, not steps here.
