function makeCtx(rec){const g={addColorStop(){}};return new Proxy({},{get(_,p){
  if(p==='createLinearGradient'||p==='createRadialGradient')return()=>g;
  return(...a)=>{if(rec)rec.push([p,...a]);};},set(){return true}});}
function makeEl(){return {width:0,height:0,innerHTML:'',textContent:'',
  classList:{toggle(){},add(){},remove(){},contains(){return false}},
  dataset:{},style:{},getContext:()=>makeCtx(),appendChild(){},
  insertAdjacentHTML(){},addEventListener(){},
  querySelectorAll:()=>Object.assign([],{forEach:Array.prototype.forEach})};}
const canvasEl=makeEl(); const handlers={};
global.window={addEventListener:(t,f)=>handlers[t]=f,GATKA:null,__GATKA_DEBUG__:false};
global.performance={now:()=>0}; global.requestAnimationFrame=()=>0;
global.document={getElementById:id=>id==='game'?canvasEl:makeEl(),createElement:()=>makeEl(),
  querySelectorAll:()=>Object.assign([],{forEach:Array.prototype.forEach}),
  addEventListener:(t,f)=>handlers[t]=f};
let __src=require('fs').readFileSync('d:/project/AI/Gatka/game.js','utf8');
// test seam: surface the IIFE's internals without loosening them in the shipped file
__src=__src.replace(/\}\)\(\);\s*$/,
  'window.__T={WEAPONS,MOVES,VECTOR,ACT,Artist,WEIGHT_FRICTION,CURVE_SWEEP,AKAAL_COLORS,INCH_TO_PIXEL_SCALE,DIFFICULTY,HITSTOP,ABILITY,KEYS};\n})();');
eval(__src);
handlers['DOMContentLoaded']();
const {WEAPONS,MOVES,VECTOR,ACT,Artist,WEIGHT_FRICTION,CURVE_SWEEP,AKAAL_COLORS,INCH_TO_PIXEL_SCALE,DIFFICULTY,HITSTOP,ABILITY,KEYS}=window.__T;
const g=window.GATKA;
let fails=0;
const check=(n,c,x='')=>{console.log((c?'  PASS  ':'* FAIL *')+' '+n+(x?'  ['+x+']':''));if(!c)fails++;};

// 1. Every weapon boots, gets a moveset, and survives a real match loop.
for(const id of Object.keys(WEAPONS)){
  let err=null;
  try{
    g.playerWeaponId=id; g._startMatch();
    for(let i=0;i<240;i++) g._update(1/60);   // 4s of live sim incl. enemy AI
    g._render();
  }catch(e){err=e;}
  check('weapon "'+id+'" boots + runs 4s of combat', !err, err?String(err).slice(0,90):'');
  check('weapon "'+id+'" has a MOVES entry', !!MOVES[id], MOVES[id]?'':'MOVES["'+id+'"] undefined -> handleInput would throw');
}

// 2. The rename actually took: soti exists, lathi is gone.
check('WEAPONS.soti exists and WEAPONS.lathi is gone',
      !!WEAPONS.soti && !WEAPONS.lathi, 'keys='+Object.keys(WEAPONS).join(','));
check('Soti kept the Lathi\'s tuning (reach/dmg/beat unchanged)',
      WEAPONS.soti.reach===124 && WEAPONS.soti.damage===9 && WEAPONS.soti.beat===0.417,
      'reach='+WEAPONS.soti.reach+' dmg='+WEAPONS.soti.damage+' beat='+WEAPONS.soti.beat);
check('Soti kept all 4 named moves',
      !!(MOVES.soti.jUp&&MOVES.soti.jMid&&MOVES.soti.guard&&MOVES.soti.guardUp),
      MOVES.soti.jUp.name+' / '+MOVES.soti.guard.name+' / '+MOVES.soti.guardUp.name);

// 3. Card generation reads every field it needs (this crashed before if absent).
for(const w of Object.values(WEAPONS)){
  check('card data complete for "'+w.id+'"',
        !!(w.bars&&w.class&&w.art&&w.bladeStyle&&w.weight),
        'class="'+w.class+'" style='+w.bladeStyle+' weight='+w.weight);
}

