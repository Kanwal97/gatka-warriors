# Gatka Warriors

A 2D martial-arts fighting game about Sikh warriors, plus a set of design/pitch
documents that share one art direction. Everything is **vanilla JavaScript +
HTML5 Canvas** — no frameworks, no build step, no external runtime dependencies.

The game centers on **Akaal, the Undying** — a *Sant-Sipahi* (saint-soldier)
Nihang Singh — and his weapons, rendered entirely as hand-authored canvas
vector art.

## Layout

| Path | What it is |
|---|---|
| [index.html](index.html) | Game shell: canvas, HTML/CSS menu overlays, weapon-select cards, controls legend |
| [game.js](game.js) | The entire engine (~1550 lines, one IIFE, sectioned) |
| [akaal-dossier.html](akaal-dossier.html) | Character pitch artifact — self-contained page, live in-engine render |
| [weapon-plate-kirpan.html](weapon-plate-kirpan.html) | Weapon concept artifact — live Kirpan render, 4 animated VFX states |
| [docs/](docs/) | Editable source-of-truth design docs (see index below) |

The two `*-dossier`/`*-plate` HTML files are **standalone artifacts** — each is a
complete page with inlined CSS/JS and no external requests (they must satisfy a
strict CSP when published as Claude Artifacts). They reuse the game's canvas
drawing language so the pitch shows the real character/weapon art.

## Running the game

There is no build. Open the shell in a browser:

```bash
start index.html          # Windows (PowerShell/Git Bash)
```

Debug: in the browser console set `window.__GATKA_DEBUG__ = true` to draw the
live attack hitboxes (red), body boxes (blue), and the authentic-length ruler
(green — the real shastar at true scale; the gap to the red box is the heroic
exaggeration, see [docs/WEAPONS.md](docs/WEAPONS.md)).

**Controls** — two-handed by design (combat needs a vector *held* while strike is
*tapped*, so they must fall under different hands):

- **Left hand:** `A`/`D` move · `W` High / `S` Low (attack+block vector) · `Space` jump ·
  `Shift` **Pentra side-step (dodge)**
- **Right hand:** `J` strike · `K` block (must match the vector) · `U` Chakram
  Storm · `I` Iron Shield · `O` Ultimate

**Gatka prefers evasion to blocking**, so the side-step is the first answer, not
the last: an on-beat step grants i-frames and beats what no guard can (the
unblockable Chakkar, the guard-breaking Purba). Off-beat you still move but stay
hittable — rhythm is the price. Stepping a blow opens the **roko aur thoko**
counter window (×1.5): you do not strike first, you answer.

Arrow keys stay bound as an alternative, but they sit on the same side as
`J`/`K`/`U`/`I`/`O` (↑→J is ~171mm), so WASD is primary. Raise the correct block
just as a blow lands to **parry**.

Bindings live in the `KEYS` table (SECTION 1) — the single source of truth for
keyboard *and* touch. On coarse pointers, on-screen controls appear during a
round and emit the same key names via `InputManager.press/release`, so every
combat rule is shared rather than duplicated per input method.

## Verifying changes (do this for any `game.js` edit)

