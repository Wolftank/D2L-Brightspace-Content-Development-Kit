# D2L Content Development Kit — the D2L module

Six topics that go into a single D2L Content module called
**D2L Content Development Kit**. This is the faculty-facing walkthrough — the
thing an instructor actually reads inside their course to learn how to use the
kit. Live in **Mark Gill - DEV** as of 2026-07-31 (see "Deployed" below).

**Known, not yet fixed:** two things flagged during migration into this repo
(2026-09-08), tracked in [`../../docs/CDK_Review_Findings.md`](../../docs/CDK_Review_Findings.md)
as findings #16 and #17 — don't re-discover these from scratch:

1. **"04 Build Locally" teaches the old, pre-front-end workflow** (typing build
   requests straight to Claude). Once the configurator ships (epics E2/E3),
   this page — and parts of 02/03/05 — describe a process that no longer
   exists and need a real rewrite, not a touch-up.
2. **Two of the three downloadable zips can't currently be rebuilt.** Their
   build scripts (`build-design-kit.ps1`, `build-personas-kit.ps1`) and source
   material (a Husky design-system folder, a synthetic-students corpus) were
   searched for and are not present anywhere on the machine this kit was
   developed on. Don't spend time hunting for them again without checking
   with Ben first — either they're recoverable from a backup he has, or the
   module needs to drop those two download links.

## Topics, in order

| File | Topic title students see | What it is |
|---|---|---|
| `01 Start Here.html` | Start Here | The brief. Two diagrams: why the three avenues differ, and the five-step process. |
| `02 Determine Your Path.html` | Determine Your Path | The interactive checklist. Eight questions, live recommendation. |
| `03 Install the Skills.html` | Install the Skills | What a skill is, how to get the kit, how to verify it. |
| `04 Build Locally.html` | Build Locally | The build loop, what to say to Claude, the gate. |
| `05 Deploy.html` | Deploy | Five stages, in order, with the two permanent ones flagged. |
| `Resources.html` | Resources | Evidence, the optional design system, glossary, help. |

**The file name becomes the topic title.** These are already named their final
titles. Do not rename them after deploying: renaming a live topic re-saves the
page and silently destroys the interactive one.

## Deploying

All six are avenue-B content topics. Upload each through the Lessons drop zone,
which creates the topic and titles it from the file name in one move:

```
Content -> D2L Content Development Kit -> Add Existing -> drop the file
```

Order the topics 01 to 05 with Resources last. Only `02` is interactive; the
rest are static prose and will render anywhere.

Before uploading:

```bash
node harness/lint/lint.js builds/cdk --avenue topic
node builds/cdk/routing.test.js
```

## Deployed

Live in **Mark Gill - DEV** (ou `2613967`) as of 2026-07-31.

| Topic | Id |
|---|---|
| Module: D2L Content Development Kit | `79516068` |
| 01 Start Here | `79516077` |
| 02 Determine Your Path | `79516078` |
| 03 Install the Skills | `79516079` |
| 04 Build Locally | `79516080` |
| 05 Deploy | `79516081` |
| Resources | `79516085` |

### How it went, for next time

**The module was created by API**, which worked cleanly:
`POST /d2l/api/le/1.96/{ou}/content/root/` with `Type: 0`.

**Creating topics by API did not.** The multipart endpoint
(`/content/modules/{id}/structure/`) returned `400` with an empty `Errors`
array, which gives nothing to debug against. Not worth chasing.

**The Lessons drop zone took all six files in one pass.** Its hidden input is
`multiple`, so injecting six `File` objects at once produced six correctly
titled topics in the right order, with no per-file clicking. That is by far the
fastest route and worth reusing.

The input is inside a `d2l-labs-file-uploader` shadow root within the
`smart-curriculum` iframe. Match on the containing element, never on document
order: the page also has a generic drop zone that will happily accept the files
and turn them into something useless while reporting success.

### The two downloadable zips

Both are built **into this folder**, not `dist/`, and both are linked as
siblings from the topic that offers them.

| Zip | Built by | Linked from | Source |
|---|---|---|---|
| `d2l-content-development-kit.zip` | [`build-kit.ps1`](../../build-kit.ps1) | `03 Install the Skills.html` | this repo |
| `scsu-d2l-design-system.zip` | [`build-design-kit.ps1`](../../build-design-kit.ps1) | `Resources.html` | `Husky-First-4-orientation\SCSU_Design_System` |
| `synthetic-students.zip` | [`build-personas-kit.ps1`](../../build-personas-kit.ps1) | `Resources.html` | `SyntheticStudents/` |

