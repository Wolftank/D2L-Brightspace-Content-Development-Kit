# Synthetic semester: design notes

Internal design for the agentic QA suite. The IT-facing version is
[IT_Proposal_Synthetic_Accounts.md](IT_Proposal_Synthetic_Accounts.md).

---

## Build it in three tiers

The full vision is twelve agents driving a real D2L course through sixteen weeks.
That is the last tier, not the first, because most of what we want to learn does
not require D2L at all. Building the expensive tier first means spending weeks of
automation effort to discover problems a cheap harness finds in an afternoon.

### Tier 1: personas against the materials. No D2L, no accounts.

Run personas against the assignment specs, rubrics, and week outlines as text.
Ask each persona to attempt the work, and record where it stalls, what it
misreads, and what it can complete without learning anything.

Catches: ambiguous instructions, missing prerequisites, assignments that can be
shortcut, rubric criteria that cannot be judged from the deliverable, deadline
pileup, unrealistic time estimates.

Cost: minutes per run. No IT dependency. **This is where the value density is
highest, and it is available right now.**

### Tier 2: integration checks against D2L. Few accounts, no personas.

Does the SCORM activity write the grade. Does best-of-3 select correctly. Do
release conditions fire for the right roles. Does the gradebook math produce the
tier gates we intend.

These are mechanical assertions. A script taking three attempts does not need a
personality. Two or three accounts is enough, and this is mostly what the probe
kit in `probes/` already sets up.

### Tier 3: the full synthetic semester.

Twelve personas, real accounts, real course, full calendar. Worth doing, and it
catches things the other two cannot: emergent load, discussion dynamics, the
experience of a course rather than of an assignment.

Do it after tiers 1 and 2 have already removed the obvious defects, so the
expensive run is spent finding subtle problems rather than typos.

---

## Personas as dimensions, not characters

Hand-authored characters feel realistic and test poorly. Twelve named students
give twelve anecdotes with no way to attribute a failure to a cause. Sampling a
dimensional space gives the same realism plus the ability to say *which* trait
broke the course.

Proposed axes:

| Dimension | Levels |
|---|---|
| **Effort** | minimum viable, adequate, something to prove |
| **Integrity** | shortcuts whenever possible, situational under pressure, never |
| **Tech fluency** | naive, competent, expert |
| **Verbosity** | terse, normal, verbose |
| **Reliability** | early, on time, chronically late, erratic |
| **Help seeking** | asks early, asks only when desperate, never asks |

The last axis is not in the original list and is arguably the most important.
The student who is stuck and silent is the one who fails, and silent failure is
the hardest thing to detect by reading your own course. A persona that is
tech-naive **and** never asks for help is the single most diagnostic combination
we can run.

Note also that "shortcuts even when doing the work would be easier" is a real and
worthwhile behavior to model. It is not irrational: it is what a student does when
they have decided the work is not worth engaging with. If a course invites that
posture, we want to know.

### Sampling

The full space is 3×3×3×3×4×3, which is far more than twelve. Do not sample
randomly. Choose twelve cells deliberately:

- roughly six that mirror a realistic cohort distribution, so aggregate results
  (grade spread, submission timing, grading load) mean something
- roughly six chosen as diagnostic extremes, including tech-naive plus
  never-asks, shortcuts plus expert, and something-to-prove plus verbose

Record the cell coordinates with every result. A finding is only actionable when
we can say which trait produced it.

### Keep the persona separate from the account

The persona is a config object. The D2L account is a credential. Bind them at run
time so a persona can be re-run against a different account, and an account can
carry a different persona next semester. If personas get hardcoded into accounts
we lose the ability to re-run a clean cohort.

---

## What we are actually measuring

Worth naming, because a QA suite without assertions is just an expensive
simulation:

- **Stall rate per assignment.** Where does a persona stop making progress?
- **Shortcut discovery.** Which assignments were completed without engaging the
  concept, and how?
- **Instruction ambiguity.** Points where two personas made incompatible
  reasonable readings of the same text.
- **Grading load.** Wall-clock estimate to grade the cohort's output against the
  rubric.
- **Rubric discrimination.** Do tier gates actually separate the effort levels,
  or does the minimum-effort persona clear the same bar as the overachiever?
- **Calendar pressure.** Submissions per week, and the worst week.

---

## Open questions

- Do we drive tier 3 through the browser (high fidelity, brittle, slow) or the
  Valence API (fast, cannot test the student UI)? Probably browser for a few
  personas and API for the rest, but the probe results should inform this.
- How do we judge a synthetic submission? A rubric-applying agent grading
  synthetic work has obvious circularity risk. Mark should hand-grade at least
  one full persona's output to calibrate.
- Does any of this need IRB attention? Almost certainly not, since there are no
  human subjects and no real student data. Worth one email to be certain.
