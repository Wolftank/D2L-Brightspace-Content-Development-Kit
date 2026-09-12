---
name: d2l-scorm-package
description: >-
  Use this skill to build a SCORM package for D2L Brightspace: an activity that
  writes a score straight to the gradebook, supports attempt limits and
  best-of-N, and remembers a learner across devices. Reach for it whenever the
  user wants a D2L activity that is GRADED automatically, or that must resume on
  a different computer, even when they only describe the thing they want ("a
  self-marking drill that goes in the gradebook", "a practice set students can
  retake three times", "an exercise that remembers where they left off"). Do NOT
  use it when the activity needs to know the learner's role or read D2L data; a
  SCORM package is served cross-origin and is sealed off from all of that, so
  route those to d2l-content-topic instead. The SCORM run-time on our tenant has
  several behaviours that fail SILENTLY and are not in the vendor
  documentation, including an instructor preview that discards every write while
  reporting no error. This skill encodes what we measured.
---

# D2L SCORM Package

Build a SCORM package that runs as a graded activity in D2L Brightspace.

Everything here was measured against **our own tenant**
(`stcloudstate.learn.minnstate.edu`), not taken from documentation. Several
findings contradict the documentation. Full evidence is in
`probes/RESULTS.md` and `harness/tenant-profile.json` in the D2L_Code repo.

---

## Read this before you write a line

Four behaviours cost real time to discover. All four fail **silently**.

### 1. You cannot test your own package

An instructor opening a SCORM object gets a preview:

```
cmi.core.student_id     "preview"
cmi.core.student_name   "Without Tracking, Preview"
cmi.core.credit         "no-credit"
cmi.core.lesson_mode    "browse"
```

In that mode **every `SetValue` is refused**. `suspend_data` accepted 0
characters at every size tested. Score writes failed. Status writes failed.

And the refusals come back with **error code 0**. An activity that dutifully
checks `GetLastError()` after each write sees no error while persisting nothing.

> You need a real student enrollment to verify anything. Ask for one before you
> start building, not after.

### 2. Marking "completed" locks the learner out

Once the activity reports `lesson_status = "completed"`, D2L serves later
launches with `mode = "review"` and `credit = "no-credit"`, and rejects every
write.

An activity that marks itself complete on load gives each student exactly one
scoring opportunity, and best-of-three silently stops working. Nothing errors.

> Write `completed` only when the learner is genuinely finished. Never on load.

### 3. Terminating hides your content

Calling `LMSFinish` / `Terminate` makes the D2L player immediately replace the
package with "This activity is complete." The learner never sees anything.

`Commit` alone persists the data. Terminate only when the learner is done
looking at things, or not at all and let D2L close the attempt on navigation.

### 4. Storage is per browser, not per user

A package runs on `content.us-east-1.content-service.brightspace.com`. That
origin is shared by **every SCORM package in every course**, and its
`localStorage` follows the browser, not the D2L account. Signing out and back in
as someone else does not change it.

> Key every stored value by learner id, and never put anything private in it.
> Two students on one lab machine share the store.

---

## The hard boundary: no API, ever

A package is served cross-origin to the tenant. Measured:

| Attempt | Result |
|---|---|
| `fetch('/d2l/api/...')` | 403 `MissingKey` from the content CDN |
| `fetch('https://<tenant>/d2l/api/...')` | CORS failure, no response |

There is no path from a package to the Brightspace API, and no session cookie.
A package therefore **cannot know the learner's role**. SCORM has no role field
either, in 1.2 or 2004.

If the activity needs role awareness, it is not one object. It is a SCORM
package for the grade plus a content topic for the role-aware surface. Say so
early; it is the most common mistake.

---

## What the run-time gives you here

- **SCORM 1.2 only.** `window.API` at parent depth 1. No `API_1484_11`.
  Budget **4096 characters** of `suspend_data`, not 64000.
- **Learner id and name**, real ones, in a real attempt.
- **Score to the gradebook**, verified end to end.
- **Attempt rules are a D2L setting, not code.** At add time you choose Highest
  Attempt (default), Lowest, Average of all, Last, or First. Do not build
  best-of-N yourself.
- `<adlcp:masteryscore>` in the manifest reaches the run-time as
  `cmi.student_data.mastery_score`.

---

## Architecture that works

1. **One `index.html` with the engine inline.** Static `<script src>` does work
   inside a package, but inline is still safer if the same build might ever run
   as a content topic, where the behaviour flips between courses.

2. **Guard every write.** `credit == "no-credit"` is the one reliable signal that
   this launch will not be recorded. It covers instructor preview *and*
   post-completion review.

   ```js
   var recording = (G('cmi.core.credit') !== 'no-credit');
   if (!recording) showBanner('Preview mode. Nothing you do here is saved.');
   ```

3. **Budget `suspend_data` explicitly.** Serialize compactly, measure before
   writing, and degrade rather than truncate.

   ```js
   var MAX = 4000;                       // under the 4096 ceiling, with room
   var blob = JSON.stringify(state);
   if (blob.length > MAX) blob = JSON.stringify(trim(state));
   ```

4. **Defer completion.** Set `incomplete` while working. Write `completed` only
   from the action that genuinely ends the activity.

5. **Commit on every meaningful change.** Cheap, and the alternative is losing a
   session.

6. **Keep the UI short.** The embedded player will not scroll a tall child.
   Measured: wheel, scrollbar drag, keyboard and parent resize all failed
   against a 1100px root. Stay under ~600px, or set the instance to
   **Open player in new window**.

7. **Key storage by learner id**, if you use `localStorage` at all. Prefer
   `suspend_data`, which is per learner and server-side.

There is a ready-to-edit starter in `assets/starter/`. It demonstrates every
rule above and passes the lint clean. Copy it rather than starting from scratch.

---

## Before you deploy: run the gate

```bash
node harness/lint/lint.js <your-build-folder> --avenue scorm
```

Zero errors to deploy. The rules encode exactly the failures above, so a clean
run means you have not made any of the four mistakes.

Then package it. The manifest **must** be at the zip root:

```bash
powershell -File build-scorm.ps1 -Source <your-build-folder> -Out dist/<name>.zip
```

`Compress-Archive` on a folder path nests everything one level down and D2L
rejects it with an unhelpful error. The build script passes `folder\*` for this
reason and validates that every file the manifest declares actually exists.

---

## Getting it into D2L

The upload path is **not** in Course Admin, which is why it looks missing:

```
Content -> a unit -> Add Existing -> SCORM/xAPI Object -> Bulk Upload
```

At add time D2L asks:

- **Create a grade item for this instance?** Defaults to Yes.
- **Grade Calculation Method.** Highest Attempt is the default. This is where
  best-of-N comes from.
- **Version Control.** Always latest, or pin this version.
- **Player.** Embedded, or new window. Choose new window if the UI is tall.

### Updating a live package

`... -> SCORM/xAPI Object -> the package's ... menu -> Manage Versions`

Upload the new zip, then click **Publish** explicitly. D2L warns that this
updates the asset everywhere it is inserted and makes it the only version
available to insert. Old versions stay listed but cannot be added to new places.

**Automation note:** the page behind that dialog also has a generic drop zone.
Targeting the wrong `input[type=file]` uploads the zip as a plain downloadable
file topic instead of a version, which looks like success. The version uploader
is specifically `content-file-uploader` inside `d2l-content-manage-versions`.

---

## Verifying it actually works

**Before you need a real student enrollment, run it against the emulator.**
`harness/emulator-harness.html` (see `d2l-tenant-qa`) loads your actual build
in an iframe with `D2LEmulator` installed at the same parent depth the real
player uses. Pick "Instructor (preview)" to confirm your credit-guard actually
holds — that writes attempted under `credit === 'no-credit'` are the ones the
emulator flags as `discarded-no-credit`, not silently accepted. This catches a
missing or broken guard before it costs someone else's enrollment to find.

With a real student enrollment, which the emulator cannot substitute for:

1. Open the activity as the student. Confirm `credit` reads `credit`, not
   `no-credit`, and the learner id is real.
2. Do the thing, finish it, and check the gradebook from your own account.
3. Take it again with a different score and confirm the grade calculation picks
   what you expect.
4. Reopen after completion and confirm the activity behaves sensibly in review
   mode rather than appearing broken.

Set a verification global at the end of init (e.g. `window.MY_ACTIVITY_READY =
true`) so a deploy check can confirm it truly initialised rather than merely
rendered.
