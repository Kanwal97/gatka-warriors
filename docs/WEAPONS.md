# Weapons & Abilities — Data Reference

The authoritative values live in the `WEAPONS`, `ABILITY`, `SIMRAN_GAIN`,
`CHAKRAM`, and `ULT` tables in [game.js](../game.js) SECTION 1. This doc mirrors
them for design reference and explains the Kirpan's VFX. **If you change a value,
change it in `game.js` and update this table.**

## Weapons (`WEAPONS`)

Timings are seconds; a weapon is a player/enemy choice (adding one to the object
auto-adds its select-screen card).

| Weapon | reach | damage | postureDmg | windup | active | recovery | notes |
|---|---:|---:|---:|---:|---:|---:|---|
| **Kirpan** | 88 | 14 | 18 | 0.16 | 0.09 | 0.24 | Balanced. Carries the Amrit-Dhāra glow (below). |
| **Soti** | 124 | 9 | 13 | 0.14 | 0.10 | 0.15 | Long reach, soft blows, fast recovery. |
| **Khanda** | 100 | 21 | 28 | 0.26 | 0.10 | 0.34 | Heavy; `superArmor` plows through hit-stun on active swings. Akaal's blade. |

### Authentic length vs `reach` — two different measurements

`INCH_TO_PIXEL_SCALE = 150 / 71 ≈ 2.11 px/inch`. **This is not a free parameter.**
`Fighter.height` is 150px and a Nihang Singh stands ~71in, so the body fixes the
scale. A 36in Tegh is ~76px — about half the warrior's height, which is what a
real sword looks like on a real man. (Picking 4 px/inch instead would imply a
**37in — three-foot — warrior** carrying a sword 96% of his own height.)

| Weapon | `lengthInches` (real) | at true scale | `reach` (combat) |
|---|---:|---:|---:|
| **Kirpan** | 31in — hilt 6 + blade 25 | 65px | 88 |
| **Soti** | 39in — regulation 36–42in, 500g | 82px | 124 |
| **Khanda** | 40in | 85px | 100 |

- **`lengthInches`** is the authentic shastar as it exists in the world. It is a
  **record**: it drives nothing but the debug ruler. The **Kirpan is one Kakaar
  with two forms** — the *Siri Sahib* worn daily (3–9in) and the full *Tegh /
  Talwar* borne in battle. They are not two weapons. Akaal bears the battle form.

#### Fitting the Kirpan to its wielder

The size is **not a free choice**. Gatka kirpans come in three standard sizes,
and the rule of thumb is that the **blade should be close to the wielder's arm
length** so the whirling patterns stay controllable.

Akaal is 150px = **71in**, and the art gives him an arm of `h * 0.34` = 51px =
**24.1in**. That picks his size for us:

| Overall | Blade | vs 24.1in arm | Intended for |
|---:|---:|---:|---|
| 23.5in | 17.5in | −6.6in | kids |
| **31in** | **25.0in** | **−0.9in** ✅ | teens / average adults |
| 33.5in | 27.5in | +3.4in | taller adults |

