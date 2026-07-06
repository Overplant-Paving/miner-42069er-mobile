// Core gameplay: level geometry, player, mutants, pickups, claiming, scoring.
import * as C from './constants.js';
import { AnimPlayer, drawText } from './engine.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------- particles

export class Particles {
  constructor() {
    this.pool = Array.from({ length: C.PARTICLE_CAP }, () => ({ alive: false }));
  }
  spawn(x, y, { vx = 0, vy = 0, life = 0.6, color = '#fff', size = 4, gravity = 0, type = 'dot' }) {
    const p = this.pool.find(p => !p.alive);
    if (!p) return; // hard cap enforced
    Object.assign(p, { alive: true, x, y, vx, vy, life, maxLife: life, color, size, gravity, type });
  }
  burst(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * (opts.speed || 120);
      this.spawn(x, y, { ...opts, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (opts.up || 0) });
    }
  }
  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  draw(ctx) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size;
      if (p.type === 'heart') {
        // Two squares + tip triangle reads as a chunky pixel heart.
        ctx.fillRect(p.x - s, p.y - s, s, s);
        ctx.fillRect(p.x, p.y - s, s, s);
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------- toasts

export class Toasts {
  constructor() { this.items = []; }
  push(text, color = C.PALETTE.boneWhite, big = false) {
    this.items.push({ text, color, big, t: 0, dur: 2.2 });
    if (this.items.length > 3) this.items.shift();
  }
  update(dt) {
    for (const t of this.items) t.t += dt;
    this.items = this.items.filter(t => t.t < t.dur);
  }
  draw(ctx) {
    let y = 120;
    for (const t of this.items) {
      const fade = t.t < 0.15 ? t.t / 0.15 : t.t > t.dur - 0.4 ? (t.dur - t.t) / 0.4 : 1;
      const rise = Math.min(1, t.t / 0.15) * 0; // eased in place
      ctx.globalAlpha = Math.max(0, fade);
      drawText(ctx, t.text, C.CANVAS_W / 2, y + rise, t.big ? 40 : 26, t.color);
      ctx.globalAlpha = 1;
      y += t.big ? 52 : 36;
    }
  }
}

// -------------------------------------------------------------------- level

// Platform span: [x, x + 2*CAP_W + segments*SEGMENT_W], top surface at y.
// Claimable segments are the mid cells between the caps.
export class Level {
  constructor(def) {
    this.def = def;
    this.platforms = def.platforms.map(p => ({
      x: p.x, y: p.y, segments: p.segments,
      width: 2 * C.CAP_W + p.segments * C.SEGMENT_W,
      claimed: new Array(p.segments).fill(false),
    }));
    this.ladders = def.ladders;
    for (let pi = 0; pi < this.platforms.length; pi++) {
      const p = this.platforms[pi];
      p.crumble = new Set((def.platforms[pi].crumble || []));
      p.crumbled = new Array(p.segments).fill(false);
      p.touched = new Array(p.segments).fill(false);
      p.crumbleT = new Array(p.segments).fill(null);
    }
    // Solid non-claimable strips: conveyors push riders; spikes kill on contact.
    this.conveyors = (def.conveyors || []).map(c => ({
      x: c.x, y: c.y, w: c.cells * C.MECH_CELL_W, dir: c.dir, cells: c.cells }));
    this.spikes = (def.spikes || []).map(s => ({
      x: s.x, y: s.y, w: s.cells * C.MECH_CELL_W, cells: s.cells }));
    this.falling = [];   // collapsing plank tweens
    this.totalSegments = this.platforms.reduce((n, p) => n + p.segments, 0);
    this.claimedCount = 0;
  }

  segSolid(p, x) {
    const local = x - (p.x + C.CAP_W);
    if (local < 0 || local >= p.segments * C.SEGMENT_W) return true; // caps
    return !p.crumbled[(local / C.SEGMENT_W) | 0];
  }
  conveyorAt(x, y) {
    for (const c of this.conveyors)
      if (Math.abs(y - c.y) <= 2 && x >= c.x && x <= c.x + c.w) return c.dir;
    return 0;
  }
  spikeAt(x, y) {
    for (const s of this.spikes)
      if (Math.abs(y - s.y) <= 3 && x >= s.x - 6 && x <= s.x + s.w + 6) return true;
    return false;
  }

  // Crumble lifecycle: a claimed crumble segment arms when stood on, then
  // collapses CRUMBLE_DELAY_S after it is left (no take-backs).
  updateMechanics(dt, player, onCrack) {
    for (const p of this.platforms) {
      for (const i of p.crumble) {
        if (p.crumbled[i]) continue;
        const segX = p.x + C.CAP_W + i * C.SEGMENT_W;
        const on = player.grounded && Math.abs(player.y - p.y) <= 2 &&
                   player.x >= segX && player.x < segX + C.SEGMENT_W;
        if (on) p.touched[i] = true;
        else if (p.touched[i] && p.crumbleT[i] === null) p.crumbleT[i] = C.CRUMBLE_DELAY_S;
        if (p.crumbleT[i] !== null) {
          p.crumbleT[i] -= dt;
          if (p.crumbleT[i] <= 0) {
            p.crumbled[i] = true;
            this.falling.push({ x: segX, y: p.y, t: 0 });
            onCrack(segX + C.SEGMENT_W / 2, p.y);
          }
        }
      }
    }
    for (const f of this.falling) f.t += dt;
    this.falling = this.falling.filter(f => f.t < 0.7);
  }
  get complete() { return this.claimedCount >= this.totalSegments; }

  // Returns { platform, segment } for a grounded foot position, or null.
  segmentAt(x, y) {
    for (const p of this.platforms) {
      if (Math.abs(y - p.y) > 2) continue;
      const local = x - (p.x + C.CAP_W);
      if (local < 0 || local >= p.segments * C.SEGMENT_W) continue;
      return { platform: p, segment: (local / C.SEGMENT_W) | 0 };
    }
    return null;
  }

  claim(p, i) {
    if (p.claimed[i]) return false;
    p.claimed[i] = true;
    this.claimedCount++;
    return true;
  }

  // One-way landing: crossing a solid top from above while overlapping its span
  // (platform segments may be crumbled away; strips are always solid).
  landingY(x, prevFeetY, feetY) {
    let best = null;
    for (const p of this.platforms) {
      if (x < p.x || x > p.x + p.width || !this.segSolid(p, x)) continue;
      if (prevFeetY <= p.y + 0.01 && feetY >= p.y) {
        if (best === null || p.y < best) best = p.y;
      }
    }
    for (const s of [...this.conveyors, ...this.spikes]) {
      if (x < s.x || x > s.x + s.w) continue;
      if (prevFeetY <= s.y + 0.01 && feetY >= s.y) {
        if (best === null || s.y < best) best = s.y;
      }
    }
    return best;
  }

  groundAt(x, feetY) {
    for (const p of this.platforms) {
      if (Math.abs(feetY - p.y) <= 2 && x >= p.x && x <= p.x + p.width && this.segSolid(p, x)) return p;
    }
    for (const s of [...this.conveyors, ...this.spikes]) {
      if (Math.abs(feetY - s.y) <= 2 && x >= s.x && x <= s.x + s.w) return s;
    }
    return null;
  }

  ladderAt(x, feetY) {
    for (const l of this.ladders) {
      if (Math.abs(x - l.x) <= C.LADDER_HALF_WIDTH * 2 &&
          feetY >= l.yTop - 4 && feetY <= l.yBottom + 4) return l;
    }
    return null;
  }

  draw(ctx, lib) {
    // Ladders behind platforms.
    for (const l of this.ladders) {
      for (let y = l.yTop; y < l.yBottom; y += C.LADDER_TILE_H) {
        const h = Math.min(C.LADDER_TILE_H, l.yBottom - y);
        ctx.drawImage(lib.ladder, 0, 0, lib.ladder.width, h / C.LADDER_TILE_H * lib.ladder.height,
          Math.round(l.x - C.LADDER_W / 2), Math.round(y), C.LADDER_W, Math.round(h));
      }
    }
    for (const p of this.platforms) {
      const allClaimed = p.claimed.every(Boolean);
      const set = allClaimed ? lib.platformClaimed : lib.platform;
      ctx.drawImage(set.left, Math.round(p.x), Math.round(p.y), C.CAP_W, C.PLATFORM_H);
      for (let i = 0; i < p.segments; i++) {
        const dx = Math.round(p.x + C.CAP_W + i * C.SEGMENT_W), dy = Math.round(p.y);
        if (p.crumble.has(i)) {
          if (p.crumbled[i]) continue;                      // gone — a real hole
          ctx.drawImage(lib.plank, dx, dy, C.SEGMENT_W, C.PLATFORM_H);
          if (p.crumbleT[i] !== null) {                     // armed: shiver
            ctx.drawImage(lib.plank, dx + ((Math.random() * 3) | 0) - 1, dy, C.SEGMENT_W, C.PLATFORM_H);
          }
          if (p.claimed[i]) {                               // claim tint (runtime grade)
            ctx.globalAlpha = 0.3;
            ctx.fillStyle = C.PALETTE.bashfulPink;
            ctx.fillRect(dx, dy, C.SEGMENT_W, 8);
            ctx.globalAlpha = 1;
          }
        } else {
          const mid = p.claimed[i] ? lib.platformClaimed.mid : lib.platform.mid;
          ctx.drawImage(mid, dx, dy, C.SEGMENT_W, C.PLATFORM_H);
        }
      }
      ctx.drawImage(set.right, Math.round(p.x + C.CAP_W + p.segments * C.SEGMENT_W),
        Math.round(p.y), C.CAP_W, C.PLATFORM_H);
    }
    for (const f of this.falling) {   // collapsing planks tumble away
      ctx.globalAlpha = Math.max(0, 1 - f.t / 0.7);
      ctx.drawImage(lib.plank, Math.round(f.x), Math.round(f.y + f.t * f.t * 700), C.SEGMENT_W, C.PLATFORM_H);
      ctx.globalAlpha = 1;
    }
    const scroll = (performance.now() / 1000 * C.CONVEYOR_SCROLL) % C.MECH_CELL_W;
    for (const c of this.conveyors) {
      const o = Math.round(c.dir > 0 ? scroll : C.MECH_CELL_W - scroll);
      for (let i = 0; i < c.cells; i++) {
        const dx = Math.round(c.x + i * C.MECH_CELL_W), dy = Math.round(c.y);
        // two source slices wrap the belt texture for an endless scroll
        ctx.drawImage(lib.conveyor, o, 0, C.MECH_CELL_W - o, C.MECH_CELL_H, dx, dy, C.MECH_CELL_W - o, C.MECH_CELL_H);
        if (o > 0) ctx.drawImage(lib.conveyor, 0, 0, o, C.MECH_CELL_H, dx + C.MECH_CELL_W - o, dy, o, C.MECH_CELL_H);
      }
    }
    for (const s of this.spikes) {
      for (let i = 0; i < s.cells; i++) {
        ctx.drawImage(lib.spikes, Math.round(s.x + i * C.MECH_CELL_W), Math.round(s.y - C.MECH_CELL_H + C.PLATFORM_H),
          C.MECH_CELL_W, C.MECH_CELL_H);
      }
    }
  }
}

// ------------------------------------------------------------------- player

export class Player {
  constructor(lib, level, spawn) {
    this.lib = lib;
    this.level = level;
    this.anim = new AnimPlayer(lib.heroIdle);
    this.respawn(spawn);
  }
  respawn(spawn, invulnS = 0) {
    this.x = spawn.x; this.y = spawn.y;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.state = 'idle'; // idle|run|jump|climb|hurt
    this.grounded = true;
    this.ladder = null;
    this.peakY = this.y;
    this.hurtT = 0;
    this.invulnT = invulnS;
    this.riding = null;    // elevator being stood on
    this.slide = null;     // slide being ridden
    this.climbLock = false; // set on ladder exit: release up/down to remount
    this.anim.set(this.lib.heroIdle);
  }

  update(dt, input, events) {
    const L = this.level;
    this.invulnT = Math.max(0, (this.invulnT || 0) - dt);
    if (this.state === 'hurt') {
      this.hurtT += dt;
      // eased knockback drift away from the facing direction, no teleport
      this.x -= this.facing * 90 * Math.max(0, 1 - this.hurtT * 2) * dt;
      this.anim.update(dt);
      return;
    }

    if (this.state === 'climb') {
      const dir = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      this.y += dir * C.CLIMB_SPEED * ((input.effects || {}).speedMult || 1) * dt;
      if (dir !== 0) this.anim.update(dt);
      const l = this.ladder;
      if (this.y <= l.yTop) { this.y = l.yTop; this.exitClimb(); }
      else if (this.y >= l.yBottom) { this.y = l.yBottom; this.exitClimb(); }
      return;
    }

    if (this.state === 'slide') {
      const s = this.slide;
      this.x += C.SLIDE.speed * 0.707 * s.dir * dt;
      this.y = s.surfaceY(this.x);
      this.peakY = this.y;               // sliding never accrues fall distance
      this.facing = s.dir;
      const done = s.dir === 1 ? this.x >= s.xBottom : this.x <= s.xBottom;
      if (done) {
        this.x = s.xBottom; this.y = s.yBottom;
        this.slide = null;
        this.state = 'idle';
        this.grounded = false;           // physics lands us on the platform below
        this.vy = 0;
        this.anim.set(this.lib.heroIdle);
      }
      return;
    }

    if (!input.up && !input.down) this.climbLock = false;
    // Horizontal (thermos boosts, conveyors drift)
    const fx = input.effects || {};
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    this.vx = dir * C.RUN_SPEED * (fx.speedMult || 1);
    if (dir !== 0) this.facing = dir;
    this.x += this.vx * dt;
    if (this.grounded) this.x += L.conveyorAt(this.x, this.y) * C.CONVEYOR_SPEED * dt;
    this.x = Math.max(16, Math.min(C.CANVAS_W - 16, this.x));

    // Ladder mount (up or down onto a ladder zone); a fresh press is required
    // after exiting a climb so stacked ladders don't chain past a landing.
    if ((input.up || input.down) && this.grounded && !this.climbLock) {
      const l = L.ladders.find(l => Math.abs(this.x - l.x) <= C.LADDER_HALF_WIDTH &&
        ((input.down && Math.abs(this.y - l.yTop) <= 2) ||
         (input.up && Math.abs(this.y - l.yBottom) <= 2)));
      if (l) {
        this.ladder = l;
        this.state = 'climb';
        this.x = l.x;
        this.grounded = false;
        this.vy = 0;
        this.anim.set(this.lib.heroClimb);
        return;
      }
    }

    // Jump (boots boost)
    if (input.jumpPressed && this.grounded) {
      this.vy = -C.JUMP_VELOCITY * ((input.effects || {}).jumpMult || 1);
      this.grounded = false;
      this.riding = null;
      this.peakY = this.y;
      events.jump();
    }

    // Vertical
    if (!this.grounded) {
      const prevFeet = this.y;
      this.vy += C.GRAVITY * dt;
      this.y += this.vy * dt;
      this.peakY = Math.min(this.peakY, this.y);
      if (this.vy > 0) {
        // Slide entry: feet cross the chute's diagonal surface
        for (const s of (this.world?.slides || [])) {
          if (!s.contains(this.x)) continue;
          const sy = s.surfaceY(this.x);
          if (prevFeet <= sy + 2 && this.y >= sy - 2) {
            this.slide = s;
            this.state = 'slide';
            this.x = Math.max(Math.min(this.x, Math.max(s.xTop, s.xBottom)), Math.min(s.xTop, s.xBottom));
            this.y = s.surfaceY(this.x);
            this.peakY = this.y;
            this.vy = 0;
            this.anim.set(this.lib.heroJump); // fall pose while sliding
            events.slideStart();
            return;
          }
        }
        // Elevator landing (elevators update before the player each frame)
        for (const el of (this.world?.elevators || [])) {
          if (this.x < el.x0 || this.x > el.x1) continue;
          if (prevFeet <= el.prevY + 2 && this.y >= el.y - 2) {
            this.y = el.y;
            this.vy = 0;
            this.grounded = true;
            this.riding = el;
            events.land(this.y - this.peakY);
            break;
          }
        }
        if (!this.grounded) {
          const landY = L.landingY(this.x, prevFeet, this.y);
          if (landY !== null) {
            this.y = landY;
            this.vy = 0;
            this.grounded = true;
            const fall = this.y - this.peakY;
            events.land(fall);
          }
        }
      }
      if (this.y > C.CANVAS_H + 80) events.fellOut();
    } else if (this.riding) {
      // Carried by the elevator; step off if we leave its span
      if (this.x < this.riding.x0 || this.x > this.riding.x1) {
        this.riding = null;
        this.grounded = false;
        this.vy = 0;
        this.peakY = this.y;
      } else {
        this.y = this.riding.y;
        this.peakY = this.y;
      }
    } else {
      // Walked off an edge?
      if (!L.groundAt(this.x, this.y)) {
        this.grounded = false;
        this.vy = 0;
        this.peakY = this.y;
      }
    }

    // Claim the segment underfoot
    if (this.grounded) {
      const hit = L.segmentAt(this.x, this.y);
      if (hit && L.claim(hit.platform, hit.segment)) {
        events.claim(hit.platform.x + C.CAP_W + (hit.segment + 0.5) * C.SEGMENT_W, hit.platform.y);
      }
    }

    // State + animation selection
    let next;
    if (!this.grounded) next = 'jump';
    else if (dir !== 0) next = 'run';
    else next = 'idle';
    if (next !== this.state) {
      this.state = next;
      this.anim.set(next === 'jump' ? this.lib.heroJump : next === 'run' ? this.lib.heroRun : this.lib.heroIdle);
    }
    this.anim.update(dt);
  }

  exitClimb() {
    this.ladder = null;
    this.state = 'idle';
    this.grounded = true;
    this.climbLock = true;   // stop here; release and re-press to keep climbing
    this.anim.set(this.lib.heroIdle);
  }

  hurt() {
    this.state = 'hurt';
    this.hurtT = 0;
    this.anim.set(this.lib.heroHurt);
    this.anim.t = 0;
  }

  // Jump frames map to physics phase (crouch/rise/apex/fall), not the clock.
  draw(ctx) {
    // spawn-grace blink: skip alternating slices while invulnerable
    if (this.invulnT > 0 && ((this.invulnT * 12) | 0) % 2 === 0) return;
    let frameOverride;
    if (this.state === 'jump') {
      frameOverride = this.vy < -220 ? 1 : Math.abs(this.vy) <= 220 ? 2 : 3;
    }
    this.anim.draw(ctx, Math.round(this.x), Math.round(this.y), this.facing === -1, frameOverride);
  }

  get hitbox() {
    const w = 30, h = C.HERO_H - 10;
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }
}

// ------------------------------------------------------------------- mutant

export class Mutant {
  // Ground types patrol a platform. 'winker' flies a horizontal span with a
  // sine bob; 'floaty' oscillates vertically in a fixed column; 'grabby'
  // patrols in dash/pause bursts; 'prude' is immune to smitten (scoffs).
  constructor(lib, def, level, speed) {
    this.lib = lib;
    this.type = def.type;
    this.speed = speed;
    this.dir = def.dir ?? 1;
    this.flying = this.type === 'winker';
    this.vertical = this.type === 'floaty';
    this.immune = this.type === 'prude';
    this.bursty = this.type === 'grabby';
    this.burstT = 0;
    if (this.flying) {
      this.x0 = def.x0; this.x1 = def.x1;
      this.baseY = def.y;
      this.spawnX = (def.x0 + def.x1) / 2;
      this.bobT = 0;
      this.y = this.baseY;
    } else if (this.vertical) {
      this.x = def.x; this.spawnX = def.x;
      this.y0 = def.y0; this.y1 = def.y1;   // top / bottom of the column
      this.bobT = def.phase ?? 0;
      this.y = (def.y0 + def.y1) / 2;
    } else {
      this.platform = level.platforms[def.platform];
      this.spawnX = this.platform.x + C.CAP_W + this.platform.segments * C.SEGMENT_W / 2;
      this.y = this.platform.y;
    }
    if (!this.vertical) this.x = this.spawnX;
    this.dead = false;
    this.respawnT = 0;
    this.anims = lib.mutants[this.type];
    this.anim = new AnimPlayer(
      this.flying ? this.anims.fly : this.vertical ? this.anims.float : this.anims.walk);
  }
  update(dt, smitten) {
    if (this.dead) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) { this.dead = false; this.x = this.spawnX; }
      return;
    }
    const affected = smitten && !this.immune;
    if (this.immune) {
      // The Prude: never smitten — stops to scoff while the others blush.
      this.anim.set(smitten ? this.anims.scoff : this.anims.walk);
    } else {
      this.anim.set(affected ? this.anims.smitten
        : (this.flying ? this.anims.fly : this.vertical ? this.anims.float : this.anims.walk));
    }
    let speed = affected ? this.speed * C.SMITTEN_SLOW : this.speed;
    if (this.immune && smitten) speed = 0;
    if (this.bursty) {
      this.burstT = (this.burstT + dt) % (C.GRABBY.dashS + C.GRABBY.pauseS);
      speed *= this.burstT < C.GRABBY.dashS ? C.GRABBY.dashMult : 0;
    }
    if (this.vertical) {
      this.bobT += dt * C.FLOATY_RATE * (affected ? 0.5 : 1);
      const mid = (this.y0 + this.y1) / 2, amp = (this.y1 - this.y0) / 2;
      this.y = mid + Math.sin(this.bobT) * amp;
      this.anim.update(dt);
      return;
    }
    if (this.flying) {
      this.bobT += dt * C.WINKER_BOB_RATE * (smitten ? 0.5 : 1);
      this.y = this.baseY + Math.sin(this.bobT) * C.WINKER_BOB;
      this.x += this.dir * speed * 0.8 * dt;
      if (this.x < this.x0) { this.x = this.x0; this.dir = 1; }
      if (this.x > this.x1) { this.x = this.x1; this.dir = -1; }
    } else {
      this.x += this.dir * speed * dt;
      const min = this.platform.x + 20;
      const max = this.platform.x + this.platform.width - 20;
      if (this.x < min) { this.x = min; this.dir = 1; }
      if (this.x > max) { this.x = max; this.dir = -1; }
    }
    this.anim.update(dt);
  }
  bop(seconds) { this.dead = true; this.respawnT = seconds; }
  draw(ctx) {
    if (this.dead) return;
    // flyers/bobbers are center-anchored: convert to the feet-anchored draw
    const half = this.flying ? C.WINKER_H / 2 : this.vertical ? C.FLOATY_H / 2 : 0;
    this.anim.draw(ctx, Math.round(this.x), Math.round(this.y + half), this.dir === -1);
  }
  get hitbox() {
    if (this.flying || this.vertical) {
      const s = (this.flying ? C.WINKER_H : C.FLOATY_H) - 4;
      return { x: this.x - s / 2, y: this.y - s / 2, w: s, h: s };
    }
    if (this.type === 'cuddler') return { x: this.x - 30, y: this.y - (C.CUDDLER_H - 6), w: 60, h: C.CUDDLER_H - 6 };
    if (this.type === 'grabby') return { x: this.x - 24, y: this.y - (C.GRABBY_H - 6), w: 48, h: C.GRABBY_H - 6 };
    if (this.type === 'prude') return { x: this.x - 19, y: this.y - (C.PRUDE_H - 6), w: 38, h: C.PRUDE_H - 6 };
    return { x: this.x - 19, y: this.y - (C.SMOOCHER_H - 6), w: 38, h: C.SMOOCHER_H - 6 };
  }
}