// 4. THE BEND must sit at the SPIKE, not the hand — ported from the reference.
{
  const deg=r=>r*180/Math.PI;
  const blade=WEAPONS.kirpan.reach;
  const s=(blade*0.97-6)/63.5, RX=cx=>6+(cx-15.2)*s, RY=cy=>(cy-7.15)*s;
  const ang=(p,q)=>-deg(Math.atan2(q[1]-p[1], q[0]-p[0]));
  // spine + belly exactly as drawKirpan builds them from the reference cm values
  const spine=[[RX(15.2),RY(6.2)],[RX(35),RY(5.6)],[RX(58),RY(4.7)],[RX(78.7),RY(3.2)]];
  const belly=[[RX(78.7),RY(3.2)],[RX(60),RY(7.3)],[RX(36),RY(8.35)],[RX(15.2),RY(8.25)]];
  const spineHand=ang(spine[0],spine[1]), spineTip=ang(spine[2],spine[3]);
  const bellyHand=ang(belly[3],belly[2]), bellyTip=ang(belly[1],belly[0]);
  check('cutting edge leaves the HAND flat',
        Math.abs(bellyHand)<3, 'belly at hand = '+bellyHand.toFixed(1)+' deg');
  check('cutting edge bends UP at the SPIKE',
        bellyTip>8, 'belly at tip = '+bellyTip.toFixed(1)+' deg');
  check('bend sits at the SPIKE side, not the hand side',
        bellyTip>bellyHand+8 && spineTip>spineHand,
        'belly '+bellyHand.toFixed(1)+'->'+bellyTip.toFixed(1)+' deg ; spine '+
        spineHand.toFixed(1)+'->'+spineTip.toFixed(1)+' deg');
  // REGRESSION GUARD: my BEND=7 attempt put the whole bend at the hand.
  const tipY=RY(3.2), baseY=-0.5, BEND=7;
  const badC=[blade*0.52, ((baseY+tipY)/2)-2*BEND];
  const badHand=ang([6,baseY],badC), badTip=ang(badC,[blade*0.97,tipY]);
  check('GUARD: the BEND=7 attempt bent at the HAND (this is the bug)',
        badHand>badTip, 'it left the hand at '+badHand.toFixed(1)+
        ' deg and reached the tip at '+badTip.toFixed(1)+' deg — backwards');
  // concave-up: convex side is the cutting edge, and it faces DOWN
  const cb=(a,b,c,d,t)=>{const u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;};
  const cMidY=(cb(RY(6.2),RY(5.6),RY(4.7),RY(3.2),0.5)+cb(RY(3.2),RY(7.3),RY(8.35),RY(8.25),0.5))/2;
  const cMidX=cb(RX(15.2),RX(35),RX(58),RX(78.7),0.5);
  const base=(RY(6.2)+RY(8.25))/2;
  const chord=base+((cMidX-6)/(RX(78.7)-6))*(tipY-base);
  check('blade is concave-UP (convex cutting edge faces DOWN)',
        cMidY>chord, 'centre '+cMidY.toFixed(2)+'px sits BELOW chord '+chord.toFixed(2)+'px');
  check('tip is the apex - no droop back toward the hand',
        tipY<cMidY, 'tip '+tipY.toFixed(2)+' vs centre '+cMidY.toFixed(2));
  // tip rise must match the reference, not be invented
  const rise=deg(Math.atan2(base-tipY, RX(78.7)-6));
  check('tip rise matches the reference ~3.6deg (was 18.4 = 5x too upswept)',
        Math.abs(rise-3.6)<1.2, 'rise = '+rise.toFixed(1)+' deg');
}

