---
name: d2l-tenant-qa
description: >-
  Use this skill to check a D2L build against what our tenant actually does,
  BEFORE deploying it. Runs the static lint and the SCORM run-time emulator and
  interprets the findings. Reach for it whenever someone is about to upload
  something to D2L, asks whether a build is ready, asks why a D2L activity is
  behaving strangely, or says a D2L activity "worked locally". Also use it after
  changing the tenant profile, and after running the probes, to keep the
  measured findings and the enforced rules in step. Every rule it enforces
  traces to a measured tenant behaviour, and every one of them fails SILENTLY in
  D2L, which is why running this is worth more than reading the code.
---

# D2L Tenant QA

The gate a build passes before it goes near D2L. Deliberately **at least as
strict as the tenant**, so a build that passes here works when deployed.

---

## Run it

```bash
node harness/lint/lint.js <build-folder> --avenue scorm|topic|widget|external
```

Exit code 0 with no errors, 1 otherwise, so it can gate a pipeline. Add `--json`
for machine-readable output.

```bash
node harness/emulator.test.js      # run-time emulator, 38 assertions
node harness/lint/lint.test.js     # lint rules, 33 assertions
```

**Zero errors to deploy.** Warnings are advisory but each one is a real
behaviour, not style.

---

## Reading the output

Findings are grouped by rule, and every rule prints a **why** quoting what we
observed on the tenant. That is the point: the goal is for someone to learn the
constraint, not just silence the check.

### The header matters too

The lint opens by listing every constraint in `tenant-profile.json` that is
still marked `verified: false`. Those are **conservative guesses**, not
measurements. A rule leaning on one is doing its best, not stating fact.

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
| `widget/unscoped-css` | A bare selector restyles D2L's chrome and every other widget. A widget is not iframed. |
| `widget/global-scope-leak` | A top-level declaration collides with the next widget that picks the same name. |

### The avenues are not the same rule set

`--avenue` is not cosmetic. The clearest example: **viewport units are an error
for a content topic and perfectly fine for a widget**, because a topic is
iframed and auto-resizes while a widget renders directly in the page.

Running the wrong avenue therefore both misses real problems and invents fake
ones. The lint asserts this difference in its own tests.

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
2. **The tenant changed.** Re-run the probes in `probes/` and update
   `harness/tenant-profile.json`. The static-script-tag behaviour has already
   differed between two courses on this tenant.
3. **The topic was renamed or opened in D2L's HTML editor.** Both re-serialize
   the page and silently corrupt inline JS and SVG. Not recoverable; redeploy.
4. **A behaviour we have not measured.** Add a probe rather than guessing, then
   add the rule so nobody hits it twice.

---

## Keeping the profile honest

`harness/tenant-profile.json` is the single source of truth for what the tenant
allows. Rules read their thresholds from it.

When you learn something new about the tenant:

1. Record it in `probes/RESULTS.md` with how it was measured.
2. Update the profile entry and set `verified: true`.
3. Add or adjust a lint rule if the finding is something a build can get wrong.
4. Add an assertion to the relevant test suite.

A finding that is not in the profile will be rediscovered by the next person.
