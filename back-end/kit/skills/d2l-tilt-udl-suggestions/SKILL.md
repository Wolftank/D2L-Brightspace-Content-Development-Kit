---
name: d2l-tilt-udl-suggestions
description: >-
  Use this skill every time you build or change a D2L activity, to find up to
  three optional design suggestions from TILT (a stated purpose, task and
  criteria) and UDL (more than one way to engage with the material, take it in,
  and show learning), and record them with CDK's record_suggestions tool. Also
  use it when an instructor asks directly what could be improved in an
  activity or an assignment they pasted or attached; then answer in the chat.
  Suggestions are never a gate: the instructor decides, and you never make a
  suggested change on your own.
---

# TILT and UDL suggestions

Design feedback on the activity, in the instructor's hands. It is not a grade,
not a judgment of the content's quality, and not part of the QA gate. The
background is `docs/TILT_UDL_Reference.docx` in the kit.

---

## When

- **After every build or change**, once the activity is finished and checked,
  before you reply. Look at the activity in `out/` as students will see it.
- **An attached assignment counts too.** When the instructor attached an
  assignment as source material, check it for each TILT element on its own,
  as students will read it. Each element it never states is a gap, even when
  the activity you built is fine, such as a practice quiz whose answers are
  clear while the assignment it prepares for names no criteria.
- **A direct request**, such as "what would you improve in this assignment?",
  gets an answer in the chat that follows the same steps: at most three
  suggestions, most useful first, each with its reason, written as ordinary
  sentences with no list, as your reply rules require. Record nothing and
  build nothing for it.

---

## What to look for

### TILT: the individual assignment

TILT asks that three things be stated to students, in language written for
them, before they start:

| Element | Stated when students can find |
|---|---|
| `Purpose` | What skill or knowledge the work builds, why it matters for the course, and how it carries beyond it |
| `Task` | Concrete steps for what to do and how, and the format to hand in |
| `Criteria` | The named traits that separate strong work from weak, before they submit, not only as a rubric after grading |

An element counts as stated once students can find it in student-facing
words. A stated element is done: make no suggestion about it, not even to add
detail such as rubric levels, examples, or more steps.

Having a due date and a grade weight is not the same as stating a purpose.
Reasoning that lives only in the instructor's message or in instructor-only
notes is invisible to students, so it does not count.

### UDL: more than one way in

UDL works at the level of the course, but each activity is a part of it:

| Principle | The question |
|---|---|
| `Engagement` | Does it recruit interest, sustain effort, and help students track their own progress? |
| `Representation` | Is the content presented in more than one way: text with a diagram, audio, or worked example? |
| `Action & Expression` | Can students show the learning in more than one way, or is the objective locked to a single format? |

The core UDL move is separating the objective from the format used to show it.
An essay is not a problem; an objective that only an essay can show is.

---

## Choosing

1. Call `mcp__cdk__get_project` and read `earlierSuggestions`. The instructor
   has already seen each of them and can ask for any in the chat. Never repeat
   one, in the same or different words, and never suggest something the
   instructor declined.
2. List the gaps, in the activity and in any attached assignment. Missing
   TILT elements come first, because they decide whether students know what
   to do and what success looks like.
3. Keep at most three, most useful first. One suggestion per element or
   principle.
4. Leave out anything already done, anything the activity's format cannot do,
   and polish that would not change what students experience.
5. Nothing worth suggesting is a good result. Do not invent a suggestion to
   fill the list.

---

## Writing each one

- `framework`: `tilt` or `udl`.
- `principle`: exactly one of `Purpose`, `Task`, `Criteria` for TILT, or
  `Engagement`, `Representation`, `Action & Expression` for UDL.
- `suggestion`: one plain sentence saying what to add or change, specific to
  this activity. For example: "Add two sentences at the top saying what the
  practice set prepares students for in the lab report."
- `reason`: one plain sentence grounded in the framework. For example:
  - "Students do better when they see the criteria before they start."
  - "Knowing why an assignment matters raises students' confidence and
    motivation, most of all for first-generation students."
  - "Letting students choose how to show the skill keeps the objective
    separate from one format."

No jargon the instructor would need to look up, and no file names or code.

---

## Recording

Call `mcp__cdk__record_suggestions` once, with the final list, after the last
change to the activity in this request. Record an empty list when nothing needs
changing, so the build shows none. The last call in a request wins.

**Do not make the suggested changes.** Build what the instructor asked for.
They read the suggestions on the build card and ask for the ones they want.

In your reply, mention the suggestions once, in a single sentence, for example
"I left two optional design suggestions on the build card.", and leave the
details to the card. Never say that you recorded them. Say nothing about
suggestions when you recorded none.
