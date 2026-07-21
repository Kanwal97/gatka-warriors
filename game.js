/* ============================================================================
 * GATKA WARRIORS — a 2D martial-arts fighter in pure vanilla JS + Canvas.
 * ----------------------------------------------------------------------------
 * ARCHITECTURE OVERVIEW
 *
 *   Game            — the orchestrator. Owns the state machine, the fixed
 *                     timestep loop, projectiles, and the list of systems.
 *   InputManager    — normalizes keyboard into a simple, pollable "intent" set.
 *   Fighter         — shared physics + combat body. Player & Enemy extend it.
 *                     Also owns the Sant-Sipahi kit: the Simran resource meter
 *                     and the three special abilities.
 *   Player / Enemy  — differ only in how their intents are produced (human
 *                     input vs. AI decision-making).
 *   Projectile      — a thrown Chakram (steel disc) with its own AABB.
 *   ParticleSystem  — a flat array of short-lived particles for parry bursts.
 *   HUD             — draws health / posture / SIMRAN bars, round pips.
 *   Artist          — pure drawing helpers for the warrior vector silhouette.
 *
 * Everything is organized as small components so responsibilities stay
 * separated even though we ship a single file. Search for the SECTION banners
 * to jump around.
 * ==========================================================================*/

(function () {
"use strict";

/* ============================================================================
 * SECTION 1 — CONSTANTS & CONFIGURATION
 * ==========================================================================*/

// A Yodha's closing speed. 230 px/s was 2.76 m/s — a jog — and crossing the
// akhara took 3.6 seconds before he could even swing. Akaal is a hero, not a
// sparring dummy. Per-weapon `mobility` (COMBAT-SYSTEM 1.4) finally multiplies
// this, so the Soti skates and the Khanda lumbers.
const BASE_SPEED = 350;

const CANVAS_W = 900;
const CANVAS_H = 500;
const GROUND_Y = 430;            // y of the floor line; fighters stand ON this
const GRAVITY  = 2200;           // px/s^2 pulling jumpers back down
const JUMP_V   = 760;            // initial upward jump speed (px/s)
const FIXED_DT = 1 / 60;         // simulation runs at a fixed 60Hz timestep

// The finite-state machine that governs the WHOLE application.
// Each value is a distinct screen/mode; Game.state only ever holds one.
const STATE = Object.freeze({
  MAIN_MENU:        "MAIN_MENU",         // title screen
  CHARACTER_SELECT: "CHARACTER_SELECT",  // weapon picking
  GUIDE:            "GUIDE",             // how to play — needs the whole frame
  GAMEPLAY:         "GAMEPLAY",          // an active round
  PAUSED:           "PAUSED",            // round frozen; the only way out mid-fight
  ROUND_OVER:       "ROUND_OVER",        // brief banner between rounds
  GAME_OVER:        "GAME_OVER",         // match finished (best of 3 decided)
});

// The three attack/block vectors. Their integer values double as vertical-zone
// indices used by the hitbox math (see Fighter.getAttackHitbox).
const VECTOR = Object.freeze({ HIGH: 0, MID: 1, LOW: 2 });

// A fighter's internal action state. Kept separate from the GAME state above.
const ACT = Object.freeze({
  IDLE:   "IDLE",
  WALK:   "WALK",
  ATTACK: "ATTACK",   // sub-phased into windup → active → recovery
  BLOCK:  "BLOCK",
  STEP:   "STEP",     // a Pentra side-step — the art's PREFERRED answer to a blow
  CAST:    "CAST",    // performing a ranged ability (Chakram Storm)
  HURT:    "HURT",    // hit-stun, can't act
  STAGGER: "STAGGER", // guard broken / Balance crushed — long punish window
  KO:      "KO",      // defeated
});

// Real-world scale. This is NOT a free parameter — the warrior's body fixes it.
// A Fighter stands `height` = 150px and a Nihang Singh stands ~71in, so:
//         INCH_TO_PIXEL_SCALE = 150 / 71 ≈ 2.11 px per inch
// A 36in Tegh is therefore ~76px: about half the warrior's height, which is what
// a real sword looks like on a real man. (Sanity check for anyone tempted to
// round it up: at 4 px/inch the warrior would stand 37in — barely three feet —
// and his sword would be 96% of his own height.)
const INCH_TO_PIXEL_SCALE = 150 / 71;

// ---- WEAPON DEFINITIONS -----------------------------------------------------
// Each weapon tunes reach, damage, timing and posture pressure. This is the
// single source of truth the selection menu and the combat code both read.
// (The selection cards are generated from this table, so adding a weapon here
//  automatically adds its card to the menu.)
//
// `lengthInches` vs `reach` — these are DIFFERENT MEASUREMENTS. Do not fuse them:
//   lengthInches  the authentic shastar, as it exists in the world. A record of
//                 the real weapon; drives nothing but the debug ruler.
//   reach         COMBAT spacing in px, from the body edge to the tip of the
//                 hitbox — arm + weapon + lunge, and playtest-tuned (see §0b).
// Real Gatka weapons are all 36–42in — an ~11% spread. COMBAT-SYSTEM §5.2 needs
// reach to SEPARATE the weapons ("Soti's out: superior reach" / "Kirpan's short
// blade can't contest spacing"), and that wants ~41%. Reality cannot carry that
// axis, so `reach` stays tuned and the authentic length is recorded beside it
// rather than driving it. Deriving reach from lengthInches would flatten the
// counter triangle to an 8% spread nobody can feel.
//
// FORM & MATERIAL traits let the Artist and the hitbox builder stay generic —
// no weapon is special-cased by id in drawing or combat code:
//   class          the discipline the weapon belongs to (shown on its card)
//   bladeStyle     "straight" (uniform cylindrical stick, blunt, point-strike)
//                  "curved_sabre" (swept arc, cleaves through the zone)
//                  "straight_broad" (broad double-edged blade)
//   hasBasketHilt  a leather basket handguard encloses the gripping hand
//   hasShield      carries a shield in the off-hand (Farri / Dhal)
//   weight         "balanced" — even weight, crisp stop-and-return
//                  "forward_heavy" — carries its arc; direction changes cost more
//   art            material + hilt colours the vector art is drawn from
const WEAPONS = {
  kirpan: {
    id: "kirpan", name: "Kirpan", class: "Virasat (Steel)",
    flavor: "The sacred curved sword. Balanced damage, honest speed.",
    // The Kirpan is ONE Kakaar with two forms, not two weapons: the Siri Sahib
    // worn daily (3–9in) and the full Tegh / Talwar borne in battle. Akaal bears
    // the battle form.
    //
    // SIZE IS NOT A FREE CHOICE — it is fitted to the wielder. Gatka kirpans come
    // in three standard sizes (23.5 / 31 / 33.5in overall), and the rule of thumb
    // is that the BLADE should be close to the wielder's ARM LENGTH so the
    // whirling patterns stay controllable. Akaal is 150px = 71in, and the art
    // gives him an arm of h*0.34 = 51px = 24.1in — so the 31in size (25in blade)
    // fits him to within an inch. 33.5in would overshoot his arm by 3.4in.
    //
    // The Sikh Rehat prescribes no length, but the blade MUST be curved and
    // single-edged — which is why `bladeStyle` is not a free choice either.
    lengthInches: 31,   // overall = hilt 6 + blade 25
    hiltInches: 6,
    bladeInches: 25,    // curved, single-edged
    bladeWidthInches: 1.35,   // 1.2–1.5in (3–4cm) — drives the blade's aspect ratio
    weightGrams: 600,         // ~500–700g for a 31in piece
    reach: 88, damage: 14, postureDmg: 18,
    windup: 0.09, active: 0.12, recovery: 0.13,
    beat: 0.50,   // Pentra tempo — 120 BPM
    mobility: 1.0,
    bladeStyle: "curved_sabre",
    hasBasketHilt: false,     // a cross-guard + disc pommel instead of a basket
    hasShield: true,          // the Dhal — Giraav Block deflects with it (§3)
    weight: "forward_heavy",  // the belly of the arc carries the swing through
    art: { material: "#e5e4e2", hilt: "#ffd700" },
    bars: { damage: 0.62, range: 0.5, speed: 0.6 },
  },
  soti: {
    id: "soti", name: "Soti", class: "Tournament",
    flavor: "The tournament stick, paired with the Farri. Long reach and a fast recovery, softer blows.",
    // The soti is the wooden stick of competitive Gatka — a substitute for the
    // sword that retains sword technique. Paired with the leather Farri, this is
    // what is actually used for sparring; the steel Kirpan is for solo
    // demonstration and shastar display, never for contact bouts.
    lengthInches: 39, weightGrams: 500,
    reach: 124, damage: 9, postureDmg: 13,
    windup: 0.07, active: 0.12, recovery: 0.09,
    beat: 0.417,  // 144 BPM — light and quick
    mobility: 1.15,   // the stick skates; footwork is its whole game
    bladeStyle: "straight",
    hasBasketHilt: true,      // leather basket dome over the gripping hand
    hasShield: true,          // the Farri
    weight: "balanced",       // momentum lives in the wrists — snappy recovery
    art: { material: "#d2b48c", hilt: "#8b5a2b" },
    bars: { damage: 0.4, range: 0.92, speed: 0.78 },
  },
  khanda: {
    id: "khanda", name: "Khanda", class: "Virasat (Steel)",
    flavor: "Akaal's double-edged blade. Devastating, armored, deliberate.",
    lengthInches: 40,   // straight double-edged blade, borne two-handed
    reach: 100, damage: 21, postureDmg: 28,
    windup: 0.15, active: 0.13, recovery: 0.19,
    superArmor: true,   // heavy swings plow through hit-stun during the swing
    beat: 0.625,  // 96 BPM — heavy and deliberate
    mobility: 0.8,    // the mass is the point; it can never quite re-aim
    bladeStyle: "straight_broad",
    hasBasketHilt: false,
    hasShield: true,
    weight: "forward_heavy",  // rotational inertia — it cannot quickly re-aim
    art: { material: "#dfe7ef", hilt: "#e6b845" },
    bars: { damage: 0.96, range: 0.62, speed: 0.3 },
  },
};

// How much swing momentum a weapon keeps per step, keyed by `weight`. A balanced
// stick stops crisply; a forward-heavy blade carries its arc, so reversing costs
// more. This is the ONLY thing `weight` drives — per-move frame data stays
// authoritative, so weight never silently re-tunes S/A/R. See COMBAT-SYSTEM §4.
const WEIGHT_FRICTION = Object.freeze({ balanced: 0.91, forward_heavy: 0.96 });

// A curved sabre does not land on a single focal point — the belly sweeps
// through the target zone — so its hitbox gains this much extra vertical
// coverage (as a fraction of body height), split above and below the zone band.
// Straight weapons keep the tight point-strike box.
const CURVE_SWEEP = 0.10;

// ---- MOVE DATA (the 12 named Gatka moves) -----------------------------------
// Each weapon exposes 4 moves via input slots: jUp / jMid / jDown (strikes) and
// guard (+ optional guardUp). Data-driven — see docs/COMBAT-SYSTEM.md §3/§6.
//   strike: { name, zone, reach?, dmg, balDmg, windup, active, recovery,
//             hits?, hitEvery?, flags?{ guardBreak, unblockable } }
//   guard : { name, guard:true, covers:[zones], windup, recovery,
//             flags?{ superArmor, deflect, stepIn } }
const MOVES = {
  soti: {
    jUp:   { name: "Pehla Hath", zone: VECTOR.HIGH, dmg: 9, balDmg: 16, windup: 0.060, active: 0.13, recovery: 0.080 },
    jMid:  { name: "Dooja Hath", zone: VECTOR.MID,  dmg: 9, balDmg: 16, windup: 0.060, active: 0.13, recovery: 0.080 },
    jDown: null,
    guard:   { name: "Chhati Block", guard: true, covers: [VECTOR.MID],  windup: 0.035, recovery: 0.085 },
    guardUp: { name: "Sir Guard",    guard: true, covers: [VECTOR.HIGH], windup: 0.048, recovery: 0.085 },
  },
  kirpan: {
    jUp:   { name: "Sidhha Vaar", zone: VECTOR.HIGH, dmg: 16, balDmg: 14, windup: 0.075, active: 0.13, recovery: 0.130 },
    jMid:  { name: "Aadi Strike", zone: VECTOR.MID,  dmg: 14, balDmg: 12, windup: 0.055, active: 0.13, recovery: 0.105 },
    jDown: { name: "Hool", zone: VECTOR.MID, reach: 106, dmg: 15, balDmg: 10, windup: 0.070, active: 0.11, recovery: 0.150 },
    guard:   { name: "Giraav Block", guard: true, covers: [VECTOR.HIGH, VECTOR.MID, VECTOR.LOW], windup: 0.045, recovery: 0.070, flags: { deflect: true, stepIn: true } },
    guardUp: null,
  },
  khanda: {
    // BIJLI (lightning). The heaviest blow in the akhara — the only guard-break —
    // calls the sky down with it. One vaar, once per swing, so it stays an event.
    jUp:   { name: "Purba Strike",  zone: VECTOR.HIGH, dmg: 21, balDmg: 28, windup: 0.155, active: 0.15, recovery: 0.210, flags: { guardBreak: true, bijli: true } },
    jMid:  { name: "Do-Dhari Vaar", zone: VECTOR.MID,  dmg: 12, balDmg: 14, windup: 0.135, active: 0.22, recovery: 0.190, hits: 2, hitEvery: 0.10 },
    jDown: { name: "Chakkar", zone: VECTOR.MID, dmg: 6, balDmg: 8, windup: 0.120, active: 0.30, recovery: 0.160, hits: 5, hitEvery: 0.10, flags: { unblockable: true } },
    guard:   { name: "Santulan Block", guard: true, covers: [VECTOR.HIGH, VECTOR.MID, VECTOR.LOW], windup: 0.070, recovery: 0.130, flags: { superArmor: true } },
    guardUp: null,
  },
};

// ---- KEY BINDINGS -----------------------------------------------------------
// TWO-HANDED BY DESIGN. Combat needs a vector HELD while strike is TAPPED
// (`up ? M.jUp : …`), so those two keys must fall under different hands.
//   LEFT hand  → W A S D  (Pentra + High/Low vector) and Space (jump) on the thumb
//   RIGHT hand → J K on the home row, U I O directly above them:
//                  index J/U · middle K/I · ring O
// Arrows stay bound as an alternative, but they sit on the SAME side as J/K/U/I/O
// — holding ↑ while tapping J is a ~171mm one-hand stretch, which is why WASD is
// the primary binding. The on-screen touch controls emit these same key names, so
// keyboard and touch share one path (see InputManager.press / release).
const KEYS = Object.freeze({
  left:     ["a", "ArrowLeft"],
  right:    ["d", "ArrowRight"],
  up:       ["w", "ArrowUp"],
  down:     ["s", "ArrowDown"],
  jump:     [" "],
  strike:   ["j"],
  guard:    ["k"],
  dodge:    ["Shift", "l"],   // left pinky, right beside A/W/S/D
  chakram:  ["u"],
  shield:   ["i"],
  ultimate: ["o"],
});

/**
 * THE CONTROL GUIDE — one source of truth for what every key does.
 *
 * Generated from the KEYS table above and the ABILITY costs below, so it can
 * never drift from what the game actually does: rebind a key or re-cost an
 * ability and the guide re-renders correct. It is injected into BOTH the title
 * screen and the PAUSE screen — you pause precisely because you have forgotten
 * which button does what, so that is exactly where the answer has to be.
 *
 * `d` says what the key is FOR, not just what it is called. "Step" is useless;
 * "beats what no guard can, then your next blow is a x1.5 counter" is the game.
 */
function buildGuide() {
  const K = (list) => {
    const k = list[0];
    return k === " " ? "Space" : (k.length === 1 ? k.toUpperCase() : k);
  };
  return [
    { group: "Left hand \u00b7 the Pentra" },
    { keys: [K(KEYS.left) + "</kbd><kbd>" + K(KEYS.right)], name: "Move",
      d: "Never stand still. Stillness weakens your guard and stops Balance recovery \u2014 the Pentra IS the art." },
    { keys: [K(KEYS.up) + "</kbd><kbd>" + K(KEYS.down)], name: "High / Low",
      d: "The vector. Picks which move Strike uses, and which zone Guard covers." },
    { keys: [K(KEYS.dodge)], name: "Step \u2014 the side-step", hi: true,
      d: "Gatka's FIRST answer, not its last. On the beat it makes you untouchable and beats what no guard can \u2014 the unblockable Chakkar, the guard-breaking Purba. Land a blow after it and it counts as a COUNTER (\u00d71.5): roko aur thoko, wait and strike." },
    { keys: [K(KEYS.jump)], name: "Jump", d: "A jumping Pentra hop." },

    { group: "Right hand \u00b7 the vaar" },
    { keys: [K(KEYS.strike)], name: "Strike",
      d: "Every shastar has 4 named moves \u2014 High / neutral / Low chooses which one." },
    { keys: [K(KEYS.guard)], name: "Guard",
      d: "Only stops blows on the SAME vector. Guard on the beat to PARRY and crush their Balance." },

    { group: "Sant-Sipahi \u00b7 spend the gold Simran meter" },
    { keys: [K(KEYS.chakram)], name: "Chakram Storm",
      d: ABILITY.chakram.cost + " Simran \u2014 a fan of 3 steel discs, one per vector." },
    { keys: [K(KEYS.shield)], name: "Iron Shield",
      d: ABILITY.shield.cost + " Simran \u2014 Sarbloh Kavach. Reflects the next blow, whatever it is." },
    { keys: [K(KEYS.ultimate)], name: "Ultimate",
      d: ABILITY.ultimate.cost + " Simran \u2014 Chardi Kala. Full meter only." },

    { group: "Anywhere" },
    { keys: ["Esc"], name: "Pause", d: "Resume, or quit to the menu." },
  ];
}

// ---- THE PENTRA SIDE-STEP (dodge) -------------------------------------------
// Gatka prefers EVASION to blocking: the ideal range is barely outside the
// opponent's reach, and side-stepping is used extensively — you read the blow and
// leave, rather than meeting it. This is COMBAT-SYSTEM §2.1's STEP/DASH state,
// and it is why a step beats things a guard cannot: an unblockable Chakkar and a
// guard-breaking Purba both pass through empty air.
//
// The i-frames are NOT free — you only get them by stepping ON THE BEAT (§1.2).
// Off the beat you still move, but you are still hittable. Rhythm is the price.
const DODGE = Object.freeze({
  dist:    104,   // px of ground the step covers — enough to leave their reach
  time:    0.26,  // how long you are committed to it
  iframe:  0.17,  // invulnerable window — ON-BEAT STEPS ONLY
  cooldown: 0.30, // so it can't be mashed as a movement tech
  // ---- Roko aur thoko — "wait and strike" -----------------------------------
  // The ethical rule that doubles as a mechanic: you do not strike first, you
  // answer. Reading an attack and stepping it opens this window, and the strike
  // you land inside it is a COUNTER — the fight's biggest reward for patience.
  counter:    0.55,
  counterDmg: 1.5,
});

// Timing window (seconds) inside which a freshly-raised, correctly-aimed block
// converts an incoming hit into a PARRY instead of a mere block.
const PARRY_WINDOW = 0.13;

const ROUNDS_TO_WIN = 2;   // best-of-3 => first to 2 round wins takes the match

// ---- THE SANT-SIPAHI KIT ----------------------------------------------------
// "Simran" is the focus/breath meter. It fills as you land and read attacks and
// is spent on the three signature abilities from Akaal's design document.
const SIMRAN_MAX = 100;
const SIMRAN_GAIN = {           // how the meter charges
  hit:      14,   // you land a clean strike
  blocked:  4,    // your strike was blocked (still built a little focus)
  gotBlock: 8,    // you blocked an incoming strike
  evade:    18,   // you STEPPED the blow — the art rates this above blocking
  parry:    24,   // you PARRIED — the discipline is richly rewarded
  reflect:  10,   // your Iron Shield reflected a blow
  chakram:  8,    // your Chakram connected
};
const ABILITY = {
  chakram:  { cost: 34, cast: 0.22 }, // Chakram Storm: fan of 3 discs
  shield:   { cost: 30, duration: 0.8 }, // Sarbloh Kavach: reflect next hit
  ultimate: { cost: 100, duration: 1.15 }, // Chardi Kala: AoE storm, invuln
};
const CHAKRAM = { speed: 470, damage: 8, postureDmg: 10, radius: 12, range: 620 };
const ULT = { pulses: [0.34, 0.78], radius: 150, damage: 16 };

// Pentra footwork rhythm + "motion is life" stillness rule. See docs/COMBAT-SYSTEM.md §1.
const PENTRA = {
  onBeatWindow: 0.12, stillGrace: 0.4, defenseMin: 0.4, decay: 1.2,
  onBeatDmg: 1.25, offBeatDmg: 0.85, onBeatBal: 1.5,   // on-beat combat bonuses
  flowNeed: 3, flowMax: 6, flowTime: 2.5, flowDmg: 1.1, // FLOW: on-beat streak reward
};

// THE ATTHHA (ATTH, "eight"): the figure-eight the blade is whirled through, and
// the thing that makes Gatka Gatka. The art does not swing in discrete arcs — the
// blade never stops; it runs the eight and the vaars FALL OUT of the spin.
// COMBAT-SYSTEM asks for it in four places (§1 footwork, §1.4 path shape, §3's
// Chakkar, §4's sway) and the arm stayed a plain circular pivot regardless.
//
// A Gerono lemniscate is (cos u, sin u * cos u) — ONE changed term turns a circle
// into an eight, so `armAngle` keeps being the phase along it and the whole
// momentum + pose-target system drives it completely unchanged.
//
// `cx` pushes the curve half an arm FORWARD, and that offset is load-bearing: a
// lemniscate crosses its own origin at u = +/-PI/2, so centred on the shoulder the
// hand would collapse INTO the shoulder twice per cycle. Offset, that crossing
// becomes the eight's waist — a real arm position, blade drawn back across the body.
const ATTHHA = Object.freeze({ cx: 0.50, w: 0.62, h: 1.15 });

// Lip palette. Deliberately VIVID, and deliberately NOT seated into the beard.
// An earlier pass mix()'d these into the beard's shadow so the mouth would "sit
// in" it — and the mouth vanished. The lips are surrounded by near-black hair
// (beard front is luminance 12) and are barely a pixel and a half tall, so the
// only thing that can carry them is contrast. Lips are lips: both fighters share
// these, and they must out-read the beard, not blend into it.
const LIPS = Object.freeze({
  deep:  "#8E3A2C",   // upper lip — sits in the moustache's shadow
  full:  "#C4553F",   // lower lip body — the tone that has to carry the mouth
  light: "#E07A5F",   // wet catch-light along the lower lip
  line:  "#4A1E16",   // the parting: darkest of the five, but still red
  edge:  "#6E2B20",   // outline
});

// Akaal's palette — shared by the in-match player and the select-screen portrait.
const AKAAL_COLORS = {
  robe: "#1f5fa8", cloth: "#163a63", sash: "#e6b845", hajooria: "#2ec7c7",
  turban: "#123a8a", skin: "#c98a52", beard: "#20140a",
};

/* ============================================================================
 * SECTION 2 — SMALL MATH / GEOMETRY HELPERS
 * ----------------------------------------------------------------------------
 * The heart of the combat system: real axis-aligned bounding-box (AABB)
 * intersection instead of a scalar distance check.
 * ==========================================================================*/

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (a, b) => a + Math.random() * (b - a);

/** Value of a quadratic Bézier at t. */
const qbez = (p0, p1, p2, t) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;

/** Value of a cubic Bézier at t — samples the Kirpan's fuller / centreline. */
const cbez = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

/**
 * Blend two #rrggbb colors. t=0 → a, t=1 → b.
 *
 * Different job from shade(): shade scales all three channels equally, so it can
 * only ever move a color's VALUE and never its hue. mix() seats a color into its
 * surroundings — used to sink the lips into the shadow of the beard around them
 * while keeping the red they need to read as lips at all.
 */
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t));
  return "rgb(" + ch(16) + "," + ch(8) + "," + ch(0) + ")";
}

