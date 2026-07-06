// Boot, asset wiring, state machine, main loop.
import * as C from './constants.js';
import { loadAssets, Anim, makeProp, drawText } from './engine.js';
import { Level, Player, Mutant, Pickup, PowerUp, Particles, Toasts, Elevator, Slide, overlaps } from './game.js';
import { sfx, toggleMute, isMuted, unlockAudio, music } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false; // sheets are prescaled; runtime draws are 1:1

// ------------------------------------------------------------------- input

const held = new Set();
const pressed = new Set();
const keyOf = code => Object.keys(C.KEYS).find(k => C.KEYS[k].includes(code));
window.addEventListener('keydown', e => {
  const k = keyOf(e.code);
  if (!k) return;
  e.preventDefault();
  unlockAudio();
  if (!held.has(k)) pressed.add(k);
  held.add(k);
});
window.addEventListener('keyup', e => {
  const k = keyOf(e.code);
  if (k) held.delete(k);
});

// ------------------------------------------------------------------- boot

let lib = null;       // wired assets
let state = 'loading';
let loadProgress = 0;
let loadError = null;

// Run state
let levelIndex = 0, score = 0, lives = C.START_LIVES, niceCount = 0;
let level = null, player = null, mutants = [], pickups = [], timer = 0;
let elevators = [], slides = [];
let powerups = [];
let speedT = 0, bootsT = 0, canaryT = 0, shield = false;
let smittenT = 0, claimStreak = 0, deathT = 0, cardT = 0, clearBonus = 0;
let lastTickSecond = -1, prophecyAwarded = false;
const particles = new Particles();
const toasts = new Toasts();
let subtitle = C.TITLE_SUBTITLES[0];

// Juice state (budgets in constants.JUICE)
let stateT = 0;           // seconds since last state change, for card easing
let freezeT = 0;          // hit-pause: sim frozen, render continues
let shakeAmp = 0, shakeT = 0, shakeDur = 1;
let redFlash = 0;
let displayScore = 0;     // tweened score readout
let claimAge = 99;        // seconds since last claim (combo window)
let fireworkT = 0;
let best = 0, newBest = false;
let continues = 0, continueLevel = 0;

function go(next) {
  state = next;
  stateT = 0;
  if (next === 'playing') music.start(C.MUSIC.bpm, C.MUSIC.gain);
  else music.stop();
}
function shake(amp, dur) {
  // never stack unbounded: keep the stronger of current vs new
  if (amp >= shakeAmp * (shakeT / shakeDur || 0)) { shakeAmp = amp; shakeT = dur; shakeDur = dur; }
}

async function boot() {
  try {
    const { images, data } = await loadAssets(p => { loadProgress = p; });
    lib = wire(images, data);
    wireV11(lib, images, data);
    best = Number(localStorage.getItem(C.BEST_KEY)) || 0;
    go('title');
    subtitle = C.TITLE_SUBTITLES[(Math.random() * C.TITLE_SUBTITLES.length) | 0];
  } catch (err) {
    loadError = String(err);
    console.error(err);
  }
}