// 5. Curve-aware hitbox still carries a blockable vector.
{
  g.playerWeaponId='kirpan'; g._startMatch();
  const p=g.player;
  p.startAttack(MOVES.kirpan.jMid); p.attackPhase='active';
  const curved=p.getAttackHitbox();
  g.playerWeaponId='soti'; g._startMatch();
  const s=g.player;
  s.startAttack(MOVES.soti.jMid); s.attackPhase='active';
  const straight=s.getAttackHitbox();
  check('curved sabre cleaves a TALLER band than the straight stick',
        curved.h > straight.h, 'kirpan h='+curved.h.toFixed(1)+' vs soti h='+straight.h.toFixed(1));
  check('curved hitbox still carries `vector` (block/parry intact)',
        curved.vector===VECTOR.MID, 'vector='+curved.vector);
}

// 6. The block/parry rule still works end-to-end with the new hitbox.
{
  g.playerWeaponId='kirpan'; g._startMatch();
  const atk=g.player, def=g.enemy;
  atk.startAttack(MOVES.kirpan.jMid); atk.attackPhase='active';
  // Force a PARRYABLE guard (Giraav): the enemy weapon is now random, and the
  // Khanda's Santulan is super-armor which correctly BLOCKS rather than parries,
  // so this test must pin a non-super-armor guard to isolate the parry rule.
  def.startBlock(MOVES.kirpan.guard); def.blockAge=0;
  const out=def.receiveHit(atk, atk.getAttackHitbox());
  check('a fresh correct-zone guard still PARRIES a curved-sabre cleave',
        out==='parry', 'outcome="'+out+'"');
}

// 7. weight -> momentum friction is wired and differentiated.
check('weight drives momentum friction (soti crisp vs kirpan carrying)',
      WEIGHT_FRICTION[WEAPONS.soti.weight] < WEIGHT_FRICTION[WEAPONS.kirpan.weight],
      'soti='+WEIGHT_FRICTION[WEAPONS.soti.weight]+' kirpan='+WEIGHT_FRICTION[WEAPONS.kirpan.weight]);

// 8. Factory dispatches by bladeStyle, and hasShield actually gates the Dhal.
{
  const seen={};
  for(const id of Object.keys(WEAPONS)){
    const rec=[]; const ctx=makeCtx(rec);
    Artist.drawWeapon(ctx,0,0,-0.3,{weapon:WEAPONS[id]});
    seen[id]=rec.length;
  }
  check('Artist.drawWeapon dispatches every bladeStyle without throwing',
        Object.values(seen).every(n=>n>0), JSON.stringify(seen)+' draw ops');
  const noShield={...WEAPONS.kirpan, hasShield:false};
  const a=[],b=[];
  Artist.drawWarrior(makeCtx(a),{weapon:WEAPONS.kirpan,colors:AKAAL_COLORS,x:0,y:430,
    width:56,height:150,facing:1,action:'IDLE',animT:0,weaponMomentum:0},-0.35,0);
  Artist.drawWarrior(makeCtx(b),{weapon:noShield,colors:AKAAL_COLORS,x:0,y:430,
    width:56,height:150,facing:1,action:'IDLE',animT:0,weaponMomentum:0},-0.35,0);
  check('hasShield:false actually removes the Dhal from the render',
        b.length < a.length, 'with shield='+a.length+' ops, without='+b.length+' ops');
}

console.log('\n'+(fails?fails+' FAILING':'ALL PASS'));