// ----------------------------------------------------------- movers (v1.1)

export class Elevator {
  constructor(sprite, def) {
    this.sprite = sprite;           // prescaled canvas, slab at the bottom
    this.x = def.x;                 // center
    this.yTop = def.yTop;
    this.yBottom = def.yBottom;
    this.y = def.yBottom;           // current top surface
    this.prevY = this.y;
    this.dir = -1;                  // start rising
    this.pauseT = 0;
  }
  get x0() { return this.x - C.ELEVATOR.w / 2; }
  get x1() { return this.x + C.ELEVATOR.w / 2; }
  update(dt) {
    this.prevY = this.y;
    if (this.pauseT > 0) { this.pauseT -= dt; return; }
    this.y += this.dir * C.ELEVATOR.speed * dt;
    if (this.y <= this.yTop) { this.y = this.yTop; this.dir = 1; this.pauseT = C.ELEVATOR.pauseS; }
    if (this.y >= this.yBottom) { this.y = this.yBottom; this.dir = -1; this.pauseT = C.ELEVATOR.pauseS; }
  }
  draw(ctx) {
    // align the slab's top edge (bottom C.ELEVATOR.slabH of the sprite) to y
    const top = this.y + C.ELEVATOR.slabH - this.sprite.height;
    ctx.drawImage(this.sprite, Math.round(this.x0), Math.round(top));
  }
}

