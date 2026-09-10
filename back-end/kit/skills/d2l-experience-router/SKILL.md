---
name: d2l-experience-router
description: >-
  Use this skill FIRST whenever someone wants to build something custom for a
  D2L Brightspace course and it is not already settled which approach to use.
  Reach for it on any opening request like "I want an interactive thing in my
  course", "can we build X in D2L", "how should I make this activity", or when a
  faculty member describes an experience without naming a technology. It asks
  the eight questions that determine which of three avenues fits, names what
  that avenue costs, and detects the one combination that CANNOT be a single
  object. It also knows when the honest answer is "use the built-in D2L tool and
  build nothing". Routes to d2l-scorm-package, d2l-content-topic, or an
  externally hosted page, and hands off to d2l-tenant-qa before deployment.
---

# D2L Experience Router

Work out which of three avenues fits, before anyone writes code. Ten minutes
here saves rebuilding later, because the avenues are not interchangeable and
switching between them is close to a rewrite.

There is a faculty-facing version of this at
`builds/activity-chooser/`, deployable as a content topic. Use this skill to run
the same logic conversationally.

---

## Why the avenues differ: origin

Everything follows from where the code runs.

| | A. External page | B. Content topic | C. SCORM package |
|---|---|---|---|
| Runs on | your hosting | **same origin as the LMS** | **content-service.brightspace.com** |
| Knows the learner | no | yes | yes |
| Knows their **role** | no | **yes** | **no, and no workaround** |
| Reads D2L data | no | yes, role-scoped | **no, sealed by CORS** |
| Writes a gradebook score | no | no | **yes** |
| State across devices | no | no | **yes** |
| Attempt rules, best-of-N | no | no | **yes, a setting** |
| Author can test it | yes | yes | **no, preview discards writes** |
| Easy to update | **yes** | moderate | repackage and publish |

**B and C do not compose.** A package cannot reach the API, so no single object
both writes a grade and behaves by role. This is the most common wrong
assumption; catch it early.

---

## The eight questions

Ask in plain language. Do not name a technology until the end.

1. Is what they are describing basically a **quiz, survey, or discussion**?
2. Does it count toward a grade in a way where it would matter if a student
   could **read the answer key**?
3. Does a score need to reach the **gradebook on its own**, without them
   entering it?
4. Does it need to **remember where a student left off**, on a different
   computer?
5. Does it need to show **different things to students than to instructors or
   TAs**?
6. Does it need the **student's name, or real course data**?
7. Will they **revise it often** once it is live?
8. Does it need a **library, database, or anything fetched** while it runs?

### Routing

```
Q1 yes                -> ADVICE: D2L already has a tool. Overridable.
Q2 yes                -> ADVICE: the answer key will be readable. Overridable.
(Q3 or Q4) AND (Q5 or Q6) -> CONFLICT. Two objects, not one.
Q3 or Q4              -> C. SCORM package
Q5 or Q6              -> B. Content topic
Q7 or Q8 only         -> A. External page
otherwise             -> B. Content topic
```

---

## Q1 and Q2 are advice, not gates

If the underlying activity is a quiz, say so and explain what the built-in tool
gives them for free: grading, question pools, accommodations, accessibility, and
nothing to maintain.

Then **let them proceed anyway if they have a reason.** Wanting something
genuinely engaging, or consistent with the visual language of a course, or doing
something the built-in tool cannot, are all legitimate. They know their students.

Never ask someone to change an answer to get past the tool. That is asking them
to misreport what they are building.

When they override, **carry it forward**. A custom high-stakes assessment should
still end with a reminder that the answer key is readable, and a suggestion to
structure the task so that reading it does not get the marks anyway.

---

## Name the costs, always

A recommendation without its costs is a trap. Say these out loud.

**If SCORM:**
- You will not be able to test this yourself. Your own view is a preview that
  discards everything it writes and reports no error while doing it. Build
  against the emulator, which reproduces this locally, and line up a TA or
  colleague enrolled as a student for the single live check at the end.
- It cannot tell a student from a TA.
- About 4000 characters of saved progress, which is not much.
- If it marks itself complete too early, the student can never improve their
  score, and nothing will tell you.

**If content topic:**
- No automatic grade.
- Anything it remembers lives in one browser. Different computer, fresh start.
  Shared lab machine, shared state.
- Once live, never rename it and never open it in D2L's HTML editor. Both
  silently destroy it.

**If external page:**
- It has no idea who the student is. None.
- No grade, no tracking, no course data.
- Students leave the course, and some do not come back.
- If the hosting goes away, so does the activity.

---

## Avenue A has no separate skill, on purpose

An external page is an ordinary web page. There is no D2L-specific technique to
teach beyond: use https, make it work on a phone, and put a durable link in the
course. The only real decision is accepting that it knows nothing about the
learner.

If they want it to feel part of the course, that is avenue B.

---

## Handing off

| Outcome | Next |
|---|---|
| Built-in tool | Nothing to build. Point at Quizzes, Surveys or Discussions. |
| A. External page | Build it however they like. Link it from Content. |
| B. Content topic | `d2l-content-topic` |
| C. SCORM package | `d2l-scorm-package` |
| Conflict | Both, scoped separately. Challenge whether both halves are needed first. |

Before anything is uploaded: `d2l-tenant-qa`.

---

## Push back on the conflict case

When someone wants both a gradebook score and role-aware behaviour, the honest
first move is not to build two things. It is to ask whether the role-aware half
is a requirement or a convenience.

Often it is an instructor-facing view that could just be a separate page only
instructors are given the link to. That collapses the whole problem.
