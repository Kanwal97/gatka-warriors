# Session handoff — Gatka Warriors

Context for the next session. Written after a long run of gameplay, art, audio,
and UI work. **Everything below is verified against the code, not remembered.**

## State right now

- **Git:** it IS a repo, working tree **clean**, `origin/main` exists, all session
  work is committed at HEAD. (Earlier sessions kept recommending `git init`; that
  is done — do not repeat it.)
- **`node --check game.js`** passes. `game.js` is ~3680 lines, one IIFE, sectioned.
- **Test suite:** `tests/verify.js` — **38 checks, all green.** Run it after ANY
  `game.js` edit:
  ```bash
  node tests/verify.js        # expects: ALL PASS  (38 pass, 0 fail)
  ```
  It reads `game.js` (absolute path inside the file), injects a `window.__T = {…}`
  seam before the closing `})();` to reach IIFE internals, stubs a no-op canvas +
  DOM, and boots via the captured `DOMContentLoaded`. This is the ONLY committed
  test; guard it.

## The one recurring trap — READ THIS

**The test harness lies more often than the code is wrong.** Five times this
session a check "failed" and the game was fine. Causes, all mine:

1. `docs/ARCHITECTURE.md`'s documented stub does `addEventListener: (t,f) => handlers[t]=f`
   — it **overwrites**. `game.js` registers **three** `keydown` listeners
   (InputManager, `_onMenuKey`, audio-arm), so the doc's stub silently keeps only
   the last. Correct stub: push into an array, `fire(t,e) => (H[t]||[]).forEach(f=>f(e))`.
   `tests/verify.js` does NOT yet use the multi-listener stub — fix it when you
   touch keyboard behaviour.
2. `_update` decays `shake`/`boltFlash`/particles in the SAME step it sets them,
   so an external sampler never sees the peak. Assert at spawn, not after `_update`.
3. Rounds end mid-measurement (KO → `ROUND_OVER` stops `_updateGameplay`); stub
   `g._endRound = () => {}` when measuring per-second rates like drum tempo.
4. Regex windows too small when grepping `index.html` for nested markup.
5. Restoring a mutated field to a hardcoded literal instead of the captured value.

If a `verify.js` check fails, **suspect the test first**, reproduce the claim by
hand, and only then edit `game.js`.

## What was built this session (all verified, all in HEAD)

- **Weapons are data-driven.** `WEAPONS` gained `class / bladeStyle / hasBasketHilt
  / hasShield / weight / mobility / art / lengthInches / hiltInches / bladeInches /
  bladeWidthInches / weightGrams`. `Artist.drawWeapon` dispatches on `bladeStyle`,
  never on id. **Lathi → Soti** (rename; kept its moves). Talwar is not a new
  weapon — it IS the Kirpan, corrected to a curved sabre.
