# D2L Brightspace Content Development Kit

Lets any SCSU instructor, technical or not, direct an agent to build, test, and deploy interactive, WCAG 2.2–conformant D2L course content — without ever interacting with the agent directly.

For the full proposal, see [`docs/Capstone_Project_Proposal.pdf`](docs/Capstone_Project_Proposal.pdf) — the finished, team-submitted proposal. Earlier drafts and working/handoff notes are intentionally not carried over here; this repo starts fresh from the finished document.

## Layout

| Path | Purpose |
|---|---|
| [`docs/`](docs/) | The finished project proposal, plus the contract the tracks build against (`architecture.md`), the first slice to build (`v1.md`), and what was verified about each agent (`drivers.md`) |
| [`back-end/kit/`](back-end/kit/) | The actual D2L Content Development Kit — skills, harness/lint gate, probes, kit-level docs. Hardened and extended in place; not a frozen reference copy |
| [`back-end/src/`](back-end/src/) | The back end — runs turns with the agent, runs the QA gate and the pedagogy check, creates builds, deploys to D2L, translates findings to plain language |
| [`back-end/config/`](back-end/config/) | Mode (local / hosted) and agent (Claude / Copilot) as configuration, not hard-coded branches |
| [`front-end/`](front-end/) | Local server + browser app: chat, configurator, build panel, preview. Displays the turn status, QA gate findings, and pedagogy check findings the back end produces — does not run those checks itself |
| [`.github/`](.github/) | Issue/PR templates, CI workflow |

## Why front-end and back-end are separate top-level folders

So those tracks can work in parallel without touching each other's files, coordinating only through the documented contract in [`docs/architecture.md`](docs/architecture.md). Role split across the 7-person team is a front-end/back-end/QA mix, not a fixed head-count per track.
