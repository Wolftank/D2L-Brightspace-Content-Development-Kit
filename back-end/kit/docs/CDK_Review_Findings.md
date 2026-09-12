# D2L Content Development Kit — experience notes

Running notes from actually using the kit (not just reading it) across seven
real D2L builds (interactive campus map: initial deploy + one content
update; hospital quality dashboard: initial deploy; hydrogen atom / Bohr
model explorer: initial deploy + one content update, adding a second
interactive Bohr-model/electron-cloud atom visualization alongside the
original energy-level explorer; kinematics practice problem set: initial
SCORM deploy — the kit's first SCORM-avenue build in this project; literary
movements timeline: initial deploy, a single-file content topic with zero
deviation from the documented flow; Crambin 3D protein viewer: built,
lint-passed, and deployed — the kit's first WebGL/three.js-based build,
and the build that surfaced the shared-content-root filename collision in
finding #15) in the "Mark Gill - DEV" sandbox. Kept
per instruction: whenever the kit gets used,
log what the experience was like and what it needs to do differently — same
"bring findings back" philosophy the kit itself asks for (`Resources.html`,
"Getting help"). This was originally a pure holding pen with nothing applied
yet; as of 2026-09-10, findings #1, #4, and half of #13 have real fixes
applied; as of this pass, #2, #6, #7, #8, #9, #10, #11, #13a, #14, and #15 do
too — see the status table immediately below, or "Suggested next steps"
at the bottom for the same information in prose, finding by finding.

## Status at a glance (updated after the `3-4-5-findings-fixes` pass)

14 of 17 findings are fully closed or need no action. Of the 3 still open,
**#3 is worth prioritizing** — it's cheap to check and the back end's whole
agent-dispatch design assumes it works. **#16 stays deliberately deferred**
until the real front end/back end exists to rewrite the faculty module
against. **#17 needs a decision from Ben**, not code.

| # | Finding | Status | Remaining work |
|---|---|---|---|
| 1 | References folder packaging gap | **Closed** | None |
| 2 | Multi-file upload creates one topic per file | **Closed** | None |
| 3 | Primary skill-discovery path never actually tested | Open | **Small effort, real stakes** — run `cd D2L_Code && claude` fresh, confirm skills auto-load. Requires a genuinely fresh cold start; could not be verified from inside a running session |
| 4 | Two doc inconsistencies | **Closed** | None |
| 5 | Confirm-File-Replace trap confirmed real | No fix needed | Informational; its one correction is already applied via #13 |
| 6 | Router doesn't detect pre-built server apps (Streamlit case) | **Closed** | None |
| 7 | Invisible click-target overlap (pattern warning) | **Closed** | None |
| 8 | Bidirectional interaction needs both directions tested | **Closed** | None |
| 9 | `javascript_tool` needs top-level `await` | **Closed** | None |
| 10 | Zero-sibling builds + content-vs-chrome colors | **Closed** | None |
| 11 | SCORM emulator can't model preview/review | **Closed** | None — `D2LEmulator.install()` now takes `opts.credit`/`opts.mode`, defaulting from `learner.role`; `harness/emulator-harness.html` added |
| 12 | Confirming data point | No fix needed | Explicitly nothing to fold in |
| 13a | New animation-loop race-condition bug | **Closed** | None |
| 13b | Correction to #5's DOM-read guidance | **Closed** | None |
| 14 | Lint gate can't catch data-contract naming mismatches | **Closed** | None |
| 15 | Filename collision across builds sharing a content root | **Closed** | None — new lint rule `topic/generic-sibling-filename` added |
| 16 | Faculty module teaches pre-front-end workflow | Open, deliberately deferred | Not sprint-ready — blocked on the real front end/back end existing |
| 17 | Two zips can't be rebuilt | Open | Not code work — needs a decision on whether the sources exist elsewhere |

## Summary — what needs to change

1. The repo-local `skills/d2l-activity-deployer/` is missing its own
   `references/` subfolder — a packaging gap, not a documentation gap.
2. Dropping multiple sibling files into the Lessons drop zone creates one
   topic per file, not one topic with hidden assets — undocumented anywhere.
3. The kit's primary documented setup (`cd D2L_Code && claude`, relying on
   project-root skill auto-discovery) was never actually exercised — every
   session in this project worked from a parent directory instead, so that
   path is technically unverified even though the kit presents it as *the*
   installation method.
4. Two small doc inconsistencies (skill count in Resources.html; D2L's UI
   labels have drifted since Deploy.html's screenshots/instructions were
   written).
5. What worked exactly as documented, worth confirming rather than just
   flagging problems: the Confirm-File-Replace checkbox trap is real and was
   reproduced live: a screenshot showed checkmarks that a DOM read proved
   weren't actually set. The skill's warning to verify by DOM, not by looking,
   is not paranoia — it's necessary. The "replace files, not topics" update
   route also worked cleanly on the first try.
6. Real router gap: `d2l-experience-router`'s eight questions never ask what
   the thing being brought in *already is*. A pre-built server-rendered app
   (Streamlit, Flask, anything with a backend) can answer every question "no"
   and route cleanly to a content topic — right up until someone tries to
   actually build it and discovers the origin model doesn't fit at all. This
   surfaced on a real user request, not a hypothetical.
7. Two self-authored bugs on the hydrogen-atom build are worth recording as
   *pattern* warnings for anyone building a similarly "compressed diagram"
   interactive: (a) an invisible click-target sized and positioned to match a
   crowded visual layout will overlap its neighbors even when the labels
   themselves have been correctly destaggered; (b) a directional
   absorption/emission (or any up/down, in/out) interaction needs both
   directions exercised in testing, not just one — a ternary got the "away"
   direction backwards and it rendered fine, just wrong.
8. A real tooling gotcha in the Claude-in-Chrome `javascript_tool`: calling
   an async function without `await`ing it returns a pending Promise as the
   "last expression," which silently serializes to `{}` — indistinguishable
   from "ran and returned nothing." The side effect (e.g. a dispatched click)
   still happens; only the reported result is lost. Top-level `await` on the
   final expression is required, not `asyncFn(); asyncFn()` or `run()` without
   `await run()`.
