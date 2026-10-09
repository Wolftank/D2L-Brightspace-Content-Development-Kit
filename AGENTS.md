# AGENTS.md

* All code should be self documenting. Inline code comments should only be used when the code requires the extra context to be understood. Use google docstring style comments for important methods/classes. Comments should be concise and describe only what the class/method does. Comments should never describe what something doesn't do or refer to previous states of the code.
* Use consistent terminology. Do not call the same concept/thing by multiple names.
* Do not preserve backward compatibility. Remove obsolete paths instead of
adding compatibility layers, fallbacks, or migrations.
* Choose the simplest implementation that fully meets the current
requirements. Avoid speculative abstractions, configuration, and
indirection.
* Grow the system in layers. Start from the smallest version that works end
to end, and add each new capability on top of a product that already
works. Never trade a working product for unfinished complexity.
* Keep components modular and concerns clearly separated.
* Prefer established, well-maintained libraries when they reduce overall
complexity or improve reliability. Do not reimplement common
functionality without a clear reason.
* Lean on the dependencies already in the project before writing your own
implementation or adding packages. Do not assume a library lacks a
capability without checking its documentation and types.
* Make architectural decisions for the long term. Do not accept a stopgap
that only works for now and is meant to be replaced later.

## Back-end test conventions

Tests in `back-end/src/` use three file suffixes:

| Suffix | Layer | What it may use |
|---|---|---|
| `*.test.ts` | Unit | Pure logic only. No disk, database (`testDb()`), network (`supertest`, `http`), child processes, or real timers. `vi.mock()`/`vi.fn()` stubs and `vi.useFakeTimers()` are fine. |
| `*.int.test.ts` | Integration | Everything that doesn't call a real agent — `testDb()`, `supertest`, temp directories, child processes. |
| `*.live.test.ts` | Live | Makes real, billed agent calls. Never runs unless explicitly asked for. |

A unit test file that imports a banned module (`node:fs`, `better-sqlite3`,
`supertest`, `node:child_process`, etc.) fails lint with a message pointing
to the `.int.test.ts` suffix.