/** Lighten (f>1) or darken (f<1) a #rrggbb color — used to ramp turban layers. */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(clamp(((n >> 16) & 255) * f, 0, 255));
  const g = Math.round(clamp(((n >> 8) & 255) * f, 0, 255));
  const b = Math.round(clamp((n & 255) * f, 0, 255));
  return "rgb(" + r + "," + g + "," + b + ")";
}

/**
 * A rectangle is {x, y, w, h} where (x, y) is the TOP-LEFT corner.
 *
 * AABB intersection test. Two axis-aligned rectangles overlap if and only if
 * they overlap on BOTH axes simultaneously. On each axis we ask: does A start
 * before B ends, AND does A end after B starts? If that holds for x and for y,
 * the rectangles share area. O(1), branch-cheap, and exact.
 */
function aabbIntersect(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** Depth of overlap on the x-axis — handy for resolving body-vs-body pushout. */
function overlapX(a, b) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
}

/* ============================================================================
 * SECTION 3 — INPUT MANAGER
 * ----------------------------------------------------------------------------
 * Converts raw keydown/keyup into a stable "held keys" set plus one-shot
 * "pressed this frame" edges, so gameplay code polls intent without caring
 * about DOM events. This decouples the human from the Fighter interface: the
 * AI later produces the SAME intent shape.
 * ==========================================================================*/

class InputManager {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();

    window.addEventListener("keydown", (e) => {
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) {
        e.preventDefault();
      }
      const k = this._norm(e.key);
      if (!this.held.has(k)) this.pressed.add(k); // rising edge only
      this.held.add(k);
    });

    window.addEventListener("keyup", (e) => {
      this.held.delete(this._norm(e.key));
    });
  }

  _norm(key) { return key.length === 1 ? key.toLowerCase() : key; }

  isDown(k)     { return this.held.has(k); }
  wasPressed(k) { return this.pressed.has(k); }

  /** True while ANY key bound to an action is held (see the KEYS table). */
  isDownAny(list)     { return list.some((k) => this.held.has(k)); }
  /** True if ANY key bound to an action went down this frame. */
  wasPressedAny(list) { return list.some((k) => this.pressed.has(k)); }

  /**
   * Synthetic press / release. The on-screen TOUCH controls call these with the
   * same key names the keyboard produces, so touch and keyboard converge here
   * and every rule downstream (Player, Fighter) stays input-agnostic.
   */
  press(k)   { if (!this.held.has(k)) this.pressed.add(k); this.held.add(k); }
  release(k) { this.held.delete(k); }

  /** Call once per frame AFTER all polling to clear the rising-edge set. */
  endFrame() { this.pressed.clear(); }
}

/* ============================================================================
 * SECTION 3B — AUDIO (Web Audio, fully synthesized)
 * ----------------------------------------------------------------------------
 * Every sound here is BUILT, not loaded. That is the same rule the art follows —
 * canvas paths, no sprites — and it is forced by the same constraints: no build
 * step, no external requests, nothing to break offline. There is not a byte of
 * sample data in this file; a nagara is a pitch-swept sine plus a noise
 * transient, steel is a stack of inharmonic partials.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: this game's identity mechanic is a BEAT.
 * The Pentra clock decides whether a strike lands on-beat, whether a guard
 * parries, whether a step buys i-frames. Until now that beat was conveyed only
 * by HUD pips — you were asked to ride a rhythm you could not hear. The nagara
 * fires on the clock, so the beat is finally audible.
 *
 * Browsers refuse to start audio without a user gesture, so nothing is created
 * until the first key or tap; `arm()` is idempotent and safe to call on every one.
 * ==========================================================================*/

const SPK_ON = "\uD83D\uDD0A", SPK_OFF = "\uD83D\uDD07";

const Sfx = {
  ctx: null, master: null, enabled: true, _noise: null,

  /** Build the graph on the first user gesture. Safe to call repeatedly. */
  arm() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;                       // no Web Audio: stay silent, never throw
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      // One second of white noise, looped — the raw material for every transient.
      const len = Math.floor(this.ctx.sampleRate * 1);
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  },

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.45 : 0;
  },

  _ok() { return this.enabled && this.ctx && this.ctx.state === "running"; },

  /** A pitch-swept oscillator with an exponential decay — the body of a hit. */
  _tone(t0, f0, f1, dur, gain, type) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur * 0.65);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  /** Filtered noise — stick on hide, steel scrape, cloth. */
  _burst(t0, dur, type, freq, q, gain) {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this._noise; s.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.02);
  },

  /**
   * THE RANJIT NAGARA — the Khalsa's war drum, struck on the Pentra clock.
   * A kettle drum is a membrane whose pitch drops hard as the head relaxes, plus
   * the crack of the stick. Tempo comes from the weapon, so the Khanda's camp
   * beats slower than the Soti's — you can hear which shastar you carry.
   */
  nagara() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone(t, 172, 54, 0.42, 0.60, "sine");        // membrane
    this._tone(t, 86, 40, 0.30, 0.28, "triangle");     // shell resonance
    this._burst(t, 0.045, "bandpass", 2600, 1.1, 0.13); // stick on hide
  },

  /** Steel ringing off steel. Bright, inharmonic, long — a parry should sing. */
  parry() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    for (const [f, g, d] of [[2180, 0.10, 0.60], [3290, 0.07, 0.46], [4710, 0.045, 0.30]]) {
      this._tone(t, f, f * 0.994, d, g, "triangle");
    }
    this._burst(t, 0.10, "highpass", 3200, 0.7, 0.14);
  },

  /** Guard takes it: the same steel, choked. Dull, short, no ring. */
  block() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone(t, 620, 300, 0.10, 0.16, "triangle");
    this._burst(t, 0.07, "bandpass", 1500, 1.6, 0.13);
  },

  /** A clean blow landing on a body — low, blunt, no metal at all. */
  hit() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone(t, 150, 58, 0.16, 0.34, "sine");
    this._burst(t, 0.08, "lowpass", 780, 0.9, 0.20);
  },

  /** Guard crushed — the blow lands AND the guard breaks. Both, in that order. */
  guardbreak() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone(t, 200, 46, 0.34, 0.42, "sine");
    this._burst(t, 0.16, "bandpass", 1100, 0.8, 0.24);
    this._tone(t + 0.04, 1500, 700, 0.20, 0.10, "square");
  },

  /** Stepped it. The blow passes through air you have already left. */
  evade() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._burst(t, 0.20, "bandpass", 900, 0.6, 0.13);   // cloth + displaced air
  },

  /** Sarbloh Kavach turning a blow — a bell, not a clash. */
  reflect() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    for (const [f, g] of [[880, 0.12], [1320, 0.07], [1970, 0.04]]) this._tone(t, f, f, 0.7, g, "sine");
  },

  /** The Chakram leaving the hand — a rising whirr of spinning steel. */
  chakram() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._burst(t, 0.32, "bandpass", 2000, 6, 0.16);
    this._tone(t, 400, 1500, 0.30, 0.06, "sawtooth");
  },

  /** Chardi Kala — the Undying Storm. A swell that arrives before the pulses. */
  ultimate() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._tone(t, 60, 180, 0.9, 0.34, "sine");
    this._tone(t, 90, 270, 0.9, 0.16, "triangle");
    this._burst(t, 0.9, "bandpass", 700, 0.5, 0.14);
  },

  /**
   * BIJLI — thunder. Two parts, because that is what thunder is: the CRACK (a
   * bright wideband snap, arriving with the flash) and the ROLL (a deep filtered
   * roar that outlives it by a second). A lightning vaar has to be heard, not
   * just seen.
   */
  thunder() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._burst(t, 0.09, "highpass", 2200, 0.5, 0.42);   // the crack
    this._burst(t + 0.02, 1.20, "lowpass", 360, 0.7, 0.40); // the roll
    this._tone(t, 74, 28, 0.75, 0.34, "sine");           // the weight under it
  },

  /** Map a combat outcome straight onto its sound. */
  impact(outcome) {
    const fn = this[outcome];
    if (typeof fn === "function") fn.call(this);
  },
};

/* ============================================================================
 * SECTION 4 — PARTICLE SYSTEM (parry sparks, ability bursts)
 * ==========================================================================*/

class ParticleSystem {
  constructor() { this.particles = []; }

  burst(x, y, count = 26, tint = "#ffd479") {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(90, 380);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: rand(0.35, 0.7), max: 0.7,
        size: rand(1.5, 4), tint,
      });
    }
  }

  update(dt) {
    const p = this.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const s = p[i];
      s.vy += 900 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= 0.98;
      s.life -= dt;
      if (s.life <= 0) p.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const s of this.particles) {
      ctx.globalAlpha = clamp(s.life / s.max, 0, 1);
      ctx.fillStyle = s.tint;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  clear() { this.particles.length = 0; }
}

/* ============================================================================
 * SECTION 5 — PROJECTILE (the thrown Chakram / steel disc)
 * ----------------------------------------------------------------------------
 * Each disc carries a `vector` so the SAME High/Mid/Low blocking rule that
 * governs melee also governs whether you can guard a disc.
 * ==========================================================================*/

class Projectile {
  constructor(owner, x, y, vx, vector) {
    this.owner = owner;      // who threw it (so it can't hit its thrower)
    this.x = x; this.y = y;
    this.vx = vx;
    this.vector = vector;
    this.spin = 0;
    this.travelled = 0;
    this.dead = false;
  }

  update(dt) {
    const dx = this.vx * dt;
    this.x += dx;
    this.travelled += Math.abs(dx);
    this.spin += dt * 26;
    if (this.travelled > CHAKRAM.range || this.x < 20 || this.x > CANVAS_W - 20) {
      this.dead = true;
    }
  }

  /** AABB for collision; carries the vector for the block-matching rule. */
  getBox() {
    const r = CHAKRAM.radius;
    return { x: this.x - r, y: this.y - r, w: r * 2, h: r * 2, vector: this.vector };
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.spin);
    // glowing steel ring with spokes
    ctx.strokeStyle = "#e8eef5"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, CHAKRAM.radius, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(120,200,255,0.7)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * CHAKRAM.radius, Math.sin(a) * CHAKRAM.radius);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ============================================================================
 * SECTION 6 — ARTIST: canvas vector art for the Gatka warrior
 * ----------------------------------------------------------------------------
 * All drawing is done from scratch with paths — no sprites/images. The warrior
 * wears a Dumalla (tall turban) and carries a Kirpan / Soti / Khanda plus a
 * round Dhal (shield). Poses are parameterized by the fighter's action so the
 * same routine animates windup / strike / block / cast.
 * ==========================================================================*/