9. Confirms Finding #2's workaround from the other direction: a build with
   **zero sibling files** (fully self-contained inline SVG/JS, no `data.js`,
   no CSV) sidesteps the multi-topic problem entirely — one file in, one
   topic out, no cleanup step at all. Worth stating explicitly as the
   cleanest case, not just "avoidable with effort."
10. The SCSU brand palette in `_design-tokens.md` was, for the first time,
    applied to a build *after* the fact (rebrand pass, not built-in from the
    start) and it dropped in cleanly. Worth codifying the one judgment call
    that came up: some colors in an activity are *content*, not chrome (e.g.
    a computed wavelength's real visible color, or an accurate spectrum
    gradient), and those must not be overwritten with brand colors just
    because a rebrand pass is underway — see Finding #10 below for where to
    draw that line.
11. First SCORM-avenue build in this project. `d2l-experience-router` and
    `d2l-scorm-package`'s starter pattern (SCORM plumbing, credit-guard,
    defer-completion, suspend_data budgeting) worked exactly as documented
    with zero deviation needed. But the runtime emulator (`d2l-emulator.js`)
    has two real gaps: (a) there's no documented way to actually run it
    against a real build's HTML — only against hand-written test scenarios —
    so a genuine per-build check required building a throwaway iframe harness
    from scratch; (b) `D2LEmulator.install()` hardcodes `cmi.core.credit` to
    `'credit'` regardless of the `learner.role` passed in, so it **cannot
    reproduce the single most important documented tenant behavior**
    (instructor preview / post-completion review forcing `no-credit` and
    silently discarding every write). Also new: the SCORM Bulk Upload dialog's
    file input lives behind a previously-undocumented shadow-DOM chain
    (`d2l-content-selector` → `d2l-drop-uploader` → `input[type=file]`),
    distinct from both the Lessons-drop-zone and Manage-Files inputs the
    deployer skill already documents. See Finding #11 below for all of it.

12. A clean, boring confirmation run: a single-file literary-movements-timeline
    content topic went through `d2l-experience-router` →
    `d2l-content-topic` → `d2l-tenant-qa` → `d2l-activity-deployer` with zero
    deviation anywhere — worth recording precisely because nothing broke.
    Confirms Finding #10's "zero-sibling builds sidestep Finding #2 entirely"
    from a third independent build, and confirms Finding #9's fix (using a
    top-level `await` on the actual upload expression, not a bare
    fire-and-forget async call) prevents the silent-`{}` result it warned
    about.
13. Adding a second, richer visualization to the hydrogen-atom build (a
    Bohr-model orbit view plus a real electron-cloud view, sharing the same
    click-driven n) surfaced one more self-authored pattern bug — two
    independently-timed animation loops racing on a shared mutable variable
    — and, on the redeploy, a correction to Finding #5's checkbox guidance:
    **verifying the Confirm-File-Replace checkbox by DOM read is not
    actually safe either**, contrary to what was written there. A real
    coordinate click registered correctly (confirmed by the only ground
    truth that matters: the file was replaced in place, no `(1)` duplicate)
    even though a DOM read immediately after showed the checkbox as
    unchecked. The component's visible state apparently isn't backed by a
    plain native `checked` attribute at all. See Finding #13 below.

(Findings 14 and 15 — the WebGL data-contract naming bug and the
shared-content-root filename collision — were appended below but never rolled
up into this list at the time; see them directly in the detail sections.)

16. The faculty module's "Build Locally" (and parts of 02/03/05) teaches
    instructors to talk to Claude directly — the exact workflow this
    capstone's front end/back end are being built to remove. Needs a real
    rewrite once that UI exists, not a wording touch-up. See Finding #16.
17. Two of the faculty module's three downloadable zips (design system,
    synthetic students) can't currently be rebuilt — their scripts and source
    material aren't present anywhere on this machine. Confirmed absent as of
    2026-09-08; don't re-search without checking with Ben first. See Finding #17.

Detail on each below.

---

## 1. Packaging gap: `d2l-activity-deployer`'s `references/` folder ships empty

`skills/d2l-activity-deployer/SKILL.md` explicitly references two files —
`references/mcp-upload.md` and `references/verify-and-troubleshoot.md` — for
the shadow-DOM upload mechanics and the nested-frame verification traversal.
**Neither file exists in the kit as unzipped.** The folder isn't even present.

This was only survivable because an *older*, separately-installed global copy
of the deployer skill (predating this kit, at `~/.claude/skills/`) happened to
still have both files with equivalent content, and they got manually merged
back in when installing the kit's skills globally. Anyone starting fresh from
just the kit zip — which is the documented, intended path — would hit a
SKILL.md that promises detail it cannot deliver, with no fallback.

**Suggested fix:** actually package `references/mcp-upload.md` and
`references/verify-and-troubleshoot.md` inside
`skills/d2l-activity-deployer/references/` in the shipped zip. Content for
both already exists (recovered copies used in this project); worth diffing
against the SKILL.md's current expectations before just re-adding verbatim,
since the SKILL.md may have evolved since those reference files were last
in sync with it.

---

## 2. Real gap: multi-file drop-zone upload creates one topic PER FILE

Not documented anywhere in `builds/cdk/05 Deploy.html`, the `d2l-tenant-qa`
skill, or `d2l-activity-deployer`.

**What Deploy.html currently says** (accurate as far as it goes):
> A content topic goes in through the Lessons drop zone, which uploads the
> file and creates the topic in one move: Content → a unit → Add Existing →
> drop the file.

