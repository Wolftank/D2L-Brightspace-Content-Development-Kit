---
name: d2l-content-topic
description: >-
  Use this skill to build a self-contained interactive HTML/JS/SVG activity that
  runs as a content topic inside a D2L Brightspace course: maps, simulations,
  calculators, interactive diagrams, directories, timelines, drag-and-drop
  exercises, self-checking practice, dashboards, anything custom. Reach for it
  WHENEVER the user wants custom interactive content in a D2L course, even when
  they only describe the thing ("an interactive campus map in our course", "a
  self-checking activity in Lessons", "a page that shows instructors something
  extra"). This is the ONLY avenue that can tell who is looking at the page and
  what their role is, because a content topic is served same-origin with the LMS
  and can call the Brightspace API with the logged-in session. It CANNOT write a
  grade automatically; route that to d2l-scorm-package. Supersedes the older
  d2l-activity-builder skill.
---

# D2L Content Topic

Build interactive content that runs **inside a D2L content topic**: an HTML file
uploaded to the course and attached as a topic, which D2L renders in a nested
iframe.

Measured against **our own tenant**. Evidence lives in `probes/RESULTS.md` and
`harness/tenant-profile.json`.

---

## What makes this avenue worth choosing

A content topic is served from the **same origin as the LMS**. That single fact
is the whole reason to pick it:

- `fetch` to `/d2l/api/...` with `credentials: 'include'` **works**, with no
  OAuth handshake. Measured, returns 200.
- It can therefore learn who the viewer is and what role they hold.
- It can read whatever D2L already permits that person to read.

If the activity does not need any of that, an external page is easier to build
and to update. If it needs an automatic grade, it needs SCORM instead, and the
two cannot be combined.

### Role detection, the one call that matters

```js
var me = await (await fetch('/d2l/api/lp/1.5/users/whoami',
                            { credentials: 'include' })).json();

var enr = await (await fetch('/d2l/api/lp/1.44/enrollments/myenrollments/' + ou,
                             { credentials: 'include' })).json();

var role = enr.Access.ClasslistRoleName;   // "Instructor" | "Student"
```

`Access` also carries `LISRoles`, `IsActive`, `CanAccess`, `LastAccessed`.
The latest LE API version on this tenant is **1.96**; some routes only exist on
newer versions.

---

## Security: read the boundary correctly

**Your JavaScript is served to the student and can be read.** Role checks in
your code are a presentation convenience, never an authorization boundary.

What actually protects data is D2L's server-side permission check, and we tested
both directions:

| From a student session | Result |
|---|---|
| Write own grade value | **403 Forbidden** |
| Create a grade item | **403 Not Authorized** |
| Read `enrollments/orgUnits/{ou}/users/` | **403 Forbidden** |
| Read `classlist` | **200. The boundary does NOT hold.** |

Two consequences:

1. **Never write grades from a content topic.** D2L refuses, correctly, and the
   attempt looks like tampering in the logs. Note that a student session *does*
   carry a usable XSRF token, so the protection is the permission check, not
   secrecy.
2. **Do not assume an endpoint is instructor-only.** `classlist` returns the
   full roster to students in every course we tested, including a small private
   one. If you build an instructor dashboard on an endpoint, students have both
   the endpoint and demonstrated ability to call it. Check each one.

---

## The sandbox rules that break naive builds

- **A static `<script src="data.js">` may silently not execute.** Measured on two
  SCSU courses with **opposite** results: it ran in one and was inert in the
  other, same tenant. The failure is silent; your data is just `undefined`.
  Build via dynamic injection or `fetch`, which works either way.

- **The iframe auto-resizes to content height**, so viewport units are
  meaningless. Give the root a **fixed pixel height**, never `100vh`. This also
  means `position: fixed` is unreliable: it measures against an iframe as tall
  as your content, while the page the reader scrolls is the D2L page outside it.
  An overlay pinned that way lands off-screen. Anchor things inline instead.

- **`localStorage` works but is shared with the entire LMS**, including D2L's own
  code, because you are same-origin with it. Namespace every key.

- **Storage throws rather than returning null** in private mode, under policy, or
  over quota. An unwrapped call inside `init()` takes the whole activity down and
  renders blank. Wrap every access. This is the single most common way an
  activity dies on one student's machine and nobody else's.

- **Storage is never authoritative.** Device-local, student-editable, wiped by
  clearing browser data. Fine for "continue where you left off". Never for
  completion or grades.

- **D2L injects its own chrome** into the rendered topic, a ReadSpeaker bar plus
  its own scripts. Namespace your globals and DOM ids.

---

## Architecture that works

1. **One `index.html`, engine inline**, plus inline SVG if you need addressable
   shapes.
2. **Load data by injection or fetch**, never a static `<script src>`:
   ```js
   var s = document.createElement('script');
   s.src = 'data.js';                       // sets window.MY_DATA
   s.onload = function () { init(window.MY_DATA || null); };
   s.onerror = function () { init(null); };  // degrade, do not hang
   document.head.appendChild(s);
   ```
3. **Fixed pixel height** on the root container.
4. **Wrapped, namespaced storage**, rehydrated *before* the first render so
   restored state is visible immediately rather than flashing empty.
5. **Vendor third-party libraries locally.** Campus policy may block CDNs.
   Always provide a visible fallback rather than a blank activity.
6. **Set a verification global** at the end of init (`window.MY_ACTIVITY_READY =
   true`) so a deploy check can confirm it truly initialised.

A ready-to-edit starter is in `assets/starter/`. It demonstrates the bootstrap,
wrapped storage, and optional role detection, and passes the lint clean.

---

## Two things that are permanent, so settle them before deploying

- **The file name becomes the topic title.** Renaming a live topic re-serializes
  the page and silently kills inline JS and SVG. Name the file exactly what
  students should see, before it goes up.
- **Never open a live topic in D2L's HTML editor.** Same corruption, same
  silence.

---

## Before you deploy: run the gate

```bash
node harness/lint/lint.js <your-build-folder> --avenue topic
```

Zero errors to deploy. The rules encode exactly the failures above.

---

## Multi-page coordination

Separate topics cannot hand live state to each other. Three options that work:

1. **A shared data file** in a common folder, referenced by **absolute** content
   path (`/content/<year>/<ou>-<course>/shared/data.js`) so it resolves from any
   depth. One source of truth, edit once.
2. **Deep links** carrying state in the `#hash`, read on load.
3. **Namespaced `localStorage`** for soft continuity, within the device-local
   caveat.