// Build the runtime asset library from loaded files. Every entry traces to an
// accepted manifest job (quality-bar integration rule).
function wire(images, data) {
  const img = p => {
    const i = images.get(p);
    if (!i) throw new Error(`missing image: ${p}`);
    return i;
  };
  const json = p => {
    const d = data.get(p);
    if (!d) throw new Error(`missing data: ${p}`);
    return d;
  };
  const anim = (dir, target, cfg) =>
    new Anim(img(`${dir}/sheet-transparent.png`), json(`${dir}/pipeline-meta.json`), target, cfg);

  const pickupsMap = new Map();
  for (const item of Object.keys(C.PICKUP_SCORES)) {
    pickupsMap.set(item, makeProp(img(`assets/props/pickups/${item}/prop.png`), C.PICKUP_SIZE, C.PICKUP_SIZE));
  }
  // Plate list, render order, and per-layer opacity come from the map job's
  // scene-hooks metadata, never hardcoded (quality-bar parallax/data rule).
  const hooks = json('data/mine-scene-hooks.json');
  const plateDefs = hooks.plate_render_order.slice().sort((a, b) => a.render_order - b.render_order);

  return {
    heroIdle: anim('assets/hero/idle', C.HERO_H, C.ANIM.heroIdle),
    heroRun: anim('assets/hero/run', C.HERO_H, C.ANIM.heroRun),
    heroJump: anim('assets/hero/jump', C.HERO_H, C.ANIM.heroJump),
    heroClimb: anim('assets/hero/climb', C.HERO_H, C.ANIM.heroClimb),
    heroHurt: anim('assets/hero/hurt', C.HERO_H, C.ANIM.heroHurt),
    mutants: {
      smoocher: {
        walk: anim('assets/enemies/smoocher/walk', C.SMOOCHER_H, C.ANIM.mutantWalk),
        smitten: anim('assets/enemies/smoocher/smitten', C.SMOOCHER_H, C.ANIM.smitten),
      },
      cuddler: {
        walk: anim('assets/enemies/cuddler/walk', C.CUDDLER_H, C.ANIM.mutantWalk),
        smitten: anim('assets/enemies/cuddler/smitten', C.CUDDLER_H, C.ANIM.smitten),
      },
    },
    plates: plateDefs.map(d => ({ img: img(d.path), opacity: d.opacity ?? 1 })),
    platform: {
      left: makeProp(img('assets/props/platform/left.png'), C.CAP_W, C.PLATFORM_H),
      mid: makeProp(img('assets/props/platform/mid.png'), C.SEGMENT_W, C.PLATFORM_H),
      right: makeProp(img('assets/props/platform/right.png'), C.CAP_W, C.PLATFORM_H),
    },
    platformClaimed: {
      left: makeProp(img('assets/props/platform-claimed/left.png'), C.CAP_W, C.PLATFORM_H),
      mid: makeProp(img('assets/props/platform-claimed/mid.png'), C.SEGMENT_W, C.PLATFORM_H),
      right: makeProp(img('assets/props/platform-claimed/right.png'), C.CAP_W, C.PLATFORM_H),
    },
    ladder: makeProp(img('assets/props/ladder/ladder.png'), C.LADDER_W, C.LADDER_TILE_H),
    pickups: pickupsMap,
    hud: {
      helmet: makeProp(img('assets/props/hud/helmet/prop.png'), C.HUD_ICON, C.HUD_ICON),
      clock: makeProp(img('assets/props/hud/clock/prop.png'), C.HUD_ICON, C.HUD_ICON),
      heart: makeProp(img('assets/props/hud/heart/prop.png'), C.HUD_ICON, C.HUD_ICON),
      star: makeProp(img('assets/props/hud/star/prop.png'), C.HUD_ICON, C.HUD_ICON),
    },
    title: img('assets/map/title-screen.png'),
    levels: json('data/levels.json').levels,
  };
}

// v1.1 assets load only once their manifest jobs are accepted; levels that
// need them are hidden until then so the game never references missing art.
function wireV11(lib, images, data) {
  const has = p => images.has(p);
  const img = p => images.get(p);
  const anim = (dir, target, cfg) =>
    new Anim(img(`${dir}/sheet-transparent.png`), data.get(`${dir}/pipeline-meta.json`), target, cfg);
  if (has('assets/enemies/winker/fly/sheet-transparent.png')) {
    lib.mutants.winker = {
      fly: anim('assets/enemies/winker/fly', C.WINKER_H, C.ANIM.mutantWalk),
      smitten: anim('assets/enemies/winker/smitten', C.WINKER_H, C.ANIM.smitten),
    };
  }
  if (has('assets/props/elevator/sheet-transparent.png')) {
    const raw = img('assets/props/elevator/sheet-transparent.png');
    lib.elevator = makeProp(raw, C.ELEVATOR.w, Math.round(C.ELEVATOR.w * raw.height / raw.width));
  }
  if (has('assets/props/slide/sheet-transparent.png')) {
    lib.slide = makeProp(img('assets/props/slide/sheet-transparent.png'), C.SLIDE.tile, C.SLIDE.tile);
  }
  // v2 assets (same defensive rule)
  const V2_ENEMIES = [['grabby', ['walk', 'smitten'], C.GRABBY_H],
                      ['floaty', ['float', 'smitten'], C.FLOATY_H],
                      ['prude', ['walk', 'scoff'], C.PRUDE_H]];
  for (const [name, actions, h] of V2_ENEMIES) {
    if (has(`assets/enemies/${name}/${actions[0]}/sheet-transparent.png`)) {
      lib.mutants[name] = {};
      for (const a of actions) {
        const cfg = a === 'walk' || a === 'float' ? C.ANIM.mutantWalk : C.ANIM.smitten;
        lib.mutants[name][a] = anim(`assets/enemies/${name}/${a}`, h, cfg);
      }
    }
  }
  if (has('assets/props/powerups/thermos/prop.png')) {
    lib.powerups = new Map();
    for (const t of Object.keys(C.POWERUPS)) {
      lib.powerups.set(t, makeProp(img(`assets/props/powerups/${t}/prop.png`), C.POWERUP_SIZE, C.POWERUP_SIZE));
    }
  }
  for (const piece of ['plank', 'conveyor', 'spikes']) {
    if (has(`assets/props/${piece}/sheet-transparent.png`)) {
      lib[piece] = makeProp(img(`assets/props/${piece}/sheet-transparent.png`), C.MECH_CELL_W, C.MECH_CELL_H);
    }
  }

  lib.levels = lib.levels.filter(lv => {
    const needsWinker = (lv.mutants || []).some(mu => mu.type === 'winker');
    const needsMovers = (lv.elevators || []).length || (lv.slides || []).length;
    if (needsWinker && !lib.mutants.winker) return false;
    if (needsMovers && !(lib.elevator && lib.slide)) return false;
    for (const mu of (lv.mutants || [])) {
      if (['grabby', 'floaty', 'prude'].includes(mu.type) && !lib.mutants[mu.type]) return false;
    }
    if ((lv.powerups || []).length && !lib.powerups) return false;
    if ((lv.platforms || []).some(p => (p.crumble || []).length) && !lib.plank) return false;
    if ((lv.conveyors || []).length && !lib.conveyor) return false;
    if ((lv.spikes || []).length && !lib.spikes) return false;
    return true;
  });
}