**What actually happens with more than one file at once:** dropping several
files together (e.g. an `index.html` plus sibling `data.js` and `map.svg`,
which the file input accepts — `multiple=true`) does upload all of them to
the *same* Manage Files folder correctly (so relative `fetch()`/script-src
sibling references resolve fine), but D2L also creates **one visible topic
entry per file**, not one topic with hidden asset files. Uploading 3 files
produced 3 topic entries in the unit's content list, titled "Interactive
Campus Map", "data", and "map" respectively.

**The fix, verified safe on this tenant:** select each unwanted extra topic →
"···" (More Actions) → **Delete** → a dialog offers two options, defaulting
to **"Remove the topic from Content but keep the associated file or activity
in the course"** (vs. "Permanently delete both... from the course"). The
default/first option is correct here — it deletes only the content-list
entry; the underlying file stays in Manage Files, which the real topic's
sibling-file fetches still depend on. Confirmed by re-checking
`window.<ACTIVITY>_READY` and a real click after deleting both extras.

**Two ways to avoid the extra-topic churn entirely, worth adding as guidance:**
1. Upload only the `.html` file through the Lessons drop zone first (creates
   just the one topic), then push the sibling assets (`data.js`, `map.svg`,
   etc.) separately through **Manage Files** directly into that topic's
   content-root folder. This is also the kit's own documented route for
   *updating* files later, so it's one workflow to teach instead of two.
2. Accept the extra-topic cleanup as a routine last step of any multi-file
   deploy (2 quick "keep the file" deletes).

---

## 3. Untested: the kit's own primary setup path (project-root skill discovery)

`builds/cdk/03 Install the Skills.html` presents **two** installation routes:
- Primary: unzip the kit, `cd D2L_Code`, run `claude` from there — "It will
  find the skills automatically, because they sit in the project it is
  working in."
- Alternative, for every-project availability: copy `skills/` into the global
  Claude config directory.

**Only the alternative route was ever actually used or verified in this
project.** Every session worked from a parent directory
(`C:\Users\benja\Documents\Internship\D2L`), two levels above
`D2L_Code/skills/`, so the primary route's core claim — that Claude Code
auto-discovers a plain `skills/` folder sitting at the root of whatever
directory it's launched from — was never put to the test here. The six
skills only became available by copying them into `~/.claude/skills/`
(global), which is real, is confirmed working (twice), but is explicitly
framed by the kit as the *secondary* option.

**Why this matters:** if the primary path doesn't actually work as described
(e.g. if Claude Code requires `.claude/skills/` specifically and a bare
`skills/` folder is never auto-registered regardless of cwd), that's the
*first thing* a brand-new user tries, per the kit's own instructions, and it
would silently fail to load any skill — indistinguishable from "the skills
just don't do anything," with no error to point at why.

**Suggested next step:** actually test `cd D2L_Code && claude` fresh (new
session, cwd rooted exactly at the kit folder, nothing pre-installed
globally) and confirm the six skills show up unprompted. If they don't, Step
3 needs rewriting around the global-install path as primary, not secondary.

---

## 4. Two small doc inconsistencies

**Skill count — fixed 2026-09-10.** `builds/cdk/03 Install the Skills.html`
correctly said **"six skills, one toolkit"**. `builds/cdk/Resources.html` had
a code sample that said:
```
skills/     five skills: router, two build paths, the gate, the deployer
```
That count was router(1) + two build paths(2) + gate(1) + deployer(1) = 5,
omitting `d2l-homepage-widget` even though it's one of the "build paths"
category and exists in the folder. Corrected to
`six skills: router, three build paths, the gate, the deployer`.

**D2L UI labels have drifted — already correct, checked 2026-09-10, no action
needed.** This finding originally said `05 Deploy.html`'s button label needed
updating from "Create New" to "Add Existing." Checked directly against the
shipped file: it already says "Add Existing" everywhere — zero instances of
"Create New" remain. Either this was fixed separately from this findings log,
or the finding described a state that was already stale by the time it was
written. Either way, nothing to do here.

---

## 5. What worked exactly as documented (worth confirming, not just flagging problems)

**The Confirm-File-Replace checkbox trap is real, and it bit on the first
try.** `d2l-activity-deployer`'s "Traps that make failure look like success"
section warns: its checkboxes are shadow-DOM components, clicking them by
coordinate can silently not register, and screenshots of the dialog are not
trustworthy for confirming state. Reproduced exactly: a coordinate click on
the select-all checkbox rendered visible checkmarks in a screenshot, but an
immediate DOM read showed `checked: false` on every row. The fix that
actually worked was calling `.click()` directly on the real `<input
type=checkbox>` elements (found via the shadow-DOM walk), then re-verifying
via a fresh DOM query before touching Overwrite. This is exactly what the
skill says to do — it's just worth recording that the warning isn't
theoretical caution, it happens on a normal, first-attempt run.

**The "replace files, not topics" update route worked cleanly.** For a
content-only update (new files, same topic, nothing new to create), using
Manage Files → Upload → Overwrite on the existing filenames left the topic
untouched (same title, same id) and picked up the new content immediately,
confirmed via `window.<ACTIVITY>_READY` and a real click test. No extra-topic
churn like the initial multi-file deploy — this is the right default to reach
for on any update, not just a fallback.

**Finding #2's avoidance strategy (option 1) held up on a second, unrelated
build.** For the hospital dashboard deploy, uploaded only the `.html` through
the Lessons drop zone (one topic, title correctly stripped of `.html`), then
pushed the sibling `hospitals.csv` separately through Manage Files at the
content root. Result: zero extra topics, zero `name(1).ext` duplicates (file
count went 32 → 33, exactly +1), and the live topic's own `fetch('hospitals.csv')`
resolved immediately. Worth promoting from "a way to avoid the cleanup step" to
"the default instruction," not just an alternative — see finding #2.

**The graceful-degrade-on-fetch-failure pattern from `d2l-content-topic`'s
architecture section earned its keep on the very first load.** The HTML topic
was live in D2L for a few minutes before its CSV sibling was uploaded, and
during that window the topic rendered a clear inline error
("Could not load hospital data (HTTP 404)...") instead of a blank page or a
console-only failure. That's the exact scenario the skill's "do not hang,
degrade" guidance is for — this is a live case of it mattering, not just a
theoretical good practice.

