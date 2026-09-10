# Tenant probe results

Tenant: `stcloudstate.learn.minnstate.edu`
Sandbox course ou: `2613967` (Mark Gill - DEV)
Date run: `2026-07-30` (section 3 only; SCORM sections still pending)

> **Status:** the API surface is measured. Everything SCORM-related below is
> still unmeasured, because the package has not been uploaded yet.

Paste the copied JSON into the code blocks. Fill the verdict tables from it.
Anything still marked `?` has not been measured and must not be repeated as fact
to faculty.

---

## 1. SCORM run-time — MEASURED 2026-07-30

**SCORM is enabled.** The upload path is Content → unit → **Add Existing →
SCORM/xAPI Object → Bulk Upload**. It is not in Course Admin, which is why it
looks absent at first glance.

Student pass run as **Sisyphus Johnson** (`sjohnson999`, id 5024307), a
purpose-built test account enrolled as Student in ou 2613967 and nothing else.

| Question | Instructor | Student |
|---|---|---|
| SCORM API found | **yes**, `window.API` at parent depth 1 | **yes**, same |
| Version exposed | **SCORM 1.2 only** (no `API_1484_11`) | same |
| Learner id | `preview` | **`5024307`** (real) |
| Learner name | `Without Tracking, Preview` | **`Johnson, Sisyphus`** |
| `cmi.core.credit` | `no-credit` | **`credit`** |
| `cmi.core.lesson_mode` | n/a in preview | **`normal`** |
| `cmi.core.entry` | n/a | `ab-initio` |
| `cmi.core.lesson_status` | `not attempted` | `not attempted` |
| `cmi.suspend_data` initial | n/a | `(empty)` |
| `cmi.student_data.mastery_score` | n/a | **`80`**, from our manifest |
| `Initialize` returned | `true`, error 0 | `true`, error 0 |
| `suspend_data` capacity | cannot measure in preview | **pending, see below** |
| Score reached gradebook | cannot measure in preview | **pending, see below** |

The instructor/student contrast is exact and settles the preview question beyond
doubt. `credit` versus `no-credit` is the single cleanest tell: an instructor's
session is explicitly marked as not counting.

`mastery_score` arriving as 80 confirms that `<adlcp:masteryscore>` in the
manifest reaches the run-time, so manifest-level configuration is usable.

### Why capacity and gradebook are still pending

Not a permissions problem. A layout one. The v1 probe put its write tests below
a 1100px fold, and **the embedded SCORM player will not scroll a child that
tall** by wheel, drag, keyboard, or programmatic resize from the parent. The
package is cross-origin, so its buttons cannot be clicked programmatically
either.

This is a genuine and reusable finding about building for the embedded player,
now recorded in the tenant profile as `embeddedPlayerScrollsInternally`.

**Fix already built:** `probe v2` (`dist/scsu-tenant-probe-scorm12-v2.zip`) is
560px tall, runs every write test automatically on load with no clicking, and
writes a scripted score sequence of 50, 90, 70 across successive launches so a
single package proves the Highest Attempt calculation by itself.

Uploading it needs the instructor account. Sequence: sign in as Mark, upload v2
as a new version, sign in as Sisyphus, open it three times.

### The finding that reshapes the QA plan

> **An instructor viewing a SCORM object gets PREVIEW MODE with no tracking.**
> `student_id` is literally the string `preview` and `credit` is `no-credit`.

You cannot test SCORM behavior by clicking your own package. Attempts, scores,
`suspend_data` persistence, and the best-of-3 calculation are all unobservable
from an instructor account. This is the concrete justification for the test
account request, and it narrows that request usefully: **one real student
enrollment unblocks every remaining SCORM question.**

### Version

Only SCORM 1.2 is exposed. Plan for **4096 characters** of `suspend_data`, not
64000. Any design needing more state has to compress or restructure.

### Add-time settings, confirmed in the UI

- Grade item created for this instance: Yes / No, defaults **Yes**
- Grade Calculation Method: **Highest Attempt** (default), Lowest Attempt,
  Average of all Attempts, Last Attempt, First Attempt
- Version Control: always latest, or pin this version
- Player: embedded (recommended) or new window