export class Slide {
  constructor(sprite, def) {
    this.sprite = sprite;           // square tile, chute runs TL→BR
    this.xTop = def.xTop;
    this.yTop = def.yTop;
    this.dir = def.dir ?? 1;        // +1 = down-right
    this.drop = def.drop;
    this.xBottom = def.xTop + def.dir * def.drop;
    this.yBottom = def.yTop + def.drop;
  }
  contains(x) {
    const lo = Math.min(this.xTop, this.xBottom), hi = Math.max(this.xTop, this.xBottom);
    return x >= lo && x <= hi;
  }
  surfaceY(x) { return this.yTop + (x - this.xTop) * this.dir; }
  // Overlap-stride tiling: the chute art is a uniform 45° band, so tiles drawn
  // at any diagonal offset share one continuous surface line and later opaque
  // tiles overwrite the junction wedge (deterministic seam fix, no art change).
  draw(ctx) {
    const t = C.SLIDE.tile, stride = C.SLIDE.stride, sink = C.SLIDE.artSink;
    const offs = [];
    for (let o = 0; o <= this.drop - t; o += stride) offs.push(o);
    if (offs[offs.length - 1] !== this.drop - t) offs.push(this.drop - t);
    for (const o of offs) {
      const y = Math.round(this.yTop + o + sink);
      if (this.dir === 1) {
        ctx.drawImage(this.sprite, Math.round(this.xTop + o), y);
      } else {
        ctx.save();
        ctx.translate(Math.round(this.xTop - o), y);
        ctx.scale(-1, 1);
        ctx.drawImage(this.sprite, -t, 0);
        ctx.restore();
      }
    }
  }
}

