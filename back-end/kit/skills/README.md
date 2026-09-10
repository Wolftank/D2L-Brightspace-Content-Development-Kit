# The D2L skill spectrum

Six skills. One entry point, four build paths, one gate.

```
                       d2l-experience-router
                       (start here, questions)
                                 |
     +---------------+-----------+-----------+------------------+
     |               |           |           |                  |
built-in tool   A. external  B. content  C. SCORM        D. homepage widget
(build nothing) (no skill)   topic       package         d2l-homepage-widget
                             d2l-content d2l-scorm-             |
                             -topic      -package               |
                                 |           |                  |
                                 +-----------+------------------+
                                             |
                                       d2l-tenant-qa
                                    (gate before deploy)
                                             |
                                   d2l-activity-deployer
```

| Skill | Use when |
|---|---|
| [`d2l-experience-router`](d2l-experience-router/SKILL.md) | Someone wants to build something in D2L and the approach is not settled |
| [`d2l-content-topic`](d2l-content-topic/SKILL.md) | It must know who is looking, or their role |
| [`d2l-scorm-package`](d2l-scorm-package/SKILL.md) | It must put a score in the gradebook, or resume across devices |
| [`d2l-homepage-widget`](d2l-homepage-widget/SKILL.md) | It must be seen without anyone navigating to it, or be genuinely invisible to students |
| [`d2l-tenant-qa`](d2l-tenant-qa/SKILL.md) | Anything is about to be uploaded, or is misbehaving in D2L |
| [`d2l-activity-deployer`](d2l-activity-deployer/SKILL.md) | Getting a finished build into a course, and verifying it |

## Destinations, and one that isn't

Three of the four build paths are **destinations**: you go to a topic, you take
a SCORM activity, you visit an external page. A **widget is a condition of the
space**. You do not go to it; it is simply there.

That single distinction decides most placements, and the reasoning is written up
in [../docs/Placement_and_Pedagogy.md](../docs/Placement_and_Pedagogy.md). The
short version: if the value depends on reaching people who do not know they need
it, it cannot be a destination.

---

## Two design decisions worth knowing

**Avenue A has no skill.** An externally hosted page is an ordinary web page.
There is no D2L-specific technique to teach beyond using https, working on a
phone, and putting a durable link in the course. The guidance lives in the
router. A skill would have been ceremony.

**`d2l-activity-builder` is superseded** by `d2l-content-topic`. It was
effectively avenue B already, but predates everything measured about session
auth, role detection, and the security boundary. Two skills describing the same
avenue would drift.

**Widgets were missing from the first version of this spectrum.** They were
identified in the earliest conversation, a probe was written, and then they got
folded into "content topic" when the set was scoped down to three. That was
wrong: a widget is not a content topic in a different frame. It is not iframed,
its CSS and globals leak into the shared homepage, and it is the only avenue
with server-enforced visibility. The gap was caught by IT reading along.

---

## The thing all five have in common

Every claim traces to something measured on
`stcloudstate.learn.minnstate.edu`, recorded in [`../probes/RESULTS.md`](../probes/RESULTS.md)
and enforced by [`../harness/`](../harness/). Where something is a guess, it is
marked `verified: false` in the tenant profile and the tooling says so out loud.

That discipline exists because this project began with a confident, wrong
belief: that a widget reading gradebook data was a SCORM object. It was not, and
a whole architecture nearly got built on it.

---

## The four findings that most often bite

Worth knowing even without reading a skill in full. All four fail **silently**.

1. **An instructor cannot test a SCORM package.** Preview discards every write
   and reports error code 0 while doing it.
2. **Marking `completed` too early locks the learner out** of improving their
   score, and quietly breaks best-of-N.
3. **A SCORM package cannot reach the Brightspace API.** It is cross-origin.
   No role, no course data, no workaround.
4. **The API returns 200 while discarding parts of a payload.** Read back and
   assert after every write.

---

## Starters

`d2l-scorm-package` and `d2l-content-topic` each ship a working starter under
`assets/starter/`. Both pass the lint clean and demonstrate every rule the skill
argues for. Copy one rather than writing boilerplate.

```bash
node harness/lint/lint.js skills/d2l-scorm-package/assets/starter --avenue scorm
node harness/lint/lint.js skills/d2l-content-topic/assets/starter --avenue topic
```