**"Best of 3" is confirmed as a built-in setting.** All five options verified
verbatim on this tenant.

---

## 2. File loading inside a SCORM package — MEASURED

| Mechanism | Result |
|---|---|
| static `<script src>` | **works** |
| dynamically injected script | works |
| `fetch()` sibling `.js` | works |
| `fetch()` sibling `.json` | works |
| relative `<img>` | works |
| `localStorage` / `sessionStorage` | work |

Everything works, because inside a package the content is plain static hosting
rather than D2L's topic renderer. Note this **differs from the HTML-topic case**,
where the static-tag finding has flipped between courses. If a build has to work
in both places, still load via injection or fetch.

---

## 3. The API boundary

The question that decides whether role-aware behavior is possible.

### From inside a SCORM package — MEASURED AND SETTLED

**A SCORM package is sealed off from the Brightspace API. Completely.**

The reason is the origin:

```
tenant page     https://stcloudstate.learn.minnstate.edu
SCORM package   https://content.us-east-1.content-service.brightspace.com
```

A package is served from a **separate Brightspace content-service origin**, at
frame depth 3, with the top window not readable.

| Attempt | Result |
|---|---|
| `fetch('/d2l/api/lp/1.5/users/whoami')` | **403** `MissingKey` from the content CDN |
| `fetch('https://stcloudstate.../d2l/api/...')` | **Failed to fetch**, CORS blocked |
| Session cookie sent | no, different origin |

The relative path does not even reach D2L. It hits the content vault, which
answers with its own CloudFront-style error. The absolute URL is blocked by CORS
before a response exists.

**The conservative default in the tenant profile was correct.** Nothing built on
`reachableFromScorm` would have worked.

### Storage differs from HTML topics, and this corrects a prior rule

`localStorage` works inside a package, but it belongs to the **content-service
origin**, not the tenant. So the long-standing rule from the HTML-topic notes,
that storage is shared LMS-wide and must be namespaced against D2L's own keys,
**does not apply to SCORM packages**. Namespacing is still worth doing, because
every SCORM package in every course shares that one content-service origin.

### Same-course role comparison — MEASURED, ou 2613967

Both roles in the *same* course, which removes the "those were campus-wide
shells" explanation for the classlist result.

| Endpoint | Instructor (Mark) | Student (Sisyphus) |
|---|---|---|
| `classlist` | 200 (3648b) | **200 (3429b)** |
| `enrollments/orgUnits/{ou}/users/` | 200 (6725b) | **403** |
| `grades/` (item definitions) | 200 | 200 |
| `grades/values/myGradeValues/` | own only | own only |
| `dropbox/folders/` | 200 (7194b) | **200 (7233b)** |
| `content/root/` | 200 | 200 |

The classlist exposure reproduces in a small private dev course, so it is a role
permission rather than a quirk of those large compliance courses. The `dropbox`
result deserves a second look with IT too: a student receiving a similar payload
to the instructor on assignment folder metadata is worth understanding, since the
instructor version carries submission statistics.

### From ordinary tenant page context  — MEASURED 2026-07-30

Session-cookie auth, `credentials: 'include'`, no OAuth. This is the same origin
and session a custom widget runs in.

| Endpoint | Instructor (ou 2613967) | Student (ou 713141 / 3755604) |
|---|---|---|
| `/d2l/api/versions/` | 200 | 200 |
| `/d2l/api/lp/1.5/users/whoami` | 200, own identity | 200, own identity |
| `/d2l/api/lp/1.44/enrollments/myenrollments/{ou}` | 200, role `Instructor` | 200, role `Student` |
| `/d2l/api/le/1.34/{ou}/classlist/` | 200 (3.6 KB) | **200 (486 KB / 312 KB)** |
| `/d2l/api/lp/1.44/enrollments/orgUnits/{ou}/users/` | 200 | **403** |
| `/d2l/api/le/1.34/{ou}/grades/` | 200 | 200 (item definitions) |
| `/d2l/api/le/1.34/{ou}/grades/values/myGradeValues/` | 200, own only | 200, own only |
| `/d2l/api/le/1.34/{ou}/dropbox/folders/` | 200, full folder data | 200, empty |