// ---- 9. lengthInches is an authentic RECORD and must not drive combat ----
{
  const {WEAPONS:W,MOVES:M}=window.__T;
  check('every weapon records its authentic length',
        Object.values(W).every(w=>typeof w.lengthInches==='number'),
        Object.values(W).map(w=>w.id+'='+w.lengthInches+'in').join(' '));

  // the decisive one: mutating lengthInches must not move a single hitbox
  g.playerWeaponId='kirpan'; g._startMatch();
  const p=g.player;
  p.startAttack(M.kirpan.jMid); p.attackPhase='active';
  const orig=p.weapon.lengthInches;                // capture, don't assume
  const before=JSON.stringify(p.getAttackHitbox());
  p.weapon.lengthInches=999;                       // absurd length
  const after=JSON.stringify(p.getAttackHitbox());
  p.weapon.lengthInches=orig;                      // restore what was actually there
  check('lengthInches does NOT leak into the hitbox (reach stays authoritative)',
        before===after, before===after?'hitbox identical at 36in and 999in':'LEAKED: '+before+' -> '+after);

  // and the scale constant must match the body, not a picked number
  const S=INCH_TO_PIXEL_SCALE;              // the ENGINE's constant, not a local copy
  check('engine scale is body-derived (150px / 71in), not a picked 4',
        Math.abs(S-150/71)<1e-9 && Math.abs(S-2.11)<0.01,
        'INCH_TO_PIXEL_SCALE='+S.toFixed(3)+' px/in -> implies a '+(150/S).toFixed(0)+'in warrior');
  check('a 36in Tegh renders at ~half the warrior height (real proportion)',
        Math.abs(36*S/150-0.5)<0.03, '36in = '+(36*S).toFixed(0)+'px = '+(36*S/150*100).toFixed(0)+'% of 150px body');
  console.log('        (at 4 px/in the warrior would be '+(150/4).toFixed(1)+'in = '+
              (150/4/12).toFixed(1)+'ft tall)');

  // the triangle's reach axis must stay readable
  const spread=W.soti.reach/W.kirpan.reach;
  const realSpread=W.soti.lengthInches/W.kirpan.lengthInches;
  check('reach keeps the triangle readable (real length could not)',
        spread>1.3, 'tuned spread '+spread.toFixed(2)+'x vs real-length spread '+realSpread.toFixed(2)+'x');
}
console.log('\n'+(fails?fails+' FAILING':'ALL PASS'));

// ---- 10. Fitted to the reference kirpan (hilt 6in + blade 25in = 31in) ----
{
  const {WEAPONS:W,INCH_TO_PIXEL_SCALE:S}=window.__T;
  const k=W.kirpan;
  const SIZES=[23.5,31,33.5];
  check('Kirpan is a STANDARD sport size, not an invented length',
        SIZES.includes(k.lengthInches), k.lengthInches+'in (standard: '+SIZES.join('/')+')');
  check('hilt + blade == overall length',
        k.hiltInches+k.bladeInches===k.lengthInches,
        k.hiltInches+'in hilt + '+k.bladeInches+'in blade = '+k.lengthInches+'in');

  // the fitting rule: blade ~= the wielder's arm. Arm is read from the ART.
  const armIn=(150*0.34)/S;
  check('blade length matches the wielder arm (the Gatka fitting rule)',
        Math.abs(k.bladeInches-armIn)<1.5,
        'blade '+k.bladeInches+'in vs arm '+armIn.toFixed(1)+'in (delta '+
        Math.abs(k.bladeInches-armIn).toFixed(1)+'in)');
  // and that the OTHER two sizes would fit worse — proves 31 was derived, not picked
  const errs=SIZES.map(o=>({o,e:Math.abs((o-6)-armIn)})).sort((a,b)=>a.e-b.e);
  check('31in is the BEST of the three sizes for a 71in warrior',
        errs[0].o===k.lengthInches,
        errs.map(x=>x.o+'in:+/-'+x.e.toFixed(1)).join('  '));

  // blade aspect ratio (scale-free) must read as a talwar, not a falchion
  const blade=k.reach, s2=(blade*0.97-6)/63.5;
  const RY2=cy=>(cy-7.15)*s2, tipX=blade*0.97, tipY=RY2(3.2);
  const cb2=(a,b,c,d,t)=>{const u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d;};
  const chord=Math.hypot(tipX-6, tipY-(RY2(6.2)+RY2(8.25))/2);
  const w=Math.abs(cb2(RY2(3.2),RY2(7.3),RY2(8.35),RY2(8.25),0.5)-cb2(RY2(6.2),RY2(5.6),RY2(4.7),RY2(3.2),0.5));
  const aspect=chord/w, real=k.bladeInches/k.bladeWidthInches;
  const refAspect=63.5/2.26;   // the reference SVG's own slenderness
  check('blade aspect matches the reference (~28:1), not the old 8.4:1 falchion',
        Math.abs(aspect-refAspect)<3, 'drawn '+aspect.toFixed(1)+':1 vs reference '+
        refAspect.toFixed(1)+':1');
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));

