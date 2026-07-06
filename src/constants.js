// All tuning numbers live here (tech-plan contract).

export const CANVAS_W = 1536;
export const CANVAS_H = 864;

// Physics
export const GRAVITY = 1800;          // px/s^2
export const RUN_SPEED = 260;         // px/s
export const JUMP_VELOCITY = 590;     // gives ~96px apex
export const CLIMB_SPEED = 180;       // px/s
// One-row drops (walk-off 120, jump-down ~216) are safe; two-row drops (240+) kill.
export const FALL_KILL_DISTANCE = 230;
export const LADDER_HALF_WIDTH = 14;  // mount zone around ladder center

// Render sizes (style-bible per-class size table)
export const HERO_H = 64;
export const SMOOCHER_H = 48;
export const CUDDLER_H = 44;
export const SEGMENT_W = 96;          // platform mid cell
export const PLATFORM_H = 32;
export const CAP_W = 32;
export const LADDER_W = 48;
export const LADDER_TILE_H = 64;
export const PICKUP_SIZE = 32;
export const HUD_ICON = 28;

// Rules
export const START_LIVES = 3;
export const SMITTEN_SECONDS = 7;
export const SMITTEN_SLOW = 0.6;
export const MUTANT_RESPAWN_SECONDS = 5;
export const CUDDLER_SPEED_FACTOR = 1.4;

// Scoring
export const SCORE_CLAIM = 25;
export const SCORE_BOP = 500;
export const SCORE_TIME_BONUS_PER_SECOND = 10;
export const PROPHECY_SCORE = 42069;  // exact hit = bonus life
export const NICE_MULTIPLE = 420;
export const PICKUP_SCORES = {
  'boxers': 150, 'magazine': 150, 'lava-lamp': 150, 'rubber-duck': 150,
  'soap': 150, 'cologne': 200, 'batteries': 150, 'banana': 150,
  'golden-pickaxe': 300,
};

// The wink lives in text only (GDD humor contract).
export const PICKUP_TOASTS = {
  'boxers': "Uncle Randy's lucky boxers. Still lucky?",
  'magazine': "'Ore Enthusiast Monthly.' He read it for the articles.",
  'lava-lamp': "Sets the mood. The mood is 'mine shaft'.",
  'rubber-duck': "Why is this down here? Don't ask.",
  'soap': "Drop it and keep walking.",
  'cologne': "One spritz drives the mutants wild.",
  'batteries': "Long-lasting. For the headlamp. Obviously.",
  'banana': "It's just a banana. Probably.",
  'golden-pickaxe': "Now THAT's a tool.",
};
export const TITLE_SUBTITLES = [
  'A deep experience.',
  'Mine games.',
  'Get down here and dig.',
  "Uncle Randy's pride and joy.",
];
export const GAMEOVER_LINE = 'Shaft happens.';
export const VICTORY_LINE = 'Dusty finally hit the motherlode.';

// Animation fps + loop policy (style-bible table; frame counts come from pipeline-meta)
export const ANIM = {
  heroIdle:   { fps: 6,  loop: true },
  heroRun:    { fps: 10, loop: true },
  heroJump:   { fps: 0,  loop: false }, // phase-mapped to physics, not clock
  heroClimb:  { fps: 8,  loop: true },
  heroHurt:   { fps: 8,  loop: false },
  mutantWalk: { fps: 8,  loop: true },
  smitten:    { fps: 6,  loop: true },
};

export const PARTICLE_CAP = 256;

// Juice budgets (quality-bar §4): shake capped ≤8px, decays <300ms, no stacking.
export const JUICE = {
  hitPauseDeathS: 0.07,
  hitPauseBopS: 0.045,
  shakeDeathAmp: 8, shakeDeathS: 0.28,
  shakeBopAmp: 4, shakeBopS: 0.18,
  redFlashS: 0.22,
  spawnInvulnS: 1.5,      // respawn grace so a wandering mutant can't chain-kill
  scoreTweenRate: 10,     // score display catch-up factor per second
  cardEaseS: 0.25,        // state-card fade-in
  titleDropS: 0.6,        // logo drop-in on title entry
};

export const MUSIC = { gain: 0.05, bpm: 96, urgentAt: 15 };

// v1.1 — movers, winker, combo, fireworks
export const WINKER_H = 40;            // render height; center-anchored flyer
export const WINKER_BOB = 24;          // hover sine amplitude (px)
export const WINKER_BOB_RATE = 3;      // rad/s
export const ELEVATOR = { w: 128, slabH: 24, speed: 90, pauseS: 0.8 };
// stride < tile so consecutive tiles overlap past the band thickness (~26px
// rendered); artSink drops the art so its rail top meets the gameplay line.
export const SLIDE = { tile: 96, stride: 64, artSink: 6, speed: 300 };

// v2 — enemies, power-ups, map mechanics
export const GRABBY_H = 44;
export const GRABBY = { dashMult: 2.2, dashS: 0.6, pauseS: 0.7 };
export const FLOATY_H = 44;
export const FLOATY_RATE = 1.4;          // rad/s vertical oscillation
export const PRUDE_H = 52;
export const PRUDE_SPEED_FACTOR = 0.8;

export const POWERUP_SIZE = 32;
export const SCORE_POWERUP = 100;
export const SPEED_MULT = 1.35;          // thermos
export const BOOTS_JUMP_MULT = 1.22;     // apex ~143px: one-row hops from below
export const BOOTS_FALL_BONUS = 70;      // extra fall tolerance while booted
export const POWERUPS = {
  'thermos':     { dur: 10, toast: "Foreman's brew. Wakes the dead shift." },
  'boots':       { dur: 10, toast: "Uncle Randy's spring boots. Boing responsibly." },
  'canary':      { dur: 8,  toast: "The canary sings; the clock listens." },
  'gold-helmet': { dur: 0,  toast: "Hard hat area." },
};
export const PRUDE_SHIELD_TOAST = "The Prude confiscated your helmet. Naturally.";

export const CRUMBLE_DELAY_S = 1.2;
export const CONVEYOR_SPEED = 70;        // player drift while standing on a belt
export const CONVEYOR_SCROLL = 44;       // belt texture scroll px/s
export const MECH_CELL_W = 96;
export const MECH_CELL_H = 32;
export const COMBO = { windowS: 2.0, every: 10, bonus: 250 };
export const FIREWORK_INTERVAL_S = 0.55;
export const BEST_KEY = 'miner42069er_best';

export const PALETTE = {
  shaftBlack: '#141019',
  timberBrown: '#6e4a2d',
  bashfulPink: '#ff5da2',
  denimBlue: '#3fa7ff',
  lanternGold: '#ffd24a',
  gobGreen: '#8cd94a',
  boneWhite: '#f2e9dc',
};

export const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ'],
  start: ['Enter'],
  restart: ['KeyR'],
  pause: ['KeyP'],
  mute: ['KeyM'],
};