**Session auth works.** This is the headline. A widget or content page can call
the API with the logged-in session and no OAuth handshake.

**Role detection works, and here is the mechanism:**

```
GET /d2l/api/lp/1.44/enrollments/myenrollments/{ou}
  -> Access.ClasslistRoleName   "Instructor" | "Student"
```

That single field is what makes role-aware widgets possible. It also carries
`LISRoles`, `IsActive`, `CanAccess`, and `LastAccessed`.

### The security gate did NOT hold as assumed

> A student-role user successfully read the **full classlist** in both courses
> tested: 486 KB in ou 713141, 312 KB in ou 3755604. Not 403. Not filtered.

Read this precisely before acting on it:

- The boundary that **does** hold is `enrollments/orgUnits/{ou}/users/`, which
  correctly returns 403 to students, and `myGradeValues`, which is correctly
  scoped to the caller.
- The classlist result is most likely the API faithfully honoring the
  **Classlist tool permission** for the Student role in those courses. Students
  being able to see who else is in their course is a normal, often intentional
  LMS setting, not prima facie a bug.
- What makes it worth raising anyway is the **exposure profile**. Both courses
  look campus-wide, and a paginated roster in the UI is a very different thing
  from a single API call returning a third of a megabyte of roster in one shot.

**The architectural consequence, which holds regardless of how IT rules on it:**
do not assume the API enforces the boundary you want. It enforces the tenant's
configured permissions, and those are more permissive than we assumed. Combined
with the fact that widget JS is readable by students, an "instructor dashboard"
widget gives students both the endpoint and the demonstrated ability to call it.

**Action:** raise with the D2L specialist as a question, not an accusation.
Ask whether Student role holding See Classlist in campus-wide compliance courses
is intended, and whether the API exposure was considered when it was set.

### Not yet measured

Whether any of this is reachable **from inside a SCORM package** is still open.
Everything above was measured from ordinary tenant page context. The profile
keeps `reachableFromScorm: false` until the package is uploaded and run.

### Replace strings in widgets

| String | Substituted |
|---|---|
| `{OrgUnitId}` | ? |
| `{OrgUnitName}` | ? |
| `{UserName}` | ? |
| `{FirstName}` | ? |
| `{RoleId}` | ? |
| `{OrgDefinedId}` | ? |

Did the widget editor preserve the inline `<script>`? `?`

### Widget JSON

```json

```

---

## 4. Attempt rules — MEASURED, CONFIRMED

Student ran the probe three times. It wrote 50, then 90, then 70.

| Check | Result |
|---|---|
| Gradebook shows 90 | **YES.** `DisplayedGrade: "90 / 100"` |
| Three attempts genuinely recorded | **YES.** A single overwritten attempt would read 70 |
| Grade calculation options offered | **YES.** All five, verified in the UI |
| Score reaches the gradebook at all | **YES** |

Read back from the instructor session:

```
GET /d2l/api/le/1.34/2613967/grades/30028794/values/5024307
  -> PointsNumerator 90, PointsDenominator 100, DisplayedGrade "90 / 100"
```

**"Best of 3" is confirmed end to end and requires no code.** Set the attempt
count and pick Highest Attempt at add time.

### The trap: completion locks the activity

On the fourth launch the same student got:

```
mode           review
credit         no-credit
prior status   completed
prior score    70
wrote score    failed err 0
```

**Once an activity reports `lesson_status = completed`, D2L serves later
launches in review mode and rejects every write, with error code 0.**

Our probe wrote `completed` on every launch, which is precisely how it locked
itself out after three. The design rule that follows:

> Do not write `completed` until the learner is genuinely finished. An activity
> that marks itself complete on first load gives every student exactly one
> scoring opportunity, and best-of-N silently stops working. Nothing errors.

`credit = 'no-credit'` is the one reliable "this launch will not be recorded"
signal, covering both instructor preview and post-completion review. Check it
before trusting any write.

---

## 4b. Assignment lifecycle, end to end — MEASURED 2026-07-31

Full instructor-to-student-to-grade cycle, driven entirely through the API.

### It all worked, programmatically

