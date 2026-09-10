---
name: d2l-homepage-widget
description: >-
  Use this skill to build a custom homepage widget for a D2L Brightspace course:
  something students see WITHOUT navigating to it, or something only instructors
  and TAs can see at all. Reach for it whenever the request is ambient rather
  than sequenced. Signals include "a dashboard on the course homepage", "students
  should see this without clicking into anything", "what's due this week", "flag
  students who are falling behind", "a nudge", "at-risk", "something only I can
  see", or any panel that should simply be present rather than visited. A widget
  is the ONLY avenue with server-enforced visibility (release conditions), so it
  is the correct home for genuinely instructor-only material inside a course. Do
  NOT use it for anything with a finished state, anything graded, or anything
  sequenced; route those to d2l-scorm-package or d2l-content-topic. A widget is
  not iframed, which makes it more capable AND more dangerous than a content
  topic: its CSS and globals leak into the shared homepage.
---

# D2L Homepage Widget

Build a custom widget that lives on a course homepage.

Measured against **our own tenant** on 2026-08-01 by running
`probes/widget-probe/widget.html` as a live widget. Evidence in
`probes/RESULTS.md` section 4c. The pedagogical reasoning for when to reach for
this at all is in `docs/Placement_and_Pedagogy.md`.

---

## When this is the right answer

**The other avenues are destinations. A widget is a condition of the space.**
You go to a topic. You do not "go to" a widget; it is simply there.

Use a widget when either is true:

- **The value depends on reaching people who do not know they need it.** A
  content topic requires navigation, which requires intention, which requires
  already knowing. The students most helped by "you have not opened this course
  in eight days" will never visit a page called *Are You Falling Behind?*
- **It must be genuinely invisible to students.** Release conditions are
  server-enforced. This is the only avenue where instructor-only material can
  live inside the course rather than in a separate document.

Do **not** use a widget when:

- It has a finished state. A widget that can be completed sits there afterwards
  looking unfinished. Completion belongs to topics and SCORM.
- It is graded. Widgets write nothing to the gradebook.
- It is specific to one week rather than true all term, unless it is dynamic.

---

## Read this before you write a line

### 1. The editor lies about your script

Paste your HTML through the **source-code view (`</>`)**, not the visual editor.

If you look at the WYSIWYG surface afterwards, the script will appear to be
gone. A DOM query for `script` returns **zero**. It has not been stripped:
TinyMCE swaps it for a placeholder while editing and restores it on save. It
executes correctly when the widget renders.

> Verify in the source view, never in the visual editor. We nearly recorded
> "widgets strip scripts" as a finding before checking.

### 2. You are not in an iframe, and that cuts both ways

A widget renders **directly in the LMS page**. Measured: origin is the tenant,
`inIframe: false`, top window readable.

The good news: no auto-resize quirks, no viewport-unit problem, no fixed-height
requirement. All the awkwardness a content topic carries is absent.

The bad news, and it is worse than the good news is good:

> **Your CSS and your globals leak into the shared homepage.**

A rule like `button { background: red }` restyles every button on the page,
including D2L's own chrome and every other widget. A top-level `var state = {}`
collides with the next widget that does the same. An element id of `header`
fights whatever else claims it.

A content topic is iframed and therefore isolated. A widget is not. This is the
single biggest difference in how you write the code.

### 3. Release conditions are the boundary. `{RoleId}` is not.

`{RoleId}` is substituted **server-side** before the HTML is sent, so a widget
can branch on role with no API call at all. That is genuinely convenient.

It is not a security boundary. The substituted value is baked into HTML the
viewer receives, so it tells the page who is looking; it does not stop a student
reading whatever else is in there.

> To hide something from students, attach a **release condition**. That is
> enforced on the server and the widget does not render at all.

### 4. Placing it changes what everyone sees

The course's active homepage may be **shared from the org**, in which case you
cannot edit it. Measured: that was the case in our sandbox.

To place a widget you must **Create Homepage**, add the widget to it, and set it
active. No admin needed, but it swaps the homepage for everyone in the course,
so do it deliberately and tell people.

---

## What a widget can reach

Measured from inside an actual widget, not inferred:

| Capability | Result |
|---|---|
| Origin | the tenant itself |
| Brightspace API | **reachable**, session auth, no OAuth |
| `whoami`, `myenrollments` | 200 |
| Course grades, dropbox folders | 200 for an instructor |
| Replace strings | **all eight substitute** |

```
{OrgUnitId} {OrgUnitName} {OrgUnitCode} {UserName}
{FirstName} {LastName}    {RoleId}      {OrgDefinedId}
```

**Prefer replace strings over API calls for identity.** They are substituted
server-side, so there is no network round trip, no latency, and no failure mode
to handle. Reach for the API only for data the replace strings cannot give you.

---

## Architecture that works

1. **Scope every CSS selector** to your widget's root. No bare element
   selectors, ever.
   ```css
   #myWidget button { ... }     /* fine */
   button { ... }               /* restyles the entire homepage */
   ```
   Prefer a single id on your root and descend from it.

2. **Wrap all JavaScript in an IIFE.** Nothing at top level. The homepage is
   shared global scope.
   ```js
   (function () { 'use strict'; /* everything */ })();
   ```

3. **Namespace every DOM id** with a widget-specific prefix. You are sharing the
   document with D2L and every other widget.

4. **Keep it short.** The homepage is a commons with a tiny attention budget.
   A widget should earn its space against everything else competing for the same
   glance. If it needs scrolling, it is a topic.

5. **Degrade visibly but quietly.** A broken widget is on the homepage, so
   *everyone* sees it, unlike a topic nobody visited. Wrap API calls, and on
   failure render a short honest line rather than an error or a blank box.

6. **No completion state.** If it can be finished, it does not belong here.

7. **Set a verification global** at the end of init (e.g.
   `window.MY_WIDGET_READY = true`) so a deploy check can confirm it truly
   initialised.

A ready-to-edit starter is in `assets/starter/`. It demonstrates every rule
above and passes the lint clean.

---

## Before you deploy: run the gate

```bash
node harness/lint/lint.js <your-build-folder> --avenue widget
```

The widget rule set is different from the others. It checks for CSS leakage,
global leakage, unnamespaced ids, and using `{RoleId}` as if it were a security
boundary. It deliberately does **not** flag viewport units, because a widget is
not iframed and they behave normally here.

---

## Getting it into D2L

**Create the widget**

```
Course Admin -> Widgets -> Create Widget
  Properties tab       name it
  Content tab          click </>  paste  verify the script is there  Save
  Release Conditions   attach one if it must be hidden from students
```

**Place it**

```
Course Admin -> Homepages
  Create Homepage (the active one is often org-shared and not editable)
  Add Widgets -> search for yours -> Add
  Save and Close
  Active Homepage -> select yours -> Apply
```

**Then check it as a student.** Instructor preview is not a problem here the way
it is for SCORM, but release conditions and `{RoleId}` branching both need a
real student to verify. If you gated it, confirm it is genuinely absent rather
than merely hidden.

---

## One thing to say out loud when building an at-risk widget

A risk score derived from login frequency and submission timing measures
**compliance, not understanding**. A student who reads on paper, works ahead
offline and submits on time reads as disengaged. A student who logs in daily and
understands nothing reads as fine.

Build it. Label it honestly. Never show a student their standing relative to
peers, which reliably harms the people it is meant to help.

The wording around the number is not decoration. It is the part that decides
whether the thing helps or does damage.
