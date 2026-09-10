# SCSU D2L Design System

The Husky visual language for D2L course material. Everything here is
**paste-ready HTML**, sized for D2L, using SCSU's palette and type.

Using this is entirely optional. Nothing in the Content Development Kit depends
on it. It is the difference between an activity that looks bolted on and one
that looks like part of the course.

## What is in here

| File | What it is |
|---|---|
| `Husky Course Kit - Blended.dc.html` | **Start here.** The settled direction: two tiers, one palette. |
| `Husky Course Kit.dc.html` | The three original directions side by side, if you want to compare. |
| `Husky's First Four.dc.html` | Blocks built for the new-student orientation. |
| `Welcome Videos.dc.html` | A video-forward layout. |
| `support.js` | The runtime the prototypes need to render. Keep it alongside them. |

## How to use it

**To look at them:** open any `.dc.html` file in a browser. Keep `support.js` in
the same folder or nothing will render.

**To use a block:** find one you like, view source, copy the block's HTML, and
paste it into your own page or into D2L's HTML editor. Every block is
self-contained. Swap the placeholder text and colours as needed.

**To have Claude use it:** point Claude at this folder and say which file you
want the look taken from. It will read the source and match the design.

## The two tiers

**Loud.** Ink background, hard diagonal cardinal wedges, Archivo in heavy
uppercase, square corners. Use it sparingly, for the things that must be
noticed: page headers, module dividers, the one warning that matters.

**Warm.** Cream cards, rounded corners, Epilogue headings, soft shadows. This is
the steady, encouraging voice of a course, and most of your content belongs here.

The triangle that keeps appearing is the Husky peak. It shows up as a section
marker, a list bullet, and a decorative accent, and it is what makes unrelated
blocks read as one system.

## Palette

| Hex | Name | Use |
|---|---|---|
| `#B11226` | Cardinal | primary red, accents, buttons |
| `#7E0C1A` | Deep | second wedge, depth |
| `#161616` | Ink | Loud backgrounds, headings |
| `#FAF7F2` | Cream | text on ink |
| `#FBE9EC` | Blush | warm tint panels, pills |
| `#F1EBE1` | Sand | page background |
| `#EADFD0` | Warm border | card borders |

## One adaptation worth copying

These prototypes load Archivo, Epilogue and Public Sans from Google Fonts. When
you build something for D2L, **name the same fonts but ship no external link**.
Campus network policy can block an outside host, and a blocked font should
degrade to a close system stack rather than break the page.

The Content Development Kit's own pages are built that way, and its checker
flags external dependencies for exactly this reason.

```css
--loud: 'Archivo','Arial Black','Helvetica Neue',Impact,sans-serif;
--warm: 'Epilogue','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
--body: 'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
```

## Provenance

These were mocked up in Claude Design and exported as a handoff bundle. They are
prototypes rather than production code: match the visual output, do not assume
the internal markup is how you should structure your own build.
