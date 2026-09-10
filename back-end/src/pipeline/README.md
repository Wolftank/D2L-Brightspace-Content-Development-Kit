# back-end/src/pipeline

The main orchestration flow for one build: calls `agent/` to generate content, calls `../kit/harness/` to run the QA gate, calls `tilt-udl/` for the pedagogical check, then hands off to `deploy/`. Emits the progress events the front end displays on its stream. Empty stub; not built yet.