// ------------------------------------------------------------------ scoring

function addScore(n) {
  const before = score;
  score += n;
  if (score % 100 === 69) { niceToast(); }
  if (((score / C.NICE_MULTIPLE) | 0) > ((before / C.NICE_MULTIPLE) | 0)) { niceToast(); }
  if (!prophecyAwarded && score === C.PROPHECY_SCORE) {
    prophecyAwarded = true;
    lives++;
    toasts.push('THE PROPHECY.', C.PALETTE.lanternGold, true);
    sfx.fanfare();
  }
}
function niceToast() {
  niceCount++;
  toasts.push('NICE.', C.PALETTE.lanternGold);
  sfx.nice();
}

// -------------------------------------------------------------- run control

// Debug/testing: ?level=N starts runs at level N (1-based, clamped).
const DEBUG_START_LEVEL = Math.max(0,
  (Number(new URLSearchParams(location.search).get('level')) || 1) - 1);

function startRun() {
  levelIndex = Math.min(DEBUG_START_LEVEL, lib.levels.length - 1);
  score = 0; lives = C.START_LIVES;
  continues = 0;
  prophecyAwarded = false; niceCount = 0;
  startLevel();
}

function startLevel() {
  const def = lib.levels[levelIndex];
  level = new Level(def);
  player = new Player(lib, level, def.spawn);
  const speeds = def.mutantSpeed;
  mutants = def.mutants.map(m => new Mutant(lib, m, level,
    speeds * (m.type === 'cuddler' ? C.CUDDLER_SPEED_FACTOR : 1) * (m.speedFactor ?? 1)));
  elevators = (def.elevators || []).map(e => new Elevator(lib.elevator, e));
  slides = (def.slides || []).map(s => new Slide(lib.slide, s));
  player.world = { elevators, slides };
  pickups = def.pickups.map(p => new Pickup(lib, p.item, p.x, p.y));
  powerups = (def.powerups || []).map(p => new PowerUp(lib.powerups.get(p.type), p.type, p.x, p.y));
  speedT = 0; bootsT = 0; canaryT = 0; shield = false;
  timer = def.timer;
  smittenT = 0; claimStreak = 0; lastTickSecond = -1;
  go('intro'); cardT = 0;
}

function loseLife(reason) {
  player.hurt();
  sfx.death();
  particles.burst(player.x, player.y - 30, 14, { color: C.PALETTE.boneWhite, life: 0.7, gravity: 500, size: 5 });
  deathT = 0;
  freezeT = C.JUICE.hitPauseDeathS;
  shake(C.JUICE.shakeDeathAmp, C.JUICE.shakeDeathS);
  redFlash = C.JUICE.redFlashS;
  go('dying');
}

