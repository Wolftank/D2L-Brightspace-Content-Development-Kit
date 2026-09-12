---
name: d2l-activity-deployer
description: >-
  Use this skill to get a finished build into a D2L Brightspace course and verify
  it actually works: uploading files, creating topics, uploading and publishing
  SCORM packages, replacing files, and confirming the deployed thing truly
  initialised. Reach for it whenever someone says they want to upload, deploy,
  publish, push, or update something in D2L, or asks why an upload did not take
  effect. Covers both browser-driven automation and the manual clicks, including
  several traps that make a failed upload look like a successful one. Supersedes
  the earlier version of this skill, which predates SCORM support.
---

# D2L Activity Deployer

Getting a build into D2L, and confirming it works. Verified against
`stcloudstate.learn.minnstate.edu`.

---

## Two hard rules, before anything else

- **Never rename a live topic.** D2L's rename re-serializes the page content and
  silently corrupts inline JS and SVG. Name the file its final title *before*
  deploying.
- **Never open a live topic in D2L's HTML editor.** Same corruption, same
  silence. Even opening and cancelling can do it.

Both failures look fine until a student reports the activity is blank.

---

## Where things go

### HTML content topics

```
/content/<year>/<ou>-<course>/
├── Your Topic Title.html        <- shells live at the content root
└── res/                         <- per-topic folder for data and assets
```

Create the topic via the **Lessons drop zone** (unit → Add Existing → drop
zone). That uploads the file *and* creates the topic, titled from the file name
with `.html` stripped. Using "Add Existing → Course File" on an already-uploaded
file keeps `.html` in the title, so avoid it for student-facing topics.

Data and asset folders go up separately through **Manage Files**.

Driving this from automation: the drop zone's real `<input type=file>` already
exists inside a `<d2l-labs-file-uploader>` custom element's shadow root — no
picker to suppress, no "browse" click needed. Walk into the `smart-curriculum`
iframe and its shadow roots to find it, then assign a `File` built with the
iframe's own constructors:

```js
var ifr = document.querySelector('iframe').contentWindow;   // smart-curriculum iframe
var idoc = ifr.document, inp = null;
(function walk(root,d){ if(d>12||inp) return;
  root.querySelectorAll('*').forEach(function(el){
    if(el.tagName==='INPUT' && (el.type||'').toLowerCase()==='file') inp=el;
    if(el.shadowRoot) walk(el.shadowRoot,d+1);
  });
})(idoc,0);

var txt  = await (await fetch('http://127.0.0.1:8757/Your File.html',{cache:'no-store'})).text();
var file = new ifr.File([txt], 'Your File.html', {type:'text/html'});   // name = desired topic title + .html
var dt   = new ifr.DataTransfer(); dt.items.add(file);
inp.files = dt.files;
inp.dispatchEvent(new ifr.Event('change', {bubbles:true}));
```

**The uploader consumes the file and clears the input on `change`**, so reading
`inp.files[0]` *after* dispatch throws "undefined" — expected, not a failure.
Confirm success by checking the tab navigated to a new `…/topics/<id>` URL,
then verify (below).

### Manage Files lives under /lp/, not /lms/

```
https://<tenant>/d2l/lp/manageFiles/main.d2l?ou=<ou>
```

Measured Aug 2026. Both `/d2l/lms/manageFiles/main.d2l?ou=` and
`/d2l/lms/courseadmin/courseadmin.d2l?ou=` return **404** on this tenant, so the
plausible guesses all fail. From the UI it is **Course Tools → Manage Files**.

### Updating existing topics: replace the files, not the topics

The safest way to push a new version of one or more live topics is to open
Manage Files at the content root, upload all of them at once, and overwrite. The
file input is `multiple`, so one pass handles the whole set.

This is preferred because it **never touches the topic**: titles, topic ids and
the topic→file mapping all survive, which sidesteps the rename corruption above.
Verified on a six-file batch with zero duplicates and every topic still bound to
its file.

### SCORM packages

Not in Course Admin, which is why it looks missing:

```
Content -> a unit -> Add Existing -> SCORM/xAPI Object -> Bulk Upload
```

The zip must have `imsmanifest.xml` at its **root**. Use `build-scorm.ps1`,
which passes `folder\*` to `Compress-Archive` for exactly this reason and
validates that every declared file exists.