const Artist = {
  drawWarrior(ctx, f, armAngle, shieldUp) {
    const dir = f.facing;
    const cx  = f.x;
    const feet = f.y;
    const h = f.height;

    ctx.save();
    ctx.translate(cx, 0);
    ctx.scale(dir, 1);   // mirror so "facing left" reuses the same path code

    // soft contact shadow — stays on the ground and shrinks with jump height
    const shs = clamp(1 - (GROUND_Y - feet) / 320, 0.45, 1);
    ctx.fillStyle = "rgba(0,0,0," + (0.35 * shs).toFixed(3) + ")";
    ctx.beginPath();
    ctx.ellipse(0, GROUND_Y + 4, 42 * shs, 9 * shs, 0, 0, Math.PI * 2);
    ctx.fill();

    const hipY   = feet - h * 0.44;
    const chestY = feet - h * 0.64;
    const neckY  = feet - h * 0.80;
    const headY  = feet - h * 0.90;
    const headR  = h * 0.085;
    // Warrior build: broad shoulders (SW) tapering to a hard waist (waistW).
    const SW = h * 0.195, waistW = h * 0.10;
    const shoulderY = neckY + h * 0.035;
    const kneeY = feet - h * 0.20;

    // LEGS — powerful churidar, wide stance, two-segment, with boots
    const stride = f.action === ACT.WALK ? Math.sin(f.animT * 10) * 9 : 3;
    ctx.strokeStyle = f.colors.cloth; ctx.lineWidth = h * 0.085; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-h * 0.055, hipY); ctx.lineTo(-h * 0.085 + stride, kneeY); ctx.lineTo(-h * 0.075 + stride, feet - h * 0.03);
    ctx.moveTo( h * 0.055, hipY); ctx.lineTo( h * 0.095 - stride, kneeY); ctx.lineTo( h * 0.085 - stride, feet - h * 0.03);
    ctx.stroke();
    ctx.fillStyle = "#241304";   // boots
    ctx.beginPath(); ctx.ellipse(-h * 0.06 + stride, feet - h * 0.005, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse( h * 0.10 - stride, feet - h * 0.005, 11, 5, 0, 0, Math.PI * 2); ctx.fill();

    // CHOLA skirt — flares from the waist over the thighs
    ctx.fillStyle = f.colors.robe;
    ctx.beginPath();
    ctx.moveTo(-waistW, hipY - 2);
    ctx.quadraticCurveTo(-SW * 1.15, kneeY, -SW * 0.8, feet - h * 0.14);
    ctx.quadraticCurveTo(0, feet - h * 0.09, SW * 0.8, feet - h * 0.14);
    ctx.quadraticCurveTo(SW * 1.15, kneeY, waistW, hipY - 2);
    ctx.closePath(); ctx.fill();

    // TORSO / CHOLA — broad shoulders → hard waist (the warrior V)
    ctx.fillStyle = f.colors.robe;
    ctx.beginPath();
    ctx.moveTo(-waistW, hipY);
    ctx.quadraticCurveTo(-SW * 1.02, chestY, -SW, shoulderY);
    ctx.quadraticCurveTo(0, shoulderY - h * 0.04, SW, shoulderY);
    ctx.quadraticCurveTo(SW * 1.02, chestY, waistW, hipY);
    ctx.closePath(); ctx.fill();
    // chest musculature hint (sternum line + pectoral sweep)
    ctx.strokeStyle = shade(f.colors.robe, 0.78); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, shoulderY + h * 0.02); ctx.lineTo(0, hipY - 3); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-SW * 0.5, chestY - h * 0.015);
    ctx.quadraticCurveTo(0, chestY + h * 0.035, SW * 0.5, chestY - h * 0.015); ctx.stroke();

    // shoulder deltoids (robe sleeve caps) — broad, powerful shoulders
    ctx.fillStyle = shade(f.colors.robe, 1.08);
    ctx.beginPath(); ctx.arc(-SW, shoulderY + h * 0.012, h * 0.056, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( SW, shoulderY + h * 0.012, h * 0.056, 0, Math.PI * 2); ctx.fill();

    // NECK — thick (painted behind the head, which is drawn later)
    ctx.strokeStyle = f.colors.skin; ctx.lineWidth = h * 0.055; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, shoulderY - h * 0.005); ctx.lineTo(0, headY + headR * 0.5); ctx.stroke();

    // Hajooria (sacred cloth across the chest) + Kamarkasa (waist sash)
    ctx.strokeStyle = f.colors.hajooria; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-SW * 0.72, shoulderY + h * 0.02); ctx.lineTo(waistW * 0.9, hipY + 2); ctx.stroke();
    ctx.strokeStyle = f.colors.sash; ctx.lineWidth = h * 0.05;
    ctx.beginPath(); ctx.moveTo(-waistW - 2, hipY - 2); ctx.lineTo(waistW + 2, hipY - 5); ctx.stroke();

    // SHIELD ARM + DHAL (from the right shoulder) — only for weapons that
    // actually pair with one: the Soti with the Farri, the Kirpan with the Dhal
    // that Giraav Block deflects with. Weapons without a shield free the hand.
    if (f.weapon.hasShield) {
      const shX = h * 0.06, shBaseY = chestY + h * 0.02;
      const shY = lerp(shBaseY, neckY - h * 0.02, shieldUp);
      ctx.strokeStyle = shade(f.colors.robe, 1.05); ctx.lineWidth = h * 0.06;  // upper arm (sleeve)
      ctx.beginPath(); ctx.moveTo(SW * 0.62, shoulderY); ctx.lineTo(shX, (shoulderY + shY) / 2); ctx.stroke();
      ctx.strokeStyle = f.colors.skin; ctx.lineWidth = h * 0.048;              // forearm
      ctx.beginPath(); ctx.moveTo(shX, (shoulderY + shY) / 2); ctx.lineTo(shX + 2, shY); ctx.stroke();
      Artist.drawDhal(ctx, shX + 11, shY, headR * 1.7);
    }

    // WEAPON ARM — upper arm (sleeve) + forearm; pivots at the left shoulder.
    // handX/handY remain the weapon end-effector so the swing animation is intact.
    const shoulderX = -SW * 0.58, shoulderYw = shoulderY + h * 0.015;
    const armLen = h * 0.34;
    // The hand rides the ATTHHA, not a circle. `armAngle` is the phase along it.
    const pivotX = shoulderX + armLen * ATTHHA.cx;
    const handX = pivotX + Math.cos(armAngle) * armLen * ATTHHA.w;
    const handY = shoulderYw + Math.sin(armAngle) * Math.cos(armAngle) * armLen * ATTHHA.h;
    // A real elbow: reach VARIES around the eight, so the joint has to bow out as
    // the arm folds rather than sit at the halfway mark like a stick.
    const _dx = handX - shoulderX, _dy = handY - shoulderYw;
    const _d = Math.hypot(_dx, _dy) || 1;
    const _bow = Math.max(0, armLen - _d * 0.5) * 0.55;
    const elbowX = (shoulderX + handX) / 2 - (_dy / _d) * _bow;
    const elbowY = (shoulderYw + handY) / 2 + (_dx / _d) * _bow;
    ctx.strokeStyle = shade(f.colors.robe, 1.05); ctx.lineWidth = h * 0.062; // upper arm (sleeve)
    ctx.beginPath(); ctx.moveTo(shoulderX, shoulderYw); ctx.lineTo(elbowX, elbowY); ctx.stroke();
    ctx.strokeStyle = f.colors.skin; ctx.lineWidth = h * 0.05;               // forearm
    ctx.beginPath(); ctx.moveTo(elbowX, elbowY); ctx.lineTo(handX, handY); ctx.stroke();

    Artist.drawWeapon(ctx, handX, handY, armAngle, f);

    // THE VAAR'S SMEAR — the trail the blade tip leaves through the atthha.
    // This was literally ctx.arc(): a circle drawn round the shoulder. It now
    // traces the SAME lemniscate the hand rides, at the tip's radius, so what you
    // see is the eight the blade is genuinely travelling. Only the arc just
    // travelled is drawn, so it reads as a trail and not as a permanent figure-8
    // painted across the screen.
    if (f.weaponMomentum !== undefined && Math.abs(f.weaponMomentum) > 0.28) {
      const heat = clamp((Math.abs(f.weaponMomentum) - 0.28) / 0.55, 0, 1);
      const rr = armLen + f.weapon.reach * 0.72;
      const tipX = shoulderX + armLen * ATTHHA.cx;
      const back = f.weaponMomentum > 0 ? -1 : 1;      // smear BEHIND the travel
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const [lw, col, al] of [[5, "rgba(255,157,46,0.5)", 0.55],
                                   [1.8, "rgba(255,244,214,0.85)", 0.8]]) {
        ctx.globalAlpha = al * heat;
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        ctx.beginPath();
        for (let i = 0; i <= 22; i++) {
          const u = armAngle + back * (i / 22) * 1.45;
          const px = tipX + Math.cos(u) * rr * ATTHHA.w;
          const py = shoulderY + Math.sin(u) * Math.cos(u) * rr * ATTHHA.h;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // HEAD — modelled, not a flat disc.
    // This used to be a single flat fill of `colors.skin`. Against a near-black
    // akhara an unshaded, saturated circle has no form at all and simply reads as
    // a glowing ball. A face needs light coming from somewhere: here the dawn is
    // above and slightly toward the opponent, so the brow catches it and the jaw
    // falls away, and the Dumalla drops a real shadow on the forehead.
    const lit = ctx.createRadialGradient(
      -headR * 0.22, headY - headR * 0.34, headR * 0.12,   // dawn highlight
      0, headY + headR * 0.10, headR * 1.18);
    lit.addColorStop(0, shade(f.colors.skin, 1.14));
    lit.addColorStop(0.55, f.colors.skin);
    lit.addColorStop(1, shade(f.colors.skin, 0.62));        // jaw falls into shadow
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.arc(0, headY, headR, 0, Math.PI * 2); ctx.fill();
    // shadow cast by the Dumalla's rim across the forehead
    ctx.save();
    ctx.beginPath(); ctx.arc(0, headY, headR, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "rgba(52,28,12,0.34)";
    ctx.beginPath();
    ctx.ellipse(0, headY - headR * 0.92, headR * 1.05, headR * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // cheekbone / temple falloff on the shaded side
    ctx.fillStyle = "rgba(60,32,14,0.20)";
    ctx.beginPath();
    ctx.ellipse(headR * 0.72, headY + headR * 0.18, headR * 0.52, headR * 0.72, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- FACE: eyes, eyebrows, pupils, nose (on the skin, below the turban rim) ---
    const eyeX = headR * 0.44, eyeY = headY - headR * 0.23, browY = headY - headR * 0.34, ew = headR * 0.20;
    for (const side of [-1, 1]) {
      const ex = side * eyeX;
      ctx.fillStyle = "#f4f1ea";                                            // white of the eye
      ctx.beginPath(); ctx.ellipse(ex, eyeY, ew * 0.85, headR * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a2412";                                            // iris
      ctx.beginPath(); ctx.arc(ex, eyeY, headR * 0.085, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0f0803";                                            // pupil
      ctx.beginPath(); ctx.arc(ex, eyeY, headR * 0.045, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";                                            // catch-light
      ctx.beginPath(); ctx.arc(ex + headR * 0.03, eyeY - headR * 0.03, headR * 0.022, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#2a160a"; ctx.lineWidth = headR * 0.05; ctx.lineCap = "round"; // upper lid
      ctx.beginPath();
      ctx.moveTo(ex - ew, eyeY - headR * 0.03); ctx.quadraticCurveTo(ex, eyeY - headR * 0.13, ex + ew, eyeY - headR * 0.03);
      ctx.stroke();
      ctx.strokeStyle = "#1a0d06"; ctx.lineWidth = headR * 0.1;             // bold eyebrow
      ctx.beginPath();
      ctx.moveTo(ex - ew, browY); ctx.quadraticCurveTo(ex, browY - headR * 0.09, ex + ew, browY);
      ctx.stroke();
    }
    // nose — a soft skin-shadow line down to a small tip (moustache covers the base)
    ctx.strokeStyle = shade(f.colors.skin, 0.82); ctx.lineWidth = headR * 0.05; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, eyeY + headR * 0.03);
    ctx.lineTo(-headR * 0.03, headY + headR * 0.02);
    ctx.quadraticCurveTo(0, headY + headR * 0.06, headR * 0.06, headY + headR * 0.03);
    ctx.stroke();

    // --- Facial hair: Prakash (open, flowing) beard + Kundal moustache +
    // soul patch, ported from the reference SVG and scaled to the head. Three
    // tonal layers (light rim → dark front) give the beard volume; tones derive
    // from f.colors.beard so each fighter keeps their hue. See docs/GROOM-BEARD.md.
    ctx.save();
    const fhk = headR / 110;                        // SVG-units → local scale
    ctx.translate(0, headY + headR * 0.171);
    ctx.scale(fhk, fhk);
    const bOuter  = shade(f.colors.beard, 1.25);
    const bMid    = shade(f.colors.beard, 0.85);
    const bFront  = shade(f.colors.beard, 0.55);
    const bStrand = shade(f.colors.beard, 2.1);
    const bEdge   = shade(f.colors.beard, 1.5);
    // outer volume layer
    ctx.fillStyle = bOuter;
    ctx.beginPath();
    ctx.moveTo(-115, -30);
    ctx.bezierCurveTo(-120, 40, -105, 110, -85, 160);
    ctx.bezierCurveTo(-60, 210, -30, 250, 0, 255);
    ctx.bezierCurveTo(30, 250, 60, 210, 85, 160);
    ctx.bezierCurveTo(105, 110, 120, 40, 115, -30);
    ctx.bezierCurveTo(95, -10, 65, 10, 0, 12);
    ctx.bezierCurveTo(-65, 10, -95, -10, -115, -30);
    ctx.closePath(); ctx.fill();
    // mid-tone layer
    ctx.fillStyle = bMid;
    ctx.beginPath();
    ctx.moveTo(-110, -10);
    ctx.bezierCurveTo(-115, 50, -95, 120, -75, 170);
    ctx.bezierCurveTo(-50, 220, -25, 240, 0, 242);
    ctx.bezierCurveTo(25, 240, 50, 220, 75, 170);
    ctx.bezierCurveTo(95, 120, 115, 50, 110, -10);
    ctx.bezierCurveTo(85, 10, 55, 25, 0, 26);
    ctx.bezierCurveTo(-55, 25, -85, 10, -110, -10);
    ctx.closePath(); ctx.fill();
    // front high-contrast layer
    ctx.fillStyle = bFront;
    ctx.beginPath();
    ctx.moveTo(-100, 10);
    ctx.bezierCurveTo(-105, 60, -85, 130, -65, 175);
    ctx.bezierCurveTo(-45, 215, -20, 230, 0, 232);
    ctx.bezierCurveTo(20, 230, 45, 215, 65, 175);
    ctx.bezierCurveTo(85, 130, 105, 60, 100, 10);
    ctx.bezierCurveTo(75, 28, 45, 38, 0, 38);
    ctx.bezierCurveTo(-45, 38, -75, 28, -100, 10);
    ctx.closePath(); ctx.fill();
    // flowing strand highlights (device-constant line width via /fhk)
    ctx.strokeStyle = bStrand; ctx.lineWidth = 1.3 / fhk;
    ctx.globalAlpha = 0.55; ctx.lineCap = "round";
    const strands = [
      [-105,20,-100,90,-70,160,-40,210], [-85,50,-80,120,-55,180,-15,225],
      [105,20,100,90,70,160,40,210],     [85,50,80,120,55,180,15,225],
      [0,40,-10,110,-20,170,0,230],
      [-45,60,-30,130,-10,195,0,215],    [45,60,30,130,10,195,0,215],
    ];
    for (const s of strands) { ctx.beginPath(); ctx.moveTo(s[0],s[1]); ctx.bezierCurveTo(s[2],s[3],s[4],s[5],s[6],s[7]); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // optional elder salt-and-pepper strands
    if (f.colors.beardGrey) {
      ctx.strokeStyle = f.colors.beardGrey; ctx.lineWidth = 1.1 / fhk; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(-70,40); ctx.bezierCurveTo(-60,110,-40,175,-20,215); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(60,55);  ctx.bezierCurveTo(55,120,35,180,15,215);   ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // LIPS — drawn BEFORE the moustache so the wings overlap the upper lip the
    // way real hair does. They sit in the gap the groom leaves between the
    // moustache (y≈0–8) and the soul patch (y=18); previously that gap was just
    // bare skin, so the face had no mouth at all.
    // LIPS — ported 1:1 from the reference. Drawn BEFORE the moustache so the
    // wings settle over the upper lip the way real hair does.
    //
    // Reference is in CENTIMETRES: the mouth spans x 0.25–4.75 (4.5cm), the
    // parting line sits at y=1.0, and the centre is x=2.5. LX/LY are the only
    // conversion — keep the cm values below verbatim and the shape can't drift.
    //
    // The vertical is DELIBERATELY compressed (LPY 11 vs LPX 16.9). The groom
    // leaves only y=8→18 between the moustache's lower edge and the soul patch —
    // about 1.2px — so a uniform scale would push the upper lip out above the
    // moustache and drive the lower lip through the soul patch. At LPY=11 the
    // upper lip lands at y=2.1 (exactly under the moustache) and the lower lip
    // ends at 17.9 (exactly above the patch), with no change to the beard.
    //
    // COLOUR. The reference palette is lit on white paper; here the mouth sits in
    // a near-black beard with a moustache overhanging it. Dropped in raw, the
    // lower lip came out 9.7x brighter than the beard around it — and even the
    // PARTING line, which must be the darkest thing in the mouth, outshone the
    // beard 5.7x. That reads as lipstick on black, not a mouth in a beard.
    //
    // So every tone is mix()'d INTO the beard rather than shade()'d: the
    // reference's red hue survives (it must — shade(skin) can't be red, which was
    // the original bug), while the value drops to where the light actually is.
    // The ladder now runs beard < parting < upper < lower < highlight < skin, so
    // the mouth reads as flesh in shadow and the parting is finally the darkest
    // part of it. Mixing toward f.colors.beard means each fighter's mouth seats
    // into their own face.
    // LPY now EQUALS LPX, so the mouth finally has the reference's own 3.14:1
    // proportions instead of being squashed to 4.8:1. That is only possible
    // because the soul patch moved down; the parting sits at 11.5, right on the
    // moustache's lower edge, so the upper lip stays tucked under the hair.
    const LPX = 16.9, LPY = 16.9;
    const LX = (cm) => (cm - 2.5) * LPX;
    const LY = (cm) => 11.5 + (cm - 1.0) * LPY;

    // lower lip
    ctx.beginPath();
    ctx.moveTo(LX(0.25), LY(1.0));
    ctx.bezierCurveTo(LX(0.9), LY(1.05), LX(1.6), LY(1.05), LX(2.5), LY(1.05));
    ctx.bezierCurveTo(LX(3.4), LY(1.05), LX(4.1), LY(1.05), LX(4.75), LY(1.0));
    ctx.bezierCurveTo(LX(4.3), LY(1.6), LX(3.4), LY(1.85), LX(2.5), LY(1.85));
    ctx.bezierCurveTo(LX(1.6), LY(1.85), LX(0.7), LY(1.6), LX(0.25), LY(1.0));
    ctx.closePath();
    ctx.fillStyle = LIPS.full; ctx.fill();
    ctx.strokeStyle = LIPS.edge; ctx.lineWidth = 0.5 / fhk; ctx.stroke();

    // lower-lip highlight
    ctx.beginPath();
    ctx.moveTo(LX(1.6), LY(1.35));
    ctx.bezierCurveTo(LX(2.1), LY(1.5), LX(2.9), LY(1.5), LX(3.4), LY(1.35));
    ctx.bezierCurveTo(LX(2.9), LY(1.42), LX(2.1), LY(1.42), LX(1.6), LY(1.35));
    ctx.closePath();
    ctx.globalAlpha = 0.9; ctx.fillStyle = LIPS.light; ctx.fill(); ctx.globalAlpha = 1;

    // upper lip, with the cupid's bow
    ctx.beginPath();
    ctx.moveTo(LX(0.25), LY(1.0));
    ctx.bezierCurveTo(LX(0.95), LY(0.6), LX(1.7), LY(0.42), LX(2.15), LY(0.55));
    ctx.bezierCurveTo(LX(2.3), LY(0.6), LX(2.4), LY(0.68), LX(2.5), LY(0.72));
    ctx.bezierCurveTo(LX(2.6), LY(0.68), LX(2.7), LY(0.6), LX(2.85), LY(0.55));
    ctx.bezierCurveTo(LX(3.3), LY(0.42), LX(4.05), LY(0.6), LX(4.75), LY(1.0));
    ctx.bezierCurveTo(LX(4.0), LY(0.92), LX(3.2), LY(0.9), LX(2.5), LY(0.92));
    ctx.bezierCurveTo(LX(1.8), LY(0.9), LX(1.0), LY(0.92), LX(0.25), LY(1.0));
    ctx.closePath();
    ctx.fillStyle = LIPS.deep; ctx.fill();
    ctx.strokeStyle = LIPS.edge; ctx.lineWidth = 0.5 / fhk; ctx.stroke();

    // mouth parting line — at a 25px head this is the part that actually reads
    ctx.beginPath();
    ctx.moveTo(LX(0.25), LY(1.0));
    ctx.bezierCurveTo(LX(1.0), LY(1.02), LX(1.8), LY(1.0), LX(2.5), LY(1.02));
    ctx.bezierCurveTo(LX(3.2), LY(1.0), LX(4.0), LY(1.02), LX(4.75), LY(1.0));
    ctx.strokeStyle = LIPS.line; ctx.lineWidth = 1.6 / fhk; ctx.lineCap = "round";
    ctx.stroke();

    // Kundal moustache — proud upturned wings sweeping onto the cheeks
    ctx.fillStyle = bFront; ctx.strokeStyle = bOuter; ctx.lineWidth = 1 / fhk;
    for (const sx of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.bezierCurveTo(sx*-15,1, sx*-45,12, sx*-65,5);
      ctx.bezierCurveTo(sx*-85,-2, sx*-100,-22, sx*-102,-42);
      ctx.bezierCurveTo(sx*-102,-42, sx*-92,-40, sx*-82,-28);
      ctx.bezierCurveTo(sx*-72,-16, sx*-60,-12, sx*-45,-4);
      ctx.bezierCurveTo(sx*-30,4, sx*-10,8, 0,8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // moustache crisp edges
    ctx.strokeStyle = bEdge; ctx.lineWidth = 1.2 / fhk;
    for (const sx of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(sx*-5,4);
      ctx.bezierCurveTo(sx*-25,4, sx*-55,12, sx*-72,2);
      ctx.bezierCurveTo(sx*-88,-8, sx*-96,-25, sx*-96,-25);
      ctx.stroke();
    }
    // Soul patch below the lip, blending into the beard. Its top moved 18 -> 28
    // to give the mouth room: at 18 the lower lip was squeezed to ONE PIXEL tall
    // and no colour could survive that. 10 groom units is 1.2px of beard — you
    // will not notice it there, and it is the difference between a mouth and a
    // smudge here.
    ctx.fillStyle = bFront;
    ctx.beginPath();
    ctx.moveTo(-12,28); ctx.bezierCurveTo(-15,38,-8,50,0,52); ctx.bezierCurveTo(8,50,15,38,12,28);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // DUMALLA (tall turban) with a Chakram embedded at the crown
    Artist.drawDumalla(ctx, 0, headY, headR, f.colors.turban);

    ctx.restore();
  },

  drawDhal(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
    g.addColorStop(0, "#6b4a1f"); g.addColorStop(1, "#2e1d0a");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c9962f"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#e6b845";
    ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c9962f";
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  /**
   * "Amritvelā" — the curved Damascus Kirpan. Beyond the base shape this draws
   * pattern-welded banding, a spine engraving band, and the Amrit-Dhāra glow,
   * whose intensity is read from the wielder's state:
   *   dormant (menu) → vigilant (in a fight) → strike (mid-swing) → parry ignite.
   */
  drawKirpan(ctx, x, y, angle, f) {
    const blade = f.weapon.reach;
    const act = f.action;                       // undefined for the menu icon
    const phase = f.attackPhase;
    const art = f.weapon.art || { material: "#cdd8e8", hilt: "#e6c877" };

    // Tip, from the reference: (78.7, 3.2)cm against the hand axis at 7.15cm —
    // a rise of 4.02cm over the 63.5cm blade, i.e. only ~3.6°. A talwar is far
    // less upswept than it looks; the previous −0.30·blade was 18.4°, five times
    // too much. Everything below tracks tipX/tipY.
    const tipX = blade * 0.97, tipY = (3.2 - 7.15) * ((blade * 0.97 - 6) / 63.5);

    // --- resolve glow (0..1) and flare (0..1) from wielder state ---------
    let glow;
    if (act === undefined)      glow = 0.30;     // select-screen icon: gentle wake
    else if (act === ACT.KO)    glow = 0.0;      // a fallen warrior's blade is dark
    else {
      glow = 0.22;                               // vigilant: always faintly awake in combat
      if (act === ACT.ATTACK && (phase === "active" || phase === "recovery")) glow = 0.7;
    }
    const flare = clamp((f.weaponFlare || 0) / 0.35, 0, 1);
    glow = Math.max(glow, flare);

    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);

    // --- hilt: leather grip + brass wire, disc pommel with a lapis gem ----
    ctx.strokeStyle = "#3a2a18"; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(4, 0); ctx.stroke();
    ctx.strokeStyle = shade(art.hilt, 0.62); ctx.lineWidth = 6; // brass disc pommel
    ctx.beginPath(); ctx.arc(-13, 0, 3.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#1f3f7a";                       // lapis core (breathes softly)
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin((f.animT || 0) * 3);
    ctx.beginPath(); ctx.arc(-13, 0, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // Talwar cross-guard (down-swept quillons)
    ctx.strokeStyle = art.hilt; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4, -6); ctx.quadraticCurveTo(2, 0, 4, 6); ctx.stroke();

    // --- blade body (filled, single-edged, curved) -----------------------
    // BLADE GEOMETRY — ported 1:1 from the reference kirpan SVG, not authored.
    // Reference is in CENTIMETRES with y DOWN: overall 78.7cm (31in), hilt
    // 0–15.2 (6in), blade 15.2–78.7 (63.5cm = 25in) — the same 31in size the
    // WEAPONS table records. The hand axis sits at y = 7.15. Ported rather than
    // linked so the file stays self-contained; RX/RY are the only conversion.
    //
    // THE BEND BELONGS AT THE SPIKE, NOT THE HAND. In the reference the cutting
    // edge leaves the guard at −0.3° and reaches the tip at 12.4° (the spine goes
    // 1.7° → 4.1°): flat where it is held, bending up at the point. Two earlier
    // attempts got this backwards — the last one left the hand at 34° and arrived
    // at the tip at −1.5°, i.e. all the bend at the hand. Keep the reference cm
    // numbers below verbatim and that cannot happen again.
    //
    // The centreline therefore sits ~0.93cm BELOW the straight hilt→tip chord:
    // concave-up, because the convex side IS the cutting edge and it faces down.
    // Do not "correct" that to bow above the chord — that is the opposite curve.
    const CM_AX = 15.2, CM_AY = 7.15, CM_LEN = 63.5;   // blade start x, hand axis y, blade length
    const s  = (blade * 0.97 - 6) / CM_LEN;            // cm → px
    const RX = (cx) => 6 + (cx - CM_AX) * s;
    const RY = (cy) => (cy - CM_AY) * s;

    const bladePath = () => {
      ctx.beginPath();
      ctx.moveTo(RX(15.2), RY(6.2));
      ctx.bezierCurveTo(RX(35), RY(5.6), RX(58), RY(4.7), tipX, tipY);           // spine → tip
      ctx.bezierCurveTo(RX(60), RY(7.3), RX(36), RY(8.35), RX(15.2), RY(8.25));  // belly (edge) → guard
      ctx.closePath();
    };
    // The fuller doubles as the blade's centreline: the engraving and the
    // Amrit-Dhāra glow both ride it, so every layer follows the one arc.
    const FUL = [[17, 6.95], [37, 6.5], [56, 5.7], [73.5, 4.35]];
    const fulX = (t) => cbez(RX(FUL[0][0]), RX(FUL[1][0]), RX(FUL[2][0]), RX(FUL[3][0]), t);
    const fulY = (t) => cbez(RY(FUL[0][1]), RY(FUL[1][1]), RY(FUL[2][1]), RY(FUL[3][1]), t);
    const steel = ctx.createLinearGradient(RX(15.2), RY(6.2), tipX, tipY);
    steel.addColorStop(0, shade(art.material, 0.35));
    steel.addColorStop(0.5, art.material);
    steel.addColorStop(1, shade(art.material, 0.62));
    bladePath(); ctx.fillStyle = steel; ctx.fill();

    // --- Damascus banding (wavy layers, clipped to the blade) ------------
    // Retightened for the slender blade: the old offsets spanned 20px (built for
    // a blade twice this wide), so most bands fell outside the clip and never
    // drew. Three bands now sit inside the real width.
    // Bands ride the fuller, offset across the blade, so they follow the bend.
    ctx.save(); bladePath(); ctx.clip();
    for (let i = 0; i < 3; i++) {
      const off = (-1 + i) * s * 0.55;      // in cm-scale, so it tracks the real width
      ctx.strokeStyle = i % 2 ? "rgba(30,40,60,0.5)" : "rgba(180,196,220,0.4)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(fulX(0), fulY(0) + off);
      for (let t = 0.1; t <= 1.001; t += 0.1) ctx.lineTo(fulX(t), fulY(t) + off);
      ctx.stroke();
    }
    ctx.restore();

    // --- cutting-edge highlight (the single edge, along the BELLY) -------
    // Straight from the reference: this is what reads the blade as single-edged.
    ctx.save(); bladePath(); ctx.clip();
    ctx.fillStyle = "rgba(220,224,227,0.85)";
    ctx.beginPath();
    ctx.moveTo(RX(16.5), RY(8.22));
    ctx.bezierCurveTo(RX(38), RY(8.28), RX(58), RY(7.2), RX(77.2), RY(3.6));
    ctx.bezierCurveTo(RX(58), RY(6.9), RX(37), RY(7.9), RX(16.5), RY(7.85));
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // --- fuller groove + engraving ticks (clipped to the steel) ----------
    ctx.save(); bladePath(); ctx.clip();
    ctx.strokeStyle = "rgba(124,131,138,0.9)"; ctx.lineWidth = 0.16 * s;
    ctx.beginPath();
    ctx.moveTo(fulX(0), fulY(0));
    for (let t = 0.1; t <= 1.001; t += 0.1) ctx.lineTo(fulX(t), fulY(t));
    ctx.stroke();
    ctx.strokeStyle = "rgba(20,24,32,0.7)"; ctx.lineWidth = 0.8;
    for (let t = 0.12; t < 0.9; t += 0.11) {
      const bx = fulX(t), by = fulY(t) - 0.4;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + 1.2, by + 1.4); ctx.stroke();
    }
    ctx.restore();

    // --- THE VAAR: the slash trail -------------------------------------
    // This was 0.22 x glow = 0.15 alpha — a rumour of a slash. A vaar is the blow
    // AND the ballad it is named for; it has to read across the akhara. Two
    // layers now: a broad saffron sweep and a white-hot core, at full heat on the
    // ACTIVE frames and trailing off through recovery.
    if (act === ACT.ATTACK && (phase === "active" || phase === "recovery")) {
      const heat = phase === "active" ? 1 : 0.4;
      ctx.save();
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.5 * heat;
      ctx.strokeStyle = "#ff9d2e"; ctx.lineWidth = 13;
      ctx.beginPath(); ctx.arc(-4, 4, blade * 0.82, -0.98, 0.22); ctx.stroke();
      ctx.globalAlpha = 0.9 * heat;
      ctx.shadowColor = "#ffd47a"; ctx.shadowBlur = 12;
      ctx.strokeStyle = "#fff4d6"; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(-4, 4, blade * 0.82, -0.85, 0.14); ctx.stroke();
      ctx.restore();
    }

    // --- Amrit-Dhāra emissive: the nectar-light in the fuller + tip seal --
    if (glow > 0) {
      ctx.save();
      const hot = flare > 0.5;
      ctx.globalAlpha = clamp(glow, 0, 1);
      ctx.shadowColor = hot ? "#fff4d6" : "#ffd47a";
      ctx.shadowBlur = 8 + glow * 12;
      ctx.strokeStyle = hot ? "#fff4d6" : "#ffd47a";
      ctx.lineWidth = 2;
      ctx.beginPath();                                          // glow rides the fuller
      ctx.moveTo(fulX(0), fulY(0));
      for (let t = 0.1; t <= 1.001; t += 0.1) ctx.lineTo(fulX(t), fulY(t));
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;                          // tip seal emitter
      ctx.beginPath(); ctx.arc(tipX - 2, tipY + 1, 1.8 + glow * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // --- full engraving ignite on a perfect parry ------------------------
    if (flare > 0) {
      ctx.save();
      ctx.globalAlpha = flare;
      ctx.shadowColor = "#fff4d6"; ctx.shadowBlur = 16;
      ctx.strokeStyle = "#fff4d6"; ctx.lineWidth = 1.5;
      bladePath(); ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  },

  /**
   * Soti — the tournament stick. A uniform cylindrical cane, blunt along its
   * whole length (no edge, so no Damascus and no Amrit-Dhāra glow: it scores
   * points, it does not cut), seated in a leather basket hilt.
   */
  drawSoti(ctx, x, y, angle, f) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    const len = f.weapon.reach;
    const art = f.weapon.art || { material: "#8a5a24", hilt: "#c9962f" };
    // shaft — even thickness end to end; the stick has no taper and no point
    ctx.strokeStyle = art.material; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(len, 0); ctx.stroke();
    // bound tip + butt cap
    ctx.strokeStyle = art.hilt; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(len - 6, 0); ctx.lineTo(len, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-12, 0); ctx.stroke();
    // leather basket hilt — a dome closing over the back of the gripping hand
    if (f.weapon.hasBasketHilt) {
      ctx.fillStyle = art.hilt;
      ctx.beginPath(); ctx.arc(-4, 0, 9, Math.PI * 0.5, Math.PI * 1.5, false); ctx.fill();
      ctx.strokeStyle = shade(art.hilt, 0.65); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(-4, 0, 9, Math.PI * 0.5, Math.PI * 1.5, false); ctx.stroke();
    }
    ctx.restore();
  },

  /** Khanda — a broad, straight, double-edged blade with a wide hilt. */
  /**
   * WEAPON FACTORY — the single place weapon art is chosen. Dispatches on the
   * weapon's `bladeStyle` (data) rather than its id, so adding a weapon to the
   * WEAPONS table draws it without editing this function.
   */
  drawWeapon(ctx, x, y, angle, f) {
    switch (f.weapon.bladeStyle) {
      case "straight":       Artist.drawSoti(ctx, x, y, angle, f);   break;
      case "straight_broad": Artist.drawKhanda(ctx, x, y, angle, f); break;
      case "curved_sabre":
      default:               Artist.drawKirpan(ctx, x, y, angle, f); break;
    }
  },

  drawKhanda(ctx, x, y, angle, f) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    const len = f.weapon.reach;
    const art = f.weapon.art || { material: "#dfe7ef", hilt: "#e6b845" };
    // grip
    ctx.strokeStyle = "#7a5720"; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(4, 0); ctx.stroke();
    // broad cross-guard
    ctx.strokeStyle = art.hilt; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4, -8); ctx.lineTo(4, 8); ctx.stroke();
    // straight double-edged blade (a filled triangle so both edges read)
    ctx.fillStyle = art.material;
    ctx.beginPath();
    ctx.moveTo(4, -5); ctx.lineTo(len - 10, -4);
    ctx.lineTo(len, 0);                       // point
    ctx.lineTo(len - 10, 4); ctx.lineTo(4, 5);
    ctx.closePath(); ctx.fill();
    // central fuller line
    ctx.strokeStyle = "#9fb0c0"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(len - 8, 0); ctx.stroke();
    ctx.restore();
  },

  // Dumalla — a stack of ~8 horizontal wrap layers (palas) climbing dark→light
  // (navy base → steel-blue crown), a symmetrical dome that fully covers the ears,
  // a front-centre Chand Tora (Khanda emblem: double-edged blade + chakkar +
  // crescent), and small shastars tucked into the folds. Layer colours ramp from
  // `tint` so each fighter keeps their turban hue. See docs/COSTUME-BANA.md.
  drawDumalla(ctx, x, y, headR, tint) {
    const N = 8;
    const Wb = headR * 2.72, Wp = headR * 1.12;   // base vs crown width
    const earY = y + headR * 0.06;
    const browY = y - headR * 1.20;   // front rim sits high on the brow (reveals eyes)

    // --- base band: full ear/side coverage; front edge rises at the brow ---
    ctx.fillStyle = shade(tint, 0.5);
    ctx.strokeStyle = shade(tint, 0.35); ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-Wb / 2, earY);
    ctx.quadraticCurveTo(-Wb / 2, y - headR * 0.62, 0, y - headR * 0.72);
    ctx.quadraticCurveTo(Wb / 2, y - headR * 0.62, Wb / 2, earY);
    ctx.quadraticCurveTo(0, browY, -Wb / 2, earY);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // --- stacked wrap layers (palas): base → crown, dark → light ---
    const D = headR * 0.34;   // vertical step between layers
    const h = headR * 0.6;    // arch height (overlaps so layers stack)
    for (let i = 1; i < N; i++) {
      const t = i / (N - 1);
      const by = (y - headR * 0.6) - (i - 1) * D;             // this layer's bottom line
      const w  = lerp(Wb * 0.98, Wp, (i - 1) / (N - 2));      // taper toward the crown
      ctx.fillStyle   = shade(tint, lerp(0.66, 1.7, t));
      ctx.strokeStyle = shade(tint, lerp(0.45, 1.15, t));
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-w / 2, by);
      ctx.bezierCurveTo(-w / 2 - w * 0.02, by - h * 0.9, -w * 0.34, by - h, 0, by - h);
      ctx.bezierCurveTo(w * 0.34, by - h, w / 2 + w * 0.02, by - h * 0.9, w / 2, by);
      ctx.quadraticCurveTo(0, by + h * 0.12, -w / 2, by);     // shallow scalloped bottom
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // faint fabric-fold highlight along the wrap
      ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-w * 0.4, by - h * 0.52);
      ctx.quadraticCurveTo(0, by - h * 0.7, w * 0.4, by - h * 0.52);
      ctx.stroke();
    }

    // --- Chand Tora: the Khanda emblem, front-centre ---
    const e = headR * 0.95, ey = y - headR * 1.05;
    // crescent (chand)
    ctx.fillStyle = "#eef2f7"; ctx.strokeStyle = "#93a4c2"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-e * 0.5, ey + e * 0.06);
    ctx.quadraticCurveTo(0, ey + e * 0.52, e * 0.5, ey + e * 0.06);
    ctx.quadraticCurveTo(0, ey + e * 0.30, -e * 0.5, ey + e * 0.06);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // central chakkar ring
    ctx.strokeStyle = "#eef2f7"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, ey - e * 0.04, e * 0.2, 0, Math.PI * 2); ctx.stroke();
    // vertical double-edged blade + tip
    ctx.fillStyle = "#eef2f7"; ctx.strokeStyle = "#718096"; ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-e * 0.055, ey - e * 0.62); ctx.lineTo(e * 0.055, ey - e * 0.62);
    ctx.lineTo(e * 0.045, ey + e * 0.16); ctx.lineTo(-e * 0.045, ey + e * 0.16);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, ey - e * 0.82); ctx.lineTo(e * 0.075, ey - e * 0.6);
    ctx.lineTo(-e * 0.075, ey - e * 0.6); ctx.closePath(); ctx.fill();

    // --- shastars tucked into the layers (the turban as armoury) ---
    ctx.save();
    ctx.translate(headR * 0.66, y - headR * 1.95); ctx.rotate(-0.26);
    ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, headR * 0.42, headR * 0.15, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 2.4; ctx.lineCap = "round"; // mini-kirpan hilt
    ctx.beginPath();
    ctx.moveTo(-headR * 1.05, y - headR * 1.12); ctx.lineTo(-headR * 0.82, y - headR * 0.94);
    ctx.stroke();

    // --- saffron farla flourish at the crown ---
    ctx.fillStyle = "#ff9d2e";
    ctx.beginPath(); ctx.arc(0, y - headR * 3.02, headR * 0.24, 0, Math.PI * 2); ctx.fill();
  },
};

/* ============================================================================
 * SECTION 7 — FIGHTER (shared body for Player & Enemy)
 * ----------------------------------------------------------------------------
 * Holds physics, health/posture/simran, the attack/block state machine, AND
 * the three Sant-Sipahi abilities. All combat rules live here so both the
 * human and the AI obey identical mechanics.
 * ==========================================================================*/

class Fighter {
  constructor(opts) {
    this.name    = opts.name;
    this.weapon  = opts.weapon;
    this.colors  = opts.colors;
    this.facing  = opts.facing;
    this.x       = opts.x;
    this.y       = GROUND_Y;
    this.width   = 56;
    this.height  = 150;
    this.speed   = BASE_SPEED * (this.weapon.mobility || 1);

    this.hp      = 100; this.maxHp   = 100;   // HEALTH
    this.posture = 100; this.maxPost = 100;   // POSTURE (guard integrity)
    this.simran  = 0;   this.maxSimran = SIMRAN_MAX; // ability RESOURCE

    this.action = ACT.IDLE;
    this.vector = VECTOR.MID;

    // Attack sub-phase bookkeeping.
    this.attackPhase = null;         // "windup" | "active" | "recovery"
    this.phaseT = 0;
    this.curMove = null;             // the current strike move (from MOVES)
    this.hitCount = 0;               // hits landed by the current swing
    this.hitTimer = 0;               // re-hit cooldown for multi-hit moves
    this.canCancel = false;          // recovery-cancel window open (on-beat combo)

    // Block bookkeeping (for parry timing).
    this.blockVector = VECTOR.MID;   // representative guard zone (for the pose)
    this.guard = null;               // the current guard move (from MOVES)
    this.blockAge = 0;

    // Ability bookkeeping.
    this.castT = 0;                  // remaining CAST time (Chakram Storm)
    this.pendingChakram = false;     // Game reads this to spawn discs
    this.shieldT = 0;                // Iron Shield active window remaining
    this.ultActive = false;          // Ultimate in progress
    this.ultT = 0;
    this.ultFired = [false, false];  // which AoE pulses have gone off
    this.ultPulseReady = false;      // Game reads/clears to apply AoE

    // Pentra side-step (dodge) + the roko-aur-thoko counter window.
    this.stepT = 0;                  // remaining STEP time
    this.stepDir = 0;                // which way the step carries us
    this.stepIFrame = 0;             // remaining invulnerability (on-beat steps only)
    this.stepCd = 0;                 // step cooldown
    this.counterT = 0;               // "wait and strike": window opened by an evade

    this.boltPending = false;        // a bijli vaar just went live; Game draws the bolt

    this.hurtT = 0;
    this.staggerT = 0;               // remaining STAGGER time
    this.animT = 0;
    this.flash = 0;
    this.weaponFlare = 0;   // Amrit-Dhāra: the Kirpan's engraving ignites (parry/strike)

    // Pentra rhythm + stillness (see docs/COMBAT-SYSTEM.md §1)
    this.beatT = 0; this.beatPhase = 0; this.onBeat = false;
    this.beatFired = false;          // set on each wrap; the Game strikes the nagara
    this.prevX = this.x; this.stillTime = 0; this.defenseMult = 1;
    this.flow = 0; this.flowT = 0;   // FLOW: consecutive on-beat successes

    // Weapon momentum (Gatka never truly stops): the drawn arm angle is a
    // physical value that carries spin and eases toward pose targets.
    this.weaponAngle = -0.35;
    this.weaponMomentum = 0;

    // Vertical physics (jumping Pentra)
    this.vy = 0;
    this.airborne = false;
  }

  get alive() { return this.hp > 0; }

  /** True when the fighter is committed and cannot start new normal actions. */
  _locked() {
    return this.action === ACT.HURT || this.action === ACT.KO ||
           this.action === ACT.CAST || this.action === ACT.STAGGER ||
           this.action === ACT.STEP || this.ultActive;
  }

  getBodyBox() {
    return { x: this.x - this.width / 2, y: this.y - this.height, w: this.width, h: this.height };
  }

  /**
   * Weapon damage rectangle for the CURRENT swing vector. Springs from the
   * front of the body in the facing direction with length == weapon.reach; its
   * vertical band is chosen by the vector (HIGH=head, MID=chest, LOW=legs).
   */
  getAttackHitbox() {
    if (this.action !== ACT.ATTACK || this.attackPhase !== "active" || !this.curMove) return null;
    const reach = this.curMove.reach || this.weapon.reach;
    const front = this.facing > 0 ? this.x + this.width / 2 : this.x - this.width / 2 - reach;
    const top   = this.y - this.height;
    const v = this.curMove.zone;
    let zoneY, zoneH;
    if (v === VECTOR.HIGH)     { zoneY = top + this.height * 0.02; zoneH = this.height * 0.34; }
    else if (v === VECTOR.MID) { zoneY = top + this.height * 0.34; zoneH = this.height * 0.34; }
    else                       { zoneY = top + this.height * 0.66; zoneH = this.height * 0.34; }

    // A straight stick lands on a localized focal point, so its box stays tight.
    // A curved sabre cleaves: the belly sweeps through the zone on its arc, so
    // the box spills above and below the band. The `vector` is untouched either
    // way — a cleave is still answered by matching the zone, so the block/parry
    // rule keeps working exactly as before.
    if (this.weapon.bladeStyle === "curved_sabre") {
      const sweep = this.height * CURVE_SWEEP;
      zoneY -= sweep * 0.5; zoneH += sweep;
    }
    return { x: front, y: zoneY, w: reach, h: zoneH, vector: v };
  }

  /* ----- normal intent-driven actions ---------------------------------- */

  /** Begin a strike from a MOVE record. */
  startAttack(move) {
    if (!move || this._locked()) return;
    // Allow a recovery-CANCEL after an on-beat hit — or freely while in FLOW.
    if (this.action === ACT.ATTACK &&
        !(this.attackPhase === "recovery" && (this.canCancel || this.inFlow))) return;
    this.action = ACT.ATTACK; this.curMove = move; this.vector = move.zone;
    this.attackPhase = "windup"; this.phaseT = 0;
    this.hitCount = 0; this.hitTimer = 0; this.canCancel = false;
    // Inject swing momentum — bigger on the beat and while in FLOW (PERFECT_FLOW).
    const boost = (this.onBeat ? 0.45 : 0.25) * (this.inFlow ? 1.3 : 1);
    this.weaponMomentum += (move.zone === VECTOR.HIGH ? -boost : boost);
  }

  /** Raise a guard from a MOVE record (its `covers` list defines what it stops). */
  startBlock(guardMove) {
    if (this._locked() || this.action === ACT.ATTACK || !guardMove) return;
    if (this.action !== ACT.BLOCK || this.guard !== guardMove) this.blockAge = 0;
    this.action = ACT.BLOCK; this.guard = guardMove;
    this.blockVector = guardMove.covers[0];   // representative zone for the pose
  }

  stopBlock() { if (this.action === ACT.BLOCK) this.action = ACT.IDLE; }

  move(dir, dt) {
    if (this.airborne) {
      if (dir !== 0) this.x += dir * this.speed * 0.7 * dt;   // air control
    } else if (this.action === ACT.IDLE || this.action === ACT.WALK) {
      if (dir !== 0) { this.x += dir * this.speed * dt; this.action = ACT.WALK; }
      else if (this.action === ACT.WALK) this.action = ACT.IDLE;
    } else if (dir !== 0 && (this.action === ACT.ATTACK || this.action === ACT.BLOCK)) {
      // Attack-recovery overlap: the feet keep drifting with the swing/guard.
      this.x += dir * this.speed * 0.35 * dt;
    }
    this.x = clamp(this.x, 40, CANVAS_W - 40);
  }

  /**
   * A PENTRA SIDE-STEP. The art's preferred answer to a blow: read it and leave,
   * rather than meet it. Neutral input retreats — the ideal range is barely
   * outside their reach, so stepping back IS the technique.
   *
   * Stepping ON THE BEAT buys the i-frames; off-beat you move but stay hittable
   * (§1.2). Any step refreshes the defence multiplier, because a step is
   * footwork — that is the whole point of the Pentra.
   */
  startDodge(dir) {
    if (this._locked() || this.action === ACT.ATTACK || this.airborne) return false;
    if (this.stepCd > 0) return false;
    this.action = ACT.STEP;
    this.stepDir = dir || -this.facing;      // neutral = step out of reach
    this.stepT = DODGE.time;
    this.stepIFrame = this.onBeat ? DODGE.iframe : 0;
    this.stepCd = DODGE.time + DODGE.cooldown;
    this.stillTime = 0;                      // a step is footwork: defence refreshes
    return true;
  }

  /** A jumping Pentra hop — only from the ground, out of a free state. */
  jump() {
    if (this.airborne || this._locked() ||
        this.action === ACT.ATTACK || this.action === ACT.BLOCK) return;
    this.vy = -JUMP_V; this.airborne = true;
  }

  /* ----- ABILITIES (all gated on the Simran meter) --------------------- */

  /** ① Chakram Storm — throw a fan of three discs. */
  castChakram() {
    if (this._locked() || this.action === ACT.ATTACK) return false;
    if (this.simran < ABILITY.chakram.cost) return false;
    this.simran -= ABILITY.chakram.cost;
    this.action = ACT.CAST; this.castT = ABILITY.chakram.cast;
    this.pendingChakram = true;   // Game spawns the discs this frame
    return true;
  }

  /** ② Sarbloh Kavach — raise the Iron Shield; next incoming hit is reflected. */
  castShield() {
    if (this._locked()) return false;
    if (this.shieldT > 0) return false;
    if (this.simran < ABILITY.shield.cost) return false;
    this.simran -= ABILITY.shield.cost;
    this.shieldT = ABILITY.shield.duration;
    return true;
  }

  /** ③ Chardi Kala — the Undying Storm. Full-meter AoE with invulnerability. */
  castUltimate() {
    if (this._locked() || this.action === ACT.ATTACK) return false;
    if (this.simran < ABILITY.ultimate.cost) return false;
    this.simran = 0;
    Sfx.ultimate();
    this.ultActive = true; this.ultT = ABILITY.ultimate.duration;
    this.ultFired = [false, false];
    this.action = ACT.IDLE; this.attackPhase = null;
    return true;
  }

  gainSimran(n) {
    if (this.ultActive) return;   // meter is spent during the ult
    this.simran = clamp(this.simran + n, 0, this.maxSimran);
  }

  /* ----- FLOW (rhythm streak) ------------------------------------------ */
  gainFlow() {
    if (this.ultActive) return;
    this.flow = Math.min(PENTRA.flowMax, this.flow + 1);
    this.flowT = PENTRA.flowTime;   // refresh the streak timeout
  }
  breakFlow() { this.flow = 0; this.flowT = 0; }
  get inFlow() { return this.flow >= PENTRA.flowNeed; }

  /* ----- per-frame simulation ------------------------------------------ */

  update(dt, opponent) {
    this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.weaponFlare > 0) this.weaponFlare -= dt;
    if (this.hitTimer > 0) this.hitTimer -= dt;
    if (this.stepCd > 0) this.stepCd -= dt;
    if (this.stepIFrame > 0) this.stepIFrame -= dt;
    if (this.counterT > 0) this.counterT -= dt;   // the counter window closes
    if (this.flowT > 0) { this.flowT -= dt; if (this.flowT <= 0) this.flow = 0; }  // FLOW decays

    // --- Pentra beat clock (per-weapon tempo; the rhythm never stops) ---
    const period = this.weapon.beat || 0.5;
    this.beatT += dt;
    if (this.beatT >= period) { this.beatT -= period; this.beatFired = true; }
    this.beatPhase = this.beatT / period;
    this.onBeat = this.beatPhase < PENTRA.onBeatWindow || this.beatPhase > 1 - PENTRA.onBeatWindow;

    // --- Stillness: motion since the last step drives the defense multiplier ---
    if (Math.abs(this.x - this.prevX) > 0.5) this.stillTime = 0;
    else this.stillTime += dt;
    this.prevX = this.x;
    this.defenseMult = clamp(1 - Math.max(0, this.stillTime - PENTRA.stillGrace) * PENTRA.decay,
                             PENTRA.defenseMin, 1);

    // --- Ultimate takes over the whole update while active --------------
    if (this.ultActive) {
      this.facing = opponent.x >= this.x ? 1 : -1;
      this.ultT -= dt;
      const elapsed = ABILITY.ultimate.duration - this.ultT;
      for (let i = 0; i < ULT.pulses.length; i++) {
        if (!this.ultFired[i] && elapsed >= ULT.pulses[i]) {
          this.ultFired[i] = true;
          this.ultPulseReady = true;   // Game applies the AoE
        }
      }
      if (this.ultT <= 0) this.ultActive = false;
      return;
    }

    // Face the opponent unless mid-swing (committed).
    if (this.action !== ACT.ATTACK) this.facing = opponent.x >= this.x ? 1 : -1;

    switch (this.action) {
      case ACT.HURT:
        this.hurtT -= dt;
        if (this.hurtT <= 0) this.action = ACT.IDLE;
        break;
      case ACT.BLOCK:
        this.blockAge += dt;
        break;
      case ACT.CAST:
        this.castT -= dt;
        if (this.castT <= 0) this.action = ACT.IDLE;
        break;
      case ACT.STAGGER:
        this.staggerT -= dt;
        if (this.staggerT <= 0) this.action = ACT.IDLE;
        break;
      case ACT.STEP:
        this.stepT -= dt;
        this.x = clamp(this.x + this.stepDir * (DODGE.dist / DODGE.time) * dt, 40, CANVAS_W - 40);
        if (this.stepT <= 0) this.action = ACT.IDLE;
        break;
      case ACT.ATTACK:
        this._advanceAttack(dt);
        break;
    }

    // Balance (posture) regenerates ONLY while moving on the Pentra.
    if (this.action !== ACT.HURT && this.action !== ACT.STAGGER && this.stillTime < 0.2) {
      this.posture = clamp(this.posture + 24 * dt, 0, this.maxPost);
    }

    // --- Vertical physics (jumping) ---
    if (this.airborne) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y >= GROUND_Y) { this.y = GROUND_Y; this.vy = 0; this.airborne = false; }
    }

    // --- Weapon momentum conservation (Gatka fluidity) ---
    // Friction bleeds spin; the Chakkar (multi-hit) sustains a whirl; then the
    // angle elastically re-centers toward the current pose target (a Lerp, so it
    // never snaps). This is what makes strike→spin→step read as one motion.
    const target = this._targetArmAngle();
    this.weaponMomentum *= WEIGHT_FRICTION[this.weapon.weight] || 0.94;
    if (this.action === ACT.ATTACK && this.attackPhase === "active" &&
        this.curMove && this.curMove.hits >= 3) {
      this.weaponMomentum += 0.16;   // Chakkar keeps spinning while active
    }
    this.weaponAngle += this.weaponMomentum;
    // Snap harder to the strike pose during the ACTIVE frames so the visible
    // blade lines up with the live hitbox (fixes "it doesn't look like it hit").
    // Snap hard onto the strike pose during ACTIVE — a hero's blade arrives, it
    // does not drift into place.
    const center = (this.action === ACT.ATTACK && this.attackPhase === "active") ? 0.64 : 0.18;
    this.weaponAngle += (target - this.weaponAngle) * center;
  }

  /** The pose the weapon arm eases toward, per action/phase. */
  _targetArmAngle() {
    switch (this.action) {
      case ACT.STEP:    return -0.55;   // weapon carried ready through the step
      case ACT.CAST:    return -1.2;
      case ACT.STAGGER: return 1.25;
      case ACT.HURT:    return 0.9;
      case ACT.BLOCK: {
        const v = this.blockVector;
        let a = v === VECTOR.HIGH ? -1.1 : v === VECTOR.LOW ? 0.7 : -0.2;
        // Giraav (Chhari) guard is a spinning vortex, not a frozen frame.
        if (this.guard && this.guard.flags && this.guard.flags.deflect) {
          a += Math.sin(this.animT * 26) * 0.25;
        }
        return a;
      }
      case ACT.ATTACK: {
        const strike = this.vector === VECTOR.HIGH ? -0.9
                     : this.vector === VECTOR.LOW  ?  0.6 : 0.0;
        if (this.attackPhase === "windup") return this.vector === VECTOR.HIGH ? 0.4 : -1.0; // pull back
        return strike;
      }
      default: // IDLE / WALK — a gentle Pentra sway; the weapon is never dead-still.
        return -0.35 + Math.sin(this.animT * 3) * 0.06;
    }
  }

  _advanceAttack(dt) {
    this.phaseT += dt;
    const m = this.curMove || this.weapon;   // move timings drive the swing
    if (this.attackPhase === "windup" && this.phaseT >= m.windup) {
      this.attackPhase = "active"; this.phaseT = 0;
      // The bolt lands the instant the blade goes live — not on contact. It falls
      // whether or not the vaar connects, because the sky is not aiming at anyone.
      if (this.curMove && this.curMove.flags && this.curMove.flags.bijli) this.boltPending = true;
    } else if (this.attackPhase === "active" && this.phaseT >= m.active) {
      this.attackPhase = "recovery"; this.phaseT = 0;
    } else if (this.attackPhase === "recovery" && this.phaseT >= m.recovery) {
      this.attackPhase = null; this.action = ACT.IDLE; this.curMove = null; this.canCancel = false;
    }
  }

  /**
   * Apply an incoming MELEE hit from `attacker`. Returns an outcome string:
   *   "parry" | "reflect" | "block" | "hit"
   *
   * Priority of defenses:
   *   1. Ultimate active  → invulnerable, blow ignored.
   *   2. Iron Shield up    → reflect (any vector), consume the shield.
   *   3. Correct-vector block within PARRY_WINDOW → parry.
   *   4. Correct-vector block → chip posture.
   *   5. Otherwise          → clean hit.
   */
  receiveHit(attacker, hitbox) {
    if (this.ultActive) return "ignore";

    // 0) EVADE — checked FIRST, and this is the whole point of the art. A step
    //    with live i-frames simply is not there to be hit, so it beats what no
    //    guard can: an unblockable Chakkar and a guard-breaking Purba both pass
    //    through empty air. That is why Gatka rates dodging above blocking.
    //    It also opens the roko-aur-thoko counter window: you waited, now strike.
    if (this.action === ACT.STEP && this.stepIFrame > 0) {
      this.gainSimran(SIMRAN_GAIN.evade);
      this.counterT = DODGE.counter;
      if (this.onBeat) this.gainFlow();
      return "evade";
    }

    // Iron Shield (ability) reflects the next hit of any kind.
    if (this.shieldT > 0) {
      this.shieldT = 0;
      attacker.posture = clamp(attacker.posture - 26, 0, attacker.maxPost);
      if (attacker.posture <= 0) attacker._stagger();
      this.gainSimran(SIMRAN_GAIN.reflect);
      return "reflect";
    }

    const move  = attacker.curMove || {};
    const flags = move.flags || {};
    const dmg = (move.dmg    != null ? move.dmg    : attacker.weapon.damage);
    const bal = (move.balDmg != null ? move.balDmg : attacker.weapon.postureDmg);
    const dmgMult = attacker.onBeat ? PENTRA.onBeatDmg : PENTRA.offBeatDmg;
    const balMult = attacker.onBeat ? PENTRA.onBeatBal : 1;

    const guarding = this.action === ACT.BLOCK && !!this.guard;
    const g      = this.guard || {};
    const gflags = g.flags || {};
    const covers = g.covers || [];
    const correctZone = guarding && covers.indexOf(hitbox.vector) !== -1;

    // 1) Super-armor guard (Santulan): absorbs any zone at low chip; immune to break.
    if (guarding && gflags.superArmor) {
      this.posture = clamp(this.posture - bal * 0.4 * balMult, 0, this.maxPost);
      this.gainSimran(SIMRAN_GAIN.gotBlock);
      if (this.posture <= 0) this._stagger();
      return "block";
    }
    // 2) Parry: correct-zone guard timed fresh OR on-beat. Unblockable can't be parried.
    if (correctZone && !flags.unblockable && (this.blockAge <= PARRY_WINDOW || this.onBeat)) {
      attacker.posture = clamp(attacker.posture - 30, 0, attacker.maxPost);
      if (attacker.posture <= 0) attacker._stagger();
      this.gainSimran(SIMRAN_GAIN.parry);
      this.weaponFlare = 0.35;
      if (this.onBeat) this.gainFlow();   // an on-beat parry builds FLOW
      if (gflags.stepIn) this.x = clamp(this.x + this.facing * 22, 40, CANVAS_W - 40); // Giraav step-in
      return "parry";
    }
    // 3) Guard-break: a heavy move (Purba) crushes a held, non-parry block.
    if (flags.guardBreak && correctZone) {
      this.hp = clamp(this.hp - dmg * 0.5 * dmgMult, 0, this.maxHp);
      this.flash = 0.14;
      attacker.gainSimran(SIMRAN_GAIN.hit);
      this.breakFlow();   // getting your guard crushed drops FLOW
      if (this.hp <= 0) this.action = ACT.KO; else this._stagger();
      this.x = clamp(this.x + attacker.facing * 18, 40, CANVAS_W - 40);
      return "guardbreak";
    }
    // 4) Normal block (zone must match; unblockable moves skip this).
    if (correctZone && !flags.unblockable) {
      this.posture = clamp(this.posture - bal * (2 - this.defenseMult) * balMult, 0, this.maxPost);
      this.gainSimran(SIMRAN_GAIN.gotBlock);
      attacker.gainSimran(SIMRAN_GAIN.blocked);
      if (this.posture <= 0) this._stagger();
      return "block";
    }

    // 5) Clean hit — punish bonus (+40%) if staggered/hurt; FLOW bonus if the
    //    attacker is riding the rhythm; and taking the hit drops your own FLOW.
    const punish = (this.action === ACT.STAGGER || this.action === ACT.HURT) ? 1.4 : 1;
    const flowMult = attacker.inFlow ? PENTRA.flowDmg : 1;
    // ROKO AUR THOKO — you stepped their blow and answered it. Patience pays.
    const counter = attacker.counterT > 0 ? DODGE.counterDmg : 1;
    attacker.counterT = 0;                     // the window is spent on this blow
    this.breakFlow();
    this.hp = clamp(this.hp - dmg * dmgMult * punish * flowMult * counter, 0, this.maxHp);
    this.posture = clamp(this.posture - bal * 0.5 * (2 - this.defenseMult) * balMult, 0, this.maxPost);
    this.flash = 0.12;
    attacker.gainSimran(SIMRAN_GAIN.hit);
    attacker.weaponFlare = 0.2;
    if (this.hp <= 0) { this.action = ACT.KO; }
    else if (this.action === ACT.ATTACK && this.weapon.superArmor && this.attackPhase === "active") {
      // Heavy weapon super-armor: keep swinging through the hit.
    } else {
      this.action = ACT.HURT; this.hurtT = 0.28;
    }
    this.x = clamp(this.x + attacker.facing * 14, 40, CANVAS_W - 40);
    return "hit";
  }

  /** Apply an incoming Chakram. Mirrors receiveHit but for a disc. */
  receiveProjectile(proj) {
    if (this.ultActive) return "ignore";
    if (this.action === ACT.STEP && this.stepIFrame > 0) {   // stepped the disc
      this.gainSimran(SIMRAN_GAIN.evade);
      this.counterT = DODGE.counter;
      return "evade";
    }
    if (this.shieldT > 0) {
      this.shieldT = 0;
      this.gainSimran(SIMRAN_GAIN.reflect);
      return "reflect";
    }
    const guarding = this.action === ACT.BLOCK && !!this.guard;
    const gflags = (this.guard && this.guard.flags) || {};
    const covers = (this.guard && this.guard.covers) || [];
    if (guarding && gflags.superArmor) {   // Santulan absorbs discs too
      this.posture = clamp(this.posture - CHAKRAM.postureDmg * 0.4, 0, this.maxPost);
      return "block";
    }
    const blocking = guarding && covers.indexOf(proj.vector) !== -1;
    if (blocking && (this.blockAge <= PARRY_WINDOW || this.onBeat)) {
      this.gainSimran(SIMRAN_GAIN.parry);
      this.weaponFlare = 0.35;
      return "parry";
    }
    if (blocking) {
      this.posture = clamp(this.posture - CHAKRAM.postureDmg * (2 - this.defenseMult), 0, this.maxPost);
      this.gainSimran(SIMRAN_GAIN.gotBlock);
      if (this.posture <= 0) this._stagger();
      return "block";
    }
    this.hp = clamp(this.hp - CHAKRAM.damage, 0, this.maxHp);
    this.flash = 0.1;
    proj.owner.gainSimran(SIMRAN_GAIN.chakram);
    if (this.hp <= 0) this.action = ACT.KO;
    return "hit";
  }

  /** AoE damage from someone's ultimate. Not blockable; a raw crush. */
  receiveUltPulse(attacker) {
    if (this.ultActive) return false;
    this.hp = clamp(this.hp - ULT.damage, 0, this.maxHp);
    this.flash = 0.14;
    this.x = clamp(this.x + attacker.facing * 22, 40, CANVAS_W - 40);
    if (this.hp <= 0) this.action = ACT.KO;
    else { this.action = ACT.HURT; this.hurtT = 0.4; }
    return true;
  }

  _stagger() {
    this.action = ACT.STAGGER; this.staggerT = 0.62;   // long, punishable
    this.posture = this.maxPost * 0.4;
    this.flash = 0.15;
    this.canCancel = false;
  }

  resetForRound(x, facing) {
    this.x = x; this.facing = facing;
    this.y = GROUND_Y; this.vy = 0; this.airborne = false;
    this.hp = this.maxHp; this.posture = this.maxPost; this.simran = 0;
    this.action = ACT.IDLE; this.attackPhase = null; this.hurtT = 0;
    this.curMove = null; this.guard = null; this.hitCount = 0; this.hitTimer = 0;
    this.canCancel = false; this.staggerT = 0;
    this.stepT = 0; this.stepDir = 0; this.stepIFrame = 0; this.stepCd = 0;
    this.counterT = 0; this.boltPending = false;
    this.blockAge = 0; this.flash = 0;
    this.castT = 0; this.shieldT = 0; this.pendingChakram = false;
    this.ultActive = false; this.ultT = 0; this.ultFired = [false, false];
    this.ultPulseReady = false;
    this.weaponFlare = 0;
    this.beatT = 0; this.beatPhase = 0; this.onBeat = false; this.beatFired = false;
    this.prevX = this.x; this.stillTime = 0; this.defenseMult = 1;
    this.flow = 0; this.flowT = 0;
    this.weaponAngle = -0.35; this.weaponMomentum = 0;
  }

  /* ----- rendering ------------------------------------------------------ */

  draw(ctx) {
    // The drawn arm angle is the momentum-driven `weaponAngle` (integrated in
    // update()); the ultimate whirls on its own clock.
    const shieldUp = this.action === ACT.BLOCK ? 1 : 0;
    const armAngle = this.ultActive
      ? (ABILITY.ultimate.duration - this.ultT) * 22
      : this.weaponAngle;

    // Ultimate aura behind the warrior.
    if (this.ultActive) {
      const pulse = 0.5 + 0.5 * Math.sin((ABILITY.ultimate.duration - this.ultT) * 20);
      ctx.save();
      ctx.globalAlpha = 0.35 + pulse * 0.25;
      const g = ctx.createRadialGradient(this.x, this.y - 70, 10, this.x, this.y - 70, ULT.radius);
      g.addColorStop(0, "rgba(255,212,121,0.9)");
      g.addColorStop(1, "rgba(255,157,46,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(this.x, this.y - 70, ULT.radius, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // FLOW aura — a soft golden nimbus while riding the rhythm streak.
    if (this.inFlow && !this.ultActive) {
      const p = 0.5 + 0.5 * Math.sin(this.animT * 12);
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.10 * p;
      const gg = ctx.createRadialGradient(this.x, this.y - 70, 10, this.x, this.y - 70, 88);
      gg.addColorStop(0, "rgba(255,212,121,0.85)");
      gg.addColorStop(1, "rgba(255,212,121,0)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(this.x, this.y - 70, 88, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    Artist.drawWarrior(ctx, this, armAngle, shieldUp);

    // STAGGER indicator — a pulsing red ring above the head (big punish window).
    if (this.action === ACT.STAGGER) {
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(this.animT * 24);
      ctx.globalAlpha = 0.45 + 0.4 * pulse;
      ctx.strokeStyle = "#ff6b52"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y - this.height - 6, 7 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Iron Shield matrix — a shimmering hex ring around the body.
    if (this.shieldT > 0) {
      const a = clamp(this.shieldT / ABILITY.shield.duration, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.4 * a;
      ctx.strokeStyle = "#8fe3ff"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - this.height / 2, this.width * 0.9, this.height * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.15 + 0.2 * a;
      ctx.fillStyle = "#8fe3ff"; ctx.fill();
      ctx.restore();
    }

    // Damage flash.
    if (this.flash > 0) {
      ctx.save();
      ctx.globalAlpha = this.flash * 3;
      ctx.fillStyle = "#ffffff";
      const b = this.getBodyBox();
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }

    // DEBUG hitboxes.
    if (window.__GATKA_DEBUG__) {
      const hb = this.getAttackHitbox();
      if (hb) { ctx.strokeStyle = "rgba(255,60,60,0.9)"; ctx.strokeRect(hb.x, hb.y, hb.w, hb.h); }
      const b = this.getBodyBox();
      ctx.strokeStyle = "rgba(60,160,255,0.6)"; ctx.strokeRect(b.x, b.y, b.w, b.h);

      // AUTHENTIC-LENGTH RULER (green): where the real shastar would end, at
      // true scale. The gap out to the red hitbox is the heroic exaggeration we
      // knowingly accept so spacing stays legible — see docs/WEAPONS.md. Keeping
      // it on screen means that trade-off is measurable instead of forgotten.
      const realPx = (this.weapon.lengthInches || 0) * INCH_TO_PIXEL_SCALE;
      if (realPx > 0) {
        const rx = this.facing > 0 ? this.x + this.width / 2 : this.x - this.width / 2 - realPx;
        const ry = this.y - this.height * 0.5;
        ctx.strokeStyle = "rgba(80,220,120,0.85)"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rx, ry); ctx.lineTo(rx + realPx, ry);                  // the real blade
        ctx.moveTo(rx + realPx, ry - 4); ctx.lineTo(rx + realPx, ry + 4); // tip tick
        ctx.stroke();
      }
    }
  }
}

/* ============================================================================
 * SECTION 8 — PLAYER (human-controlled Fighter)
 * ----------------------------------------------------------------------------
 * The "block vector" is chosen by the currently-held arrow — Up=High,
 * Down=Low, else Mid — so pressing Up + K yields a HIGH block, as specified.
 * Abilities: U = Chakram Storm, I = Iron Shield, O = Ultimate.
 * ==========================================================================*/

class Player extends Fighter {
  handleInput(input, dt) {
    if (this.action === ACT.KO || this.ultActive || this.action === ACT.CAST) return;

    // Everything reads the KEYS table, so W/S and ↑/↓ (and the touch pad) are
    // the same intent — no branch here knows where the press came from.
    const up = input.isDownAny(KEYS.up), down = input.isDownAny(KEYS.down);
    const M = MOVES[this.weapon.id];   // this weapon's moveset

    // --- ABILITIES (one-shot taps, checked before normal actions) -------
    if (input.wasPressedAny(KEYS.ultimate) && this.castUltimate()) return;
    if (input.wasPressedAny(KEYS.chakram)  && this.castChakram())  return;
    if (input.wasPressedAny(KEYS.shield)) this.castShield();  // shield layers on movement
    if (input.wasPressedAny(KEYS.jump))   this.jump();        // Space = jumping Pentra

    // --- DODGE (Shift / L): the Pentra side-step, the art's first answer ----
    if (input.wasPressedAny(KEYS.dodge)) {
      let sd = 0;
      if (input.isDownAny(KEYS.left))  sd -= 1;
      if (input.isDownAny(KEYS.right)) sd += 1;
      if (this.startDodge(sd)) return;
    }

    // --- GUARD (hold K): Up selects the weapon's high guard if it has one ---
    if (input.isDownAny(KEYS.guard)) {
      this.startBlock(up && M.guardUp ? M.guardUp : M.guard);
      return;
    } else this.stopBlock();

    // --- STRIKE (tap J): Up / neutral / Down pick the move slot ----------
    if (input.wasPressedAny(KEYS.strike)) {
      const move = up ? M.jUp : down ? (M.jDown || M.jMid) : M.jMid;
      this.startAttack(move);
      return;
    }

    // --- MOVEMENT --------------------------------------------------------
    let dir = 0;
    if (input.isDownAny(KEYS.left))  dir -= 1;
    if (input.isDownAny(KEYS.right)) dir += 1;
    this.move(dir, dt);
  }
}

/* ============================================================================
 * SECTION 9 — ENEMY (AI-controlled Fighter)
 * ----------------------------------------------------------------------------
 * Reactive AI that spaces, blocks the player's telegraphed vector, throws
 * Chakrams from range, shields against the ultimate, and spends a full meter
 * on its own ultimate. Emits the SAME intents a human would.
 * ==========================================================================*/

class Enemy extends Fighter {
  constructor(opts) {
    super(opts);
    this.think = 0;
    this.plan = "approach";
  }

  think_ai(dt, player) {
    if (this.action === ACT.KO || this.action === ACT.HURT || this.action === ACT.STEP ||
        this.action === ACT.CAST || this.action === ACT.STAGGER || this.ultActive) return;

    const gap = Math.abs(player.x - this.x);
    const inRange = gap <= this.weapon.reach + this.width * 0.5;
    this.think -= dt;

    // Panic-shield if the player is unloading their ultimate nearby.
    if (player.ultActive && gap < ULT.radius && this.shieldT <= 0 &&
        this.simran >= ABILITY.shield.cost) {
      this.castShield();
    }

    // Spend a full meter on the ultimate when reasonably close.
    if (this.simran >= ABILITY.ultimate.cost && gap < 220 && Math.random() < 0.5) {
      this.castUltimate();
      return;
    }

    // Read the swing and SIDE-STEP it — the art's preferred answer, so the AI
    // reaches for it before it reaches for a guard.
    if (player.action === ACT.ATTACK && player.attackPhase === "windup" &&
        gap < 155 && Math.random() < 0.32 && this.startDodge(0)) return;

    // React to the player's swing: guard sometimes (not always — let hits land).
    if (player.action === ACT.ATTACK && player.attackPhase === "windup" &&
        gap < 140 && Math.random() < 0.45) {
      const M = MOVES[this.weapon.id];
      const readHigh = (Math.random() < 0.6 ? player.vector : (player.vector + 1) % 3) === VECTOR.HIGH;
      this.startBlock(readHigh && M.guardUp ? M.guardUp : M.guard);
      return;
    } else if (this.action === ACT.BLOCK) {
      this.stopBlock();
    }

    if (this.think > 0) {
      if (this.plan === "approach" && !inRange) {
        this.move(player.x > this.x ? 1 : -1, dt);
        if (Math.random() < 0.004) this.jump();   // occasional hop
      } else if (this.plan === "retreat") this.move(player.x > this.x ? -1 : 1, dt);
      return;
    }

    // Pick a new plan.
    if (inRange) {
      if (Math.random() < 0.72) {
        const M = MOVES[this.weapon.id];
        const slots = [M.jUp, M.jMid, M.jDown].filter(Boolean);
        this.startAttack(slots[Math.floor(rand(0, slots.length))]);
        this.think = rand(0.35, 0.7);
      } else { this.plan = "retreat"; this.think = rand(0.25, 0.5); }
    } else {
      // From range, sometimes fling a Chakram fan instead of just walking in.
      if (gap > this.weapon.reach + 80 && this.simran >= ABILITY.chakram.cost &&
          Math.random() < 0.4) {
        this.castChakram();
        this.think = rand(0.4, 0.8);
      } else {
        this.plan = "approach";
        this.think = rand(0.2, 0.45);
      }
    }
  }
}

/* ============================================================================
 * SECTION 10 — HUD (health, posture, SIMRAN, rounds)
 * ==========================================================================*/

const HUD = {
  draw(ctx, game) {
    const p = game.player, e = game.enemy;
    HUD._fighterBars(ctx, p, 24, false);
    HUD._fighterBars(ctx, e, CANVAS_W - 24, true);
    HUD._roundPips(ctx, game);

    ctx.fillStyle = "#ffd479";
    ctx.font = "16px Cinzel, serif";
    ctx.textAlign = "left";
    ctx.fillText(p.name + "  •  " + p.weapon.name, 26, 92);
    ctx.textAlign = "right";
    ctx.fillText(e.name + "  •  " + e.weapon.name, CANVAS_W - 26, 92);
    ctx.textAlign = "left";
  },

  _fighterBars(ctx, f, edgeX, mirror) {
    const W = 340, H = 18, x = mirror ? edgeX - W : edgeX, y = 26;
    HUD._bar(ctx, x, y, W, H, f.hp / f.maxHp, "#c0392b", "#ff6b52", mirror);
    HUD._bar(ctx, x, y + H + 4, W, 8, f.posture / f.maxPost, "#2a6f4f", "#7be0a6", mirror);
    // SIMRAN meter (gold); pulses / labels "READY" at full.
    HUD._bar(ctx, x, y + H + 16, W, 7, f.simran / f.maxSimran, "#8a5a15", "#ffd479", mirror);
    if (f.simran >= SIMRAN_MAX) {
      ctx.fillStyle = "#ffe9a8";
      ctx.font = "11px Cinzel, serif";
      ctx.textAlign = mirror ? "right" : "left";
      ctx.fillText("✦ ULTIMATE READY", mirror ? x + W : x, y + H + 34);
      ctx.textAlign = "left";
    }

    // --- Pentra beat pips (4 steps): active step highlighted, flares on-beat.
    // Placed on the OUTER edge so they never collide with the ULT-ready text. ---
    const step = Math.floor(clamp(f.beatPhase, 0, 0.999) * 4);
    for (let i = 0; i < 4; i++) {
      const px = mirror ? x + 10 + i * 15 : x + W - 10 - i * 15;
      const py = y + H + 30;
      const on = i === step;
      ctx.beginPath();
      ctx.arc(px, py, on ? (f.onBeat ? 6 : 4.5) : 3, 0, Math.PI * 2);
      ctx.fillStyle = on ? (f.onBeat ? "#fff4d6" : "#ff9d2e") : "#3a2410";
      ctx.fill();
      ctx.strokeStyle = "#e6b845"; ctx.lineWidth = 1; ctx.stroke();
    }
    // stillness warning — "motion is life"
    if (f.defenseMult < 0.8) {
      ctx.fillStyle = "#ff6b52"; ctx.font = "10px Cinzel, serif";
      ctx.textAlign = mirror ? "left" : "right";
      ctx.fillText("KEEP MOVING", mirror ? x : x + W, y + H + 46);
      ctx.textAlign = "left";
    }
    // ROKO AUR THOKO — the counter window is open; your next blow answers theirs.
    if (f.counterT > 0) {
      ctx.fillStyle = "#7be0a6"; ctx.font = "11px Cinzel, serif";
      ctx.textAlign = mirror ? "right" : "left";
      ctx.fillText("⟳ COUNTER", mirror ? x + W : x, y + H + 58);
      ctx.textAlign = "left";
    }
    // FLOW streak indicator (inner side, below the ULT-ready text)
    if (f.inFlow) {
      ctx.fillStyle = "#ffe9a8"; ctx.font = "11px Cinzel, serif";
      ctx.textAlign = mirror ? "right" : "left";
      ctx.fillText("≈ FLOW ×" + f.flow, mirror ? x + W : x, y + H + 46);
      ctx.textAlign = "left";
    }
  },

  _bar(ctx, x, y, w, h, frac, backCol, fillCol, mirror) {
    frac = clamp(frac, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "#1a0f05"; ctx.fillRect(x, y, w, h);
    const fw = w * frac;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, fillCol); grad.addColorStop(1, backCol);
    ctx.fillStyle = grad;
    ctx.fillRect(mirror ? x + (w - fw) : x, y, fw, h);
    ctx.strokeStyle = "#e6b845"; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  },

  _roundPips(ctx, game) {
    const cy = 34, cx = CANVAS_W / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd479"; ctx.font = "14px Cinzel, serif";
    ctx.fillText("ROUND " + game.roundNumber, cx, 20);
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      HUD._pip(ctx, cx - 26 - i * 18, cy, i < game.playerWins);
      HUD._pip(ctx, cx + 26 + i * 18, cy, i < game.enemyWins);
    }
    ctx.textAlign = "left";
  },

  _pip(ctx, x, y, filled) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = filled ? "#ff9d2e" : "#3a2410"; ctx.fill();
    ctx.strokeStyle = "#e6b845"; ctx.lineWidth = 1.4; ctx.stroke();
  },
};

/* ============================================================================
 * SECTION 11 — BACKGROUND (the akhara / arena)
 * ==========================================================================*/

// Where the far courtyard meets the sky. The Gurdwara stands on this line, well
// behind the akhara floor at GROUND_Y — distance, not decoration.
const HORIZON_Y = 356;

/**
 * THE CHHAONI — a Nihang war-camp akhara before a Sikh qila.
 * ----------------------------------------------------------------------------
 * This is where Gatka actually lives: the akhara of a Nihang encampment, ringed
 * by the fort it guards. Everything here is martial rather than devotional —
 * ramparts, a shastar rack, the war drum, the standard. No place of worship is
 * used as a backdrop for combat.
 *
 * The rampart is a QILA wall (Anandgarh, Lohgarh and their kin were built as
 * fortresses, not shrines): battlements, arrow slits, corner bastions.
 */
function drawRampart(ctx, t) {
  const wallTop = 292, base = HORIZON_Y;
  ctx.save();

  // the curtain wall
  const stone = ctx.createLinearGradient(0, wallTop, 0, base);
  stone.addColorStop(0, "#4a3a24"); stone.addColorStop(1, "#241a0e");
  ctx.fillStyle = stone;
  ctx.fillRect(0, wallTop, CANVAS_W, base - wallTop);

  // coping course + merlons (the battlement a defender fights from)
  ctx.fillStyle = "#5d4930";
  ctx.fillRect(0, wallTop, CANVAS_W, 5);
  ctx.fillStyle = "#3d2f1c";
  for (let x = 6; x < CANVAS_W; x += 34) {
    ctx.fillRect(x, wallTop - 13, 19, 13);
    ctx.fillStyle = "#5d4930"; ctx.fillRect(x, wallTop - 13, 19, 2.5);
    ctx.fillStyle = "#3d2f1c";
  }

  // arrow slits, lit from within — the camp is awake before dawn
  for (let x = 40; x < CANVAS_W; x += 68) {
    ctx.fillStyle = "#120b05";
    ctx.fillRect(x, wallTop + 20, 5, 22);
    ctx.fillStyle = "rgba(255,175,80,0.30)";
    ctx.fillRect(x + 1, wallTop + 26, 3, 12);
  }

  // corner bastions — round towers, the classic Sikh qila
  for (const bx of [92, CANVAS_W - 92]) {
    const bw = 74, bTop = wallTop - 40;
    const bg = ctx.createLinearGradient(bx - bw / 2, 0, bx + bw / 2, 0);
    bg.addColorStop(0, "#241a0e"); bg.addColorStop(0.4, "#54422a"); bg.addColorStop(1, "#1d1409");
    ctx.fillStyle = bg;
    ctx.fillRect(bx - bw / 2, bTop, bw, base - bTop);
    ctx.fillStyle = "#5d4930";
    ctx.fillRect(bx - bw / 2 - 4, bTop, bw + 8, 5);
    ctx.fillStyle = "#3d2f1c";
    for (let i = 0; i < 4; i++) ctx.fillRect(bx - bw / 2 + 2 + i * 19, bTop - 11, 12, 11);
    // brazier burning on the bastion head
    const flick = 0.6 + 0.4 * Math.sin(t * 7 + bx);
    const fire = ctx.createRadialGradient(bx, bTop - 16, 1, bx, bTop - 16, 15 + flick * 5);
    fire.addColorStop(0, "rgba(255,220,150," + (0.85 * flick).toFixed(3) + ")");
    fire.addColorStop(1, "rgba(255,120,20,0)");
    ctx.fillStyle = fire;
    ctx.beginPath(); ctx.arc(bx, bTop - 16, 15 + flick * 5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * THE RANJIT NAGARA — the Khalsa's war drum.
 * ----------------------------------------------------------------------------
 * Guru Hargobind had the Ranjit Nagara ("victory drum") beaten at the Akal Takht:
 * a declaration of sovereignty, and the drum the Khalsa marched and fought to.
 *
 * It is not scenery. THIS GAME'S IDENTITY MECHANIC IS A BEAT — the Pentra clock
 * that decides whether your strike lands on-beat, whether your guard parries and
 * whether your step buys i-frames — and until now that beat came from nowhere.
 * The nagara is struck ON that clock, so the rhythm you fight to has a source you
 * can see and read. `beatHit` is 1 on the beat and falls to 0 between.
 */
function drawRanjitNagara(ctx, t, beatHit) {
  const cx = 726, base = HORIZON_Y + 4;
  ctx.save();

  // timber stand
  ctx.strokeStyle = "#3a2714"; ctx.lineWidth = 5; ctx.lineCap = "round";
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * 12, base - 26); ctx.lineTo(cx + sx * 30, base);
    ctx.stroke();
  }

  // kettle body — beaten copper, struck from above
  const r = 34;
  const bowl = ctx.createLinearGradient(cx - r, base - 62, cx + r, base - 20);
  bowl.addColorStop(0, "#8a4a1c"); bowl.addColorStop(0.45, "#c9762e"); bowl.addColorStop(1, "#5a2f10");
  ctx.fillStyle = bowl;
  ctx.beginPath();
  ctx.moveTo(cx - r, base - 56);
  ctx.bezierCurveTo(cx - r, base - 18, cx + r, base - 18, cx + r, base - 56);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#3a1d08"; ctx.lineWidth = 1.4; ctx.stroke();

  // hide head — it FLEXES on the strike, which is the whole point
  const flex = beatHit * 3.2;
  ctx.fillStyle = "#e8d3a8";
  ctx.beginPath();
  ctx.ellipse(cx, base - 56 + flex, r, 9 + flex * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8a6a34"; ctx.lineWidth = 1.6; ctx.stroke();
  // rim rope + V-lacing down the shell
  ctx.strokeStyle = "#6b4a1f"; ctx.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI + (i / 8) * Math.PI;
    const lx = cx + Math.cos(a) * r * 0.94;
    ctx.beginPath();
    ctx.moveTo(lx, base - 54 + flex);
    ctx.lineTo(cx + Math.cos(a) * r * 0.5, base - 24);
    ctx.stroke();
  }

  // the strike: a mallet falling onto the beat, and the shock ring off the head
  const lift = (1 - beatHit) * 0.9;
  ctx.save();
  ctx.translate(cx - 6, base - 60);
  ctx.rotate(-0.5 - lift);
  ctx.strokeStyle = "#7a5720"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(26, 0); ctx.stroke();
  ctx.fillStyle = "#d8c8a0";
  ctx.beginPath(); ctx.arc(29, 0, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  if (beatHit > 0.04) {
    ctx.save();
    ctx.globalAlpha = 0.5 * beatHit;
    ctx.strokeStyle = "#ffd479"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, base - 56, r + (1 - beatHit) * 22, 9 + (1 - beatHit) * 10, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * SHASTAR RACK — the weapons stand of the chhaoni.
 * Shastar are kept upright and to hand, never on the ground. Talwars, a barchha
 * (spear), and a chakram on its pole: the arms a Nihang actually carries.
 */
function drawShastarRack(ctx, t) {
  const cx = 168, base = HORIZON_Y + 4;
  ctx.save();

  // A-frame
  ctx.strokeStyle = "#3a2714"; ctx.lineWidth = 4.5; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 34, base); ctx.lineTo(cx - 10, base - 44);
  ctx.moveTo(cx + 34, base); ctx.lineTo(cx + 10, base - 44);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(cx - 26, base - 26); ctx.lineTo(cx + 26, base - 26); ctx.stroke();

  // barchha (spear) + a second haft, leaning
  for (const [ox, lean, len] of [[-22, -0.13, 86], [20, 0.10, 78]]) {
    ctx.save();
    ctx.translate(cx + ox, base);
    ctx.rotate(lean);
    ctx.strokeStyle = "#5a3f1c"; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len); ctx.stroke();
    ctx.fillStyle = "#cdd8e8";                       // leaf blade
    ctx.beginPath();
    ctx.moveTo(0, -len - 13);
    ctx.quadraticCurveTo(3.4, -len - 4, 0, -len + 2);
    ctx.quadraticCurveTo(-3.4, -len - 4, 0, -len - 13);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // two talwars hung on the crossbar, curve UP to the tip (as the blade does)
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + sx * 13, base - 26);
    ctx.rotate(sx * 0.42);
    ctx.strokeStyle = "#b9c6d8"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(4, 22, 1, 40);              // belly leads, tip rises
    ctx.stroke();
    ctx.strokeStyle = "#e6b845"; ctx.lineWidth = 2;  // cross-guard
    ctx.beginPath(); ctx.moveTo(-4, -1); ctx.lineTo(4, -1); ctx.stroke();
    ctx.restore();
  }

  // chakram on its pole — the Nihang's quoit
  ctx.strokeStyle = "#5a3f1c"; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(cx + 38, base); ctx.lineTo(cx + 38, base - 58); ctx.stroke();
  ctx.strokeStyle = "#dfe7ef"; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.arc(cx + 38, base - 66, 8.5, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Nihang tents ranged along the camp line, behind the akhara. */
function drawChhaoniTents(ctx, t) {
  ctx.save();
  for (const [tx, tw, th] of [[300, 58, 30], [388, 44, 24], [560, 50, 27], [640, 38, 21]]) {
    const g = ctx.createLinearGradient(tx - tw / 2, HORIZON_Y - th, tx + tw / 2, HORIZON_Y);
    g.addColorStop(0, "#2c3d63"); g.addColorStop(1, "#141d33");   // Nihang blue
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(tx - tw / 2, HORIZON_Y + 2);
    ctx.lineTo(tx, HORIZON_Y - th);
    ctx.lineTo(tx + tw / 2, HORIZON_Y + 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(230,184,69,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, HORIZON_Y - th); ctx.lineTo(tx, HORIZON_Y + 2); ctx.stroke();
  }
  ctx.restore();
}

/**
 * The NISHAN SAHIB — the Sikh standard that stands at every Gurdwara: a saffron
 * flag bearing the Khanda, on a mast wrapped in saffron cloth. Drawn last and
 * tallest so nothing in the scene rises above it.
 */
function drawNishanSahib(ctx, t, x, footY, h) {
  ctx.save();
  const topY = footY - h;
  // Everything scales off `h`, so the standard stays proportioned wherever it
  // stands. (It used to hardcode a 74px flag sized for one particular mast.)
  const mw = Math.max(1.6, h * 0.026);            // mast half-width

  // cloth-wrapped mast (chola)
  const cloth = ctx.createLinearGradient(x - mw, 0, x + mw, 0);
  cloth.addColorStop(0, "#b4610f"); cloth.addColorStop(0.45, "#ff9d2e"); cloth.addColorStop(1, "#8a4a0c");
  ctx.fillStyle = cloth;
  ctx.fillRect(x - mw, topY, mw * 2, h);
  ctx.strokeStyle = "rgba(90,45,8,0.5)"; ctx.lineWidth = Math.max(0.4, h * 0.0034);
  for (let y = topY + h * 0.034; y < footY; y += h * 0.055) {
    ctx.beginPath(); ctx.moveTo(x - mw, y); ctx.lineTo(x + mw, y + h * 0.013); ctx.stroke();
  }
  // khanda finial atop the mast
  ctx.fillStyle = "#e6b845";
  ctx.beginPath(); ctx.arc(x, topY - h * 0.017, mw, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - mw * 0.27, topY - h * 0.051, mw * 0.54, h * 0.034);

  // the flag — triangular, saffron, rippling
  const fw = h * 0.31, fh = h * 0.17, fy = topY + h * 0.034;
  const wave = (u) => Math.sin(t * 2.2 + u * 3.4) * (h * 0.015) * u;  // slack grows toward the fly
  ctx.beginPath();
  ctx.moveTo(x, fy);
  for (let i = 0; i <= 10; i++) { const u = i / 10; ctx.lineTo(x + fw * u, fy + wave(u)); }
  for (let i = 10; i >= 0; i--) {
    const u = i / 10;
    ctx.lineTo(x + fw * u, fy + fh * (1 - u * 0.62) + wave(u));
  }
  ctx.closePath();
  const flag = ctx.createLinearGradient(x, fy, x + fw, fy + fh);
  flag.addColorStop(0, "#ff9d2e"); flag.addColorStop(1, "#d86d0e");
  ctx.fillStyle = flag; ctx.fill();
  ctx.strokeStyle = "rgba(120,58,6,0.6)"; ctx.lineWidth = 1; ctx.stroke();

  // the KHANDA on the flag: double-edged blade, chakkar, two crossed kirpans
  const er = h * 0.030;                       // emblem radius, proportional to the mast
  const ex = x + fw * 0.36, ey = fy + fh * 0.42 + wave(0.36);
  ctx.strokeStyle = "#3a1d05"; ctx.fillStyle = "#3a1d05";
  ctx.lineWidth = Math.max(0.5, er * 0.23); ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2); ctx.stroke();          // chakkar
  for (const sx of [-1, 1]) {                                                  // crossed kirpans
    ctx.beginPath();
    ctx.arc(ex, ey + er * 0.14, er * 1.5, sx > 0 ? -0.5 : Math.PI + 0.5,
            sx > 0 ? 1.5 : Math.PI - 1.5, sx < 0);
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(0.7, er * 0.31);                                    // the khanda itself
  ctx.beginPath(); ctx.moveTo(ex, ey - er * 1.57); ctx.lineTo(ex, ey + er * 1.14); ctx.stroke();
  ctx.beginPath(); ctx.arc(ex, ey + er * 1.21, er * 0.29, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawBackground(ctx, t, beatHit) {
  const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  g.addColorStop(0, "#3a2410"); g.addColorStop(0.55, "#20130a"); g.addColorStop(1, "#0d0803");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.fillStyle = "rgba(255,157,46,0.18)";
  ctx.beginPath(); ctx.arc(CANVAS_W / 2, 150, 90, 0, Math.PI * 2); ctx.fill();

  drawRampart(ctx, t);
  drawChhaoniTents(ctx, t);

  // Camp ground between the rampart and the akhara floor.
  const camp = ctx.createLinearGradient(0, HORIZON_Y, 0, GROUND_Y);
  camp.addColorStop(0, "#3b2712"); camp.addColorStop(1, "#241608");
  ctx.fillStyle = camp;
  ctx.fillRect(0, HORIZON_Y, CANVAS_W, GROUND_Y - HORIZON_Y);

  drawShastarRack(ctx, t);
  drawRanjitNagara(ctx, t, beatHit);

  // Dawn haze — pushes the whole camp back so it never out-shouts the fighters.
  const haze = ctx.createLinearGradient(0, 200, 0, GROUND_Y);
  haze.addColorStop(0, "rgba(58,36,16,0.06)");
  haze.addColorStop(1, "rgba(58,36,16,0.30)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 200, CANVAS_W, GROUND_Y - 200);
  // The standard stands on the camp ground, planted clear of both the drum and
  // the rack. A Nihang chhaoni without a Nishan Sahib is not a chhaoni.
  drawNishanSahib(ctx, t, 452, HORIZON_Y + 6, 168);

  ctx.fillStyle = "#2a1a0c"; ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
  ctx.strokeStyle = "rgba(230,184,69,0.35)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(CANVAS_W, GROUND_Y); ctx.stroke();

  for (let i = 0; i < 6; i++) {
    const x = 80 + i * 145;
    const sway = Math.sin(t * 1.5 + i) * 6;
    ctx.fillStyle = i % 2 ? "#ff9d2e" : "#e6b845";
    ctx.beginPath();
    ctx.moveTo(x, 40); ctx.lineTo(x + 22, 40); ctx.lineTo(x + 11 + sway, 66);
    ctx.closePath(); ctx.fill();
  }
}

/* ============================================================================
 * SECTION 12 — GAME: state machine + main loop
 * ==========================================================================*/

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.input = new InputManager();
    this.particles = new ParticleSystem();
    this.projectiles = [];           // active Chakrams
    this.floaters = [];              // floating damage / outcome text
    this.bolts = [];                 // BIJLI: lightning called down by a Purba
    this.boltFlash = 0;              // the sky lighting up, briefly
    this.shake = 0;                  // screen-shake magnitude (decays)

    this.state = STATE.MAIN_MENU;    // <-- the master FSM variable
    this.time = 0;
    this.acc = 0;
    this.last = performance.now();

    this.playerWeaponId = "kirpan";
    this.roundNumber = 1;
    this.playerWins = 0;
    this.enemyWins = 0;

    this.player = null;
    this.enemy = null;

    // Title-screen showcase. A REAL Fighter, not bespoke menu art: Akaal gets
    // the same Pentra sway, weapon momentum and Amrit-Dhāra glow he has in a
    // match, so the menu can never drift out of sync with the game's own look.
    this.showcase = null;
    this._showcaseFoe = { x: 0 };   // stand-in opponent: only its x is read, for facing

    this.bannerT = 0;
    this.freezeT = 0;                // brief hit-stop on impactful hits

    this.scale = 1;                  // design units → backing-store pixels

    this._cacheDom();
    this._bindUI();
    this._bindMenuKeys();
    this._bindAudio();
    this._bindTpadToggle();
    this._bindPauseBtn();
    this._armShowcase();
    this._syncOverlays();
    this._resize();
    window.addEventListener("resize", () => this._resize());
    window.addEventListener("orientationchange", () => this._resize());
    requestAnimationFrame(this._frame.bind(this));
  }

  /**
   * Match the canvas BACKING STORE to the size it is actually displayed at, times
   * the device pixel ratio, then scale the context so every game maths stays in
   * the 900×500 design space (CANVAS_W/CANVAS_H, GROUND_Y, every hitbox).
   *
   * Without this the canvas always rendered 900×500 and the browser upscaled it:
   * soft on any HiDPI screen, and softer the larger the frame gets. With it, the
   * frame can grow to any size and stay pin-sharp — the art is all vector paths,
   * so there is nothing to lose by rasterising it bigger.
   *
   * Nothing else in the engine needs to know: `_render` re-applies the transform
   * each frame, so gameplay code keeps thinking the canvas is 900×500.
   */
  _resize() {
    const c = this.canvas;
    // Fall back to the design size if the canvas has not been laid out yet.
    const rect = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
    const cssW = (rect && rect.width)  || CANVAS_W;
    const cssH = (rect && rect.height) || CANVAS_H;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.scale = w / CANVAS_W;
  }

  /* ---- DOM overlay wiring --------------------------------------------- */

  _cacheDom() {
    this.dom = {
      menuMain:   document.getElementById("menu-main"),
      menuSelect: document.getElementById("menu-select"),
      menuRound:  document.getElementById("menu-round"),
      menuOver:   document.getElementById("menu-over"),
      weaponGrid: document.getElementById("weapon-grid"),
      selectPortrait: document.getElementById("select-portrait"),
      roundTitle: document.getElementById("round-title"),
      roundSub:   document.getElementById("round-sub"),
      overTitle:  document.getElementById("over-title"),
      overSub:    document.getElementById("over-sub"),
      touch:      document.getElementById("touch"),
      shastarSpec: document.getElementById("shastar-spec"),
      mute:        document.getElementById("mute"),
      tpadToggle:  document.getElementById("tpad-toggle"),
      pauseBtn:    document.getElementById("pause-btn"),
      menuPause:   document.getElementById("menu-pause"),
      guideBody:   document.getElementById("guide-body"),
      pauseGuide:  document.getElementById("pause-guide"),
      menuGuide:   document.getElementById("menu-guide"),
    };
  }

  _bindUI() {
    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => this._onAction(btn.dataset.action));
    });
    this._buildWeaponCards();
    this._buildControlGuide();
    this._bindTouch();
  }

  /**
   * TOUCH CONTROLS. Each on-screen key feeds InputManager.press/release with the
   * SAME key name the keyboard emits, so `Player.handleInput` is untouched and
   * every combat rule stays identical across input methods.
   *
   * Uses Pointer Events, so it also covers stylus and touch-screen laptops.
   * `setPointerCapture` matters: without it, sliding a thumb off a button never
   * fires pointerup and the key would stick down forever.
   */
  _bindTouch() {
    const root = this.dom.touch;
    if (!root) return;
    // Show the pad on anything that can actually be tapped. `(pointer: coarse)`
    // alone misses touchscreen laptops — they report a FINE primary pointer but
    // still take taps — so also trust a reported digitiser. And set
    // `window.__GATKA_TOUCH__ = true` in the console to force it on: without that
    // there is no way to even look at these controls on a desktop.
    this._isTouch = !!window.__GATKA_TOUCH__ ||
      !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);

    root.querySelectorAll("[data-key]").forEach((btn) => {
      const key = btn.dataset.key;
      const down = (e) => {
        e.preventDefault();
        if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
        this.input.press(key); btn.classList.add("on");
      };
      const up = (e) => {
        e.preventDefault();
        this.input.release(key); btn.classList.remove("on");
      };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      // Belt and braces: if the pointer is lost some other way, don't stick.
      btn.addEventListener("lostpointercapture", up);
    });
  }

  _onAction(action) {
    switch (action) {
      case "show-guide":  this._transition(STATE.GUIDE); break;
      case "goto-select":
        this._transition(STATE.CHARACTER_SELECT);
        this._drawSelectPortrait(); this._renderShastarSpec();
        break;
      case "start-match": this._startMatch(); break;
      case "resume":      this._pause(false); break;
      case "rematch":     this._startMatch(); break;
      case "to-menu":     this._transition(STATE.MAIN_MENU); break;
    }
  }

  /**
   * Render the control guide into every slot that wants it. Same markup, same
   * source, two screens — nothing to keep in sync by hand.
   */
  _buildControlGuide() {
    const html = buildGuide().map((g) => {
      if (g.group) return '<div class="grp">' + g.group + "</div>";
      const keys = g.keys.map((k) => "<kbd>" + k + "</kbd>").join("");
      return '<div class="gk">' + keys + "</div>" +
             '<div class="gn' + (g.hi ? " hi" : "") + '">' + g.name + "</div>" +
             '<div class="gd">' + g.d + "</div>";
    }).join("");
    for (const el of [this.dom.guideBody, this.dom.pauseGuide]) {
      if (el) el.innerHTML = html;
    }
  }

  _buildWeaponCards() {
    const grid = this.dom.weaponGrid;
    grid.innerHTML = "";
    Object.values(WEAPONS).forEach((wpn) => {
      const card = document.createElement("div");
      card.className = "weapon-card" + (wpn.id === this.playerWeaponId ? " selected" : "");
      card.dataset.weapon = wpn.id;

      const icon = document.createElement("canvas");
      icon.width = 150; icon.height = 70;
      this._drawWeaponIcon(icon.getContext("2d"), wpn);

      card.appendChild(icon);
      card.insertAdjacentHTML("beforeend", `
        <h3>${wpn.name}</h3>
        <div class="wclass">${wpn.class}</div>
        <div class="flavor">${wpn.flavor}</div>
        ${this._statBar("DAMAGE", wpn.bars.damage)}
        ${this._statBar("RANGE",  wpn.bars.range)}
        ${this._statBar("SPEED",  wpn.bars.speed)}
      `);

      card.addEventListener("click", () => this._selectWeapon(wpn.id));
      grid.appendChild(card);
    });
  }

  /** Select a weapon by id and sync the card highlight (used by mouse + keys). */
  _selectWeapon(id) {
    this.playerWeaponId = id;
    this.dom.weaponGrid.querySelectorAll(".weapon-card").forEach((c) =>
      c.classList.toggle("selected", c.dataset.weapon === id));
    this._drawSelectPortrait();
    this._renderShastarSpec();
    this._armShowcase();   // so backing out to the title shows the weapon you picked
  }

  /**
   * Render the large Character-Select portrait for the currently-selected
   * weapon. INTERIM: draws a framed head-and-shoulders view of Akaal using the
   * existing warrior art. This is the slot the detailed portrait badge (from
   * the reference SVG) will render into — swap the inner drawing, keep the frame.
   */
  _drawSelectPortrait() {
    const c = this.dom.selectPortrait;
    if (!c) return;
    const p = c.getContext("2d");
    const W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = W / 2 - 4;
    p.clearRect(0, 0, W, H);

    // deep-neela backdrop disc
    const bg = p.createRadialGradient(cx, cy - 20, 20, cx, cy, R);
    bg.addColorStop(0, "#17264a"); bg.addColorStop(1, "#0b1322");
    p.fillStyle = bg;
    p.beginPath(); p.arc(cx, cy, R, 0, Math.PI * 2); p.fill();

    // clip to the disc and draw a large head-and-shoulders warrior
    p.save();
    p.beginPath(); p.arc(cx, cy, R - 3, 0, Math.PI * 2); p.clip();
    const f = new Player({
      name: "Akaal", weapon: WEAPONS[this.playerWeaponId],
      colors: AKAAL_COLORS, facing: 1, x: cx,
    });
    f.height = H * 1.25;         // zoom so head + shoulders fill the frame
    f.y = H * 1.5;               // feet below the disc (body clipped away)
    f.action = ACT.IDLE; f.animT = 0;
    Artist.drawWarrior(p, f, -0.5, 0);
    p.restore();

    // gold + navy framing rings (echoes the badge)
    p.strokeStyle = "#e6b845"; p.lineWidth = 3;
    p.beginPath(); p.arc(cx, cy, R - 2, 0, Math.PI * 2); p.stroke();
    p.strokeStyle = "#0A2F64"; p.lineWidth = 5;
    p.beginPath(); p.arc(cx, cy, R - 7, 0, Math.PI * 2); p.stroke();

    // weapon name caption
    p.fillStyle = "#ffd479"; p.font = "16px Cinzel, serif"; p.textAlign = "center";
    p.fillText(WEAPONS[this.playerWeaponId].name, cx, H - 12);
    p.textAlign = "left";
  }

  /* ---- KEYBOARD CONTROL FOR MENUS ------------------------------------- */
  /**
   * The gameplay input is polled from InputManager; the DOM menus, however, are
   * click-driven. This adds keyboard parity so a player never needs the mouse:
   *   Enter / Space → confirm the primary action of the current screen
   *   ← / →         → cycle the weapon on the select screen
   *   Esc           → step back (select → menu, game-over → menu)
   * Gameplay/round-over screens are left to their own systems.
   */
  _bindMenuKeys() {
    window.addEventListener("keydown", (e) => this._onMenuKey(e));
  }

  /**
   * Audio cannot start until the user has interacted — every browser blocks it —
   * so arm on ANY first gesture. `Sfx.arm()` is idempotent and also resumes a
   * context the browser suspended when the tab lost focus.
   */
  _bindAudio() {
    const arm = () => Sfx.arm();
    window.addEventListener("keydown", arm);
    window.addEventListener("pointerdown", arm);
    const btn = this.dom.mute;
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      Sfx.arm();
      Sfx.setEnabled(!Sfx.enabled);
      btn.textContent = Sfx.enabled ? SPK_ON : SPK_OFF;
      btn.setAttribute("aria-pressed", String(!Sfx.enabled));
    });
  }

  /**
   * Force the on-screen controls on, anywhere.
   *
   * They auto-detect a phone correctly, but that means on a desktop they are
   * invisible and unprovable — which reads exactly like they were never built.
   * This makes them something you can see, press and judge on any machine, and
   * it doubles as a real preference (touchscreen monitors, or simply preferring
   * to tap). The pad still only draws during a ROUND; the menus are already
   * tappable on their own.
   */
  _bindPauseBtn() {
    const btn = this.dom.pauseBtn;
    if (!btn) return;
    btn.addEventListener("click", (e) => { e.stopPropagation(); this._pause(true); });
  }

  _bindTpadToggle() {
    const btn = this.dom.tpadToggle;
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.__GATKA_TOUCH__ = !window.__GATKA_TOUCH__;
      const on = !!window.__GATKA_TOUCH__;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
      this._syncOverlays();
    });
  }

  _onMenuKey(e) {
    // PAUSE is the one key that has to work mid-fight, so it is handled before
    // the gameplay guard below.
    const pk = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (pk === "Escape" || pk === "p") {
      if (this.state === STATE.GAMEPLAY) { this._pause(true);  e.preventDefault(); return; }
      if (this.state === STATE.PAUSED)   { this._pause(false); e.preventDefault(); return; }
    }
    // Only the menu states react; gameplay & the auto-advancing round banner don't.
    if (this.state === STATE.GAMEPLAY || this.state === STATE.ROUND_OVER) return;

    const confirm = e.key === "Enter" || e.key === " ";
    // If a real <button> is focused, let the browser's native activation handle
    // Enter/Space so we don't fire the action twice.
    const onButton = e.target && e.target.tagName === "BUTTON";

    if (confirm && !onButton) {
      if (this.state === STATE.MAIN_MENU)             this._onAction("goto-select");
      else if (this.state === STATE.CHARACTER_SELECT) this._onAction("start-match");
      else if (this.state === STATE.GAME_OVER)        this._onAction("rematch");
      e.preventDefault();
      return;
    }

    // A/D cycle the cards as well as ←/→, so the hand that will drive the
    // Pentra in a moment is already in position.
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const back = (k === "ArrowLeft" || k === "a"), fwd = (k === "ArrowRight" || k === "d");
    if (this.state === STATE.CHARACTER_SELECT && (back || fwd)) {
      const ids = Object.keys(WEAPONS);
      let i = ids.indexOf(this.playerWeaponId);
      i = (i + (fwd ? 1 : -1) + ids.length) % ids.length;
      this._selectWeapon(ids[i]);
      e.preventDefault();
      return;
    }

    if (e.key === "Escape") {
      if (this.state === STATE.CHARACTER_SELECT) this._transition(STATE.MAIN_MENU);
      else if (this.state === STATE.GUIDE)       this._transition(STATE.MAIN_MENU);
      else if (this.state === STATE.GAME_OVER)   this._onAction("to-menu");
    }
  }

  _statBar(label, frac) {
    return `<div class="stat">${label}
      <div class="bar"><div class="fill" style="width:${Math.round(frac * 100)}%"></div></div>
    </div>`;
  }

  _drawWeaponIcon(ctx, wpn) {
    ctx.clearRect(0, 0, 150, 70);
    const fakeF = { weapon: wpn };
    ctx.save();
    ctx.translate(18, 40);
    Artist.drawWeapon(ctx, 0, 0, -0.3, fakeF);
    ctx.restore();
  }

  /* ---- STATE TRANSITIONS ---------------------------------------------- */

  _transition(next) { this.state = next; this._syncOverlays(); }

  _syncOverlays() {
    const s = this.state;
    this.dom.menuMain.classList.toggle("hidden",   s !== STATE.MAIN_MENU);
    this.dom.menuSelect.classList.toggle("hidden", s !== STATE.CHARACTER_SELECT);
    if (this.dom.menuGuide) this.dom.menuGuide.classList.toggle("hidden", s !== STATE.GUIDE);
    this.dom.menuRound.classList.toggle("hidden",  s !== STATE.ROUND_OVER);
    this.dom.menuOver.classList.toggle("hidden",   s !== STATE.GAME_OVER);
    if (this.dom.menuPause) this.dom.menuPause.classList.toggle("hidden", s !== STATE.PAUSED);
    // The pause button only exists while there is something to pause.
    if (this.dom.pauseBtn) {
      this.dom.pauseBtn.classList.toggle("hidden", s !== STATE.GAMEPLAY);
    }
    // Touch pad only exists on coarse pointers, and only during a live round —
    // the menus are already tappable on their own.
    if (this.dom.touch) {
      // Re-check the force flag here, so toggling __GATKA_TOUCH__ in the console
      // takes effect on the next screen rather than needing a reload.
      const touch = this._isTouch || !!window.__GATKA_TOUCH__;
      this.dom.touch.classList.toggle("hidden", !touch || s !== STATE.GAMEPLAY);
    }
  }

  /**
   * Fill the Character-Select spec panel from the WEAPONS table. All of this was
   * already recorded and none of it was ever on screen: the authentic length and
   * its hilt/blade split, the weight, the discipline, the Pentra tempo.
   * Rows are skipped when a weapon has no figure, rather than inventing one —
   * the Khanda has no verified weight yet.
   */
  _renderShastarSpec() {
    const el = this.dom.shastarSpec;
    if (!el) return;
    const w = WEAPONS[this.playerWeaponId];
    const rows = [["Discipline", w.class]];
    if (w.lengthInches) {
      rows.push(["Length", w.hiltInches && w.bladeInches
        ? w.lengthInches + " in — hilt " + w.hiltInches + " + blade " + w.bladeInches
        : w.lengthInches + " in"]);
    }
    if (w.weightGrams) rows.push(["Weight", w.weightGrams + " g"]);
    rows.push(["Tempo", Math.round(60 / w.beat) + " BPM"]);
    rows.push(["Guard", MOVES[w.id].guard.name]);
    el.innerHTML = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  }

  /**
   * Build (or re-arm) the title-screen Akaal, wielding whatever weapon is
   * currently picked — so backing out of Character Select shows your choice.
   * He stands on the akhara's right, facing the title copy on the left.
   */
  _armShowcase() {
    this.showcase = new Fighter({
      name: "Akaal", weapon: WEAPONS[this.playerWeaponId], facing: -1,
      x: CANVAS_W * 0.74, colors: AKAAL_COLORS,
    });
  }

  /**
   * Freeze or resume the round. Until now GAMEPLAY had no exit at all: no pause,
   * no quit, on any input — once a round started you were locked in until someone
   * was KO'd, and on a phone there was not even an Esc key to reach for.
   */
  _pause(on) {
    if (on && this.state !== STATE.GAMEPLAY) return;
    if (!on && this.state !== STATE.PAUSED) return;
    if (on) {
      // Drop every held key. You will let go of the keys WHILE paused, and a
      // guard held at the moment of pausing would otherwise still be held on
      // resume — you would come back mid-block, or walking into a wall.
      this.input.held.clear();
      this.input.pressed.clear();
    }
    this._transition(on ? STATE.PAUSED : STATE.GAMEPLAY);
  }

  /* ---- MATCH / ROUND LIFECYCLE ---------------------------------------- */

  _startMatch() {
    this.roundNumber = 1; this.playerWins = 0; this.enemyWins = 0;
    this._spawnFighters();
    this._transition(STATE.GAMEPLAY);
  }

  _spawnFighters() {
    const pWeapon = WEAPONS[this.playerWeaponId];
    // Enemy takes a different weapon for variety (cycles to the next one).
    const ids = Object.keys(WEAPONS);
    const eId = ids[(ids.indexOf(this.playerWeaponId) + 1) % ids.length];

    this.player = new Player({
      name: "Akaal", weapon: pWeapon, facing: 1, x: 250, colors: AKAAL_COLORS,
    });
    this.enemy = new Enemy({
      name: "Vairi", weapon: WEAPONS[eId], facing: -1, x: 650,
      colors: { robe: "#6d2b2b", cloth: "#451919", sash: "#d9c27a", hajooria: "#caa24a",
                turban: "#3a3f4a", skin: "#b87a44", beard: "#1a1206" },
    });
    this.particles.clear();
    this.projectiles.length = 0;
    this.floaters.length = 0; this.bolts.length = 0; this.boltFlash = 0; this.shake = 0;
  }

  _startNextRound() {
    this.roundNumber++;
    this.player.resetForRound(250, 1);
    this.enemy.resetForRound(650, -1);
    this.particles.clear();
    this.projectiles.length = 0;
    this.floaters.length = 0; this.bolts.length = 0; this.boltFlash = 0; this.shake = 0;
    this._transition(STATE.GAMEPLAY);
  }

  _endRound(playerWon) {
    if (playerWon) this.playerWins++; else this.enemyWins++;

    if (this.playerWins >= ROUNDS_TO_WIN || this.enemyWins >= ROUNDS_TO_WIN) {
      const win = this.playerWins >= ROUNDS_TO_WIN;
      this.dom.overTitle.textContent = win ? "FATEH!" : "DEFEAT";
      this.dom.overSub.textContent = win
        ? "Waheguru Ji Ki Fateh — the match is yours."
        : "You have fallen. Rise and fight again.";
      this._transition(STATE.GAME_OVER);
      return;
    }
    this.dom.roundTitle.textContent = playerWon ? "ROUND WON" : "ROUND LOST";
    this.dom.roundSub.textContent = playerWon ? "Chardi Kala!" : "Steady yourself…";
    this.bannerT = 2.2;
    this._transition(STATE.ROUND_OVER);
  }

  /* ---- FIXED-TIMESTEP MAIN LOOP --------------------------------------- */

  _frame(now) {
    let frameTime = (now - this.last) / 1000;
    this.last = now;
    if (frameTime > 0.25) frameTime = 0.25;
    this.time += frameTime;

    if (this.freezeT > 0) {
      this.freezeT -= frameTime;   // hit-stop: pause sim but keep rendering
    } else {
      this.acc += frameTime;
      while (this.acc >= FIXED_DT) {
        this._update(FIXED_DT);
        // Clear the rising-edge set HERE — the instant a sim step has actually
        // POLLED it — and never once per rAF.
        //
        // This used to sit next to _render(), which meant every frame wiped
        // `pressed` whether or not a fixed step had consumed it. At 60Hz the
        // accumulator happens to run ~one step per frame and it went unnoticed;
        // above 60Hz most frames run ZERO steps, so most taps died unheard:
        // 59% dropped at 144Hz, 64% at 165Hz. Hit-stop was worse — it skips the
        // sim entirely, so 100% of taps vanished in the exact window you most
        // want to answer a blow.
        //
        // Leaving it inside the loop also buys real input BUFFERING for free:
        // a tap during hit-stop now survives and fires on the next step.
        this.input.endFrame();
        this.acc -= FIXED_DT;
      }
    }

    this._render();
    requestAnimationFrame(this._frame.bind(this));
  }

  /* ---- SIMULATION STEP (state-dependent) ------------------------------ */

  _update(dt) {
    if (this.state === STATE.PAUSED) return;   // frozen: nothing ticks, not even FX
    switch (this.state) {
      case STATE.GAMEPLAY:   this._updateGameplay(dt); break;
      case STATE.ROUND_OVER: this._updateBanner(dt);   break;
      case STATE.MAIN_MENU:
      case STATE.GUIDE:      this._updateShowcase(dt); break;
    }
    this.particles.update(dt);
    // Floating damage/outcome text drifts up and fades.
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y += f.vy * dt; f.vy += 70 * dt; f.life -= dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].life -= dt;
      if (this.bolts[i].life <= 0) this.bolts.splice(i, 1);
    }
    if (this.boltFlash > 0) this.boltFlash = Math.max(0, this.boltFlash - dt * 9);
    this.shake = this.shake > 0.2 ? this.shake * 0.85 : 0;   // shake decays
  }

  _updateBanner(dt) {
    this.bannerT -= dt;
    if (this.bannerT <= 0) this._startNextRound();
  }

  /** Idle the title-screen Akaal. The stand-in foe only supplies a facing. */
  _updateShowcase(dt) {
    const s = this.showcase;
    if (!s) return;
    this._showcaseFoe.x = s.x - 200;   // always to his left → he faces the copy
    s.update(dt, this._showcaseFoe);
    if (s.beatFired) { s.beatFired = false; Sfx.nagara(); }   // the camp drums on the title screen too
  }

  _updateGameplay(dt) {
    const p = this.player, e = this.enemy;

    // The nagara marks the Pentra beat the fight runs on. Only the player's clock
    // drives it: one camp, one tempo — and it is the tempo of the shastar you chose.
    if (p.beatFired) { p.beatFired = false; Sfx.nagara(); }
    e.beatFired = false;

    // 1) Gather intents.
    p.handleInput(this.input, dt);
    e.think_ai(dt, p);

    // 2) Advance both bodies.
    p.update(dt, e);
    e.update(dt, p);

    // 3) Spawn any Chakrams requested this frame.
    this._spawnPendingChakrams(p);
    this._spawnPendingChakrams(e);

    // BIJLI: a Purba just went live — bring the sky down on where it lands.
    for (const f of [p, e]) {
      if (!f.boltPending) continue;
      f.boltPending = false;
      const hb = f.getAttackHitbox();
      const bx = hb ? hb.x + hb.w * (f.facing > 0 ? 0.78 : 0.22) : f.x + f.facing * 60;
      this._spawnBolt(bx, hb ? hb.y + hb.h * 0.7 : f.y - f.height * 0.4);
    }

    // 4) Separate overlapping bodies.
    this._separateBodies(p, e);

    // 5) COMBAT: melee hitbox vs body.
    this._resolveAttack(p, e);
    this._resolveAttack(e, p);

    // 6) Ultimate AoE pulses.
    this._resolveUlt(p, e);
    this._resolveUlt(e, p);

    // 7) Projectiles.
    this._updateProjectiles(dt);

    // 8) Win check.
    if (!p.alive && this.state === STATE.GAMEPLAY) this._endRound(false);
    else if (!e.alive && this.state === STATE.GAMEPLAY) this._endRound(true);
  }

  /** Turn a fighter's `pendingChakram` flag into three real discs. */
  _spawnPendingChakrams(f) {
    if (!f.pendingChakram) return;
    f.pendingChakram = false;
    Sfx.chakram();
    const dir = f.facing;
    const frontX = f.x + dir * (f.width / 2 + 6);
    const top = f.y - f.height;
    // One disc per vector so the fan mixes up the defender's blocking.
    const lanes = [
      { v: VECTOR.HIGH, y: top + f.height * 0.18 },
      { v: VECTOR.MID,  y: top + f.height * 0.48 },
      { v: VECTOR.LOW,  y: top + f.height * 0.78 },
    ];
    for (const lane of lanes) {
      this.projectiles.push(new Projectile(f, frontX, lane.y, dir * CHAKRAM.speed, lane.v));
    }
  }

  _separateBodies(a, b) {
    const ba = a.getBodyBox(), bb = b.getBodyBox();
    if (aabbIntersect(ba, bb)) {
      const push = overlapX(ba, bb) / 2 + 0.5;
      const dir = a.x < b.x ? -1 : 1;
      a.x = clamp(a.x + dir * push, 40, CANVAS_W - 40);
      b.x = clamp(b.x - dir * push, 40, CANVAS_W - 40);
    }
  }

  _resolveAttack(attacker, defender) {
    const hb = attacker.getAttackHitbox();
    if (!hb) return;
    const move = attacker.curMove;
    const maxHits = (move && move.hits) || 1;       // multi-hit (Chakkar) / two-way (Do-Dhari)
    if (attacker.hitCount >= maxHits) return;
    if (move && move.hitEvery && attacker.hitTimer > 0) return;   // re-hit cooldown

    if (aabbIntersect(hb, defender.getBodyBox())) {
      attacker.hitCount++;
      if (move && move.hitEvery) attacker.hitTimer = move.hitEvery;
      const hpBefore = defender.hp;
      const outcome = defender.receiveHit(attacker, hb);
      const dealt = Math.round(hpBefore - defender.hp);
      const contactX = attacker.facing > 0
        ? defender.x - defender.width / 2 : defender.x + defender.width / 2;
      const contactY = hb.y + hb.h / 2;
      this._impactFx(outcome, contactX, contactY);
      this._hitFeedback(outcome, dealt, contactX, contactY, attacker.onBeat);
      // On-beat landing → combo cancel + FLOW; off-beat landing breaks FLOW.
      if (attacker.onBeat && (outcome === "hit" || outcome === "block" || outcome === "guardbreak")) {
        attacker.canCancel = true;
        attacker.gainFlow();
      } else if (outcome === "hit" || outcome === "guardbreak" || outcome === "evade") {
        attacker.breakFlow();   // being read and stepped beats being on the beat
      }
    }
  }

  /** Floating damage numbers, outcome text, and screen shake — the "it hit!" read. */
  _hitFeedback(outcome, dealt, x, y, onBeat) {
    if (outcome === "hit" || outcome === "guardbreak") {
      const big = outcome === "guardbreak";
      if (dealt > 0) this._spawnFloater(x, y - 22, "-" + dealt, big ? "#ff9d2e" : "#ffd479", big ? 25 : 19);
      if (big) this._spawnFloater(x, y - 44, "BREAK!", "#ff9d2e", 17);
      // DRAMA SCALES WITH THE BLOW. Hitstop and shake used to be flat, so a
      // 6-damage Chakkar tick stopped the world exactly as hard as a 21-damage
      // Purba — which drains the weight out of both. `power` is the damage
      // measured against a heavy hit, so a tick barely registers and a full Purba
      // lands like the thing it is named for.
      const power = clamp(dealt / 22, 0.30, 1.7);
      this.shake = Math.max(this.shake, (big ? 15 : 9) * power);
      this.freezeT = Math.max(this.freezeT, (big ? 0.14 : 0.10) * power);
    } else if (outcome === "parry")   this._spawnFloater(x, y - 22, "PARRY!", "#fff4d6", 18);
    else if (outcome === "reflect")   this._spawnFloater(x, y - 22, "REFLECT!", "#8fe3ff", 16);
    else if (outcome === "block")     this._spawnFloater(x, y - 16, "block", "#aeb8c4", 12);
    else if (outcome === "evade")     this._spawnFloater(x, y - 24, "EVADE!", "#7be0a6", 17);
    if (onBeat && (outcome === "hit" || outcome === "block" || outcome === "guardbreak")) {
      this.particles.burst(x, y, 10, "#ffd479");   // on-beat flourish
      this.freezeT += 0.03;
    }
  }

  /**
   * BIJLI — call the sky down onto (x, y).
   *
   * The bolt is generated ONCE and stored, never re-randomised per frame: a
   * lightning bolt that re-rolls every frame reads as static, not as a strike.
   * It hangs for a moment and fades, the way the after-image does.
   */
  _spawnBolt(x, y) {
    const pts = [];
    const segs = 10;
    const drift = rand(-40, 40);                 // where it starts up in the cloud
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // eases from a wandering origin onto the strike point — it is AIMED
      const px = lerp(x + drift, x, t * t) + (i > 0 && i < segs ? rand(-15, 15) : 0);
      pts.push([px, t * y]);
    }
    const forks = [];
    for (let f = 0; f < 2; f++) {
      const i = Math.floor(rand(3, segs - 2));
      let [fx, fy] = pts[i];
      const fp = [[fx, fy]];
      for (let k = 0; k < 3; k++) { fx += rand(-24, 24); fy += rand(9, 22); fp.push([fx, fy]); }
      forks.push(fp);
    }
    this.bolts.push({ pts, forks, life: 0.26, max: 0.26 });
    this.boltFlash = 1;
    this.shake = Math.max(this.shake, 20);
    this.freezeT = Math.max(this.freezeT, 0.11);
    this.particles.burst(x, y, 26, "#cfe6ff");
    this.particles.burst(x, y, 12, "#ffffff");
    Sfx.thunder();
  }

  _drawBolts(ctx) {
    const line = (p) => {
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
      ctx.stroke();
    };
    for (const b of this.bolts) {
      const a = clamp(b.life / b.max, 0, 1);
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowColor = "#8fd0ff"; ctx.shadowBlur = 26;
      ctx.globalAlpha = 0.40 * a;                    // the halo
      ctx.strokeStyle = "#6fa8ff"; ctx.lineWidth = 13;
      line(b.pts);
      ctx.globalAlpha = 0.85 * a;                    // the channel
      ctx.strokeStyle = "#bcdcff"; ctx.lineWidth = 5;
      line(b.pts);
      ctx.globalAlpha = a;                           // the core
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      line(b.pts);
      ctx.globalAlpha = 0.7 * a; ctx.lineWidth = 1.5;
      for (const f of b.forks) line(f);
      ctx.restore();
    }
  }

  _spawnFloater(x, y, text, color, size) {
    this.floaters.push({ x, y, vy: -46, life: 0.85, max: 0.85, text, color, size: size || 16 });
  }

  _drawFloaters(ctx) {
    ctx.save();
    ctx.textAlign = "center";
    for (const f of this.floaters) {
      ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = "bold " + f.size + "px Cinzel, serif";
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "left";
    ctx.restore();
  }

  /** Apply a fighter's ultimate AoE when a pulse is flagged ready. */
  _resolveUlt(attacker, defender) {
    if (!attacker.ultPulseReady) return;
    attacker.ultPulseReady = false;
    const gap = Math.abs(defender.x - attacker.x);
    // burst FX around the attacker regardless
    this.particles.burst(attacker.x, attacker.y - 70, 30, "#ffd479");
    this.particles.burst(attacker.x, attacker.y - 70, 14, "#ffffff");
    this.freezeT = 0.06;
    if (gap <= ULT.radius) {
      if (defender.receiveUltPulse(attacker)) {
        this.particles.burst(defender.x, defender.y - 70, 16, "#c0392b");
      }
    }
  }

  _updateProjectiles(dt) {
    const list = this.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const proj = list[i];
      proj.update(dt);

      // Collide with whichever fighter is NOT the owner.
      const target = proj.owner === this.player ? this.enemy : this.player;
      if (!proj.dead && aabbIntersect(proj.getBox(), target.getBodyBox())) {
        const hpBefore = target.hp;
        const outcome = target.receiveProjectile(proj);
        this._impactFx(outcome, proj.x, proj.y);
        this._hitFeedback(outcome, Math.round(hpBefore - target.hp), proj.x, proj.y, false);
        proj.dead = true;
      }
      if (proj.dead) list.splice(i, 1);
    }
  }

  /** Shared feedback for any impact outcome. One hook, every sound. */
  _impactFx(outcome, x, y) {
    Sfx.impact(outcome);
    if (outcome === "parry") {
      this.particles.burst(x, y, 32, "#ffe9a8");
      this.particles.burst(x, y, 16, "#ffffff");
      this.freezeT = 0.09;
    } else if (outcome === "reflect") {
      this.particles.burst(x, y, 26, "#8fe3ff");
      this.freezeT = 0.08;
    } else if (outcome === "block") {
      this.particles.burst(x, y, 8, "#cdd6e0");
      this.freezeT = 0.04;
    } else if (outcome === "guardbreak") {
      this.particles.burst(x, y, 22, "#ff9d2e");
      this.particles.burst(x, y, 8, "#ffffff");
      this.freezeT = 0.09;
    } else if (outcome === "evade") {
      this.particles.burst(x, y, 12, "#7be0a6");
      this.freezeT = Math.max(this.freezeT, 0.035);
    } else if (outcome === "hit") {
      this.particles.burst(x, y, 16, "#c0392b");
      this.particles.burst(x, y, 6, "#ff6b52");
      this.freezeT = Math.max(this.freezeT, 0.07);
    }
  }

  /* ---- RENDER --------------------------------------------------------- */

  _render() {
    const ctx = this.ctx;
    // Re-assert the design-space transform every frame: setting canvas.width on
    // resize wipes the context state, and this is the one place that matters.
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const playing = this.player && this.enemy &&
      (this.state === STATE.GAMEPLAY || this.state === STATE.PAUSED ||
       this.state === STATE.ROUND_OVER || this.state === STATE.GAME_OVER);

    // The field shakes on impact; the HUD (drawn after) stays steady.
    ctx.save();
    if (this.shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    // The nagara is struck on the Pentra clock, so the rhythm the fight runs on
    // has a visible source. Falls back to the Kirpan's 120bpm on the menus.
    const bp = this.player ? this.player.beatPhase : (this.time % 0.5) / 0.5;
    const beatHit = clamp(1 - Math.min(bp, 1 - bp) / PENTRA.onBeatWindow, 0, 1);
    drawBackground(ctx, this.time, beatHit);

    if (playing) {
      // Pentra beat pulse: a gold ring flares at each fighter's feet on the beat.
      for (const fr of [this.player, this.enemy]) {
        const bi = clamp(1 - Math.min(fr.beatPhase, 1 - fr.beatPhase) / PENTRA.onBeatWindow, 0, 1);
        if (bi > 0.02) {
          ctx.save();
          ctx.globalAlpha = 0.35 * bi;
          ctx.strokeStyle = "#ffd479"; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(fr.x, GROUND_Y + 4, 30 + (1 - bi) * 16, 8 + (1 - bi) * 4, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      this.enemy.draw(ctx);
      this.player.draw(ctx);
      for (const proj of this.projectiles) proj.draw(ctx);
      this._drawBolts(ctx);
      this.particles.draw(ctx);
      this._drawFloaters(ctx);
    } else {
      // Title screen: Akaal stands in the akhara itself, which the menu's
      // gradient deliberately leaves visible behind him.
      if ((this.state === STATE.MAIN_MENU || this.state === STATE.GUIDE) && this.showcase) {
        this.showcase.draw(ctx);
      }
      this.particles.draw(ctx);
    }
    ctx.restore();   // end shake transform

    // The sky lighting up. Capped at 0.42 and gone in ~110ms — bright enough to
    // land, short and dim enough not to be a strobe. See the accessibility note
    // in the audit: this is the one full-screen flash in the game.
    if (playing && this.boltFlash > 0) {
      ctx.save();
      ctx.globalAlpha = this.boltFlash * 0.42;
      ctx.fillStyle = "#dfeeff";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }

    if (playing) {
      HUD.draw(ctx, this);
      // Gold screen tint whenever anyone is unleashing an ultimate.
      if (this.player.ultActive || this.enemy.ultActive) {
        ctx.save();
        ctx.fillStyle = "rgba(255,157,46,0.10)";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
      }
    }
  }
}

/* ============================================================================
 * SECTION 13 — BOOTSTRAP
 * ==========================================================================*/

window.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game");
  window.__GATKA_DEBUG__ = false;   // set true in console to see hitboxes
  window.GATKA = new Game(canvas);
});

})();
