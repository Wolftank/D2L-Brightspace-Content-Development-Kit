# CDK design tokens

Lifted from `SCSU_Design_System/Husky Course Kit - Blended.dc.html`. Every CDK
topic inlines this same block, because D2L topics must be self-contained.

## Palette

| Token | Hex | Use |
|---|---|---|
| Cardinal | `#B11226` | primary red, accents, buttons |
| Deep | `#7E0C1A` | second wedge, gradients |
| Ink | `#161616` | Loud backgrounds, headings on light |
| Cream | `#FAF7F2` | text on ink |
| Blush | `#FBE9EC` | Warm tint panels, pills |
| Blush border | `#F3D3D9` | borders on blush |
| Sand | `#F1EBE1` | page background |
| Warm border | `#EADFD0` | card borders |
| Divider | `#E0D6C8` | rules on light |
| Body | `#4a463f` | body text on light |
| Muted | `#8a847c` | secondary text |
| Faint | `#a59f96` | kickers, captions |
| On-dark body | `#cfc9c1` | body text on ink |
| On-dark muted | `#9a948c` | captions on ink |
| Pink accent | `#E8A9B2` | kickers on ink |

## Type

- **Loud display:** Archivo 900, uppercase, tight tracking
- **Warm display:** Epilogue 700/800, normal case
- **Body:** Public Sans 400/600/700
- **Kicker/label:** monospace, uppercase, `letter-spacing: .16em`

Loaded with **system fallbacks and no CDN link**, deliberately. The design kit
uses Google Fonts, but our own guidance says never depend on an external host:
campus policy may block it, and a blocked font should degrade, not break.

```css
--loud: 'Archivo','Arial Black','Helvetica Neue',Impact,sans-serif;
--warm: 'Epilogue','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
--body: 'Public Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
--mono: 'SFMono-Regular',ui-monospace,Menlo,Consolas,monospace;
```

## The two tiers

**Loud.** Ink background, diagonal cardinal wedge via `clip-path`, Archivo 900
uppercase, square corners. Used sparingly: page headers, step dividers, the one
warning that must be read.

**Warm.** White card, `#EADFD0` border, `border-radius: 20px`, soft shadow,
Epilogue headings. Everything explanatory and reassuring.

## The motif

The Husky peak: a CSS triangle, `border-left/right: transparent` with a solid
`border-bottom`. Appears as a section marker, a list bullet, and a decorative
accent. It is the thing that makes unrelated blocks read as one system.

## D2L constraints that shaped these pages

- **No fixed root height on prose topics.** The content iframe auto-resizes, so
  static pages should flow naturally. Fixed pixel heights are for *interactive*
  activities that need internal scroll.
- **No viewport units,** ever. Same reason.
- **No external stylesheet or font link.** Self-contained.
- **Name the file before deploying.** The filename becomes the topic title, and
  renaming a live topic silently corrupts it.
