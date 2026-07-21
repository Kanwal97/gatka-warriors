# Facial Hair Groom Spec — Akaal (next-gen 3D asset)

Technical + artistic spec for the beard and moustache of the Sikh warrior asset.

> **Scope:** this is for the **next-gen / 3D character-asset track** (strand-based
> groom), separate from the shipped 2D canvas game. Keep the two tracks distinct —
> but they now share the same facial-hair *identity*: `Artist.drawWarrior` in
> [game.js](../game.js) renders a layered **Prakash (open) beard** (three tonal
> volume layers — light rim → dark front — plus flowing strand highlights), an
> upturned **Kundal moustache**, and a **soul patch**, with an optional elder
> salt-and-pepper (`colors.beardGrey`). The 2D paths are scaled ports of the
> reference SVG; tones derive from each fighter's `colors.beard` via `shade()`.
>
> **Kesh guardrail:** the hair is **uncut and sacred** (a Kakaar). "Natural,
> uncut, no razor edges" is a doctrinal requirement, not a style option — never
> carve a shaped cheek line, fade, or trimmed neckline. See
> [../CLAUDE.md](../CLAUDE.md#cultural-authenticity--a-hard-guardrail).

---

## 1. Visual aesthetic & grooming

**Style — recommend Prakash (open) for the hero read, with a Tucked variant.**

- **Prakash / open (primary):** full, uncut beard flowing naturally from the
  cheeks to well below the jaw; maximum silhouette and motion. Best for a heroic,
  patriarchal warrior read and for showing off strand physics in combat.
- **Tucked / rolled (alt):** the beard gathered up and tucked/tied into itself or
  under the turban wrap for a neat, battle-ready profile. Ship as a **second
  groom + a blendshape/attachment state** for cutscenes or a "prepared for
  battle" beat — do not fake it by shortening the same groom.

**Volume & density**
- High-volume: target ~**28–45k render strands** (hero LOD0) interpolated from
  **~450–800 guide curves**. Density ramps: densest on the chin/jaw, thinning at
  the upper cheek and the throat.
- Multi-length regions (uncut = uneven): the mid-jaw and chin are longest; feather
  the ends with **length + noise/cut modifiers**, not a uniform trim.

**Flow map (guide direction field)** — sideburns → jaw → chin → throat:
- **Sideburns:** grow down from the temple, blending seamlessly into the cheek
  beard (no separation seam).
- **Cheeks:** sweep down-and-slightly-forward following the masseter; keep the
  upper cheek line **soft and irregular** — natural growth, never a razor edge.
- **Jawline:** hair cascades *over and past* the jaw (this is where physics lives);
  direction turns downward, gaining length.
- **Chin / under-chin:** the longest fall; add a subtle central part and a few
  **clumped locks** so it reads as strands, not a solid mass.
- **Throat/neck:** soft, wispy, thinning into the collar — no trimmed neckline.
- Add **flyaways / stray guides** (2–4%) and per-clump directional variance so it
  never looks combed or CG-clean.

**Kundala moustache (the signature)**
- Grown as a **separate groom region** from the beard so its flow reads
  independently. Dense, thick, covering the top lip.
- The tails sweep outward past the mouth corners, then **coil/curl upward** at the
  tips (waxed handlebar). Drive with a **coil/curl modifier** on stiffer guides
  and a tighter clump; keep the curl an authored, near-rigid shape (low physics
  influence — see §3) so it holds its stand-out silhouette in motion.
- Slight asymmetry between the two tips reads as hand-waxed and real.

| Region | Rel. length | Density | Physics influence |
|---|---|---|---|
| Sideburns / upper cheek | short | med | low |
| Cheek / masseter | med | high | med |
| Jaw / chin (open) | long | high | **high** |
| Under-chin / throat | med→wispy | low | med (collar-collided) |
| Moustache body | med | high | low |
| **Kundala tips** | med | med | **very low (authored curl)** |

### 1b. Turban (Dumalla) / hairline interaction

The Kesh is bound up under the Dumalla, so the groom must meet the turban wrap
cleanly:

- **Wrap-line seam:** the lowest turban wrap sits at the hairline/temple. Author a
  short **transition zone** where scalp/temple hair is tucked *under* the wrap —
  hide the root band with the turban's lowest larh so there is no hard mesh seam.
  Bind these strands to the **head bone** (they don't sim) so they stay pinned
  under the cloth.
- **Sideburns** emerge from *under* the wrap just ahead of the ear and flow into
  the cheek beard — this is the visible hair↔turban handoff; keep it dense so no
  scalp shows at the seam.
- **Volume budget:** the turban implies a large mass of bound Kesh beneath it, but
  that hair is **not rendered as strands** — bake it into the Dumalla silhouette
  (it's already voluminous). Only the temple/sideburn transition needs real
  strands. This keeps the head-hair strand budget near zero; spend it on the beard.
- **Collision:** add the Dumalla's lowest wrap as a **kinematic collider** so any
  stray temple/sideburn strands rest against the cloth, never poke through it.

---

## 2. Hair shaders & texturing

**Groom pipeline**
- Author in **XGen (Maya)** / **Ornatrix** / **Houdini** — guides + interpolation,
  **clumping** (multi-level: broad locks + fine sub-clumps), **noise**, **cut/
  length**, and a **coil** modifier for the Kundala.
- Export **Alembic groom** → **Unreal Groom asset**, bound to the skeletal head
  mesh via a **groom binding**. Ship **hair-card LODs** generated from the same
  groom for distance/perf (see LODs).

**Shading — strand-based, physically-based**
- Use Unreal's **Hair (strand) shading model** (Marschner-based, with **dual
  scattering / multiple-scattering** approximation) so the beard has real depth
  and backlit translucency — not a flat card look.
- **Multi-tonal color** (the brief's core ask):
  - Base via **melanin + redness** (eumelanin/pheomelanin) rather than a flat
    albedo — gives believable brown-black range.
  - **Root→tip gradient:** slightly darker/oilier at the root, lighter dusty tips.
  - **Per-strand hue/value variation** (randomize by strand seed) for the
    salt-and-pepper realism of a real beard — never a single value.
  - **Elder / grey option:** drive silver by a **random per-clump + per-strand
    mask** (not a painted streak) so grey emerges scattered; optionally weight the
    mask spatially (more grey at the chin/temples) and expose a **0–1 "age"
    parameter** to blend young↔elder on the same asset. A few authored **silver
    "hero" locks** at the temples/chin sell the character.
- **Specular / highlights:** the Marschner lobes give the characteristic **double
  highlight** — a sharp bright **primary (R)** band and a colored, softer
  **secondary (TRT)** band with a shifted tint, plus **TT transmission** for the
  rim/backlight glow. Tune **roughness** (longitudinal vs azimuthal) so the beard
  catches a crisp highlight along the flow direction; add slight **specular
  randomization** per strand so the highlight shimmers instead of banding.

**LODs & performance**
- **LOD0** strands (hero/close), **LOD1–2** decimated strands, **LOD2/3**
  **hair cards** (baked depth/ID/root/flow/alpha atlas), far LOD → **helmet mesh /
  baked-in normal** on the head. Author card clumps from the groom so shape
  matches.
- Budget targets (tune to platform): LOD0 ~28–45k strands; guides ~450–800;
  card LODs a few hundred cards. Strand physics guides far lower than render
  strands (see §3).

---

## 3. Dynamic physics & collisions

**Solver & guide sim**
- Simulate on the **guide curves** (Unreal groom physics / Niagara-based strand
  solver); render strands follow via interpolation. Simulate a **reduced guide
  set** (~120–250 sim guides) for cost.
- Key params: **root stiffness** (rigid at the skin), **bend/stretch stiffness**,
  **damping**, **strand radius/mass**, **gravity**, and **wind**. Roots are
  **kinematically pinned** to the head/jaw bone so the beard never detaches; only
  the lower two-thirds swings.
- **Self-collision** (or a volume/PBD constraint) to preserve loft so fast moves
  don't collapse the beard flat.

**Collision proxies (the anti-clipping cage)**
- Add dedicated **collision bodies to the character's Physics Asset**: capsules/
  spheres on the **jaw, chin, neck, clavicle, upper chest**, shaped as a smooth
  **"beard rest cage"** the strands slide across. Keep these slightly **inflated**
  (positive skin-width / penetration margin) so strands rest on the surface, not
  inside it.
- A **backstop plane/capsule at the sternum** guarantees the chin fall can never
  pass into the torso hitbox during a hard forward lean or a downward sword cleave.

**Clothing interaction — Chola collar & Hajooria**
- **Sim order:** body/anim → **cloth (collar + scarf)** → **hair collides against
  cloth colliders**. Never two-way couple hair↔cloth in real time (feedback/blow-
  up risk); instead expose the cloth as **kinematic collision proxies** to the
  hair solver.
- **Open (Prakash):** the beard **rests over the high Chola collar** and drapes
  down the chest; the collar's collider stops it clipping through.
- **Hajooria (neck scarf):** treat as a moving kinematic collider; the beard
  parts/rides over it. If the scarf is cloth-sim'd, feed its **collision proxy**
  (a simplified capsule chain), not the full mesh.
- **Tucked variant:** author the tuck as **pinned constraints / an attach socket**
  into the collar or turban wrap rather than relying on sim to hold the fold.

**Combat robustness (fast motion without clipping/explosion)**
- Increase **solver substeps** during high-velocity anims (running, slashes);
  **clamp max strand velocity** and raise **damping** transiently to prevent the
  groom exploding on a whip-fast root motion.
- Support **inertia scaling** so the beard trails believably on a dash/turn but
  snaps back under damping; keep root anchoring rigid so the base stays glued to
  the face.
- **Handle root motion / teleports:** on large frame-to-frame transforms, **reset/
  skip sim** for that frame (teleport detection) so a warp or cutscene cut doesn't
  fling the beard.
- **Length/penetration limits:** hard **max-stretch** and **penetration-depth
  clamp** as a last-resort backstop against clipping into armor.

**Physics LODs**
- Reduce sim guide count and substeps by distance; **freeze to a kinematic/animated
  pose** (or fully disable sim) at far LODs and off-screen. Kundala tips stay
  **near-authored** (very low sim influence) at all LODs so the curl never sags.

---

## Acceptance checklist

- [ ] No razor/fade/trimmed neckline anywhere; cheek line soft and irregular (Kesh).
- [ ] Sideburn→beard blend seamless; visible strand clumps + flyaways, not a mass.
- [ ] Kundala tips hold their upward curl in idle **and** during combat.
- [ ] Multi-tonal: per-strand variation + root/tip gradient; grey via scattered
      mask; `age` param blends young↔elder.
- [ ] Marschner double-highlight reads under key + rim light.
- [ ] No clipping into Chola collar, Hajooria, chest armor, or torso hitbox across
      run / dash / turn / overhead slash / hard lean.
- [ ] No explosion on fast root motion / teleport / cutscene cut.
- [ ] LOD chain strands→cards→mesh with matching silhouette; physics LOD by distance.