// ------------------------------------------------------------------- pickup

export class Pickup {
  constructor(lib, item, x, y) {
    this.item = item;
    this.sprite = lib.pickups.get(item);
    this.x = x; this.y = y;
    this.taken = false;
    this.bobT = Math.random() * Math.PI * 2;
  }
  update(dt) { this.bobT += dt * 3; }
  draw(ctx) {
    if (this.taken) return;
    const bob = Math.sin(this.bobT) * 3;
    ctx.drawImage(this.sprite, Math.round(this.x - C.PICKUP_SIZE / 2),
      Math.round(this.y - C.PICKUP_SIZE + bob));
  }
  get hitbox() {
    return { x: this.x - 16, y: this.y - C.PICKUP_SIZE, w: 32, h: C.PICKUP_SIZE };
  }
}

export class PowerUp {
  constructor(sprite, type, x, y) {
    this.type = type;
    this.sprite = sprite;
    this.x = x; this.y = y;
    this.taken = false;
    this.bobT = Math.random() * Math.PI * 2;
  }
  update(dt) { this.bobT += dt * 3; }
  draw(ctx) {
    if (this.taken) return;
    const bob = Math.sin(this.bobT) * 3;
    // gentle glow pulse marks power-ups apart from lost property
    ctx.globalAlpha = 0.75 + Math.sin(this.bobT * 2) * 0.25;
    ctx.drawImage(this.sprite, Math.round(this.x - C.POWERUP_SIZE / 2),
      Math.round(this.y - C.POWERUP_SIZE + bob));
    ctx.globalAlpha = 1;
  }
  get hitbox() {
    return { x: this.x - 16, y: this.y - C.POWERUP_SIZE, w: 32, h: C.POWERUP_SIZE };
  }
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
