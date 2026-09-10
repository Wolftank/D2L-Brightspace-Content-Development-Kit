# The D2L skill spectrum: plan

Three deliverables: a faculty-facing routing checklist, a local tenant emulator
that gates deployment, and one build-and-deploy skill per avenue.

Everything below is derived from measurements in
[../probes/RESULTS.md](../probes/RESULTS.md), not from documentation. Where
something is still unmeasured it is marked.

---

## The three avenues, and why the boundary falls where it does

The avenues are not three flavours of the same thing. They run in different
origins, and that single fact determines what each can do.

| | A. External page | B. Content topic | C. SCORM package |
|---|---|---|---|
| Where it runs | anywhere you host it | **same origin as the LMS** | **content-service.brightspace.com** |
| Knows who the learner is | no | **yes**, via `whoami` | **yes**, learner id and name |
| Knows the learner's ROLE | no | **yes**, `ClasslistRoleName` | **no**, and no workaround |
| Reads D2L data | no | **yes**, role-scoped | **no**, sealed by CORS |
| Writes a gradebook score | no | not natively | **yes**, native |
| State across devices | no | no | **yes**, `suspend_data` |
| Attempt rules, best-of-N | no | no | **yes**, a setting |
| Author can test it | yes | yes | **no**, preview rejects writes |
| Easy to update | **yes** | moderate | repackage and publish |
| Heavy libraries, a backend | **yes** | risky | no |

**The load-bearing consequence: B and C do not compose.** A SCORM package cannot
reach the API, so no single object can both write a grade and behave differently
by role. Anything needing both is two objects. The checklist has to detect that
combination and say so plainly, because it is the mistake people will make.

---

## 1. The routing checklist

Plain-language questions. No LMS jargon, no mention of SCORM until the answer.

1. Is this really a quiz, a discussion, or a survey?
2. Is it graded work that counts, where a student seeing the answer key would matter?
3. Does a score need to reach the gradebook automatically, without you typing it in?
4. Does it need to remember where a student left off, on any device they log into?
5. Does it need to show different things to students than to you or a TA?
6. Does it need the student's name, or their actual course data?
7. Will you revise it often after it is live?
8. Does it need a library, a database, or anything fetched from the internet while it runs?

### Routing

```
Q1 yes                  -> ADVICE: D2L already has a tool for this. Overridable.
Q2 yes                  -> ADVICE: the answer key will be readable. Overridable.
Q3 or Q4 yes            -> C. SCORM package
Q5 or Q6 yes            -> B. Content topic
Q7 or Q8 yes (only)     -> A. External page
otherwise               -> B. Content topic (default: it feels in-course)

CONFLICT: (Q3 or Q4) AND (Q5 or Q6)
        -> Cannot be one object. Explain, and propose the pair:
           SCORM for the graded part, content topic for the role-aware part.
```

### Q1 and Q2 are advice, not gates

The first draft treated both as hard stops, with an instruction to go back and
change the answer to No. That was wrong. It asked faculty to misreport what they
are building in order to get past the tool, and it dismissed real reasons for a
bespoke build: wanting something genuinely engaging, or consistent with the
visual language of a course, or doing something the built-in tool cannot.

Both now present as advice with an explicit override, and the override is
**carried forward as a caveat on the final recommendation** rather than
forgotten. Someone who builds a custom high-stakes assessment still sees, on the
final answer, that the key will be readable.

Changing the underlying answer retires the override automatically, so the two
cannot drift out of step.

### Each answer ships with its costs, not just its name

Faculty should never receive a recommendation without the trade. For example,
the SCORM answer must say, in plain language:

- You will not be able to test it yourself. Your own view is a preview that
  silently discards everything it writes. You need a test student.
- It cannot tell a student from a TA.
- It can hold roughly 4000 characters of saved state, which is not much.
- If it marks itself complete too early, the student can never improve the score.

### Delivery

The checklist is itself an avenue-B content topic: self-contained HTML,
interactive, no identity needed, no grade. It is deliberately built under its own
rules, which makes it the reference implementation as well as the guide.

---

## 2. SCSU-Tenant-D2L-Emulator