| Step | Method | Result |
|---|---|---|
| Create assignment | `POST /dropbox/folders/` | id 15506751, text submission |
| Create grade item | `POST /grades/` | id 30030284, out of 10 |
| Link the two | `PUT /dropbox/folders/{id}` | linked |
| Student submits | UI, TinyMCE in shadow DOM | submission 97057027 |
| Instructor grades | `POST /feedback/user/{uid}` | score 7 |
| Enter gradebook grade | `PUT /grades/{gi}/values/{uid}` | `7 / 10` |

**Writes work with session auth.** Non-GET needs an XSRF token, available from
`D2L.LP.Web.Authentication.Xsrf.GetXsrfToken()` and sent as `X-Csrf-Token`. This
means an entire course can be constructed by script. For the synthetic semester
that is the difference between feasible and not.

Note the API version matters: `le` latest is **1.96** here, and the feedback
route only exists on newer versions as `/feedback/user/{userId}`. On 1.34 it 404s.

### THE BIG WARNING: 200 does not mean it saved

Twice the API accepted a payload, returned **200**, and silently discarded part
of it.

1. **Feedback body.** Posting `Feedback: {Content, Type}`, which is the
   documented RichTextInput shape, returns 200 and stores **nothing**. The
   working shape is `Feedback: {Text, Html}`. Both are accepted. Only one persists.
2. **Grade item link.** A `PUT` with `GradeItemId` returned 200 while
   `GradeItemId` stayed `null` on read-back.

> **Never trust a 2xx from this API. Read back and assert.** Any script that
> builds a course must verify every write, or it will report success while
> producing a course that is quietly half-configured.

### Assignment feedback and gradebook comment are the SAME FIELD

Measured directly. A 400-character piece of assignment feedback was silently
replaced by a 54-character gradebook comment written afterwards. Read back from
both endpoints, the strings were byte-identical.

> Writing a gradebook comment **destroys** any assignment feedback already
> there. An instructor who writes detailed feedback on the submission and then
> adds a short note in the gradebook has just deleted the detailed feedback,
> with no warning.

This one is worth telling faculty regardless of anything else we build.

### What is recoverable afterwards

Essentially everything, which is good news for QA:

| Artifact | Recoverable | Where |
|---|---|---|
| Full answer text | **yes**, all 1443 chars, all 10 answers | `Submissions[0].Comment` |
| Which answers were wrong | yes, by content inspection | same |
| Submission id and timestamp | yes, to the millisecond | `Submissions[0]` |
| Who submitted | yes | `SubmittedBy` |
| Score | yes | feedback endpoint and gradebook |
| Feedback text | yes | `/feedback/user/{uid}` |
| Grade, comments, last modified, by whom | yes | `/grades/{gi}/values/{uid}` |
| Class rollup counts | yes | folder `TotalUsersWithSubmissions` etc |

**D2L also auto-generates an HTML file from a text submission**
(`Worksheet 1 Basic Game Design-Jul 31, 2026 1026 AM.html`, 1709 bytes), so a
typed submission leaves a downloadable artifact as well as a queryable field.

### Student-side boundary

| Endpoint as student | Result |
|---|---|
| Another user's feedback row | **403 Forbidden**, boundary holds |
| `myGradeValues` | 200, own values only |
| Assignment metadata | 200, expected |
| `/dropbox/folders/{id}/submissions/` | **200** |

> **OPEN AND IMPORTANT.** The student got 200 on the submissions collection,
> but only one student has submitted, so the instructor sees exactly one entry
> too. We cannot yet distinguish "filtered to self" from "returns everyone."
> If it is unfiltered, a student can read every classmate's submitted work and
> grades. Given that the classlist boundary already did not hold, do not assume
> the safe answer. **Test this with a second student account before building
> anything that relies on it.**

---

## 4c. Homepage widgets — MEASURED 2026-08-01

Run by creating `probes/widget-probe/widget.html` as a custom widget in ou 2613967,
placing it on a homepage, and reading its output live.

**This avenue was missing from the kit. It should not have been.** It was
identified in the very first conversation, a probe was written for it, and then
it was folded into "content topic" when the spectrum was scoped. Widgets are
materially different, and for one important use case they are strictly better.