const playerEvents = {
  jump() { sfx.jump(); },
  land(fall) {
    particles.burst(player.x, player.y, 6, { color: '#7a5b3a', life: 0.35, size: 4, up: 40 });
    sfx.land();
    if (fall >= C.FALL_KILL_DISTANCE + (bootsT > 0 ? C.BOOTS_FALL_BONUS : 0)) loseLife('fall');
  },
  fellOut() { loseLife('pit'); },
  claim(cx, cy) {
    if (claimAge > C.COMBO.windowS) claimStreak = 0;   // combo window expired
    claimAge = 0;
    claimStreak++;
    addScore(C.SCORE_CLAIM);
    sfx.claim(Math.min(claimStreak, 12));
    particles.burst(cx, cy, 5, { color: C.PALETTE.bashfulPink, life: 0.5, size: 4, up: 60 });
    if (claimStreak > 0 && claimStreak % C.COMBO.every === 0) {
      addScore(C.COMBO.bonus);
      toasts.push(`STREAK x${claimStreak}! +${C.COMBO.bonus}`, C.PALETTE.lanternGold);
      sfx.streak();
    }
  },
  slideStart() {
    sfx.whoosh();
  },
};

// ------------------------------------------------------------------ update

function update(dt) {
  stateT += dt;
  toasts.update(dt);
  particles.update(dt);

  if (state === 'title' && pressed.has('start')) { sfx.select(); startRun(); }
  else if (state === 'intro') {
    cardT += dt;
    if (cardT > 2 || pressed.has('start') || pressed.has('jump')) go('playing');
  }
  else if (state === 'playing') updatePlaying(dt);
  else if (state === 'dying') {
    deathT += dt;
    player.anim.update(dt);
    if (deathT > 1.1) {
      lives--;
      if (lives <= 0) {
        newBest = score > best;
        if (newBest) { best = score; localStorage.setItem(C.BEST_KEY, String(best)); }
        continueLevel = levelIndex;
        go('gameover'); sfx.gameover();
      }
      else {
        player.respawn(lib.levels[levelIndex].spawn, C.JUICE.spawnInvulnS);
        timer = lib.levels[levelIndex].timer; // claims persist, timer resets (GDD)
        smittenT = 0;
        go('playing');
      }
    }
  }
  else if (state === 'clear') {
    cardT += dt;
    if (cardT > 2.4) {
      levelIndex++;
      if (levelIndex >= lib.levels.length) {
        newBest = score > best;
        if (newBest) { best = score; localStorage.setItem(C.BEST_KEY, String(best)); }
        go('victory'); sfx.fanfare();
      }
      else startLevel();
    }
  }
  else if (state === 'victory') {
    fireworkT -= dt;
    if (fireworkT <= 0) {
      fireworkT = C.FIREWORK_INTERVAL_S;
      const fx = 250 + Math.random() * (C.CANVAS_W - 500);
      const fy = 130 + Math.random() * 320;
      const col = Math.random() < 0.5 ? C.PALETTE.bashfulPink : C.PALETTE.lanternGold;
      particles.burst(fx, fy, 22, { color: col, life: 0.9, size: 4, speed: 200, gravity: 160 });
      sfx.pop();
    }
    if (pressed.has('start')) { sfx.select(); startRun(); }
  }
  else if (state === 'gameover') {
    if (pressed.has('start')) {
      // classic arcade continue: resume at the failed level, score keeps
      sfx.select();
      continues++;
      lives = C.START_LIVES;
      levelIndex = continueLevel;
      startLevel();
    } else if (pressed.has('restart')) {
      sfx.select();
      startRun(); // fresh run in under 2s (quality-bar)
    }
  }

  pressed.clear();
}