**The persona build refuses to package an unverified corpus.** It runs
`verify_personas.py` first and aborts on a non-zero exit. That harness enforces
the property the corpus exists to protect: cheating is statistically independent
of nationality, native language, English proficiency, age, major and residency.
A corpus that drifted on that would quietly teach a detector to flag
international students, so shipping one unchecked is not acceptable. Current
corpus passes at N=500, seed 20260731.

**The design system source matters.** It is the Husky kit from the orientation
project, **not** the `scsu-d2l-design-system/` folder sitting in this repo. That
copy is the Game Design Toolkit variant, which is the wrong catalog for general
course material. The build script hard-codes the correct path and will fail
loudly rather than silently ship the wrong one.

A generated `README.md` is added inside the design zip explaining the two tiers,
the palette, how to view the `.dc.html` prototypes, and the no-CDN font rule.
Its source is `_design-kit-readme.md` in this folder.

**Watch the size labels.** Each download button prints the zip's size, so
changing a page changes the zip, which can change the label, which changes the
page again. It settles after one iteration. Both scripts print the size and
remind you which file to update. Verified live: the labels match the actual
byte counts (128 KB / 130659 bytes, and 48 KB / 48754 bytes).

### The downloadable kit

`d2l-content-development-kit.zip` is built by [`build-kit.ps1`](../../build-kit.ps1)
**into this folder**, not into `dist/`. That is deliberate: this folder mirrors
the D2L content root, so `03 Install the Skills.html` can link to the zip as a
sibling and the link resolves both locally and once deployed.

The lint proved the point. The first version of the download button linked to a
zip that lived in `dist/`, and `shared/missing-assets` failed the build with
"References d2l-content-development-kit.zip which is not in the build." A rule
written from a measured D2L behaviour caught a genuine deployment mismatch.

Uploading the zip and overwriting a page both go through **Manage Files**, not
the Lessons drop zone, since the drop zone creates new topics rather than
replacing files. Two things about that dialog:

- Its file input does not exist until you click the inner **Upload** button.
  Patch `HTMLInputElement.prototype.click` to a no-op for file inputs in every
  same-origin realm *first*, or that click opens a native picker you cannot
  dismiss.
- The **Confirm File Replace** checkbox must be clicked at real coordinates.
  Ticking it from page JS silently fails and D2L saves `name(1).html` instead,
  leaving the live topic pointed at the old file. Zoom in and confirm the tick
  before committing: our first click missed the box by 16 pixels and looked
  fine at normal magnification.

**Measured while deploying this:** D2L rewrites relative `href`s in a topic,
appending the org unit. `href="d2l-content-development-kit.zip"` was served as
`d2l-content-development-kit.zip?ou=2613967`. It still resolves, and the fetch
returned `200`, `application/x-zip-compressed`, 127489 bytes, byte-identical to
the local file. Relative sibling links in topics are safe.

### Verifying a deployed topic

`window.frames` traversal is **not** sufficient to reach a topic's window. The
topic iframe sits inside a shadow root, so a frames-only walk returns a false
negative even when the page is working perfectly. Descend through shadow roots.

Verified live: `SCSU_CHOOSER_READY` true, 8 questions and 8 explainer buttons
present, and answering Q3 inside D2L routed to "A SCORM package". Rendering is
not initialising; check the global.

## Design

Built with the **Husky Course Kit, Blended** direction from
`SCSU_Design_System`. Tokens and the reasoning are in
[`_design-tokens.md`](_design-tokens.md).

Two tiers, used deliberately:

- **Loud** (ink, cardinal wedges, Archivo 900 uppercase) for the page heroes,
  the step numbers, and the moments that must be read. In the checklist, the
  Loud treatment is reserved for the two pieces of *advice*, so "D2L already has
  a tool for this" lands harder than a routine recommendation.
- **Warm** (cream cards, rounded, Epilogue) for everything explanatory.

The Husky peak triangle appears as section markers and list bullets, which is
what makes six separate files read as one module.

### One deliberate deviation from the kit

The design kit loads Archivo, Epilogue and Public Sans from Google Fonts. These
pages name the same families but ship **no external font link**, because campus
network policy can block an outside host and a blocked font should degrade
rather than break the page. That is the same rule the gate enforces on faculty
builds, so the module follows its own advice.

Everything falls back to a close system stack, so the pages are readable
regardless.

## Note on the checklist

`02` supersedes the old `builds/activity-chooser/`, which has been removed.
`routing.test.js` lifts `decide()` and `caveatsFor()` straight out of the HTML
and exercises 25 routing cases, so the page stays self-contained while the logic
stays tested. If the extraction stops matching, that is a real signal that the
page's shape changed and the routing needs re-checking by hand.