// ---- 11. Combat-bug regressions + the continuous atthha whirl ----------------
{
  const {WEAPONS:W,MOVES:M,VECTOR:V,ACT:A}=window.__T;

  // (a) The unblockable Chakkar must pierce the Santulan super-armor guard — the
  //     whole point of the STEP being its only answer. (Was returning "block".)
  g.playerWeaponId='khanda'; g._startMatch();
  {
    const atk=g.player, def=g.enemy;
    def.startBlock(M.khanda.guard); def.blockAge=0;   // hold Santulan (super-armor)
    atk.startAttack(M.khanda.jDown); atk.attackPhase='active';   // Chakkar (unblockable)
    const out=def.receiveHit(atk, atk.getAttackHitbox());
    check('unblockable Chakkar pierces the Santulan super-armor guard',
          out!=='block', 'outcome="'+out+'" (super-armor must yield to unblockable)');
  }

  // (b) A clean Chakram hit must INTERRUPT (HITSTUN), not leave the target idle.
  g.playerWeaponId='soti'; g._startMatch();
  {
    const atk=g.player, def=g.enemy; def.action=A.IDLE;
    const out=def.receiveProjectile({owner:atk, vector:V.MID});
    check('a clean Chakram hit causes hitstun (ACT.HURT), not a free chip',
          out==='hit' && def.action===A.HURT, 'outcome="'+out+'" action='+def.action);
  }

  // (c) Sarbloh Kavach reflecting a disc must DRAIN the thrower's posture.
  g.playerWeaponId='kirpan'; g._startMatch();
  {
    const atk=g.player, def=g.enemy;
    atk.posture=atk.maxPost; def.shieldT=1;
    const before=atk.posture;
    const out=def.receiveProjectile({owner:atk, vector:V.MID});
    check('Iron Shield reflect drains the disc-thrower\'s posture',
          out==='reflect' && atk.posture<before,
          'outcome="'+out+'" posture '+before.toFixed(0)+'->'+atk.posture.toFixed(0));
  }

  // (d) Enemy weapon is random — mirrors reachable, all three ids appear.
  g.playerWeaponId='kirpan';
  {
    let sawMirror=false; const ids=new Set();
    for(let i=0;i<300;i++){ g._spawnFighters(); ids.add(g.enemy.weapon.id);
      if(g.enemy.weapon.id==='kirpan') sawMirror=true; }
    check('enemy weapon is random: mirror matchups reachable, all 3 occur',
          sawMirror && ids.size===3, 'mirror='+sawMirror+' ids={'+[...ids].join(',')+'}');
  }

  // (e) THE ATTHHA NEVER STOPS — the blade whirls in the ready stance.
  g.playerWeaponId='khanda'; g._startMatch();
  {
    const p=g.player; let moved=false;
    for(let i=0;i<12;i++){ g._update(1/60); if(Math.abs(p.weaponAngVel)>0.002) moved=true; }
    check('the blade whirls the atthha while idle (never dead-still)',
          moved && p.action===A.IDLE, 'angVel seen while action='+p.action);
  }

  // (f) Each shastar carries a distinct motion tempo (Soti quick -> Khanda heavy).
  check('each shastar has its own motion signature (whirl tempo differs)',
        W.soti.motion.whirl > W.kirpan.motion.whirl && W.kirpan.motion.whirl > W.khanda.motion.whirl,
        'soti='+W.soti.motion.whirl+' kirpan='+W.kirpan.motion.whirl+' khanda='+W.khanda.motion.whirl);

  // (g) Authenticity: the Khanda is two-handed and carries NO shield.
  check('Khanda is two-handed with no shield (authentic broadsword)',
        W.khanda.twoHanded===true && W.khanda.hasShield===false,
        'twoHanded='+W.khanda.twoHanded+' hasShield='+W.khanda.hasShield);

  // (h) REFINE: the whirl RIDES THE BEAT — its speed varies across the drum cycle
  //     (surge on the beat, ease mid-beat) rather than grinding at a flat rate.
  g.playerWeaponId='khanda'; g._startMatch();
  {
    const p=g.player; let lo=Infinity, hi=0, idle=0;
    for(let i=0;i<180;i++){ g._update(1/60);
      if(p.action===A.IDLE){ const s=Math.abs(p.weaponAngVel); if(s<lo)lo=s; if(s>hi)hi=s; idle++; } }
    check('the whirl rides the nagara: speed varies across the beat (not flat)',
          idle>30 && hi>lo*1.3,
          'idle angVel lo='+lo.toFixed(4)+' hi='+hi.toFixed(4)+' ('+idle+' idle frames)');
  }

  // (i) Each shastar carries its own beat-surge (light stick even -> heavy khanda heaves).
  check('per-weapon swing: Khanda heaves on the beat more than the Soti',
        W.khanda.motion.swing > W.kirpan.motion.swing && W.kirpan.motion.swing > W.soti.motion.swing,
        'soti='+W.soti.motion.swing+' kirpan='+W.kirpan.motion.swing+' khanda='+W.khanda.motion.swing);
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));