The 31in size fits to within an inch, and the height rule agrees independently
(5'11" is an average adult). **If `Fighter.height` ever changes, re-run this
fit** — the size is derived from the body, not chosen.

The Sikh Rehat prescribes no length, but the blade **must be curved and
single-edged**, which is why `bladeStyle: "curved_sabre"` is not a free choice
either. Training/demonstration pieces keep a blunt edge.

> **Sport vs demonstration.** Competitive Gatka is fought with the wooden **Soti**
> and leather **Farri** — the soti is a *substitute for the sword that retains
> sword technique*. The steel Kirpan is for solo demonstration and shastar
> display, never contact bouts. That distinction is what the `class` field
> ("Tournament" vs "Virasat (Steel)") records.

#### Blade aspect ratio

The reference gives a **1.2–1.5in (3–4cm)** blade on a 25in blade — an aspect
ratio near **18.5 : 1**. Aspect is *scale-free*, so it must hold even though the
drawn blade is heroically long. `drawKirpan` draws **15.9 : 1**, within 16% of
real: a talwar's slender profile.

It was **8.4 : 1** — a blade reading 4.7in wide, a falchion wedge rather than a
talwar. Narrowing it meant retightening the detail layers built for the fat
blade: the Damascus banding spanned 20px (most bands fell outside the clip and
never drew) and the engraving ticks drifted above the spine, off the steel.
Both are now clipped to `bladePath` so they cannot escape it again.
- **`reach`** is combat spacing in px, from the body edge to the tip of the
  hitbox — **arm + weapon + lunge** — and is playtest-tuned (§0b).

**Why they are not fused.** Real Gatka weapons are all 36–42in: an ~11% spread.
[COMBAT-SYSTEM §5.2](COMBAT-SYSTEM.md) needs reach to *separate* the weapons
("Soti's out: superior reach"; "Kirpan's short blade can't contest spacing"),
which wants ~41%. Today's tuned spread is **1.41×** (124 vs 88) and reads
instantly; true length gives **1.08×**, which nobody can feel. Reality cannot
carry that axis. So the authentic length is recorded *beside* `reach` rather than
deriving it — deriving it would flatten the counter triangle.

Set `window.__GATKA_DEBUG__ = true` to see the trade-off: the **green ruler** is
the real shastar at true scale, the **red box** is the live hitbox. The gap
between them is the heroic exaggeration, kept visible so it stays an intentional
choice rather than an accident.

### Form & material traits

These describe the weapon's *physical* identity. The `Artist` and the hitbox
builder read them generically — **no weapon is special-cased by id** — so a new
row in `WEAPONS` draws and fights correctly without touching either.

| Weapon | class | bladeStyle | hasBasketHilt | hasShield | weight |
|---|---|---|---|:--:|---|
| **Kirpan** | Virasat (Steel) | `curved_sabre` | no (cross-guard + disc pommel) | yes — the Dhal | `forward_heavy` |
| **Soti** | Tournament | `straight` | yes — leather basket | yes — the Farri | `balanced` |
| **Khanda** | Virasat (Steel) | `straight_broad` | no | **no — `twoHanded`** | `forward_heavy` |

> **Sword+shield vs two-handed.** Sword+shield is *the* Gatka combination, so the
> Kirpan carries the Dhal and the Soti the Farri. The **Khanda is clasped with
> both hands** — it is a two-handed broadsword and carries **no shield**
> (`twoHanded: true`; `Artist.drawWarrior` puts the off-hand on the hilt instead
> of a Dhal). It was wrongly `hasShield: true`.

### Motion signature (`motion`)

The atthha (figure-eight) never stops: in a ready state the blade whirls
continuously, and each weapon whirls at its own tempo with its own smear. This is
the identity motion of Gatka and is now visible at rest, not just during a strike.

| Weapon | `motion.whirl` (rad/s) | `motion.swing` | trail | reads as |
|---|---:|---:|---|---|
| **Soti** | 8.5 | 0.25 | thin, pale | quick, tight, snappy |
| **Kirpan** | 6.0 | 0.35 | gold (Amrit-Dhāra) | fluid, wide, flowing |
| **Khanda** | 3.8 | 0.50 | broad, cold steel | slow, heavy, committed |

`Fighter.whirlPhase` advances at `motion.whirl` while IDLE/WALK/STEP and becomes
the arm's pose target; `Fighter.weaponAngVel` (blade angular speed = whirl +
strike spin) drives the smear, so both the ready-whirl and a live vaar leave a
trail.

**The whirl rides the nagara.** Real Gatka "rotates in smooth circles matching the
drum's beat", so the whirl rate is modulated by the beat clock —
`whirl · (1 + swing · cos(beatPhase·2π))` — surging as the beat lands and easing
through the mid-beat. `swing` sets how hard it heaves: a light Soti patters evenly
(0.25), a heavy Khanda heaves onto the beat then coasts (0.50). The mean rate stays
`whirl` (cos integrates to zero), so each weapon keeps its identity tempo.

**The smear is a dissipating comet.** The trail tapers alpha (squared falloff) and
width toward its tail so it reads as motion-blur, not a flat ribbon; the hot vaar
strands blend additively (`"lighter"`) so overlaps bloom. The strike ease also
*ramps* into the pose across the active window (0.34 → 0.72) instead of snapping.

- **`bladeStyle`** picks the art via the `Artist.drawWeapon` factory *and* shapes
  the hitbox: a `curved_sabre` cleaves, so its box gains `CURVE_SWEEP` (0.10 ×
  body height) of extra vertical coverage — the belly sweeps through the zone
  rather than landing on one point. Straight weapons keep the tight point-strike
  box. **The `vector` is identical either way**, so block/parry is unaffected.