| Question | Answer |
|---|---|
| Can an ordinary instructor create one? | **Yes.** Course Admin → Widgets → Create Widget |
| Release conditions available? | **Yes**, server-enforced |
| Does inline `<script>` execute? | **Yes**, when pasted via the source view |
| Rendered in an iframe? | **No.** Directly in the LMS page |
| Origin | the tenant itself |
| API reachable? | **Yes**, measured from inside the widget |
| Replace strings substitute? | **Yes, all eight** |

### Replace strings, all substituted

```
{OrgUnitId}     2613967
{OrgUnitName}   Mark Gill - DEV
{OrgUnitCode}   Mark Gill - DEV
{UserName}      qi2822gl@minnstate.edu
{FirstName}     Mark
{LastName}      Gill
{RoleId}        1015          <- Instructor, per the roles API
{OrgDefinedId}  12317014.e
```

**`{RoleId}` is the standout.** A widget can branch on the viewer's role with no
API call at all, because D2L substitutes it server-side before the HTML is sent.
That is a simpler mechanism than the content topic's `ClasslistRoleName` fetch.

The caveat still applies: the substituted value is baked into HTML the viewer
receives, so it tells the page who is looking but is **not** a security boundary.
Release conditions are the boundary, and they are genuinely server-enforced.

### What widgets give you that nothing else does

1. **Placement.** A widget is on the homepage. Students see it without
   navigating. A content topic has to be found. For anything ambient, a
   dashboard, a what's-due panel, a nudge, that is the entire point.
2. **Server-enforced visibility.** Release conditions can make a widget truly
   invisible to students. A content topic's role logic is JavaScript the student
   can read, which we documented as presentation only.
3. **Not iframed.** It runs directly in the LMS page, so no auto-resize quirks,
   no viewport-unit problem, no fixed-height requirement.

### The trap, and the friction

**The trap:** the WYSIWYG editor appears to strip your script. A DOM query for
`script` returns zero. It has not been stripped; TinyMCE swaps it for a
placeholder while editing and restores it on save. **Paste via the source-code
(`</>`) view** and check there, not in the visual editor.

**The friction:** the course's active homepage was shared from the org and could
not be edited. To place a widget an instructor must **Create Homepage**, add the
widget, and set it active. No admin needed, but it is an extra step nobody
expects, and it swaps the homepage everyone in the course sees.

### Consequence for the kit

The at-risk dashboard that started this whole project is a **widget**, not a
content topic. Describe it to the current checklist and it routes to avenue B,
which would work but would sit somewhere nobody looks. The router needs a
placement question and a fourth outcome.

---

## 5. Conclusions

**What SCORM can do here.** Ship a self-contained graded activity. All file
loading works. The 1.2 run-time is present and initializes cleanly. Attempt
limits and best-of-N are D2L settings, with Highest Attempt as the default.

**What SCORM cannot do here.** Reach the Brightspace API, at all, ever. Know the
viewer's role. Share storage with the LMS or with HTML topics. Carry more than
4096 characters of state, since only SCORM 1.2 is exposed. Be tested by its own
author, because instructors get preview mode.

**What the widget plus API pattern can do here.** Everything SCORM cannot.
Session-cookie auth works with no OAuth, `whoami` identifies the caller, and
`Access.ClasslistRoleName` gives the role. Instructor-scoped data is readable.

**The two do not compose.** Since a package cannot reach the API, there is no
hybrid artifact. An experience needing both a gradebook score and role awareness
has to be two objects: a SCORM package for the grade, a widget or topic for the
role-aware surface.

**What requires an IT conversation.**
1. One student-role test enrollment. Now clearly justified: preview mode makes
   every remaining SCORM question unmeasurable from an instructor account.
2. Whether Student holding See Classlist in campus-wide courses is intended,
   given the API returns the full roster in one call.

**What contradicted expectations.**
- The demo widget was never SCORM. Different technology entirely.
- Static `<script src>` works inside a package, unlike the flip-flopping
  HTML-topic result.
- `localStorage` is **not** LMS-shared for packages. Prior rule was topic-specific.
- The security gate we assumed on classlist does not hold.
- Instructor preview mode, which was not on the original question list at all and
  is the single biggest constraint on the QA plan.