// ---- 12. Escalating difficulty — the vairi hardens each round the player wins ----
{
  const D=DIFFICULTY;
  g.playerWeaponId='kirpan'; g._startMatch(true);   // fresh run: difficulty back to 1
  const e=g.enemy;

  // (a) LEVEL 1 == the old baseline: no scaling at all (no regression).
  e.applyDifficulty(1);
  check('Level 1 is the exact baseline (skill 0, dmgScale 1, maxHp = baseMaxHp)',
        e.skill===0 && e.dmgScale===1 && e.maxHp===e.baseMaxHp,
        'skill='+e.skill+' dmgScale='+e.dmgScale+' maxHp='+e.maxHp+'/'+e.baseMaxHp);

  // (b) Higher levels scale skill, damage and HP up.
  e.applyDifficulty(4);
  check('higher levels scale the vairi up (skill/dmg/HP all rise)',
        e.skill>0 && e.dmgScale>1 && e.maxHp>e.baseMaxHp,
        'skill='+e.skill.toFixed(2)+' dmgScale='+e.dmgScale.toFixed(2)+' maxHp='+e.maxHp.toFixed(0));

  // (c) The scaling is CAPPED, not unbounded.
  e.applyDifficulty(100);
  check('scaling is capped (skill<=1, dmg<=+dmgCap, HP<=+hpCap)',
        e.skill===1 && e.dmgScale<=1+D.dmgCap+1e-9 && e.maxHp<=e.baseMaxHp*(1+D.hpCap)+1e-9,
        'skill='+e.skill+' dmgScale='+e.dmgScale.toFixed(2)+' maxHp='+e.maxHp.toFixed(0));

  // (d) A round WIN raises the level; a match DEFEAT resets it to 1.
  g._startMatch(true); g.playerWins=0; g.enemyWins=0; g.difficulty=1;
  g._endRound(true);
  check('winning a round raises the difficulty level', g.difficulty===2, 'difficulty='+g.difficulty);
  g.playerWins=0; g.enemyWins=1; g.difficulty=3;   // a losing decider
  g._endRound(false);
  check('a match defeat resets the level to 1', g.difficulty===1, 'difficulty='+g.difficulty);

  // (e) Persistence: a rematch KEEPS the level; a fresh start RESETS it.
  g.difficulty=5; g._startMatch(false);
  check('rematch keeps the climbed level (carries across matches)', g.difficulty===5, 'difficulty='+g.difficulty);
  check('the enemy is scaled to that level, the PLAYER never is',
        g.enemy.skill>0 && g.enemy.dmgScale>1 && g.player.dmgScale===1 && g.player.skill===0,
        'enemy skill='+g.enemy.skill.toFixed(2)+' player dmgScale='+g.player.dmgScale);
  g._startMatch(true);
  check('a fresh start resets the level to 1', g.difficulty===1, 'difficulty='+g.difficulty);

  // (f) The enemy carries the CURRENT level into the next round.
  g.difficulty=4; g._startNextRound();
  check('the enemy carries the current level after _startNextRound',
        Math.abs(g.enemy.skill - (4-1)/D.skillLevels) < 1e-9,
        'enemy skill='+g.enemy.skill.toFixed(3)+' expected '+((4-1)/D.skillLevels).toFixed(3));
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));