At add time D2L asks for: a grade item (defaults to Yes), **Grade Calculation
Method** (Highest Attempt by default; this is where best-of-N comes from),
version control, and embedded vs new-window player.

---

## Updating a live SCORM package

```
Add Existing -> SCORM/xAPI Object -> the package's "..." menu -> Manage Versions
```

Upload the new zip. It **stages**, and then you must click **Publish**
explicitly. D2L warns that publishing updates the asset everywhere it is
inserted and makes it the only version available to insert. Older versions stay
listed but cannot be added anywhere new.

---

## Traps that make failure look like success

### The wrong file input

There are several `input[type=file]` elements live at once, and the obvious one
is usually wrong.

- **Lessons drop zone (new topic):** hidden inside a `D2L-LABS-FILE-UPLOADER`
  custom element's **shadow root**, nested inside the `smart-curriculum` app
  iframe.
- **Manage Files:** the dialog renders inside a same-origin `blank.html` target
  iframe; the real input is `input.d2l-fileinput-input[type=file]` in there.
  Two copies exist; use the first.
- **SCORM version upload:** specifically
  `d2l-content-manage-versions` → `content-file-uploader` → `input`.

> The page behind the Manage Versions dialog **also** has a generic drop zone.
> Targeting the first `input[type=file]` you find will upload your SCORM zip as
> a plain downloadable file topic instead of a version. It reports success and
> creates a useless topic. Match on the containing custom element, not on order.

None of these are visible to a plain `document.querySelectorAll('input[type=file]')`
from the top frame. Walk into iframes and shadow roots. Click the visible
"Upload" button first, because it lazily renders the input.

### The Confirm File Replace dialog

Its checkboxes are shadow-DOM components. Ticking them from page JS silently
fails and D2L then saves the upload as `name(1).html` copies instead of
overwriting. Click the select-all checkbox and the Overwrite button by
coordinates from a screenshot.

**Do not trust a DOM read of the checkbox state either — confirmed unreliable
on a real run.** A real coordinate click correctly ticked the box and the file
was genuinely overwritten in place (confirmed by size/timestamp changing on the
same filename, no `(1)` duplicate), but an immediate DOM read afterward showed
`checked: false` on every checkbox reachable via a full shadow-root traversal —
a false negative. This component's visible state does not appear to be backed
by a plain native `checked` attribute at all.

**The only verification that actually matters:** after clicking Overwrite,
reload the file listing and confirm, for the target filename, that the
size/timestamp changed *and* no sibling `name(1).html` exists. That is ground
truth; nothing about the dialog's own DOM should be trusted either way — not a
screenshot (the renderer has hung mid-dialog and returned a garbage frame, and
a previous coordinate miss was 16px off and looked fine at normal
magnification), and not a DOM query either.

Assert `dupeCount === 0` against `/\(\d+\)\./` on the reloaded listing — a
silent `name(1).html` is the failure this dialog produces when a tick didn't
actually register.

### Saving mid-upload

Clicking Save before the progress bar finishes fails with "Select at least one
file". The files stay staged, so just Save again once staging completes.

---

## Driving uploads from automation

File bytes are fetched **browser-side** from inside the target iframe's own
realm, so a plain `python3 -m http.server` will not do: the cross-origin fetch
from the tenant fails silently without CORS headers. Run the permissive server:

```bash
python cors_server.py      # serves the current directory on 127.0.0.1:8757
```

Then, in the page:

1. Suppress the native picker, or a real OS dialog opens and blocks everything:
   ```js
   var proto = win.HTMLInputElement.prototype;
   var orig = proto.click;
   proto.click = function () { if (this.type === 'file') return; return orig.apply(this, arguments); };
   ```
2. Fetch the bytes and assign a real `File` **using the target iframe's own
   constructors**, not the top frame's:
   ```js
   var buf = await win.fetch('http://127.0.0.1:8757/build.zip').then(r => r.arrayBuffer());
   var dt = new win.DataTransfer();
   dt.items.add(new win.File([buf], 'build.zip', { type: 'application/zip' }));
   target.files = dt.files;
   target.dispatchEvent(new win.Event('change', { bubbles: true }));
   ```
3. Wait for the progress bar before clicking anything else.

Other automation notes:

