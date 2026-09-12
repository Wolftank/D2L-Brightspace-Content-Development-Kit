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