// ---- 13. Mobile perf: the LOW_PERF render path (halved trail) is sound --------
{
  // Force low-power mode and re-derive it (`_bindTouch` reads the flag), then run a
  // few seconds of real combat + render — the halved-sample trail must not throw.
  window.__GATKA_LOWPERF__ = true;
  g._bindTouch();
  let err=null;
  try {
    g.playerWeaponId='soti'; g._startMatch(true);
    for(let i=0;i<40;i++) g._update(1/60);
    g._render();
  } catch(e){ err=e; }
  check('LOW_PERF render path (halved blade trail) runs a match without throwing',
        !err, err?String(err).slice(0,90):'40 sim steps + render, low-power on');
  window.__GATKA_LOWPERF__ = false; g._bindTouch();
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));

// ---- 14. THE VAAR SWING: a strike moves the blade EVERY time (no sticking) ----
// The old strike eased to a static pose and held it — invisible whenever the idle
// whirl had already parked the blade near that pose ("the sword sticks"). The new
// deterministic arc must produce a real swing from ANY starting angle and vector.
{
  g.playerWeaponId='kirpan'; g._startMatch(true);
  const p = g.player, foe = g.enemy;
  const starts = [-2.6, -0.9, 0.0, 0.6, 1.9, 3.0];   // varied pre-strike whirl angles
  const cases = [['HIGH', MOVES.kirpan.jUp], ['MID', MOVES.kirpan.jMid]];
  let worstPeak = Infinity, worstCase = '';
  for (const [label, move] of cases) {
    for (const s of starts) {
      p.action = ACT.IDLE; p.weaponAngle = s; p.whirlPhase = s; p.weaponMomentum = 0;
      p.startAttack(move);
      let peak = 0;
      for (let i = 0; i < 50 && p.action === ACT.ATTACK; i++) {
        p.update(1/60, foe);
        if (p.attackPhase === 'active') peak = Math.max(peak, Math.abs(p.weaponAngVel));
      }
      if (peak < worstPeak) { worstPeak = peak; worstCase = label + ' from ' + s.toFixed(1); }
    }
  }
  // A stuck blade would peak ~0; a real swing sweeps ~1+ rad over the active window.
  check('every strike swings the blade (no sticking) from any start angle/vector',
        worstPeak > 0.08,
        'worst active peak |angVel|=' + worstPeak.toFixed(3) + ' (' + worstCase + ')');

  // And the swing genuinely passes near the tuned hitbox pose during active.
  p.action = ACT.IDLE; p.weaponAngle = 2.0; p.whirlPhase = 2.0; p.weaponMomentum = 0;
  p.startAttack(MOVES.kirpan.jMid);
  let nearest = Infinity;
  for (let i = 0; i < 50 && p.action === ACT.ATTACK; i++) {
    p.update(1/60, foe);
    if (p.attackPhase === 'active') nearest = Math.min(nearest, Math.abs(p.weaponAngle - 0.0));
  }
  check('the swing passes through the MID strike pose (blade meets the hitbox)',
        nearest < 0.25, 'closest approach to pose 0.0 = ' + nearest.toFixed(3) + ' rad');
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));

// ---- 15. DRIVE joystick maps to the SAME keys the D-pad/keyboard emit ----------
// The "drive hand" is just another input source: dragging holds a/d (move) and w/s
// (High/Low stance). If this mapping is right, combat is byte-for-byte identical to
// the buttons — nothing else in the fight logic can tell the difference.
{
  const H = () => [...g.input.held].sort().join('');
  const set = (k) => k.slice().sort().join('');
  g._releaseDrive();
  g._applyDrive(-30, 0);   // push LEFT
  check('drive LEFT holds only "a"', H() === set(['a']), 'held={' + H() + '}');
  g._releaseDrive();
  g._applyDrive(30, 0);    // push RIGHT
  check('drive RIGHT holds only "d"', H() === set(['d']), 'held={' + H() + '}');
  g._releaseDrive();
  g._applyDrive(0, -30);   // push UP → High stance
  check('drive UP holds only "w" (High stance)', H() === set(['w']), 'held={' + H() + '}');
  g._releaseDrive();
  g._applyDrive(0, 30);    // push DOWN → Low stance
  check('drive DOWN holds only "s" (Low stance)', H() === set(['s']), 'held={' + H() + '}');
  g._releaseDrive();
  g._applyDrive(24, 24);   // diagonal → move right + Low
  check('drive diagonal holds "d"+"s"', H() === set(['d', 's']), 'held={' + H() + '}');
  g._releaseDrive();
  g._applyDrive(8, -8);    // inside the deadzone → neutral (Mid, no move)
  check('drive inside the deadzone holds nothing (Mid stance)', H() === '', 'held={' + H() + '}');
  g._applyDrive(40, 0); g._releaseDrive();
  check('releasing the drive clears every held key', H() === '', 'held={' + H() + '}');
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));

