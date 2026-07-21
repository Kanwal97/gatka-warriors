# Architecture — `game.js`

The engine is a single IIFE (`(function(){ "use strict"; … })()`) so nothing
leaks to global scope except `window.GATKA` (the Game instance) and the
`window.__GATKA_DEBUG__` flag. It is organized into numbered `SECTION` banners;
this doc explains the parts that aren't obvious from reading top-to-bottom.

## Two independent state machines

Do not confuse them.

### Application FSM — `Game.state` (`STATE`)
`MAIN_MENU → CHARACTER_SELECT → GAMEPLAY → ROUND_OVER → GAME_OVER`

- **One funnel:** every screen change goes through `Game._transition(next)`,
  which sets `state` and calls `_syncOverlays()`. `_syncOverlays()` toggles the
  `.hidden` class on the four DOM overlays so exactly one menu shows per state.
- The MAIN_MENU / CHARACTER_SELECT / GAME_OVER screens are DOM-driven (HTML
  overlays + `data-action` buttons wired in `_bindUI`). GAMEPLAY / ROUND_OVER
  run simulation.

### Fighter FSM — `Fighter.action` (`ACT`)
`IDLE, WALK, ATTACK, BLOCK, CAST, HURT, KO`

- `ATTACK` is sub-phased: `attackPhase` = `"windup" → "active" → "recovery"`,
  advanced by `_advanceAttack()` using per-weapon durations. The hitbox is live
  **only during `"active"`**.
- `CAST` is the Chakram-throw lock. `HURT` is hit-stun. `KO` is defeated.
- `_locked()` centralizes "can't start a new action" (HURT/KO/CAST/ultActive).

## Combat: AABB, not distance

`aabbIntersect(a, b)` tests overlap on both axes. Rectangles are
`{x, y, w, h}` with `(x,y)` = top-left.

**Attack hitbox** — `Fighter.getAttackHitbox()` returns `null` unless mid-swing
in the `"active"` phase. Otherwise it builds a rect:
- springs from the fighter's front edge in the facing direction,
- length = `weapon.reach`,
- vertical band chosen by `vector`: HIGH = head third, MID = chest third,
  LOW = legs third,
- carries `vector` so the defender can check it.

**Resolution** — `Game._resolveAttack(attacker, defender)` runs each fixed step:
if `!attacker.hasHitThisSwing` and the hitbox overlaps the defender's body box,
it calls `defender.receiveHit(attacker, hitbox)` and sets `hasHitThisSwing`
(so one swing lands at most once across its multi-step active window).

**Defense priority in `receiveHit()`** (returns an outcome string):
1. `ultActive` → `"ignore"` (invulnerable)
2. `shieldT > 0` (Iron Shield) → `"reflect"` — consume shield, drain attacker posture
3. correct-vector block within `PARRY_WINDOW` (0.13s) → `"parry"` — punish
   attacker posture, ignite `weaponFlare`
4. correct-vector block → `"block"` — chip posture
5. otherwise → `"hit"` — HP damage + hit-stun (Khanda's `superArmor` skips the
   stun while its own swing is active)

`receiveProjectile()` mirrors this for Chakrams; `receiveUltPulse()` is an
unblockable AoE crush.

## The Sant-Sipahi kit (abilities)

- **Resource:** `Fighter.simran` (0–`SIMRAN_MAX`=100), charged by `gainSimran()`
  from the `SIMRAN_GAIN` table (parry rewards the most, 24).
- **① Chakram Storm** (`castChakram`, cost 34): enters `CAST`, sets
  `pendingChakram`. `Game._spawnPendingChakrams()` turns that flag into a
  **3-disc fan** (one per HIGH/MID/LOW lane). Decoupled so both Player and AI use
  the same path.
- **② Sarbloh Kavach / Iron Shield** (`castShield`, cost 30): sets `shieldT`
  timer; the reflect is handled in `receiveHit`/`receiveProjectile`.
- **③ Chardi Kala / Ultimate** (`castUltimate`, cost 100): `ultActive` for
  `ULT.duration`; invulnerable + super-armor; fires AoE pulses at
  `ULT.pulses` timestamps via the `ultPulseReady` flag, applied by
  `Game._resolveUlt()`.

`weaponFlare` is the **Amrit-Dhāra** Kirpan glow timer — set on parry (0.35) and
on landing a hit (0.2); read by `Artist.drawKirpan` to drive its emissive
states. See [WEAPONS.md](WEAPONS.md).

