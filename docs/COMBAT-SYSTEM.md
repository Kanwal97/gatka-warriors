# Gatka Combat System — Design Blueprint

A modular, data-driven combat module built on the **Pentra** (rhythmic footwork)
and three weapon movesets (Soti, Kirpan, Khanda — 4 moves each). Written to be
translated directly into game logic.

> **Relationship to the shipped engine.** The current game ([game.js](../game.js))
> already implements: a fighter `ACT` state machine, AABB hitboxes with **High /
> Mid / Low vectors**, a **posture** bar (this doc's *Balance/Stun* meter), a
> **Simran** resource, and per-weapon timing in the `WEAPONS` table. This
> blueprint **extends** that: it adds the Pentra beat clock + stillness rule, and
> replaces the single attack/block per weapon with **4 named moves per weapon**.
> A migration note closes each section. Frames are @60fps; angles are in the
> fighter's local frame (0° = forward/facing).

---

## 0b. Playtest tuning (feel)

- **Jumping Pentra** — `Space` jumps (gravity `GRAVITY`, launch `JUMP_V`); air
  control at 0.7×; the shadow stays grounded and shrinks with height; attacks work
  airborne. `Fighter.vy/airborne`.
- **Hit clarity** — floating damage numbers + `PARRY!/BREAK!/REFLECT!/block`
  text (`_hitFeedback`/`_drawFloaters`), a decaying **screen shake** on solid
  hits (field only, HUD steady), and beefier hit particles/hitstop. The blade
  **snaps to the strike pose during ACTIVE frames** (centering 0.5 vs 0.18) so
  the visual lines up with the live hitbox.
- **Connection** — active windows widened (~0.12–0.14s) and reach bumped
  (Kirpan 88 / Soti 124 / Khanda 100); the enemy now guards ~45% (was 70%) so
  offense gets through.

## 0. Design pillars

1. **Motion is life.** Standing still is punished (defense decays) — the fight is
   always moving. This is the identity mechanic.
2. **Rhythm rewards mastery.** Every strike/block resolves against a steady
   **beat**; on-beat actions get bonuses. Skill = reading and riding the beat.
3. **Weapons are a triangle.** Soti → Khanda → Kirpan → Soti. Each has a clear
   answer and a clear loser (see §5).
4. **Data-driven.** Moves are rows in a table (§6), not bespoke code — new moves
   are data, not new branches.

---

## 1. THE PENTRA — movement & beat system

The Pentra is a 4-step footwork cycle (circular / figure-eight). It is the base
locomotion layer; striking and blocking are launched *out of* it and return to it.

### 1.1 The beat clock
- A free-running clock emits **4 beats per Pentra cycle** (steps: `P0 P1 P2 P3`).
- **Tempo scales with weapon weight, but the clock never stops** ("rhythm
  unbroken"): the heavier the weapon, the slower the steady tempo.

| Weapon | Tempo (BPM) | Beat period | Cycle (4 beats) |
|---|---:|---:|---:|
| Soti  | 144 | 0.417 s (~25f) | 1.67 s |
| Kirpan | 120 | 0.500 s (~30f) | 2.00 s |
| Khanda |  96 | 0.625 s (~38f) | 2.50 s |

- `beatPhase = (t mod beatPeriod) / beatPeriod` → 0..1. The **on-beat window** is
  `beatPhase < 0.12 || beatPhase > 0.88` (±~7f). Actions whose *active* frame
  lands in this window are **ON-BEAT**.

### 1.2 On-beat effects
| Action on-beat | Bonus |
|---|---|
| Strike | +25% damage, +50% Balance damage, hitstop +2f |
| Guard  | becomes a **perfect guard / parry** (no chip, reflect Balance) |
| Footwork step | refresh full defense multiplier; small i-frame on the step |
| Off-beat strike | −15% damage, worse recovery (−4f advantage) |

Maps to the shipped `PARRY_WINDOW` idea — a parry here is "correct guard **on
the beat**" instead of "within 0.13 s of raising guard."

### 1.3 Stillness penalty (the core rule)
- Track `stillTime` — seconds the character's footwork velocity ≈ 0.
- `defenseMult = clamp(1 − max(0, stillTime − 0.4) × 1.2, 0.4, 1.0)`.
  - Move within 0.4 s → full defense. Stand still → decays to **0.4×** over ~0.9 s.
- `defenseMult` scales incoming Balance damage taken and guard effectiveness.
- Balance/Posture also **regenerates only while moving** on the Pentra.

### 1.4 Weapon-weight movement
- Footwork **speed** = base × weapon `mobility` (Soti 1.15, Kirpan 1.0, Khanda 0.8).
- Path shape: idle = tight circle; advancing = figure-eight toward the opponent.
- Heavier weapons carry more **momentum** (see Animation §4): direction changes
  cost more frames.

**Migration:** add a `beatClock` + `beatPhase` to `Game`, a `stillTime` /
`defenseMult` to `Fighter`, and gate posture regen on movement. Replace the
"raise-guard within window" parry test with an on-beat test.

---

## 2. COMBAT STATE MACHINE

Extends the shipped `ACT` enum. One base locomotion state, transient action
states, and reaction states.

```
            ┌───────────────────────────── PENTRA (base) ──────────────────────────────┐
            │  constant footwork · beat clock running · defenseMult tracked             │
            └───┬───────────────┬────────────────┬───────────────┬────────────────┬─────┘
      strike btn│         guard btn│        got hit │        guard broke│      dash/step │
                ▼               ▼                ▼               ▼                ▼
   ┌──── STRIKE ────┐   ┌── GUARD ──┐      ┌ HITSTUN ┐     ┌ STAGGER ┐      ┌ STEP/DASH ┐
   │ startup        │   │ hold: cover│      │ locked   │     │ long lock│      │ i-frame on │
   │ active(hitbox) │   │ on-beat →  │      │ → PENTRA │     │ (guard   │      │ the beat   │
   │ recovery       │   │  PARRY     │      └────┬─────┘     │  crush)  │      └─────┬──────┘
   └───────┬────────┘   │ release →  │           │          └────┬─────┘            │
           │            │  PENTRA    │           └───────────────┴──────────────────┘
           └──────────► PENTRA ◄──────┘                    all recover → PENTRA
```

### 2.1 State table

| State | Enter | Can act? | Exit |
|---|---|---|---|
| **PENTRA** | default; any action recovers here | move + start any action | on input / on hit |
| **STRIKE** | strike input (move id) | no new action until recovery cancel window | startup→active→recovery→PENTRA |
| **GUARD** | hold guard (with zone) | may switch zone; may release | release→PENTRA; on-beat block→parry reaction |
| **HITSTUN** | took an un-guarded/chip hit | no | timer→PENTRA |
| **STAGGER** | Balance meter emptied OR guard-break move | no (punish window) | long timer→PENTRA (partial Balance restored) |
| **STEP/DASH** | dash input | no attack; i-frame only if stepped **on-beat** | short→PENTRA |
| **FLOW** (opt.) | 3 consecutive on-beat actions | buff: free recovery-cancels + `flowDmg` ×1.1 damage; golden aura + HUD `≈ FLOW ×n` | drops on off-beat landing / taking a hit / `flowTime` timeout &nbsp;✅ |

### 2.2 Key transition rules
- **Strike phases:** `startup → active → recovery`. Hitbox live only in `active`.
  A landed hit may open a **recovery cancel** into another move (combo) *only if
  on-beat*.
- **Guard resolution** (extends the shipped `receiveHit` priority):
  1. STAGGER/HITSTUN → cannot guard (full hit).
  2. Guard zone matches attack zone **and on-beat** → **PARRY** (reflect Balance).
  3. Guard zone matches → **BLOCK** (chip + Balance loss scaled by `defenseMult`).
  4. Attack is `guardBreak` (e.g. Purba) or `unblockable` (Khanda momentum) →
     ignore guard → STAGGER / hit.
  5. Else → clean hit → HITSTUN.
- **Balance/Stun:** every block and clean hit removes Balance; at 0 → STAGGER.
  Balance regenerates **only in PENTRA while moving**.

**Migration:** `ACT` already has IDLE/WALK(→PENTRA), ATTACK(→STRIKE),
BLOCK(→GUARD), HURT(→HITSTUN), plus add **STAGGER** and **STEP**. `receiveHit`
already models parry/block/hit — insert the on-beat + guardBreak checks.

---

## 3. HITBOX & HURTBOX DATA — the 12 moves

**Shape vocabulary**
- `SECTOR(r, θ0..θ1, w)` — a swept arc (slash): radius `r`=reach, sweep from
  angle θ0 to θ1, blade thickness `w`. Best modeled as 2–3 sampled AABBs along
  the arc, or a capsule per active frame.
- `BOX(w×h @ offset)` — axis-aligned box (thrusts, guards).
- `CAPSULE(r, len)` — for spinning/persistent barriers.
- **Zone** = vertical band → reuses the shipped `VECTOR` (High/Mid/Low) for
  block-matching.

Frame notation `S/A/R` = startup / active / recovery. `Blk` = on-block advantage
(attacker frames − defender frames; negative = punishable).

### Weapon A — SOTI (the tournament stick) · fast, medium reach, low dmg, **high Balance dmg**

| # | Move | S/A/R | Shape · Zone | Reach | Dmg | Bal | Props |
|---|---|---|---|---:|---:|---:|---|
| 1 | **Pehla Hath** — diagonal down (shoulder) | 8/6/12 | `SECTOR(116, −60°..−10°, 10)` · **High→Mid** | 116 | 9 | 16 | fast poke; +Bal on-beat |
| 2 | **Dooja Hath** — reverse diagonal | 8/6/12 | `SECTOR(116, +60°..+10°, 10)` · **High→Mid** | 116 | 9 | 16 | mirror of #1; combos from #1 |
| 3 | **Chhati Block** — 2-hand vertical, torso | 3/hold/8 | `BOX(26×70 @ front-mid)` · guards **Mid** | — | — | — | high-frequency block; weak vs overhead |
| 4 | **Sir Guard** — 2-hand overhead horizontal | 4/hold/8 | `BOX(80×20 @ top)` · guards **High** | — | — | — | anti-vertical-drop; weak vs Low/thrust |

*Hurtbox note:* Soti keeps a compact hurtbox (staff held close); its danger is
**tempo** — it interrupts slow weapons before their active frames.

### Weapon B — KIRPAN · very fast, short/med reach, **high slashing dmg**

| # | Move | S/A/R | Shape · Zone | Reach | Dmg | Bal | Props |
|---|---|---|---|---:|---:|---:|---|
| 1 | **Aadi Strike** — horizontal rib sweep | 6/5/12 | `SECTOR(78, −25°..+25°, 12)` · **Mid** | 78 | 14 | 12 | wide; catches lateral movement |
| 2 | **Sidhha Vaar** — vertical overhead chop | 8/5/14 | `SECTOR(78, −80°..−5°, 12)` · **High→Mid** | 78 | 16 | 14 | beats Mid guards; loses to Sir Guard |
| 3 | **Giraav Block** — shield deflect + step-in | 4/6/6 | `BOX(30×60)` deflect · any zone if **on-beat** | — | — | — | parry→auto **forward step** (spacing reset) |
| 4 | **Hool** — straight thrust to chest | 7/4/16 | `BOX(90×14 @ mid)` · **Mid**, long/thin | 90 | 15 | 10 | pierce; punishes whiffs; unsafe on block (Blk −8) |

*Hurtbox note:* Kirpan's forward-committed thrust (**Hool**) extends its hurtbox —
counter-hittable on whiff. Giraav's step-in is its spacing tool vs longer weapons.

### Weapon C — KHANDA · slow, medium/long reach, **massive dmg, momentum**

| # | Move | S/A/R | Shape · Zone | Reach | Dmg | Bal | Props |
|---|---|---|---|---:|---:|---:|---|
| 1 | **Chakkar** — spinning figure-8 barrier | 12/**18**/16 | `CAPSULE(92,120)` frontal, **multi-hit** · Mid | 92 | 8×hits | 10×hits | persistent **hurtbox barrier**; unblockable, drains Balance; exposes back |
| 2 | **Do-Dhari Vaar** — two-way sweep | 14/6+6/20 | `SECTOR(92,−40°..40°)` **fwd** then `(140°..220°)` **back** | 92 | 18 | 20 | hits front **and** backswing; catches rolls |
| 3 | **Purba Strike** — heavy diagonal chop | 16/6/22 | `SECTOR(92,−70°..10°,16)` · **High→Low** | 92 | 21 | 28 | **GUARD-BREAK** (crush non-perfect blocks) |
| 4 | **Santulan Block** — static flat-blade absorb | 6/hold/12 | `BOX(34×90)` · **super-armor** guard, all zones | — | — | — | absorbs heavy hits, no chip; slow to raise/lower |

*Hurtbox note:* Khanda's power moves have **long recovery = big hurtbox windows**.
Chakkar guards the front but leaves the **back** open (punish by circling — the
Pentra footwork answer). Momentum means Khanda can't quickly re-aim.

**Migration:** each row becomes a record in a `MOVES` table (§6). Shipped
`getAttackHitbox()` already builds a zoned AABB from `reach`; extend it to read
`shape` + `arc` and, for multi-hit/two-way moves, multiple active windows.

---

## 4. ANIMATION DIRECTION NOTES

**Global (all weapons):** never a static idle — the base pose is the Pentra
weight-shift (ball-of-foot, hips loose, subtle figure-eight sway). Secondary
motion always on: turban **farla**, robe hem, **beard** sway, sash. Add a visible
**on-beat "pop"** (1–2f scale/lean accent) so the player feels the rhythm.

- **Soti (light):** snappy, whip-like. Fast anticipation, minimal wind-up,
  crisp stop-and-return. Momentum lives in the **wrists**; body stays upright and
  mobile. Recovery settles quickly back into footwork. Trail FX thin.
- **Kirpan (medium, agile):** fluid and continuous — slashes flow into the next
  step. Momentum transfers through **hip rotation**; the off-hand (shield)
  frames the guard. Hool: sharp weight-forward lunge, hard recoil on whiff.
  Blade trails should curve (echoes the Amrit-Dhāra VFX).
- **Khanda (heavy):** committed, full-body. **Momentum transfer from the legs
  and core** — you feel the mass. Big anticipation, long follow-through, the
  spin (Chakkar) uses continuous rotational inertia; direction changes are
  *slow* by design. Heavy footfalls, camera micro-shake on Purba impact.

**Weapon momentum (implemented — the fluidity layer).** The drawn arm angle is a
physical value, not a per-frame pose lookup: `Fighter.weaponAngle` +
`weaponMomentum`, integrated in `update()` (fixed timestep). Friction bleeds spin
(`×0.94`/step); a strike **injects** momentum (bigger on-beat / in FLOW —
"PERFECT_FLOW"); the **Chakkar** sustains a whirl while active; then the angle
**elastically re-centers** toward the pose target via a Lerp (`+= (target−angle)
×0.18`) so it never snaps. Idle carries a gentle Pentra sway; the Giraav (Chhari)
guard is a spinning vortex. When `|momentum| > 0.4` a translucent **rotational
blur** arc is drawn. Feet keep drifting during an attack/guard
(attack-recovery overlap). See `_targetArmAngle()`.

**Procedural / blueprint hooks:**
- Root-motion drives spacing on lunges (Hool) and Purba's step.
- IK the weapon hand to the arc so contact reads at the `active` frame.
- Anticipation curve length ∝ weapon weight; overshoot + settle on recovery.
- On guard-break (Purba vs guard): play a **stagger break** on the defender +
  weapon-fling, syncing to the attacker's impact frame.
- Freeze-frame (hitstop) scales with damage tier and doubles on-beat.

---

## 5. BALANCING & ATTRIBUTES MATRIX

### 5.1 Attributes (1–10)

| Attribute | Soti | Kirpan | Khanda |
|---|:--:|:--:|:--:|
| Speed | 9 | 8 | 3 |
| Reach | 8 | 5 | 7 |
| Damage | 3 | 7 | 10 |
| Balance/Stun dmg | 9 | 5 | 8 |
| Guard quality | 6 | 7 (parry+step) | 8 (super-armor) |
| Mobility (tempo) | 9 | 7 | 4 |
| Risk on whiff | Low | Med | High |

### 5.2 The counter triangle

```
        SOTI ──beats──►  KHANDA
          ▲                  │
          │                  beats
        beats                │
          │                  ▼
        KIRPAN ◄──beats── (Kirpan)   →  KIRPAN ──beats──► SOTI
```

**Soti ▶ Khanda** — speed + Balance damage. Soti's fast active frames
interrupt Khanda's long startups; high Balance dmg staggers the slow bruiser
before it commits. *Khanda's out:* Santulan super-armor absorbs a poke, Chakkar
walls the approach.

**Khanda ▶ Kirpan** — reach + unblockable momentum. Kirpan's short blade can't
contest Khanda's spacing; Purba guard-breaks the Kirpan's blocks; Chakkar denies
the close range Kirpan wants. *Kirpan's out:* Giraav parry→step to slip inside,
then punish the long recovery.

**Kirpan ▶ Soti** — very high speed + slashing damage out-trades. Kirpan wins
the fast exchanges and does real HP damage where Soti only chips Balance;
Giraav parries the predictable stick arcs. *Soti's out:* superior reach +
Sir/Chhati guards to keep Kirpan at bay and rack Balance.

### 5.3 Rhythm as the great equalizer
Any weapon can beat any other **by owning the beat**: on-beat parries reflect
Balance, on-beat strikes gain the damage/stun to break the rock-paper-scissors.
Spacing (Pentra footwork) + rhythm reads are the skill ceiling above the triangle.

### 5.4 Tuning levers (single source of truth)
`tempo (BPM)`, `defenseMult decay`, on-beat bonus %, per-move `S/A/R`, `Bal`
damage, `guardBreak`/`unblockable` flags, `Blk` advantage. Tune these; don't
hand-edit behavior.

---

## 6. DATA SCHEMA (ready for code)

Each move is a row; the engine reads it generically.

```js
// MOVES[weaponId] = [ move, move, move, move ]
const MOVE = {
  id: "kirpan.hool",
  kind: "strike",              // "strike" | "guard"
  zone: VECTOR.MID,            // reuses the shipped High/Mid/Low system
  shape: "box",                // "sector" | "box" | "capsule"
  arc: [ -0, +0 ],             // sector sweep in degrees (strike only)
  reach: 90, boxW: 90, boxH: 14,
  startup: 7, active: [4], recovery: 16,   // active = list → multi-window moves
  dmg: 15, balDmg: 10,
  onBlockAdv: -8,
  flags: { guardBreak: false, unblockable: false, superArmor: false, stepIn: false },
};
// Guards: kind:"guard", covers:[zones], flags.superArmor, on-beat → parry.
```

**Runtime, per fixed step (extends the shipped loop):**
1. Advance `beatClock`; compute `beatPhase`, `onBeat`.
2. Update `stillTime` → `defenseMult`; regen Balance only if moving.
3. In STRIKE `active`, build hitbox(es) from the move row (sector→sampled AABBs)
   and test `aabbIntersect` vs opponent hurtbox (already in engine).
4. Resolve via the §2.2 priority (add on-beat + guardBreak to `receiveHit`).
5. Apply on-beat bonuses; enter HITSTUN/STAGGER; open recovery-cancel if on-beat.

---

## 7. Suggested build order (if implemented in this engine)
1. **Beat clock + stillness** (pure additions; low risk) — feel the rhythm first.
   ✅ **IMPLEMENTED** — per-weapon `beat` tempo in `WEAPONS`, `PENTRA` config,
   `Fighter.beatPhase/onBeat` + `stillTime/defenseMult`; Balance regen gated on
   movement; blocked/clean Balance damage scaled by `(2 − defenseMult)`; HUD beat
   pips + "KEEP MOVING" warning + on-beat ground pulse. (On-beat *combat bonuses*
   — parry/damage — remain step 4.)
2. **Move data table** + generic hitbox builder (sector→AABBs); port the current
   single attack to `move[0]` per weapon.
   ✅ **IMPLEMENTED** — `MOVES[weaponId]` table (12 moves); `Fighter.startAttack`
   /`startBlock` take a move record; `getAttackHitbox`/`_advanceAttack` read move
   data; damage/Balance from the move. (Hitboxes remain zone-AABBs, not swept
   sectors — the sector→AABB sampling is a later visual upgrade.)
3. **4 moves per weapon** bound to inputs (e.g., ↑/→/↓ + strike = move select).
   ✅ **IMPLEMENTED** — J with ↑ / neutral / ↓ picks the three strike slots; K
   (↑+K for the high guard where a weapon has one) picks the guard. Enemy AI
   picks from the same move table. Special flags live too: **guard-break**
   (Purba), **unblockable + multi-hit** (Chakkar), **two-way** (Do-Dhari),
   **super-armor** guard (Santulan), **deflect + step-in** (Giraav).
4. **Guard zones + on-beat parry**, then **guard-break / unblockable / super-armor**.
   ✅ **On-beat bonuses IMPLEMENTED** (ahead of steps 2–3): guarding **on the
   beat** parries (alongside the fresh-raise parry); on-beat strikes deal
   `onBeatDmg` ×1.25 / `onBeatBal` ×1.5, off-beat `offBeatDmg` ×0.85; on-beat
   impacts add hitstop + a gold spark. Guard *zones* + guard-break/super-armor
   still pending (need the move table, step 2).
5. **STAGGER + recovery-cancel combos**, then the **counter-matrix tuning pass**.
   ✅ **STAGGER + recovery-cancel IMPLEMENTED** — `ACT.STAGGER` is a first-class
   state (0.62s, `_locked`, pulsing red indicator, wide-open pose); a guard-break
   or emptied Balance triggers it; hits on a staggered/hurt defender deal a
   **+40% punish**; an **on-beat landing hit opens `canCancel`**, letting a strike
   cancel its own recovery into the next move (combo). The **counter-matrix
   tuning pass** still wants human playtesting (values live in `MOVES`/`PENTRA`).