1. **Syntax:** `node --check game.js`
2. **Headless smoke/unit test:** `game.js` is browser code, but it can be driven
   under Node by stubbing the DOM + a no-op canvas context, then invoking the
   captured `DOMContentLoaded` handler and calling `GATKA._update(dt)` /
   `GATKA._render()` manually. This is the project's test harness pattern — see
   [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#testing-headless-harness) for the
   full stub. Use it to assert combat/ability outcomes deterministically
   (e.g. a parry returns `"parry"`, Chakram spawns exactly 3 discs).
3. For artifact HTML, validate the embedded script by extracting
   `<script>…</script>` and running it through `new Function(src)` (syntax only).

## Architecture at a glance

`game.js` is one IIFE divided into numbered `SECTION` banners:

1. **Constants** — `STATE` (app FSM), `VECTOR` (High/Mid/Low), `ACT` (fighter
   FSM), `WEAPONS`, ability costs, Simran gains. **Single source of truth.**
2. **Geometry** — `aabbIntersect()`: real axis-aligned bounding-box overlap, the
   basis of all combat (not distance checks).
3. **InputManager** — normalizes keys into pollable held/pressed intents.
4. **ParticleSystem** — flat array, parry/ability bursts.
5. **Projectile** — the thrown Chakram (own AABB, carries a block vector).
6. **Artist** — pure canvas vector drawing (warrior, Dumalla, Dhal, Kirpan/
   Soti/Khanda, Damascus glow states).
7. **Fighter** — shared body: physics, HP/posture/**Simran**, attack/block FSM,
   the three abilities, and all hit-resolution rules.
8/9. **Player / Enemy** — differ only in how intents are produced (human vs AI).
10. **HUD**, 11. **Background**, 12. **Game** (state machine + fixed-timestep
    loop), 13. **Bootstrap**.

Deeper detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Conventions (please follow)

- **No libraries.** Vanilla JS only. No Phaser, no bundler, no npm runtime deps.
- **All art is canvas paths** — no sprite images. New visuals go in the `Artist`
  object and are parameterized by fighter state so poses animate.
- **`WEAPONS` / `ABILITY` / gains tables are the single source of truth.** Adding
  a weapon to the `WEAPONS` object automatically adds its select-screen card.
- **Combat is AABB-based.** Hitboxes are `{x,y,w,h,vector}` rectangles; defense
  requires matching the `vector`. Keep new attacks in this model.
- **Fixed timestep.** Simulation runs in `FIXED_DT` (1/60) steps via an
  accumulator; rendering is per-rAF. Don't put game logic in the render path.
- **Match the surrounding comment density.** `game.js` is heavily commented by
  design (it doubles as a teaching artifact); keep that voice.
- **Artifacts stay self-contained** — inline all CSS/JS, no external fonts/CDNs,
  design both nothing-breaks-offline. They commit to a single dark theme by
  choice. Reuse the tokens in [docs/ART-DIRECTION.md](docs/ART-DIRECTION.md).

## Cultural authenticity — a hard guardrail

This project depicts a **living faith**. The Bana (attire), the Five Kakaars
(Kesh, Kara, Kachera, Kirpan, Kangha), and terms like *Sant-Sipahi*, *Chardi
Kala*, *Deg Tegh Fateh*, *Waheguru Ji Ki Fateh* are used with their **real
meanings**, never as decoration. When adding characters, copy, or art:

- Treat the turban and Kirpan with reverence in-fiction and in-tone; no comic or
  gory framing of sacred articles.
- Keep depictions respectful and non-exoticizing; prefer accuracy over spectacle.
- The historically authentic warrior reference is the **18th-century
  Akali-Nihang tradition** — see [docs/COSTUME-BANA.md](docs/COSTUME-BANA.md).

## Docs index

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — engine internals, FSM, combat math, abilities, test harness
- [docs/ART-DIRECTION.md](docs/ART-DIRECTION.md) — shared palette, typography, artifact rules
- [docs/DESIGN-AKAAL.md](docs/DESIGN-AKAAL.md) — the Akaal character bible
- [docs/WEAPONS.md](docs/WEAPONS.md) — weapon + ability data tables and the Amritvelā VFX spec
- [docs/GROOM-BEARD.md](docs/GROOM-BEARD.md) — next-gen facial-hair groom spec (grooming, hair shaders, strand physics)
- [docs/COMBAT-SYSTEM.md](docs/COMBAT-SYSTEM.md) — Gatka combat blueprint: the Pentra beat system, state machine, 12-move hitbox data, counter matrix
- [docs/COSTUME-BANA.md](docs/COSTUME-BANA.md) — authentic 18th-c. Nihang costume reference
