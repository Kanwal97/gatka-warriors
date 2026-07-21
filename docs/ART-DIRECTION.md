# Art Direction

One visual system spans the game and every pitch artifact: a committed **dark
neela (indigo) "warrior codex"** grounded in the Nihang world, with a single
disciplined **kesari (saffron) → gold** accent and cold steel for all shastar.
This is deliberately *not* the generic cream-serif or purple-gradient look.

## Color tokens

Used as CSS custom properties in the artifacts and mirrored in the game's canvas
fills. Neutrals are **blue-biased on purpose** (chosen, not defaulted grey).

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#0b1322` | Deepest neela-black background |
| `--ground-2` | `#0e1a30` | Recessed panels / code wells |
| `--panel` | `#15213c` | Card / panel surface |
| `--panel-2` | `#1b2a4b` | Raised card gradient top |
| `--line` | `#29395c` | Indigo hairline borders |
| `--steel` | `#93a4c2` | Primary dim text (blue-biased neutral) |
| `--steel-dim` | `#64769a` | Captions / tertiary |
| `--parchment` | `#eaeef6` | Cool off-white body text |
| `--saffron` | `#ff9d2e` | **THE accent** (single bold hue) |
| `--saffron-deep` | `#e07d13` | Accent shadow / gradient end |
| `--gold` | `#ffd47a` | Secondary highlight within the accent family |
| `--blade` | `#cdd8e8` | Cold steel highlight (shastar) |
| `--lapis` | `#1f3f7a` | Soul-gem / cool contrast note |

**In-game fighter palettes** (canvas, not tokens): Akaal/player robe `#1f5fa8`,
turban `#123a8a`, sash gold `#e6b845`, hajooria teal `#2ec7c7`, skin `#c98a52`.
Enemy "Vairi" uses a crimson set. Amrit-Dhāra nectar light: `#ffd47a` core,
`#ff9d2e` mid, `#fff4d6` flare-white.

## Typography

System-font stacks chosen for characterful, reliable rendering (no CDN webfonts
— the Artifact CSP blocks them and would fall back silently).

- **Display:** `"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`
  — a calligraphic humanist serif, set uppercase with letter-spacing for an
  engraved, devotional-martial gravitas. Give headings `text-wrap: balance`.
- **Body:** `"Gill Sans MT", "Gill Sans", "Segoe UI", system-ui, sans-serif`
  — humanist sans warmth.
- **Data / prompts:** `"Consolas", ui-monospace, monospace` with
  `font-variant-numeric: tabular-nums` wherever digits align.

The in-game HUD uses `Cinzel, serif` for banners (loaded via Google Fonts in
`index.html`, graceful serif fallback offline).

## Layout & motion principles

- **Hero is the thesis:** open with the most characteristic object *moving* — a
  live canvas render (the warrior; the spinning Chakram; the glowing Kirpan),
  not a static image.
- **Eyebrow labels, not false numbering.** Only number sections when the content
  is a real sequence (e.g. the weapon spec's 01–04 mirror the client brief).
- Layout via flex/grid + `gap`; wide content (tables, `<pre>`) gets its own
  `overflow-x: auto` container so the page body never scrolls sideways.
- **Motion is restrained and orchestrated** — one ambient hero moment (slow
  rotation, drifting embers, a scrolling emissive "current"), not scattered
  effects. Always honor `@media (prefers-reduced-motion: reduce)`: render one
  static frame and stop the rAF loop.

## Single-theme by choice

The artifacts commit to the dark world (like an arcade attract screen) rather
than supporting a light theme — tokens live on `:root` only, so the viewer's
theme toggle intentionally leaves the cinematic look intact. This is a
deliberate design decision, documented here so it doesn't read as an omission.

## Artifact build rules

- Fully self-contained: inline all CSS/JS, no external requests, no remote fonts
  or images. Must render offline and satisfy a strict CSP.
- Write page content only (no `<html>/<head>/<body>` wrappers — the publish step
  adds them); a `<title>` and one favicon emoji per artifact, stable across
  redeploys.
- Reuse the game's canvas drawing language so pitch art matches shipped art.

Current artifacts: [../akaal-dossier.html](../akaal-dossier.html) (favicon ⚔️),
[../weapon-plate-kirpan.html](../weapon-plate-kirpan.html) (favicon 🗡️).