---

## 6. Router gap: pre-built server-rendered apps sail through the eight questions

None of `d2l-experience-router`'s eight questions ask what technology the
thing being integrated *already is*. A user asked to deploy an
"already-built, interactive, reads-a-CSV, three-switchable-views" dashboard to
D2L, framed entirely in terms of what it does (no role-awareness needed, no
grade, not ambient). Every one of the eight questions answers cleanly toward
**B. Content topic** — Q5/Q6 (role-aware/real course data) are both no, Q3/Q4
(grade/cross-device resume) are both no. Nothing in the router's question list
would have caught the actual problem: the thing that already existed was a
**Streamlit app** — a Python process rendering server-side over a websocket,
not a static frontend. A content topic requires a self-contained client-side
bundle; Streamlit is structurally incompatible with that, no matter how the
eight questions answer.

This wasn't caught by the router at all — it only surfaced because the
source code got read directly (`dashboard.py`, a `streamlit` import) and
because the project's own prior session log had already independently
discovered the same wall from a different angle (a true `<iframe>` embed of
the Streamlit Community Cloud deployment failed with an infinite redirect
loop, root-caused to Streamlit Cloud's third-party-cookie auth handshake).
Without either of those, the router's own logic would have sent someone
straight into building a content topic for something that cannot be one.

**Suggested fix:** add a ninth question, asked early, before the eight:
*"Is this being built from scratch, or is it an existing app/page someone
already built?"* — if existing, follow up with *"does it run its own server
(Flask, Streamlit, Django, Node, etc.), or is it just static HTML/JS/CSS?"* A
server-backed existing app is never a content-topic candidate as-is; the real
options become (a) external page / Weblink to wherever it's hosted, with the
role/grade limitations that implies, or (b) a from-scratch rebuild as a static
client-side app, scoped and estimated as its own decision — not something to
discover midway through following the router's B/C avenue guidance.

---

## 7. Pattern warning: an invisible click-target sized for a crowded layout will overlap its neighbors

Built on the hydrogen-atom explorer: an energy-level diagram where n=4, 5, 6
sit only 5–8px apart on screen (real physics — Bohr-model level spacing
shrinks as 1/n² and crowds together at high n). The visible *labels* for
those three levels were correctly destaggered onto evenly-spaced rows with
dashed leader lines back to their true positions — that part worked and
looked right immediately.

**The invisible click-target `<rect>` for each level was left anchored to
the true (crowded) line position, at its original size**, on the reasoning
that the hit area was a separate concern from the label. It wasn't: a hit
rect sized `±9px` around a true position that is itself only `~5-8px` from
its neighbor's true position overlaps that neighbor's hit rect by construction,
independent of anything happening to the labels. Clicking in the overlap zone
resolved to whichever level's `<g>` happened to be later in DOM order (z-order
= document order for overlapping siblings with no explicit stacking), which
in practice meant clicks on n=5 kept silently registering as n=6. This did
not throw, did not log anything, and the diagram *looked* completely correct
at every zoom level tested — it only surfaced because a follow-up
comprehensive test dispatched a click on every level and asserted the
resulting state, rather than eyeballing one or two transitions.

**The fix:** decouple the hit-rect's anchor from the true line position and
tie it to the same destaggered row the label already uses, sized so adjacent
rows (a fixed, deliberately-chosen spacing) cannot overlap — in this build,
12px-tall hit rects on 13px-spaced rows, confirmed by re-querying
`getBoundingClientRect()` on every level's hit rect and asserting no two
ranges intersect, not by looking at the rendered diagram.

**Generalizable takeaway for the kit:** whenever a build compresses a real
data-driven layout (physics energy levels here, but the same shape applies to
a crowded timeline, a log-scale axis, a dense scatter plot), destaggering the
*visible* element (label, tick, marker) is necessary but not sufficient —
audit every *invisible* hit-target that was sized for the pre-destagger
positions too. They are easy to forget because nothing about them is visible
in a screenshot.

---

## 8. Pattern warning: a bidirectional interaction needs both directions tested, not one

Same build: the transition arrow between two energy levels is drawn with
`marker-end` at the destination point, so `y1`/`y2` need to run
start→destination for the arrowhead to point the right way regardless of
direction. The first version instead branched on direction:

```js
arrowLine.setAttribute('y1', isAbsorption ? yFrom : yTo);
arrowLine.setAttribute('y2', isAbsorption ? yTo : yFrom);
```

For absorption this happens to be correct (`y1=yFrom, y2=yTo`, arrowhead at
destination, pointing the right way). For emission it silently reverses the
line (`y1=yTo, y2=yFrom`), so the arrowhead ends up at the *origin* instead —
the emission arrow pointed back toward where the electron came from, not
toward where it was going. This rendered without error, looked plausible in
a quick glance (there was *an* arrow, in roughly the right place, colored
correctly for "emission"), and was only caught by deliberately testing a
downward transition and checking the arrow's screen direction against the
known correct behavior, after the first tests had only exercised upward
transitions. The fix was to drop the direction-dependent branching entirely —
always `y1=yFrom, y2=yTo` — since the arrowhead's direction is already fully
determined by which endpoint is the destination.

**Generalizable takeaway:** any interaction with two distinct
directions/states (absorption vs. emission, expand vs. collapse, forward vs.
back) that reuses one code path with a ternary needs both branches exercised
in testing, ideally exercised *back to back on the same element* (as
happened here once the bug was found) so a visual regression is a direct
before/after comparison rather than two isolated one-off checks.

---

## 9. Tooling gotcha: `javascript_tool` async calls need a top-level `await`, not a bare call

Driving the D2L upload and post-deploy verification through
Claude-in-Chrome's `javascript_tool`, a script shaped like:

```js
async function run() { /* ...await fetch, await timeout, return {...} */ }
run();
```