- **Kirpan blade** ported 1:1 from a user SVG (`drawKirpan`): bend on the SPINE
  side (edge leaves the hand flat ~−0.3°, bends up at the tip ~12.4°), tip is the
  apex, ~28:1 aspect. Fitted to the 31in sport size (blade ≈ Akaal's 24in arm).
- **The atthha (figure-eight).** The weapon arm rides a Gerono lemniscate
  `(cos u, sin u·cos u)`, not a circle. `const ATTHHA = {cx,w,h}`. This is the
  identity of Gatka and was the deepest thing that had been wrong.
- **Dodge + roko-aur-thoko.** `ACT.STEP`, `Shift`/`L`, `startDodge`, on-beat
  i-frames, evade beats unblockable/guard-break, ×1.5 counter window. See `DODGE`.
- **Yodha tempo pass.** `BASE_SPEED = 350`, per-weapon `mobility`, every move's
  frame data cut (~30–43% faster), hitstop/shake now scale with damage. **NOTE:
  this contradicts `docs/COMBAT-SYSTEM.md §3`'s frame table — doc NOT yet synced,
  pending playtest confirmation of feel.**
- **Bijli.** Purba Strike (`flags.bijli`) calls a lightning bolt + thunder; the one
  full-screen flash (α 0.42, ~110ms). `_spawnBolt` geometry is generated ONCE.
- **Audio** (`SECTION 3B`, `Sfx`): fully synthesized Web Audio, no files. Nagara
  fires on the Pentra clock (per-weapon tempo). Every impact outcome has a sound
  via the single `_impactFx` hook. Mute button. Armed on first gesture.
- **Face:** modelled head (was a flat glowing disc), lips ported from a user SVG
  with a vivid palette (`LIPS`) — NOT `shade(skin)`, which can't be red. Soul patch
  moved down to y=28 to give the lower lip real height.
- **UI/UX:** responsive canvas (`_resize`, DPR-aware, 900×500 design space
  preserved), frame `min(1280px, 96vw, (100vh-44px)*1.8)`, touch controls (11
  buttons incl. STEP), `PAUSED` state (Esc/P), BACK out of select, dedicated
  **GUIDE** screen (`_buildControlGuide`, generated from `KEYS`, rendered on guide
  + pause screens), shastar spec panel, ੴ Ik Onkar on the title.
- **Background:** was generic Gurdwara → Harmandir Sahib (user SVG) → **removed at
  user request** → now a **Nihang chhaoni** (qila rampart, Ranjit Nagara, shastar
  rack, tents, Nishan Sahib). This is the CURRENT background.

## FIXED — the original audit bugs (all four, verified by tests/verify.js §11)

Fixed in the weapon-motion & authenticity pass (2026-07-21):

1. **Chakkar unblockable vs Santulan** — the super-armor branch in `receiveHit` now
   yields to `flags.unblockable` (`guarding && gflags.superArmor && !flags.unblockable`),
   so the Chakkar falls through to the clean-hit path. A step is again its only answer.
2. **Iron Shield reflect on a Chakram** — `receiveProjectile`'s shield branch now
   drains the thrower's posture (−20, stagger if emptied), mirroring the melee reflect.
3. **Chakram hitstun** — a clean disc hit now chips posture + knocks back + `breakFlow()`
   + sets `ACT.HURT` (heavy super-armor mid-active exception kept), like a melee hit.
4. **Matchup variety** — `_spawnFighters` picks the enemy weapon at RANDOM
   (`ids[Math.floor(rand(0, ids.length))]`), so all 9 matchups incl. mirrors occur.
   NOTE: this made verify.js test #6 depend on a parryable enemy guard — it now pins
   `MOVES.kirpan.guard` (Giraav) explicitly, since a random Khanda enemy holds the
   Santulan super-armor guard which correctly returns "block", not "parry".

## Weapon-motion pass (2026-07-21) — "motions not showing / stiff / un-Gatka"

The atthha now **whirls continuously in the ready stance** (was a ±0.06 twitch):
`Fighter.whirlPhase` advances at a per-weapon `WEAPONS[id].motion.whirl` and is the
arm's pose target in IDLE/WALK/STEP; the smear is driven by `Fighter.weaponAngVel`
(blade angular speed) so the ready-whirl AND strikes both trail. Per-weapon motion
signatures (Soti quick/thin, Kirpan fluid/gold, Khanda slow/broad). **Khanda is now
two-handed with no shield** (`twoHanded: true`; off-hand drawn on the hilt). Research:
panthra is "flowing, non-stop movement with no preset moves"; sword+shield is the
Gatka pairing; khanda is clasped two-handed (SikhiWiki / gatkaa.com / ismaa.net).

## Strike swing fix + button restyle + bg cache (2026-07-24)

Users: still lagging on buttons + "when you strike, on some the sword sticks and
won't move." Root cause of the stick: the strike **eased the blade to a static pose
and held it** — invisible whenever the continuous whirl had already parked the blade
near that pose (intermittent). Fixes:
- **Deterministic vaar swing.** New `STRIKE_ARC` table (per vector: `back`/`strike`/
  `follow`) + `REST_ANGLE`; `Fighter._integrateWeapon` now drives a phase-clocked arc
  for strikes (anticipation → whip through the zone → follow-through, fast-in/slow-out),
  starting from `swingFrom` (captured in `startAttack`). Reads the SAME from any whirl
  angle → no sticking. Hitboxes/timings unchanged; Chakkar keeps its spin. verify.js §14.
- **Background offscreen cache** on `LOW_PERF` (`_buildBgCache` + blit in `_render`) —
  stops re-drawing the chhaoni 60×/s on phones. Ambient anim freezes on mobile only.
- **Button restyle:** 64px keys, gradient "gamepad" look, bigger D-pad arrows, STRIKE
  emphasized, and INSTANT press feedback via `.on` + a `:active` CSS fallback.
- Research: game-animation (anticipation/follow-through/smear) + mobile touch UI
  (large targets, instant feedback, fewer buttons). Desktop/keyboard/tests untouched.

## Mobile performance + fewer buttons (2026-07-24)

Users reported lag on touch and too many buttons. Fixed:
- **Removed `backdrop-filter: blur`** from `.tkey` (×11), `.hud-btn`, `.overlay` — the
  main mobile GPU jank (blurring the live canvas behind every button each frame).
- **DPR capped at 2** in `_resize`; **rAF bound once** (`_frameBound`); **`LOW_PERF`**
  module flag (true on coarse pointers via `_bindTouch`, or `__GATKA_LOWPERF__`)
  halves the blade-trail sample count (12 vs 24) in `drawWarrior`.
- **Abilities tray:** the 3 Simran abilities moved behind one `✦` toggle
  (`#ability-toggle` → `#ability-tray.open`), auto-collapsing after use / when the pad
  hides. Persistent touch keys 11 → ~8; each keeps its `data-key` so combat is
  unchanged. Bigger core buttons on coarse pointers. Guarded by verify.js §13.
- Desktop + keyboard paths untouched. See docs/ARCHITECTURE.md "Mobile performance".

## Weapon-motion smooth & refine

**Smooth & refine sub-pass:** the whirl now RIDES THE BEAT —
`rate = whirl·(1 + swing·cos(beatPhase·2π))` in `_integrateWeapon`, so it surges on
the nagara and eases mid-beat (per-weapon `motion.swing`: soti 0.25 / kirpan 0.35 /
khanda 0.50; mean rate unchanged). The smear is a DISSIPATING COMET (per-segment
alpha² + width taper toward the tail, hot strands additive-blended `"lighter"`), and
the strike ease RAMPS into the pose across the active window (0.34→0.72) instead of a
hard snap. Research: Gatka "rotates in smooth circles matching the drum's beat",
"fluid flowing movement without hesitation" (SikhiWiki / SikhNet). Guarded by
verify.js §11 (h)/(i).

## Escalating difficulty (2026-07-21)

`Game.difficulty` (starts 1) **climbs each round the player wins** and CARRIES
ACROSS MATCHES — a match win rolls into a harder rematch; a match DEFEAT (or a
fresh `start-match`) resets it to 1. `_startMatch(fresh)` gates the reset (`rematch`
passes `false`). One `DIFFICULTY` table is the single source of truth: level → 0..1
`skill` (interpolates the enemy AI's `[base,max]` reaction chances in `think_ai` +
shortens reaction times) + capped HP/damage bumps via `Enemy.applyDifficulty(level)`,
applied at spawn and each `_startNextRound`. **Level 1 == the exact old behaviour**
(skill 0). Player is never scaled (`dmgScale` 1). HUD shows `◆ LEVEL n`; round-won
banner announces it. Guarded by verify.js §12. See docs/ARCHITECTURE.md.

Also open, lower priority: `onBlockAdv` (frame advantage) in the schema but unread;
Do-Dhari Vaar's backswing is front-only 2-hit; offhand Dhal is passive (art only,
except Giraav's deflect); no round timer; no photosensitivity toggle (matters now
that bijli exists); the multi-listener stub fix for `docs/ARCHITECTURE.md`.

## The hard guardrail (CLAUDE.md)

This depicts a **living faith**. Five Kakaars, Bana, and terms carry REAL meanings,
never decoration. Kirpan = one Kakaar in two forms (Siri Sahib worn / Tegh borne),
NOT two weapons. Ek Onkar opens the work (invocation, not caption). No place of
worship as a combat backdrop — that is WHY the Gurdwara/Harmandir was removed for
the chhaoni. When the user supplies real Sikh cultural detail (Gatka technique,
atthha, roko aur thoko), it is authoritative — port it faithfully.

## Working style that fit this user

- They give reference SVGs / real technique and expect a **1:1 faithful port**,
  not an approximation. Keep their numbers verbatim; convert with a named helper.
- They test by EYE and report feel ("too slow", "not visible", "glowing"). Trust
  the report; measure to find the cause; fix the cause, not the symptom.
- Prefer data-driven (tables, single source of truth) over special-casing.
- `node --check` + `node tests/verify.js` after every `game.js` edit, always.
- Mid-turn messages are common; they stack. Address each.
