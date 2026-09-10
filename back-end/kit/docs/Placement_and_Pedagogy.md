# Placement and pedagogy: where a thing should live in a course

A design note, written before rewriting the router to add homepage widgets.

The technical differences between the build avenues are recorded in
[../probes/RESULTS.md](../probes/RESULTS.md) and enforced by
[../harness/](../harness/). This note is about the *other* question, the one
faculty actually ask: not "what can this technology do" but "where does this
thing belong."

Audience note: this repo is developed in the open in a shared sandbox, and IT
reads along. Written accordingly.

---

## The one-line boundary

**Three of the four avenues are destinations. A widget is not a destination, it
is a condition of the space.**

You go to a content topic. You take a SCORM activity. You visit an external
page. You do not "go to" a widget. It is simply there, the way a poster on a
classroom wall is there.

Everything below follows from that one distinction.

---

## Four kinds of thing, four homes

A course contains four categorically different things. Faculty already think in
these terms; they just do not map them to technologies.

| What it is | Its nature | Where it belongs |
|---|---|---|
| **Ambient state** | Always true. No beginning, no end. Nobody completes it. | **Homepage widget** |
| **Sequenced learning** | Has an order. You work through it. | Content topic |
| **Bounded assessment** | An attempt, with a result that counts | SCORM, or native Quizzes |
| **Reference** | Consulted, not worked through | External page |

Most mis-placement comes from putting ambient state in a destination. A "how am
I doing" page is a contradiction: the students who would benefit from it are the
ones who will not go and look.

---

## The decisive question

If you ask a faculty member only one thing, ask this:

> **Does the student have to have decided to look at this?**

A content topic requires an act of navigation. Navigation requires an intention.
An intention requires already knowing you need the thing.

A widget requires none of that.

So the real test is: **does the value of this depend on reaching people who do
not know they need it?** If yes, it cannot be a content topic, however well
built.

The students most helped by "you have not opened this course in eight days" are
precisely the students who will never navigate to a page called *Are You Falling
Behind?* The population that most needs the nudge is the least likely to go
looking for one.

That is an inference rather than a citation, but it is a hard one to escape.

### It connects to the persona work

The axis argued as most diagnostic in
[Synthetic_Semester_Design.md](Synthetic_Semester_Design.md) was **help-seeking**,
and specifically the tech-naive-and-never-asks combination.

That persona is exactly who a widget reaches and a content topic misses. If the
synthetic cohort is ever run against a course, the students who stall silently
are the evidence for whether anything ambient was needed.

---

## What only a widget can do

Release conditions on a widget are **server-enforced**. That makes a widget the
only avenue where genuinely instructor-only material can live *inside the
course*: not hidden behind readable JavaScript, actually invisible.

The gain is less about security than about workflow. Marking notes, exemplars,
a watch-list, and reminders can sit in the course next to the teaching rather
than in a separate document nobody remembers to open. Co-locating the
instructor's working context with the teaching context is worth something real.

Contrast with a content topic, where role logic is JavaScript the student can
read, and which the kit documents as presentation only.

---

## Three cautions worth handing faculty

### 1. The homepage is a commons

Attention there is tiny and shared. If four faculty each add three widgets, the
homepage becomes noise and every widget loses, including the good ones.

A widget should have to earn its space against everything else competing for the
same glance. This is a governance question rather than a technical one, and it
is the item most worth IT's view: at some point somebody has to say how many
widgets a course homepage can carry before it stops working.

### 2. Anything with a "done" state does not belong in a widget

A widget that can be completed is confusing, because it stays there afterwards
looking unfinished. Completion semantics belong to topics and SCORM, which have
real completion tracking behind them.

If it can be finished, it is a destination.

### 3. Be careful what "at risk" means

This one matters most, because an at-risk dashboard is the thing that started
this project.

A risk score derived from login frequency and submission timing measures
**compliance, not understanding**. A student who reads on paper, works ahead
offline, and submits on time reads as disengaged. A student who logs in daily
and understands nothing reads as fine.

That kind of widget is a good prompt for a conversation and a bad diagnosis.
Worth building. Worth labelling honestly. And worth never showing a student
their standing relative to peers, which reliably harms the people it is meant to
help.

If such a widget ships, the wording around the number is not decoration. It is
the part that determines whether the tool helps or does damage.

---

## Routing questions this implies

The pedagogical framing gives better checklist questions than the technical one
would. Proposed additions to the router:

1. **Does the student have to decide to look at it?** No, it should just be
   there → widget.
2. **Does it have a finished state?** Yes → not a widget.
3. **Is it true all term, or specific to one moment?** Moment-specific → topic,
   unless the widget is dynamic.
4. **Does it need to be genuinely invisible to students?** Yes → widget, using
   release conditions.
5. **Is it worth a permanent share of everyone's homepage?** If it cannot
   survive that question, it is a topic.

Note that questions 1 and 4 can both point at a widget for different reasons:
reaching students who would not look, and hiding things from students entirely.
Both are legitimate and they are close to opposites, which is worth saying out
loud so nobody thinks a widget is only for one or the other.

---

## Where the current kit was wrong (closed — verified 2026-09-10)

This note originally described a gap: the deployed checklist had three avenues
and no notion of placement, so an at-risk dashboard would route to a content
topic and sit somewhere nobody ever looked.

**That gap is closed.** Checked directly against the shipped files, not
assumed: `02 Determine Your Path` has the placement question and routes to a
widget outcome (with cost/caveat text specific to that path); the
`d2l-homepage-widget` skill exists; `01 Start Here`'s origin diagram already
shows all four avenues including the widget; `03 Install the Skills`'s diagram
lists all five outcomes (built-in tool plus four build paths). `routing.test.js`
passes 35/35, including several assertions specifically about widget routing
("placement decides the widget," "a widget cannot carry a grade").

Nobody updated this note when the fix landed, which is the actual lesson worth
keeping: closing a gap in code without closing it in the design note that
described the gap just leaves a false trail for the next person to re-chase.