Not graphical. A suite you run against a build before it goes anywhere near D2L.
It already exists in skeleton form as `harness/d2l-emulator.js` plus
`harness/tenant-profile.json`.

Two halves, because they catch different things:

### 2a. Static lint (fast, catches most)

Parses the build and flags rule violations without running it. Every rule below
traces to something we actually measured.

**SCORM builds**

| Rule | Severity | Because |
|---|---|---|
| Any request to `/d2l/api` or the tenant host | error | cross-origin, always fails |
| `100vh` or viewport units on the root | error | iframe auto-sizes |
| Root taller than ~600px | warn | embedded player will not scroll it |
| `Terminate`/`LMSFinish` on load | error | player hides your content |
| Writes `completed` before real interaction | error | locks all later attempts |
| `suspend_data` payload can exceed the cap | error | silent truncation |
| `localStorage` key without the learner id | warn | store is per browser, not per user |
| No `Commit` before `Terminate` | error | data lost |
| No `credit == 'no-credit'` guard | warn | writes silently discarded in preview and review |

**Content-topic builds**

| Rule | Severity | Because |
|---|---|---|
| Static `<script src>` for own data | error | executes in some courses, not others |
| `100vh` | error | iframe auto-sizes |
| Unwrapped `localStorage` access | error | it throws, taking init down |
| `localStorage` backing completion or grades | error | not authoritative, student-editable |
| Unnamespaced storage keys | warn | shared with the whole LMS |
| CDN dependency with no fallback | warn | campus policy may block |
| Writes to the grades API from a student-facing page | error | see open question below |

**External pages**: https, mobile layout, link permanence. Little to enforce.

### 2b. Runtime harness (catches behaviour)

Loads the build headlessly under the emulator, drives it, and reports the
violation log. Already implemented for SCORM; needs a content-topic mode that
emulates same-origin plus a role-aware API stub.

### The rule that keeps it honest

Every constraint comes from `tenant-profile.json`, and every entry carries a
`verified` flag. When the emulator enforces something unverified it says so in
its own output. That is what stopped us shipping the guess that SCORM could
reach the API.

**Gate:** zero errors to deploy. Warnings are advisory.

---

## 3. The skills

| Skill | Does |
|---|---|
| `d2l-experience-router` | Runs the checklist conversationally, routes, states the costs |
| `d2l-external-page` | Build and link an externally hosted page |
| `d2l-content-topic` | Build an HTML topic: bootstrap, storage, role-aware API use |
| `d2l-scorm-package` | Build, package, version, publish a SCORM object |
| `d2l-tenant-qa` | Run the emulator, gate the deploy |
| `d2l-activity-deployer` | Upload mechanics, shared by B and C. **Needs updating** |

The deployer already exists and is now materially out of date. It should absorb:
the SCORM upload path (Add Existing, not Course Admin), Manage Versions and the
explicit Publish step, the shadow-DOM file input locations, the CORS-server
pattern, and the fact that the generic page drop zone will happily accept a zip
and turn it into a useless file topic.

`d2l-activity-builder` in the SE 266 repo is effectively today's avenue B. The
plan assumes it becomes `d2l-content-topic` rather than being duplicated.

---

## Open questions that block parts of this

1. ~~**Can a student write their own grade via the API?**~~ **SETTLED
   2026-07-31. The boundary holds.** From a student session carrying a valid
   XSRF token: writing their own grade value returned **403**, creating a grade
   item returned **403 Not Authorized**, and writing their own assignment
   feedback failed with a 500. The grade stayed at 7/10 and no stray item was
   created.

   The nuance worth keeping: the XSRF token **is** available to students, so the
   protection is a server-side permission check, not client-side secrecy. That
   is the right architecture, and it means the lint rule stays **warn** rather
   than becoming an absolute prohibition. A content topic may safely *read*
   role-scoped data. It still must never be the thing that decides a grade,
   because D2L will refuse anyway and the attempt will look like tampering.
2. **Is `/dropbox/folders/{id}/submissions/` filtered for students?** Unresolved
   because only one student has submitted. If unfiltered, students can read each
   other's work.
3. **Actual `suspend_data` cap.** Presumed 4096. Never observed, because the run
   that would have shown it was not captured.

All three are answerable with the existing test account plus one more.