reliably returned `{}` — not an error, not a rejection, just an empty object,
indistinguishable from "the function ran and had nothing to report." The
actual cause: `run()` returns a `Promise`, and that pending Promise *is* the
tool's "last expression," which gets serialized before it resolves. **The
side effects inside `run()` still happened** — a dispatched click really
landed, a `fetch` really completed — only the reported return value was
lost. This was caught by re-querying DOM state in a completely separate,
synchronous follow-up call and seeing that a click the previous call claimed
had done nothing had, in fact, already taken effect.

**The fix:** use a top-level `await` on the actual expression whose value you
want, e.g. `await run()` as the final line (or skip the wrapper function
entirely and write top-level `await fetch(...)` / `await new
Promise(...)` directly) — matching the tool's own description ("top-level
`await` works... write the expression you want... rather than `return
...`"), which is easy to skim past when porting a normal async/await pattern
from application code.

**Generalizable takeaway for the deployer skill:** the existing "Driving
uploads from automation" section already shows `await win.fetch(...)`
inline, unwrapped — which is the correct pattern — but doesn't call out
*why* that shape matters, or warn against the natural instinct to wrap
multi-step automation in a named async function for readability. Worth a
one-line callout there and in any future automation-heavy section, since
this failure mode gives no error and is easy to misattribute to the upload
itself having silently failed, rather than to the reporting step.

---

## 10. Confirms and extends: zero-sibling builds sidestep Finding #2 entirely; content colors vs. chrome colors

**Zero-sibling upload.** The hydrogen-atom explorer is a single
self-contained `.html` file — no `data.js`, no CSV, no companion asset of any
kind, everything computed inline. Dropped through the Lessons drop zone: one
file in, one topic out, zero extra topic entries, zero cleanup step. This is
the cleanest possible case of Finding #2 and worth stating plainly: **a
build with no sibling files never hits the multi-topic problem at all**,
which is one more reason (alongside Finding #2's "upload html first" advice)
to prefer self-contained single-file builds when the content genuinely
allows it, rather than defaulting to a `data.js` split out of habit.

**Content colors vs. chrome colors, discovered while rebranding.** Asked to
apply the SCSU Husky Course Kit palette (`_design-tokens.md`) to an
already-built activity, the rebrand pass recolored the header, cards,
buttons, section markers, and the absorption/emission process badges
(Deep/Cardinal — both genuinely from the palette, chosen so the two remained
distinguishable) — but deliberately left untouched the wavelength-to-color
mapping, the visible-spectrum rainbow gradient, and the UV/IR zone colors.
Those aren't decoration: a computed 486 nm photon *is* cyan, and forcing it
to render as Cardinal red to match the brand would make the activity teach
something false. The judgment call — "is this color telling the student a
fact, or is it telling the student which UI system they're in" — isn't
written down anywhere in `_design-tokens.md` or the `d2l-content-topic`
skill, and it's exactly the kind of thing a future rebrand pass on a
different data-driven build (a map's terrain colors, a chart's data-series
colors, a dashboard's status colors) will need to make correctly rather than
reflexively repainting everything in sight.

**Suggested addition to `_design-tokens.md`:** a short "what not to
rebrand" note — any color that encodes a fact about the content itself
(a measured value, a physical quantity, a status derived from data) stays as
authored; only the surrounding chrome (headers, cards, nav, buttons, generic
badges) takes the brand palette.

---

## 11. First SCORM build: the starter pattern held up perfectly, but the emulator has a real blind spot

Built a self-graded kinematics (projectile motion / free fall) problem set —
8 randomized numeric/MC problems, best-of-N via D2L's own Grade Calculation
Method (not custom code), gradebook write on submit. This was also the first
build in the project to go through `d2l-experience-router` and
`d2l-scorm-package` rather than `d2l-content-topic`.

**What worked exactly as documented, worth confirming:** the router's eight
questions correctly identified this as SCORM (Q3: score must reach the
gradebook on its own) with no B/C conflict (no role/identity need). The
starter's SCORM plumbing (parent-chain `API` walk, `G`/`S`/`C` wrappers,
`credit !== 'no-credit'` guard, deferring `lesson_status = 'completed'` to an
explicit action instead of on load, never calling `LMSFinish`) was copied
close to verbatim and needed zero deviation. `build-scorm.ps1` validated the
manifest and produced a correctly-rooted zip (`imsmanifest.xml` at the zip
root, confirmed via `unzip -l`) on the first run. The "Add Existing → SCORM/xAPI
Object → Bulk Upload" flow matched `d2l-activity-deployer`'s description
exactly, including the exact default answers the skill predicts (grade item:
Yes, Grade Calculation Method: Highest Attempt — this is where best-of-N
comes from, no code needed).

**One packaging note not in `build-scorm.ps1`'s docs:** `Join-Path` in
Windows PowerShell does not recognize an absolute path passed as
`-ChildPath` — it string-concatenates instead of replacing, so
`Join-Path "D2L_Code" "C:\Users\...\kinematics-practice"` produces garbage.
The script's `-Source`/`-Out` params need a path *relative to the script's
own folder* even when the actual build lives well outside the kit repo
(`..\..\kinematics-practice` worked correctly, resolving through the `..`
components at file-access time). Worth a one-line note in the script's
usage comment for anyone whose build folder isn't a repo subfolder.

**Real gap #1 — the emulator has no documented way to run against a real build.**
`d2l-scorm-package`'s SKILL.md shows `node harness/emulator.test.js` (38
assertions) as "the run-time emulator," but that file only exercises
hand-authored scenarios against the `D2LEmulator` library directly — there is
no CLI or runner that takes a build folder and drives its actual `index.html`
through the emulator, the way `lint.js --avenue scorm` takes a build folder
for the static check. Getting genuine build-specific runtime coverage meant
building a throwaway harness page: an emulator-hosting parent page that
installs `D2LEmulator` on `window`, then loads the real build in a plain
`<iframe>` — which works because the build's own API-discovery walk climbs
`w.parent` looking for `w.API`, exactly reproducing the tenant's measured
"API at parent depth 1" placement. Driving the real UI through a full attempt
this way caught real things a hand-written scenario wouldn't (actual
`suspend_data` size under real content — 3,571 of 4,096 chars — actual commit
count, confirmation the build never calls `Terminate`). **Worth turning into
a documented, reusable pattern** (a small `emulator-harness.html` template
next to `assets/starter/`) rather than something each build re-invents.

