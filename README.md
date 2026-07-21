# Gatka Warriors

A 2D martial-arts fighting game about **Sikh warriors**, built in **vanilla
JavaScript + HTML5 Canvas** — no frameworks, no build step, no runtime
dependencies. Every visual is hand-authored canvas vector art (no sprite images).

The game centers on **Akaal, the Undying** — a *Sant-Sipahi* (saint-soldier)
Nihang Singh — and the three shastar he bears: the **Kirpan**, the **Soti**, and
the **Khanda**.

> **Cultural note.** This project depicts a *living faith*. The Bana (attire), the
> Five Kakaars, and terms like *Sant-Sipahi*, *Chardi Kala*, and *Waheguru Ji Ki
> Fateh* are used with their real meanings, never as decoration. Depictions of the
> turban and Kirpan are kept reverent, following the 18th-century Akali-Nihang
> tradition. See [CLAUDE.md](CLAUDE.md) for the full guardrail.

## Running

There is no build. Open the shell in a browser:

```bash
start index.html          # Windows (PowerShell / Git Bash)
```

**Debug view:** in the browser console, set `window.__GATKA_DEBUG__ = true` to draw
the live attack hitboxes (red), body boxes (blue), and the authentic-length ruler
(green — the real shastar at true scale).

## Controls

Two-handed by design — combat needs a **vector held** while a **strike is tapped**,
so they fall under different hands.

**Left hand — the Pentra**
- `A` / `D` — move (never stand still: stillness weakens your guard and stops
  Balance recovery)
- `W` / `S` — High / Low vector (picks which strike/guard you use)
- `Space` — jumping Pentra hop
- `Shift` (or `L`) — **Pentra side-step (dodge)**: Gatka's *first* answer. On the
  beat it grants i-frames and beats what no guard can (the unblockable Chakkar, the
  guard-breaking Purba), then opens the **roko aur thoko** counter (×1.5).

**Right hand — the vaar**
- `J` — strike (each shastar has named High / Mid / Low moves)
- `K` — guard (only stops blows on the *same* vector; guard on the beat to **parry**)
- `U` — Chakram Storm · `I` — Iron Shield · `O` — Ultimate (spend the gold Simran meter)

`Esc` / `P` — pause. Arrow keys are bound as an alternative. On touch devices,
on-screen controls emit the same inputs. Full legend lives on the in-game GUIDE and
pause screens (generated from the `KEYS` table).

## The three shastar

| Weapon | Style | Feel |
|---|---|---|
| **Kirpan** | curved sabre + Dhal (shield) | balanced; fluid wide whirl; gold Amrit-Dhāra trail |
| **Soti** | tournament stick + Farri (shield) | long reach, fast, high Balance damage; quick tight whirl |
| **Khanda** | two-handed broadsword (no shield) | heavy, armored, deliberate; big committed arcs |

The blade is never dead-still: it whirls the **atthha** (figure-eight) continuously
in the ready stance, riding the **nagara** drum beat. Combat is on a **Pentra beat
clock** — on-beat strikes, parries, and steps are rewarded.

## Difficulty

A match is best-of-3, but the **difficulty level climbs each round you win** and
carries across matches (it resets only on defeat or a fresh start). Each level the
enemy reacts, guards, and dodges more sharply and hits a little harder. The HUD
shows `◆ LEVEL n`.

## Project layout

| Path | What it is |
|---|---|
| [index.html](index.html) | Game shell: canvas, menus, weapon-select, controls legend |
| [game.js](game.js) | The entire engine — one IIFE, sectioned |
| [tests/verify.js](tests/verify.js) | Headless smoke + unit tests (`node tests/verify.js`) |
| [docs/](docs/) | Design source-of-truth docs (architecture, weapons, combat, art) |
| [akaal-dossier.html](akaal-dossier.html) · [weapon-plate-kirpan.html](weapon-plate-kirpan.html) | Standalone pitch artifacts (live in-engine render) |

## Development

Vanilla JS only — no libraries, no bundler. All art is canvas paths; combat is
AABB-based; the `WEAPONS` / `MOVES` / `DIFFICULTY` tables are the single source of
truth. Simulation runs at a fixed 1/60 timestep; rendering is per-rAF.

**Verify any `game.js` change:**

```bash
node --check game.js        # syntax
node tests/verify.js        # headless tests — expect ALL PASS
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for engine internals and the
headless test harness, and [CLAUDE.md](CLAUDE.md) for conventions and the cultural
guardrail.