function updatePlaying(dt) {
  if (pressed.has('pause')) { go('paused'); sfx.select(); pressed.clear(); return; }

  if (canaryT <= 0) timer -= dt;   // the canary freezes the clock
  if (timer <= 3.2 && Math.ceil(timer) !== lastTickSecond && timer > 0) {
    lastTickSecond = Math.ceil(timer);
    sfx.timerLow();
  }
  if (timer <= 0) { loseLife('timer'); return; }

  smittenT = Math.max(0, smittenT - dt);
  const smitten = smittenT > 0;
  music.set({ smitten, urgent: timer < C.MUSIC.urgentAt });

  claimAge += dt;
  speedT = Math.max(0, speedT - dt);
  bootsT = Math.max(0, bootsT - dt);
  canaryT = Math.max(0, canaryT - dt);
  for (const el of elevators) el.update(dt);
  level.updateMechanics(dt, player, (cx, cy) => {
    sfx.bop();
    shake(3, 0.15);
    particles.burst(cx, cy, 8, { color: '#8a6a44', life: 0.5, size: 4, gravity: 400 });
  });
  const input = {
    left: held.has('left'), right: held.has('right'),
    up: held.has('up'), down: held.has('down'),
    jumpPressed: pressed.has('jump'),
    effects: { speedMult: speedT > 0 ? C.SPEED_MULT : 1, jumpMult: bootsT > 0 ? C.BOOTS_JUMP_MULT : 1 },
  };
  player.update(dt, input, playerEvents);
  if (state === 'playing' && player.grounded && level.spikeAt(player.x, player.y)) {
    loseLife('spikes');
    return;
  }
  if (player.state === 'slide' && Math.random() < dt * 14) {
    particles.spawn(player.x, player.y, { vx: -player.facing * 60, vy: -20, life: 0.4, color: '#7a5b3a', size: 4 });
  }
  if (state !== 'playing') return; // death during update

  for (const m of mutants) m.update(dt, smitten);
  for (const p of pickups) p.update(dt);

  // Pickups
  const box = player.hitbox;
  for (const p of pickups) {
    if (p.taken || !overlaps(box, p.hitbox)) continue;
    p.taken = true;
    addScore(C.PICKUP_SCORES[p.item]);
    toasts.push(C.PICKUP_TOASTS[p.item], C.PALETTE.boneWhite);
    smittenT = C.SMITTEN_SECONDS;
    sfx.pickup();
    sfx.smitten();
    particles.burst(p.x, p.y - 16, 10, { color: C.PALETTE.lanternGold, life: 0.6, size: 4, up: 80 });
    for (const m of mutants) if (!m.dead) particles.spawn(m.x, m.y - 50, { vy: -60, life: 0.8, color: C.PALETTE.bashfulPink, size: 6, type: 'heart' });
  }

  // Power-ups
  for (const pu of powerups) {
    if (pu.taken || !overlaps(box, pu.hitbox)) continue;
    pu.taken = true;
    addScore(C.SCORE_POWERUP);
    toasts.push(C.POWERUPS[pu.type].toast, C.PALETTE.lanternGold);
    sfx.pickup();
    particles.burst(pu.x, pu.y - 16, 12, { color: C.PALETTE.lanternGold, life: 0.7, size: 4, up: 90 });
    if (pu.type === 'thermos') speedT = C.POWERUPS.thermos.dur;
    else if (pu.type === 'boots') bootsT = C.POWERUPS.boots.dur;
    else if (pu.type === 'canary') canaryT = C.POWERUPS.canary.dur;
    else if (pu.type === 'gold-helmet') shield = true;
  }

  // Mutant contact
  for (const m of mutants) {
    if (m.dead || !overlaps(box, m.hitbox)) continue;
    if (player.invulnT > 0 && !smitten) continue; // spawn grace
    const boppable = smitten && m.type !== 'prude';   // the Prude is immune to charm
    if (boppable || (shield && m.type !== 'prude')) {
      if (!boppable) { shield = false; toasts.push('HELMET SAVE!', C.PALETTE.lanternGold); }
      m.bop(C.MUTANT_RESPAWN_SECONDS);
      addScore(C.SCORE_BOP);
      toasts.push('+500 BOP!', C.PALETTE.bashfulPink);
      sfx.bop();
      freezeT = C.JUICE.hitPauseBopS;
      shake(C.JUICE.shakeBopAmp, C.JUICE.shakeBopS);
      particles.burst(m.x, m.y - 24, 12, { color: C.PALETTE.bashfulPink, life: 0.8, size: 6, type: 'heart', up: 100 });
    } else if (shield && m.type === 'prude') {
      shield = false;                                  // confiscated, not consumed kindly
      toasts.push(C.PRUDE_SHIELD_TOAST, C.PALETTE.boneWhite);
      player.invulnT = 1.2;
      freezeT = C.JUICE.hitPauseBopS;
      shake(C.JUICE.shakeBopAmp, C.JUICE.shakeBopS);
      sfx.timerLow();
    } else {
      loseLife('mutant');
      return;
    }
  }

  // Level complete
  if (level.complete) {
    clearBonus = Math.ceil(timer) * C.SCORE_TIME_BONUS_PER_SECOND;
    addScore(clearBonus);
    if (lives < C.START_LIVES) {
      lives++;
      toasts.push('SHIFT BONUS: +1 LIFE', C.PALETTE.lanternGold);
    }
    go('clear'); cardT = 0;
    sfx.fanfare();
  }
}

