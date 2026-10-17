---
name: d2l-tenant-qa
description: >-
  Use this skill to check a D2L build against what our tenant actually does,
  BEFORE deploying it. Runs the QA gate through CDK's check_output tool and
  interprets the findings. Reach for it whenever someone is about to upload
  something to D2L, asks whether a build is ready, asks why a D2L activity is
  behaving strangely, or says a D2L activity "worked locally". Every rule it
  enforces traces to a measured tenant behaviour, and every one of them fails
  SILENTLY in D2L, which is why running this is worth more than reading the
  code.
---

# D2L Tenant QA

The gate a build passes before it goes near D2L. Deliberately **at least as
strict as the tenant**, so a build that passes here works when deployed.

---

## Run it

Call the `mcp__cdk__check_output` tool. It runs the gate on `out/` as it is
now, against the rules for the project's avenue, and returns `passed` and the
findings. Each finding names its rule, severity, file, line, and message, and
explains why the rule exists. It records nothing: CDK builds and checks `out/`
again after your turn.

**Zero errors to deploy.** Warnings are advisory but each one is a real
behaviour, not style.

---

## Reading the output

Findings are grouped by rule, and every rule prints a **why** quoting what we
observed on the tenant. That is the point: the goal is for someone to learn the
constraint, not just silence the check.

### Unverified constraints matter too

The tenant limits from `mcp__cdk__get_project` mark each constraint with a
`verified` flag. Those still marked `verified: false` are **conservative
guesses**, not measurements. A rule leaning on one is doing its best, not
stating fact.

This exists because assuming an unverified behaviour is exactly how this project
started: a widget that read gradebook data was described as a SCORM object, and
a whole architecture was nearly built on it. If a finding depends on an
unverified value, verify it before trusting the finding.

---

## What the errors actually mean

Each of these was a real failure we hit or measured. None of them announce
themselves in D2L.

| Rule | What happens if you ship it |
|---|---|
| `scorm/no-terminate-on-load` | The player replaces your activity with "This activity is complete." Learner sees nothing. |
| `scorm/no-completed-on-load` | Every launch after the first is read-only. Best-of-N silently stops working. |
| `scorm/no-api-calls` | The call fails. A package is cross-origin and sealed off from D2L. |
| `scorm/suspend-data-cap` | Saved state is truncated or refused past 4096 characters. |
| `scorm/manifest` | D2L rejects the package with an unhelpful error, or gives it no run-time at all. |
| `topic/no-static-script-src` | Your data is `undefined` in some courses and fine in others. |
| `topic/unwrapped-storage` | Blank activity for any student in private mode or over quota. |
| `topic/no-storage-for-grades` | A record the institution relies on, kept somewhere the student can edit. |
| `shared/no-viewport-units` | Layout is wrong, because the iframe sizes to content. |
| `shared/missing-assets` | Silent 404 in D2L. |
| `shared/script-syntax` | The whole script stops, so the activity never loads its content or reports a score. |
| `shared/text-encoding` | Characters that are not valid UTF-8 show as garbage. |
| `a11y/alt` | A screen reader user gets nothing, or a file name, for the image. |
| `a11y/lang` | A screen reader reads the page in the wrong language. |
| `widget/unscoped-css` | A bare selector restyles D2L's chrome and every other widget. A widget is not iframed. |
| `widget/global-scope-leak` | A top-level declaration collides with the next widget that picks the same name. |

### The avenues are not the same rule set

The gate checks each build against its own avenue's rules. The clearest
example: **viewport units are an error for a content topic and perfectly fine
for a widget**, because a topic is iframed and auto-resizes while a widget
renders directly in the page.

Warnings worth taking seriously:

- `scorm/storage-key-learner-id` — package storage is per **browser**, not per
  user. Two students on a lab machine share it, and so does every other SCORM
  package at SCSU.
- `scorm/credit-guard` — without a `no-credit` check the activity cannot tell it
  is in preview or review, where writes are discarded and the error code still
  reads 0.
- `scorm/root-height` — the embedded player will not scroll a tall child.

---

## When the lint passes but D2L still misbehaves

Static analysis cannot catch everything. In order of likelihood:

1. **You tested it yourself as an instructor.** For SCORM that proves nothing:
   preview discards every write. Have someone enrolled as a student open it. Note
   that a TA is only useful here if their enrolment is a student one — anyone with
   instructor-level permissions in the course gets the same inert preview.
2. **The tenant changed.** The static-script-tag behaviour has already
   differed between two courses on this tenant. Tell the instructor, so the
   probes can be re-run and the tenant profile updated.
3. **The topic was renamed or opened in D2L's HTML editor.** Both re-serialize
   the page and silently corrupt inline JS and SVG. Not recoverable; redeploy.
4. **A data-contract naming mismatch between an authoring script and the
   consuming page.** A known blind spot: the lint only checks *how* a script
   is loaded (`topic/no-static-script-src` and friends), never *what global it
   sets* versus what the page reads. A generator that writes
   `window.MY_PROJECT_DATA` while `init()` reads `window.MY_PROJ_DATA` passes
   the gate clean — the script tag itself loaded fine and fired `onload`, the
   lint has no way to see the name drift. **After the gate passes, read both
   files and confirm the page reads the same global the script sets** — a clean
   lint result proves the loading mechanism is sound, not that the data arrived
   under the name the page expects.
5. **A behaviour we have not measured.** Say so plainly rather than guessing,
   so a probe and a rule can be added and nobody hits it twice.