- **Unit reordering:** drag events do not work. Click the unit's drag handle to
  enter keyboard-reorder mode, which exposes real ▲▼ buttons. Watch nesting:
  moving up past a unit's topics first nests INTO that unit; one more ▲ pops it
  above.
- **Coordinates go stale** across navigations and re-renders. Re-screenshot
  between steps rather than batching a long click sequence from one snapshot.

### Chrome MCP tool quirks

- Returning long token-like or `=`-heavy strings, or URLs with query strings,
  can trip an output filter ("[BLOCKED: Cookie/query string data]"). Stash
  results on a `window.__x` var and read back short, plain fields instead; for
  large page text, inject it into a top-document element and use a
  text-extraction tool.
- Output is truncated around ~1000 chars — return compact confirmations, not
  whole file dumps.
- `navigate` may prepend `https://` — to open a local file, serve it over
  `http://127.0.0.1` rather than using a `file://` URL.
- **`javascript_tool` needs a top-level `await` on the expression whose result you
  want, not a bare async call.** `async function run() { ... } run();` reliably
  reports back `{}` — the tool serializes the pending `Promise` `run()` returns as
  the "last expression," before it resolves. The side effects inside still
  happen (a click really lands, a `fetch` really completes); only the reported
  result is lost, which reads exactly like "nothing happened" and is easy to
  misattribute to the upload itself failing. Write `await run()` as the final
  line, or skip the wrapper and write the `await` directly:
  `await win.fetch(...)`, not `win.fetch(...).then(...)` fired and forgotten.

---

## Creating content through the API instead

For anything repetitive, skip the UI. Writes work with session auth:

```js
var token = D2L.LP.Web.Authentication.Xsrf.GetXsrfToken();
fetch('/d2l/api/le/1.96/' + ou + '/dropbox/folders/', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Csrf-Token': token },
  body: JSON.stringify(payload)
});
```

Assignments, grade items, feedback and grade values were all created this way.

> **Never trust a 2xx.** Measured twice: the API returned **200** while
> discarding part of the payload. Feedback sent as the documented
> `{Content, Type}` rich-text shape stores **nothing**; the working shape is
> `{Text, Html}`. A folder `PUT` carrying `GradeItemId` returned 200 with the
> field still null. **Read back and assert after every write.**

Also note: assignment feedback and the gradebook comment are the **same field**.
Writing a grade comment destroys existing assignment feedback, byte-identical on
read-back, with no warning.

---

## Verify it actually initialised

Rendering is not initialising. A corrupted topic often still renders.

Check the verification global your build sets (`window.MY_ACTIVITY_READY`) from
inside the live topic, traversing the nested frames. For a content topic the
frames are same-origin and readable. For SCORM the package is **cross-origin**,
so you cannot reach into it: verify by observing behaviour and by checking the
gradebook instead.

**`window.frames` alone will lie to you.** The topic iframe sits inside a
**shadow root**, so a plain frame walk reports the topic as uninitialised when it
is working perfectly. This has produced a false negative twice. Recurse through
`shadowRoot` as well as `contentDocument`, and give the page a couple of seconds
— the content frame is not populated when the outer page settles.

Two further notes from a live run:

- **Do not return iframe `src` or response URLs** from an automation eval. They
  carry session tokens and the whole result gets blocked, costing a round trip.
  Return booleans and counts instead.
- **Assert on content, not just on upload.** Check that new strings are present
  *and* that the strings they replaced are absent. Matching sizes prove bytes
  moved; only the absent-old check proves you are not looking at a cached or
  half-replaced page.

And for SCORM, remember you cannot verify it from your own account at all.
Instructor preview discards every write while reporting no error. Use a student
enrollment.

### Quick triage

| Symptom | Likely cause | Action |
|---|---|---|
| Blank topic / nothing renders | wrong file attached, or files not in same folder | re-check the Course File attached; confirm siblings uploaded together |
| Renders but clicks/filters/modals dead | editor or rename corruption (see the two hard rules) | re-upload the clean local `index.html` via Overwrite, re-verify |
| Works locally, blank in D2L only | depended on a static `<script src>` or a blocked CDN | rebuild to inline or inject the dependency, redeploy |
| Data missing/`undefined` | static `<script src="data.js">` (inert in some courses) | rebuild to load data via injection/fetch, redeploy |