**Real gap #2 — the emulator cannot model preview/review at all.**
`D2LEmulator.install()`'s SCORM 1.2 model hardcodes
`'cmi.core.credit': { access: RO, value: 'credit' }` unconditionally; the
`learner.role` option only affects the separate Brightspace-API classlist/grades
emulation, never the SCORM data model. This means the emulator — whose whole
premise is "at least as strict as the tenant" — cannot reproduce
`instructorViewIsPreviewOnly` or `completedStatusLocksFurtherAttempts`, which
`tenant-profile.json` itself flags as **MEASURED AND DESIGN-CRITICAL** and
which the skill's own "Read this before you write a line" section leads with
as failure #1 and #2. A build's credit-guard can currently only be checked
statically (does the source contain the check) via the lint rule
`scorm/credit-guard`, never dynamically. That gap happened to get closed
anyway in this session by observing the real behavior live in D2L (the
instructor-preview banner correctly appeared, unprompted, on first open of
the real deployed package) — but that was extra verification done on top of
the QA gate, not something the gate itself could have caught if the banner
logic had been subtly wrong.

**Confirms a tenant-profile entry from a fresh angle, live in production:**
opening the freshly-deployed package as the (instructor) deploying account
showed the exact "Preview mode. Nothing you do here is recorded." banner this
build's own code produces when `credit === 'no-credit'` — real, unprompted,
independent confirmation of `instructorViewIsPreviewOnly` /
`previewRejectsAllWrites`, and separately, the grade item appeared correctly
auto-created and correctly named in the gradebook's Enter Grades view
immediately after the "Yes" default was accepted.