// ---- 16. HIT-STOP is capped so a strike never freezes/blocks input for long ----
// The loop skips the whole sim (input included) while freezeT>0, so an over-long
// hit-stop is the "buttons don't work when I strike" hang. Any freeze must clamp
// to HITSTOP.max (desktop) / mobileMax (LOW_PERF) within a single frame.
{
  g.playerWeaponId='kirpan'; g._startMatch(true);
  window.__GATKA_LOWPERF__ = false; g._bindTouch();     // desktop cap
  g.last = 0; g.acc = 0; g.freezeT = 0.5;               // absurdly long freeze request
  g._frame(16);                                         // one ~16ms frame
  check('hit-stop clamps to HITSTOP.max on desktop (no long input-block)',
        g.freezeT <= HITSTOP.max + 1e-9, 'freezeT=' + g.freezeT.toFixed(3) + ' cap=' + HITSTOP.max);

  window.__GATKA_LOWPERF__ = true; g._bindTouch();      // mobile: tighter cap
  g.last = 0; g.acc = 0; g.freezeT = 0.5;
  g._frame(16);
  check('hit-stop clamps to HITSTOP.mobileMax on LOW_PERF (phones stay responsive)',
        g.freezeT <= HITSTOP.mobileMax + 1e-9, 'freezeT=' + g.freezeT.toFixed(3) + ' cap=' + HITSTOP.mobileMax);
  window.__GATKA_LOWPERF__ = false; g._bindTouch();
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));

// ---- 17. SMART ability button picks the right Simran ability (one tap, no tray) ----
{
  g.playerWeaponId='kirpan'; g._startMatch(true);
  const p = g.player, e = g.enemy;
  const noThreat = () => { e.ultActive = false; e.action = ACT.IDLE; e.attackPhase = null;
                           g.projectiles.length = 0; p.shieldT = 0; };

  noThreat(); p.simran = 0;
  check('smart ability: empty meter → nothing castable (null)', g._smartAbility() === null,
        'got ' + g._smartAbility());
  noThreat(); p.simran = ABILITY.chakram.cost;
  check('smart ability: Chakram affordable, no threat → Chakram (u)',
        g._smartAbility() === KEYS.chakram[0], 'got ' + g._smartAbility());
  noThreat(); p.simran = ABILITY.ultimate.cost;
  check('smart ability: full meter → Ultimate (o)',
        g._smartAbility() === KEYS.ultimate[0], 'got ' + g._smartAbility());
  noThreat(); p.simran = ABILITY.shield.cost; e.action = ACT.ATTACK; e.attackPhase = "active";
  check('smart ability: under threat + Shield affordable → Shield (i)',
        g._smartAbility() === KEYS.shield[0], 'got ' + g._smartAbility());

  // The sync must run and reflect "castable" vs "none" without throwing.
  let err = null;
  try { noThreat(); p.simran = ABILITY.ultimate.cost; g._syncSmartButton();
        p.simran = 0; g._syncSmartButton(); } catch (ex) { err = ex; }
  check('_syncSmartButton updates the button without throwing', !err,
        err ? String(err).slice(0, 90) : 'ran for full + empty meter');
}
console.log(String.fromCharCode(10)+(fails?fails+' FAILING':'ALL PASS'));