// -------------------------------------------------------------------- draw

function drawStage() {
  // Fixed camera: plates draw statically in metadata order at metadata opacity
  // (scroll factors resolve to 0 movement — tech-plan note).
  for (const plate of lib.plates) {
    ctx.globalAlpha = plate.opacity;
    ctx.drawImage(plate.img, 0, 0, C.CANVAS_W, C.CANVAS_H);
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  const y = 34;
  for (let i = 0; i < lives; i++) ctx.drawImage(lib.hud.helmet, 24 + i * 34, y - C.HUD_ICON / 2 - 8);
  ctx.drawImage(lib.hud.clock, 24 + 3 * 34 + 30, y - C.HUD_ICON / 2 - 8);
  const secs = Math.max(0, Math.ceil(timer));
  drawText(ctx, `${secs}`, 24 + 3 * 34 + 30 + C.HUD_ICON + 28, y - 8 + C.HUD_ICON / 2, 28,
    secs <= 10 ? C.PALETTE.bashfulPink : C.PALETTE.boneWhite, 'left');
  if (smittenT > 0) {
    const x0 = C.CANVAS_W / 2 - 80;
    ctx.drawImage(lib.hud.heart, x0 - C.HUD_ICON - 8, y - C.HUD_ICON / 2 - 8);
    ctx.fillStyle = '#141019'; ctx.fillRect(x0, y - 16, 160, 14);
    ctx.fillStyle = C.PALETTE.bashfulPink;
    ctx.fillRect(x0 + 2, y - 14, 156 * (smittenT / C.SMITTEN_SECONDS), 10);
  }
  // active power-up indicators (icon + remaining bar)
  if (lib.powerups) {
    let ex = C.CANVAS_W / 2 + 120;
    const fx = [['thermos', speedT, C.POWERUPS.thermos.dur], ['boots', bootsT, C.POWERUPS.boots.dur],
                ['canary', canaryT, C.POWERUPS.canary.dur]];
    for (const [t, left, dur] of fx) {
      if (left <= 0) continue;
      ctx.drawImage(lib.powerups.get(t), ex, y - 20, 24, 24);
      ctx.fillStyle = '#141019'; ctx.fillRect(ex, y + 8, 24, 4);
      ctx.fillStyle = C.PALETTE.lanternGold;
      ctx.fillRect(ex, y + 8, 24 * (left / dur), 4);
      ex += 34;
    }
    if (shield) { ctx.drawImage(lib.powerups.get('gold-helmet'), ex, y - 20, 24, 24); ex += 34; }
  }
  ctx.drawImage(lib.hud.star, C.CANVAS_W - 220, y - C.HUD_ICON / 2 - 8);
  drawText(ctx, String(Math.round(displayScore)).padStart(6, '0'), C.CANVAS_W - 180, y - 8 + C.HUD_ICON / 2, 28, C.PALETTE.lanternGold, 'left');
  drawText(ctx, `[M] SOUND ${isMuted() ? 'OFF' : 'ON'}`, C.CANVAS_W - 24, C.CANVAS_H - 24, 18, 'rgba(242,233,220,0.45)', 'right');
  // clamp: at victory levelIndex has advanced past the last level
  const lvl = lib.levels[Math.min(levelIndex, lib.levels.length - 1)];
  drawText(ctx, lvl.name, C.CANVAS_W / 2, C.CANVAS_H - 24, 20, 'rgba(242,233,220,0.5)');
}

function drawWorld() {
  drawStage();
  const lvl = lib.levels[Math.min(levelIndex, lib.levels.length - 1)];
  if (lvl.tint) { ctx.fillStyle = lvl.tint; ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H); }
  for (const s of slides) s.draw(ctx);
  level.draw(ctx, lib);
  for (const el of elevators) el.draw(ctx);
  for (const pu of powerups) pu.draw(ctx);
  for (const p of pickups) p.draw(ctx);
  for (const m of mutants) m.draw(ctx);
  player.draw(ctx);
  particles.draw(ctx);
  drawHUD();
  toasts.draw(ctx);
}