**New shadow-DOM path for the deployer skill's automation section:** the
SCORM Bulk Upload dialog's file input is not in either shadow-DOM chain the
skill currently documents (Lessons drop zone's `D2L-LABS-FILE-UPLOADER`, or
Manage Files' `input.d2l-fileinput-input`). It's
`iframe[name starting d2l_c_...] → d2l-content-selector (shadow) →
d2l-drop-uploader (shadow) → input[type=file]`. Confirmed working with the
same suppress-native-picker + `DataTransfer` + target-realm-`File` pattern
the skill already documents for the other two inputs — only the traversal
path differs.

---

## 13. Two more self-authored bugs adding a second visualization, plus a correction to Finding #5

Extending the hydrogen-atom explorer with a Bohr-model orbit view and a real
electron-cloud view (both driven by the same click-selected n) surfaced one
new pattern bug and one correction to earlier guidance in this document.

**New pattern warning: two independently-timed animation loops racing on a
shared mutable variable.** The existing energy-level ladder already animates
a 650ms electron slide via its own `requestAnimationFrame` loop. The new
Bohr-model orbit view added a *second*, completely independent
`requestAnimationFrame` loop (continuous orbiting needs its own clock; the
ladder's loop only exists for the duration of one transition). Both loops are
triggered by the same click and use the same 650ms duration, but each starts
its own timer from its own first animation-frame callback — which can differ
from the other loop's first callback by a frame or more. The atom loop's
transition-complete branch read the ladder's shared `currentN` variable to
decide which ring to highlight; on a real run, that branch fired fractionally
before the ladder's own callback had updated `currentN`, so the electron dot
correctly landed on the new ring while the ring highlight stayed stuck on the
previous one — permanently, since that highlight call only happens once, at
completion. It rendered fine for every simple case and only showed up under
repeated rapid clicking, exactly the kind of bug a single manual click-through
will not catch. **The fix:** never read a variable another independently-timed
loop owns; each loop should track its own copy of "what it has caught up to,"
updated only from its own transition's endpoint value, never from a sibling
loop's shared state. Generalizable to any build with more than one
animation/timer responding to the same event: check what each one reads at
completion, not just what it does during the animation.

**Correction to Finding #5: DOM-read verification of the Confirm-File-Replace
checkbox is not actually reliable.** Finding #5 (and the deployer skill
itself) says reading checkbox state via DOM is safe, only *writing* it via JS
silently fails. This session found a case where the read is unreliable too: a
real coordinate click (the documented-correct write method) on the row
checkbox was followed immediately by a DOM query showing `checked: false` on
every `input[type=checkbox]` reachable via a full shadow-root traversal — a
false negative, since the file was, in fact, correctly overwritten in place
(confirmed by size and timestamp changing on the same filename, no `(1)`
suffix appearing). A prior attempt in the same session, where the checkbox
was ticked via `element.click()` in JS exactly as Finding #5 warns against,
did produce the documented `(1)`-duplicate failure — so that half of Finding
#5 held up exactly as written. It was only the "verify by DOM read" half that
turned out not to hold: this particular checkbox's visible state does not
appear to be backed by a plain native `checked` attribute at all (possibly a
closed shadow root, or an internal state model the component simply doesn't
mirror onto the native input). **Practical fix, and the only verification
that actually matters regardless of what any DOM read claims:** after
clicking Overwrite, re-query the file listing for the target filename and
confirm size/timestamp changed *and* no sibling `(1).html` exists — that is
ground truth; nothing about the dialog's own DOM should be trusted either
way.

## 14. First heavier-engine build (three.js/WebGL): the vendor+injection pattern generalizes, but the lint gate cannot catch a same-origin data-contract mismatch

Building a 3D protein viewer (three.js + `OrbitControls`, a vendored
generated-data file, all local, no CDN) confirms the vendor-locally +
sequential-dynamic-injection pattern holds up for something heavier than the
canvas/SVG builds this log has covered so far: three chained dynamic
`<script>` loads (`three.min.js` → `OrbitControls.js`, which itself expects
`window.THREE` to already exist → `data.js`, which sets a data global → then
`init()`), each with its own `onerror` fallback, worked exactly as the
starter template models it, first try, zero deviation from the documented
pattern.

**Real self-authored bug the lint gate structurally cannot catch.** The
authoring script that generates the data file wrote
`window.SCSU_PROTEIN_DATA = {...}`, while the consuming HTML's `init()` read
`window.SCSU_PROT_DATA` — a one-word naming drift between the two ends of a
data contract that only exists across two separate files. `lint.js` passed
this build clean (`topic/no-static-script-src` and friends only check *how*
a script is loaded, not whether it sets what the consumer expects), because
the script tag itself was structurally correct: it loaded, returned 200, and
fired `onload`. The mismatch only surfaced by actually running the build —
`preview_start` against the folder, then reading `window.SCSU_PROT_DATA` back
in the console and finding it `undefined` even though the network tab showed
the file loaded fine. **This is a category of bug static analysis cannot see
at all**, since it requires executing the JS and checking the resulting
global, not just checking the loading mechanism.

**Confirms the verification-global step earns its keep beyond the D2L
deploy-check use case.** Once the name was fixed, `window.SCSU_PROT_READY`
plus reading back `window.SCSU_PROT_DATA.atoms.length` /
`.bonds.length` gave an immediate, unambiguous pass/fail — no screenshot
needed to know initialization genuinely completed with the right data, only
to confirm it *looked* right afterward.

## 15. Real gap: a generic sibling-asset filename collided with another build's file on a shared content root, one step from silent data corruption

Deploying the protein viewer (finding #14) surfaced a hazard that hasn't come
up in this log before, because every prior multi-file build in this project
happened to pick a distinct sibling filename by chance. This build's data
file was originally just `data.js` — the same name `campus-map`'s own sibling
data file uses. Every content-topic build in "Mark Gill - DEV" shares one
flat `/content/Gill-DEV/` folder (this is itself documented behavior, not new
— see finding #2 and the deployer skill's "Manage Files" section), so pushing
`data.js` through Manage Files surfaced the **Confirm File Replace** dialog
with an existing `data.js` already sitting there. Its size (20.97 KB) matched
`campus-map/data.js` exactly. **Had the select-all-and-overwrite habit from
finding #5/#13 been applied here without checking the file's size/date
first, this would have silently overwritten a live, working build's data
file with this build's unrelated molecule data** — no error, no warning,
just a working campus map quietly losing its building-click data on the next
load. Caught only because the existing file's size didn't match what was
expected to already be there, which is not something any lint rule checks
(the file doesn't exist locally in this build's own folder, so there is
nothing to lint against). Fixed by renaming to a build-specific name
(`crambin-protein-data.js`) and re-uploading clean.

**This is a distinct hazard from finding #2's "one topic per file" problem**:
that one is about *topic* creation being wrong; this one is about *asset
files* silently colliding by name across otherwise-unrelated builds that
happen to share a content root. Both stem from the same root cause (a flat,
shared folder with no per-build namespacing) but need separate guidance,
since finding #2's fix (upload HTML alone via the drop zone, push assets via
Manage Files) is exactly the workflow that walks straight into this one.

---

## 16. Real gap: the faculty module teaches a workflow the capstone project is replacing

Surfaced while migrating `builds/cdk/` into the team repo (2026-09-08), not
from a live D2L build. `04 Build Locally.html` walks an instructor through
typing build requests straight to Claude ("Say something like: 'I want
students to drag the parts of a cell...'", "Ask Claude to serve the folder and
open it"). Parts of `02`, `03`, and `05` carry the same assumption — that the
person using the kit is the one talking to the agent.

That assumption is exactly what the capstone's front end (E2) and back end
(E3) are being built to remove: once the configurator exists, an instructor
never interacts with an AI agent directly, per the proposal's own Agent
Independence objective. This isn't a wording fix — the build loop, the
"starting the conversation" guidance, and the gate-running instructions all
describe a CLI-driven process that will no longer be how any of this works.

**Suggested fix:** don't touch this content until the front end/back end API
boundary is real (Sprint 2/3). Then rewrite `02`–`05` around the configurator
UI, not the chat interface, and retire the "say something like" framing
entirely. Track as its own backlog item under Front-End Configurator & Preview
(E2) or Documentation (E1) — not a documentation-polish task, a real rewrite
once there's a UI to document.

---

## 17. Gap: two of the faculty module's three downloadable zips can't currently be rebuilt

Also surfaced during the 2026-09-08 migration. `builds/cdk/README.md`
describes three build scripts producing three downloadable zips linked from
the module: `build-kit.ps1` (present, works), `build-design-kit.ps1`, and
`build-personas-kit.ps1` (both referenced, neither present). The latter two's
source material — a "Husky-First-4-orientation/SCSU_Design_System" folder and
a "SyntheticStudents/" persona corpus — was searched for across this machine's
entire `Documents` tree, including the original internship folder, and is not
present anywhere. The README's own detail (measured byte sizes, deployed org
unit IDs) indicates these zips were real and did ship at some point; the
scripts and sources simply aren't on this machine now.

**Suggested fix:** don't re-search for these without checking with Ben first
whether he has them on another machine or backup. If they're genuinely gone,
`Resources.html`'s design-system and synthetic-students download links need to
either point somewhere else or come out, and the module's README should stop
describing a build path that doesn't exist. Low priority relative to #16 —
these are optional downloads, not the core faculty workflow.

---

## Suggested next steps, when ready

- ~~Fold finding #1 (missing `references/` folder) into the kit's actual zip~~
  **Done (2026-09-08).** Reconciled the two orphaned reference files (only
  found in the global `~/.claude/skills/` copy, not in the packaged kit)
  against the current `SKILL.md`, which no longer points at a `references/`
  split at all. Most of their content was already superseded by `SKILL.md`'s
  own (more complete) coverage; folded in only what was genuinely missing —
  the Lessons-drop-zone create-topic code sample, the `javascript_tool`
  Chrome-extension quirks, and the verification Quick Triage table — directly
  into `SKILL.md` rather than restoring a references/ split nothing points to.
- ~~Fold finding #2 into `builds/cdk/05 Deploy.html` (a new "worth knowing"
  card or a caveat under stage 2, "Upload") and into
  `skills/d2l-activity-deployer/SKILL.md`'s "Traps" section.~~ **Done.** Added
  the caveat to stage 2 of Deploy.html and a full trap entry (avoidance +
  safe cleanup) to the deployer skill.
- Actually run the test described in finding #3 before trusting Step 3's
  primary instructions for the next new user.
- ~~Fix #4 is two small text edits~~ **Done (2026-09-10).** `Resources.html`'s
  skill count corrected; `05 Deploy.html`'s button label was found already
  correct, no edit needed there.
- ~~Promote finding #2's "upload html first, push assets via Manage Files"
  workaround from an alternative to the default instruction~~ **Done**,
  folded into the same commit as the trap entry above, alongside the
  zero-sibling-builds recommendation from #10.
- ~~Fold finding #6 into `d2l-experience-router`'s SKILL.md as a ninth,
  upfront question~~ **Done.** Added ahead of the eight questions, plus
  updated the skill's own frontmatter description.
- ~~Add findings #7 and #8 as general build-quality reminders somewhere in
  `d2l-content-topic`'s SKILL.md~~ **Done**, as a "Pattern warnings from real
  builds" section (bundled with #13a below, same target file).
- ~~Add finding #9's callout to `d2l-activity-deployer`~~ **Done**, added to
  the Chrome MCP tool quirks list rather than the automation section, since
  that's where the file's other `javascript_tool`-specific notes already live.
- ~~Promote finding #10's "prefer zero-sibling builds"... and fold the
  content-colors-vs-chrome-colors note into `_design-tokens.md`~~ **Done**,
  both landed; the content-topic skill also got its own short version of the
  color-judgment note.
- ~~Highest priority from finding #11: fix `D2LEmulator.install()`~~ **Done.**
  `install()` now takes `opts.credit`/`opts.mode`, defaulting from
  `learner.role` when omitted (`'Instructor'` → `no-credit`/`browse`).
  `doSetValue` now actually discards writes under `no-credit` (reports error 0,
  does not persist) and logs a new `discarded-no-credit` violation — this is
  the actual behavior that was missing, not just the settable field. 12 new
  `emulator.test.js` assertions cover it.
- ~~Ship a reusable `emulator-harness.html` template~~ **Done**, added next to
  `harness/d2l-emulator.js`, and pointed at from `d2l-tenant-qa`'s "Run it" and
  `d2l-scorm-package`'s verification section (the finding's text named
  `d2l-scorm-package`'s "Run it" section specifically, but the actual
  `node harness/emulator.test.js` reference lives in `d2l-tenant-qa`; both
  skills now reference the harness from where it's actually relevant).
- Add a one-line note to `build-scorm.ps1`'s header comment: `-Source`/`-Out`
  must be relative to the script's own folder (`Join-Path` does not resolve
  an absolute `-ChildPath`), even for a build that lives outside the repo.