- **`weight`** drives *only* `WEIGHT_FRICTION` — how much swing momentum survives
  each step (`balanced` 0.91 = crisp stop-and-return; `forward_heavy` 0.96 =
  carries its arc, costlier to reverse). It deliberately does **not** touch
  per-move S/A/R, so frame data in `MOVES` stays the single authority.
- **`hasShield`** gates the off-hand shield in `Artist.drawWarrior`. The Kirpan
  keeps it because §3's **Giraav Block** is defined as a *shield* deflect.
- **`art`** supplies `material` + `hilt` colours; the blade gradient is derived
  from `material` via `shade()`.

### Kirpan blade geometry

The blade sweeps **upward from the grip, and the tip is the apex** — the curve
reads on the **upper side** and the point never droops back toward the hand.
`tipX/tipY` in `drawKirpan` is the single anchor; the Damascus banding, the spine
engraving, and the Amrit-Dhāra fuller + tip seal all track it, so the blade stays
one continuous arc. (Before, the spine peaked at mid-blade and the tip fell back
below it, which read as a downward curve.)

## Combat rules (recap)

- Attacks/blocks have a **vector**: HIGH / MID / LOW. A block only works if its
  vector matches the incoming hitbox's vector.
- **Parry window:** 0.13s (`PARRY_WINDOW`) — a freshly-raised, correctly-aimed
  block converts a hit into a parry (punishes attacker posture, ignites the
  Kirpan).
- **Posture** depletes on blocked hits; at 0 the guard breaks → stagger.
- **Hit-stop** (`freezeT`) adds impact weight: parry 0.09s, reflect 0.08s,
  block 0.04s, hit 0.05s.

## The Simran meter & abilities

`SIMRAN_MAX = 100`. Charge via `SIMRAN_GAIN`:

| Event | Simran |
|---|---:|
| Land a clean hit | +14 |
| Your hit was blocked | +4 |
| You blocked a hit | +8 |
| **You parried** | **+24** |
| Iron Shield reflected | +10 |
| Your Chakram connected | +8 |

Abilities (`ABILITY`):

| Ability | Key | Cost | Params | Effect |
|---|:--:|---:|---|---|
| **Chakram Storm** | `U` | 34 | cast 0.22s | Fan of 3 discs, one per vector. `CHAKRAM`: speed 470, dmg 8, postureDmg 10, radius 12, range 620. |
| **Sarbloh Kavach** (Iron Shield) | `I` | 30 | window 0.8s | Reflect the next incoming hit (any vector); drain attacker posture. |
| **Chardi Kala** (Ultimate) | `O` | 100 | duration 1.15s | Invulnerable + super-armor; AoE pulses at t=`ULT.pulses` [0.34, 0.78], radius 150, dmg 16 each. |

Enemy AI uses the same kit: throws Chakrams from range, panic-shields the
player's ultimate, spends a full meter on its own ultimate.

## Amritvelā — the Kirpan's Amrit-Dhāra VFX

Concept weapon: a curved single-edged **Damascus** blade with Gurmukhi-inspired
spine engraving, a Talwar disc pommel (lotus/lion + lapis soul-gem), and a
spiritual (not elemental) **nectar-light** buff locked to saffron-gold. Presented
in the [weapon-plate artifact](../weapon-plate-kirpan.html); implemented in
`Artist.drawKirpan`.

**In-engine glow states** (driven by wielder state + the `weaponFlare` timer):

| State | Trigger in code | Visual |
|---|---|---|
| Dormant | `action === KO` / menu icon | Blade dark; lapis pommel-gem breathes. |
| Vigilant | any live combat action | Faint gold thread wakes in the fuller. |
| Strike | `ATTACK` active/recovery | Brighter fuller + gold crescent slash-trail; `weaponFlare=0.2` on a landed hit. |
| Parry ignite | a successful parry sets `weaponFlare=0.35` | Whole engraving flares gold-white; ties into the parry particle burst. |

Only the **Kirpan** gets this treatment; Khanda and Soti keep their own looks.
The artifact also documents the **Ultimate ("Amrit Velā")** state — molten runes,
liquid afterimages — as a future in-engine enhancement.

## Materials / production (concept)

Damascus as tiling flow-mapped normal+roughness under the emissive; two emissive
masks (`fuller_flow` scrolling, `seal_burst` parry); brass metallic 1.0 rough
0.35–0.6; velvet anisotropic cloth. Full notes in the weapon-plate artifact.