function centerCard(lines) {
  const ease = Math.min(1, stateT / C.JUICE.cardEaseS);
  ctx.globalAlpha = ease;
  ctx.fillStyle = 'rgba(10,8,16,0.72)';
  ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
  let y = C.CANVAS_H / 2 - (lines.length - 1) * 30 + (1 - ease) * 24;
  for (const [text, size, color] of lines) {
    drawText(ctx, text, C.CANVAS_W / 2, y, size, color);
    y += size + 26;
  }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.clearRect(0, 0, C.CANVAS_W, C.CANVAS_H);

  if (state === 'loading') {
    ctx.fillStyle = C.PALETTE.shaftBlack;
    ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
    if (loadError) {
      drawText(ctx, 'ASSET LOAD FAILED', C.CANVAS_W / 2, C.CANVAS_H / 2 - 30, 40, C.PALETTE.bashfulPink);
      drawText(ctx, loadError, C.CANVAS_W / 2, C.CANVAS_H / 2 + 30, 18, C.PALETTE.boneWhite);
    } else {
      drawText(ctx, 'DESCENDING...', C.CANVAS_W / 2, C.CANVAS_H / 2 - 20, 36, C.PALETTE.lanternGold);
      ctx.fillStyle = '#141019';
      ctx.fillRect(C.CANVAS_W / 2 - 200, C.CANVAS_H / 2 + 20, 400, 18);
      ctx.fillStyle = C.PALETTE.bashfulPink;
      ctx.fillRect(C.CANVAS_W / 2 - 198, C.CANVAS_H / 2 + 22, 396 * loadProgress, 14);
    }
    return;
  }

  if (state === 'title') {
    ctx.drawImage(lib.title, 0, 0, C.CANVAS_W, C.CANVAS_H);
    const t = Math.min(1, stateT / C.JUICE.titleDropS);
    const easeOut = 1 - (1 - t) * (1 - t);
    const drop = -180 + 180 * easeOut;
    const bob = t >= 1 ? Math.sin(stateT * 2.2) * 5 : 0;
    drawText(ctx, 'MINER', C.CANVAS_W / 2, 130 + drop + bob, 96, C.PALETTE.lanternGold);
    drawText(ctx, '42069er', C.CANVAS_W / 2, 226 + drop + bob, 84, C.PALETTE.bashfulPink);
    ctx.globalAlpha = t;
    drawText(ctx, subtitle, C.CANVAS_W / 2, 300, 26, C.PALETTE.boneWhite);
    ctx.globalAlpha = 1;
    if (best > 0) drawText(ctx, `BEST ${String(best).padStart(6, '0')}`, C.CANVAS_W / 2, 352, 24, C.PALETTE.lanternGold);
    if ((performance.now() / 600 | 0) % 2 === 0)
      drawText(ctx, 'PRESS ENTER', C.CANVAS_W / 2, C.CANVAS_H - 150, 36, C.PALETTE.boneWhite);
    drawText(ctx, 'ARROWS/WASD move+climb · SPACE/Z jump · P pause · M mute', C.CANVAS_W / 2, C.CANVAS_H - 90, 22, 'rgba(242,233,220,0.8)');
    return;
  }

  ctx.save();
  if (shakeT > 0) {
    const decay = shakeT / shakeDur;
    ctx.translate(((Math.random() * 2 - 1) * shakeAmp * decay) | 0,
                  ((Math.random() * 2 - 1) * shakeAmp * decay) | 0);
  }
  drawWorld();
  ctx.restore();
  if (redFlash > 0) {
    ctx.globalAlpha = (redFlash / C.JUICE.redFlashS) * 0.3;
    ctx.fillStyle = '#c1121f';
    ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
    ctx.globalAlpha = 1;
  }

  if (state === 'intro') {
    const def = lib.levels[levelIndex];
    centerCard([
      [`LEVEL ${levelIndex + 1}: ${def.name}`, 48, C.PALETTE.lanternGold],
      [def.introLine, 26, C.PALETTE.boneWhite],
    ]);
  } else if (state === 'clear') {
    centerCard([
      ['SECTION CLAIMED!', 52, C.PALETTE.bashfulPink],
      [`TIME BONUS +${clearBonus}`, 30, C.PALETTE.lanternGold],
    ]);
  } else if (state === 'paused') {
    centerCard([
      ['PAUSED', 52, C.PALETTE.boneWhite],
      ['P to resume · M to mute', 24, C.PALETTE.boneWhite],
    ]);
  } else if (state === 'gameover') {
    centerCard([
      ['GAME OVER', 64, C.PALETTE.bashfulPink],
      [C.GAMEOVER_LINE, 28, C.PALETTE.boneWhite],
      [`SCORE ${score}`, 34, C.PALETTE.lanternGold],
      [newBest ? 'NEW BEST!' : `BEST ${best}`, 24, newBest ? C.PALETTE.bashfulPink : C.PALETTE.boneWhite],
      [`ENTER continue at level ${continueLevel + 1} · R start over`, 24, C.PALETTE.boneWhite],
    ]);
  } else if (state === 'victory') {
    centerCard([
      ['SHIFT COMPLETE', 64, C.PALETTE.lanternGold],
      [C.VICTORY_LINE, 28, C.PALETTE.boneWhite],
      [`FINAL SCORE ${score}`, 36, C.PALETTE.bashfulPink],
      [continues === 0 ? 'NO CONTINUES — LEGEND OF THE MINE' : `(${continues} continue${continues > 1 ? 's' : ''})`, 24, continues === 0 ? C.PALETTE.lanternGold : C.PALETTE.boneWhite],
      [newBest ? 'NEW BEST!' : `BEST ${best}`, 24, newBest ? C.PALETTE.bashfulPink : C.PALETTE.boneWhite],
      ['ENTER to dig again', 24, C.PALETTE.boneWhite],
    ]);
  }
}