- Add the SCORM Bulk Upload dialog's shadow-DOM path
  (`d2l-content-selector` → `d2l-drop-uploader` → `input[type=file]`) to
  `d2l-activity-deployer`'s "wrong file input" trap list — it's a third
  distinct chain alongside the two already documented there.
- Nothing new to fold in from finding #12 — it's a confirming data point, not
  a gap. Worth keeping as evidence the last two fixes (prefer zero-sibling
  builds; top-level `await` on uploads) actually hold up on a fresh build,
  not just the ones that originally surfaced them.
- ~~Add finding #13's shared-mutable-state pattern warning alongside findings
  #7/#8~~ **Done**, same "Pattern warnings from real builds" section as #7/#8.
- ~~Correct Finding #5 and `d2l-activity-deployer`'s "Traps" section~~
  **Done (2026-09-08).** Replaced the DOM-read verification instruction in
  `SKILL.md`'s Confirm File Replace section with finding #13's practical fix —
  confirm via the resulting file list (size/timestamp changed, no `(1)`
  sibling), not via any read of the dialog's own DOM.
- ~~Finding #11's SCORM Bulk Upload dialog shadow-DOM path... needs adding to
  the "wrong file input" trap list~~ **Done**, added as a third distinct chain
  alongside the two already documented there.
- Finding #16 (faculty module teaches the pre-front-end workflow): don't
  touch `builds/cdk/02–05` until the front-end/back-end API boundary is real.
  File as its own backlog item under E2 (Front-End) once there's a UI to
  document — not a Sprint 1/2 task.
- Finding #17 (two zips can't currently be rebuilt): needs a decision, not a
  fix — check with Ben whether the missing scripts/source exist on another
  machine before assuming they're gone; if they are, drop or replace
  `Resources.html`'s design-system and synthetic-students download links.
- ~~Add finding #14's data-contract-name-mismatch bug as a documented lint
  blind spot in `d2l-tenant-qa`'s SKILL.md, and add a "run the build once"
  step to `d2l-content-topic`'s guidance~~ **Done**, both landed.
- ~~**Highest priority from finding #15**: add a rule... that a sibling asset
  file must be named build-specifically... and fold a stronger warning into
  `d2l-activity-deployer`'s Confirm-File-Replace section~~ **Done.** New lint
  rule `topic/generic-sibling-filename` (warn), plus the SKILL.md guidance and
  the pre-overwrite size/date check in the deployer's Traps section. The
  `good-topic` fixture's own `data.js` was renamed to `wk1-data.js` so it stays
  clean under the new rule — a small piece of dogfooding, since it was
  exactly the kind of generic name the rule now exists to catch.