## Escalating difficulty (`Game.difficulty`)

A match is best-of-3 (`ROUNDS_TO_WIN = 2`), but difficulty **climbs across matches**:

- `Game.difficulty` starts at 1 and **increments each round the player wins**
  (`_endRound`). A **match defeat resets it to 1**; a **match win keeps it**, so the
  rematch begins harder (`_startMatch(fresh)` — `start-match` passes `true` and
  resets; `rematch` passes `false` and persists).
- The level → a 0..1 `skill` plus small HP/damage bumps, applied to the enemy by
  `Enemy.applyDifficulty(level)` at spawn and each `_startNextRound`. The **single
  source of truth is the `DIFFICULTY` table**; its AI knobs are `[base, max]` pairs
  interpolated by `skill` in `Enemy.think_ai`, and **`skill = 0` at Level 1 is
  exactly the pre-difficulty behaviour** (no regression). Outgoing damage scales by
  `Fighter.dmgScale` (player stays 1); `baseMaxHp` keeps HP scaling from compounding.
- HUD shows `◆ LEVEL n`; the round-won banner announces the rise.

## Fixed-timestep loop

`Game._frame(now)`:
- clamps `frameTime` (avoids spiral-of-death after tab-out),
- **hit-stop:** if `freezeT > 0`, decrement it and skip simulation (keep
  rendering) — this is the impact "weight" on hits/parries,
- else accumulate into `acc` and run `_update(FIXED_DT)` in whole 1/60 steps,
- always `_render()`, then `input.endFrame()` (clears rising-edge presses).

Keep **all game logic in `_update`**, never in `_render`.

## Rendering

`Artist` (SECTION 6) is pure drawing, parameterized by fighter state. The
warrior is drawn mirrored via `ctx.scale(facing, 1)` so "facing left" reuses the
same path code.

Weapon art goes through **one factory**, `Artist.drawWeapon(ctx, x, y, angle, f)`,
which dispatches on the weapon's `bladeStyle` — *never* on its id. Adding a
weapon to `WEAPONS` therefore draws it with no edit here:

| `bladeStyle` | draw fn | |
|---|---|---|
| `curved_sabre` | `drawKirpan` | curved Damascus + Amrit-Dhāra glow; tip is the apex |
| `straight` | `drawSoti` | uniform cane, blunt (no edge → no glow), basket hilt |
| `straight_broad` | `drawKhanda` | broad double-edged blade |

Shared props: `drawDhal` (drawn only when `weapon.hasShield`), `drawDumalla`.

## Testing: headless harness

`game.js` runs under Node with a stubbed environment. Pattern:

```js
// stub a no-op 2D context (gradients return {addColorStop(){}})
function makeCtx(){const g={addColorStop(){}};return new Proxy({},{get(_,p){
  if(p==='createLinearGradient'||p==='createRadialGradient')return()=>g;
  return()=>{}},set(){return true}});}
// stub minimal DOM elements (classList/dataset/getContext/querySelectorAll…)
const handlers={};
global.window={addEventListener:(t,f)=>handlers[t]=f,GATKA:null,__GATKA_DEBUG__:false};
global.performance={now:()=>0};
global.requestAnimationFrame=()=>0;            // drive frames manually
global.document={getElementById:id=>id==='game'?canvasEl:makeEl(),
  createElement:()=>makeEl(),querySelectorAll:()=>Object.assign([],{forEach:Array.prototype.forEach}),
  addEventListener:(t,f)=>handlers[t]=f};
eval(require('fs').readFileSync('game.js','utf8'));
handlers['DOMContentLoaded']();                // boots Game -> window.GATKA
const g=window.GATKA;
g.playerWeaponId='kirpan'; g._startMatch();
// now assert deterministically, e.g.:
g.player.simran=100; g.player.castChakram(); g._spawnPendingChakrams(g.player);
console.assert(g.projectiles.length===3, 'Chakram fan spawns 3');
```

Use `g._update(1/60)` to advance simulation and `g._render()` to exercise the
`Artist` draw paths (catches drawing exceptions across fighter states). Set
`__GATKA_DEBUG__=true` to also cover the debug hitbox-draw branch.

**Always** run `node --check game.js` first, and re-run the ability unit checks
after touching `Fighter`, `Game`, or `WEAPONS`.