// -------------------------------------------------------------------- loop

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); // clamp long tab-away frames
  last = now;

  if (pressed.has('mute')) {
    const m = toggleMute();
    toasts.push(m ? 'MUTED' : 'SOUND ON', C.PALETTE.boneWhite);
  }
  shakeT = Math.max(0, shakeT - dt);
  redFlash = Math.max(0, redFlash - dt);
  displayScore += (score - displayScore) * Math.min(1, dt * C.JUICE.scoreTweenRate);
  if (Math.abs(score - displayScore) < 1) displayScore = score;
  if (state === 'paused') {
    if (pressed.has('pause')) { go('playing'); sfx.select(); }
    pressed.clear();
    stateT += dt;
    draw();           // paused halts simulation, not rendering
  } else if (freezeT > 0) {
    freezeT -= dt;    // hit-pause: render only
    pressed.clear();
    draw();
  } else {
    update(dt);
    draw();
  }
  requestAnimationFrame(frame);
}

boot();
requestAnimationFrame(frame);

// Read-only state probe for the scripted playtest driver (not a gameplay input).
window.__MINER = {
  get state() { return state; },
  get score() { return score; },
  get lives() { return lives; },
  get level() { return levelIndex; },
  get timer() { return timer; },
  get claimed() { return level ? `${level.claimedCount}/${level.totalSegments}` : ''; },
  get px() { return player ? player.x : -1; },
  get py() { return player ? player.y : -1; },
  get smitten() { return smittenT; },
  get mutants() { return mutants.map(m => ({ x: m.x, y: m.y, dead: m.dead, dir: m.dir, type: m.type })); },
  get platClaims() { return level ? level.platforms.map(p => p.claimed.filter(Boolean).length) : []; },
  // One-call snapshot so the scripted driver's control loop stays fast.
  get snap() {
    return {
      state, score, lives, timer, smitten: smittenT,
      px: player ? player.x : -1, py: player ? player.y : -1,
      grounded: player ? player.grounded : false,
      climbing: player ? player.state === 'climb' : false,
      mutants: mutants.map(m => ({ x: m.x, y: m.y, dead: m.dead, dir: m.dir, type: m.type })),
      elevators: elevators.map(e => ({ x: e.x, y: e.y, dir: e.dir })),
      sliding: player ? player.state === 'slide' : false,
      shield, speedT, bootsT, canaryT, continues,
      riding: player ? !!player.riding : false,
      platClaims: level ? level.platforms.map(p => p.claimed.filter(Boolean).length) : [],
      platSegs: level ? level.platforms.map(p => p.claimed.slice()) : [],
      platCrumbled: level ? level.platforms.map(p => p.crumbled.slice()) : [],
      claimedCount: level ? level.claimedCount : 0,
      totalSegments: level ? level.totalSegments : 0,
      level: levelIndex,
    };
  },
};
