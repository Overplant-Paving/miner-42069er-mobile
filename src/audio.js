// WebAudio synth SFX — oscillators/noise/envelopes only, zero audio files.

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}
export function isMuted() { return muted; }

function tone({ type = 'square', from = 440, to = from, dur = 0.1, vol = 0.3, delay = 0 }) {
  const ac = ensure();
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.15, vol = 0.25, delay = 0, lowpass = 1200 }) {
  const ac = ensure();
  const t0 = ac.currentTime + delay;
  const len = Math.max(1, (dur * ac.sampleRate) | 0);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  select() { tone({ from: 520, to: 780, dur: 0.08, vol: 0.25 }); },
  jump() { tone({ from: 300, to: 620, dur: 0.14, vol: 0.3 }); },
  land() { noise({ dur: 0.06, vol: 0.12, lowpass: 500 }); },
  // Claim pip pitch climbs with the streak, resets elsewhere.
  claim(step = 0) { tone({ type: 'sine', from: 620 + step * 40, dur: 0.06, vol: 0.22 }); },
  pickup() { tone({ type: 'triangle', from: 660, dur: 0.09, vol: 0.3 }); tone({ type: 'triangle', from: 880, dur: 0.12, vol: 0.3, delay: 0.08 }); },
  smitten() { [660, 550, 440].forEach((f, i) => tone({ type: 'sine', from: f, to: f * 0.9, dur: 0.16, vol: 0.2, delay: i * 0.11 })); },
  bop() { noise({ dur: 0.08, vol: 0.3, lowpass: 2500 }); tone({ from: 500, to: 150, dur: 0.18, vol: 0.3, delay: 0.02 }); },
  death() { tone({ type: 'sawtooth', from: 400, to: 60, dur: 0.6, vol: 0.3 }); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.14, vol: 0.25, delay: i * 0.12 })); },
  nice() { tone({ type: 'square', from: 233, to: 220, dur: 0.22, vol: 0.3 }); tone({ type: 'square', from: 311, to: 294, dur: 0.22, vol: 0.3 }); },
  timerLow() { tone({ type: 'sine', from: 980, dur: 0.05, vol: 0.15 }); },
  streak() { [523, 659, 880].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.09, vol: 0.25, delay: i * 0.07 })); },
  whoosh() { noise({ dur: 0.28, vol: 0.22, lowpass: 900 }); },
  pop() { noise({ dur: 0.05, vol: 0.12, lowpass: 3000 }); tone({ type: 'sine', from: 700, to: 220, dur: 0.22, vol: 0.1, delay: 0.02 }); },
  gameover() { [392, 330, 262, 196].forEach((f, i) => tone({ type: 'sawtooth', from: f, dur: 0.25, vol: 0.25, delay: i * 0.2 })); },
};

// Resume the AudioContext on first input (browser autoplay policy).
export function unlockAudio() { ensure(); }

// ---------------------------------------------------------------- music
// Quiet procedural bass loop (quality-bar: optional, synth-only, under SFX).
// Modes: normal / smitten (+4 semitones, brighter) / urgent (faster).
let musicTimer = null;
let musicStep = 0;
let musicOpts = { smitten: false, urgent: false, bpm: 96, gain: 0.05 };

function musicTick() {
  const ac = ensure();
  const o = musicOpts;
  const semis = o.smitten ? 4 : 0;
  const mul = Math.pow(2, semis / 12);
  const bass = [110, 110, 165, 110, 131, 110, 165, 147][musicStep % 8] * mul;
  tone({ type: 'triangle', from: bass, to: bass, dur: 0.14, vol: o.gain });
  if (musicStep % 4 === 2) {
    tone({ type: 'square', from: bass * 2, to: bass * 2, dur: 0.07, vol: o.gain * 0.5 });
  }
  musicStep++;
}

export const music = {
  start(bpm, gain) {
    if (musicTimer) return;
    musicOpts.bpm = bpm; musicOpts.gain = gain;
    musicStep = 0;
    const interval = () => 60000 / (musicOpts.bpm * (musicOpts.urgent ? 1.3 : 1)) / 2;
    const loop = () => { musicTick(); musicTimer = setTimeout(loop, interval()); };
    musicTimer = setTimeout(loop, 10);
  },
  stop() { if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; } },
  set(flags) { Object.assign(musicOpts, flags); },
};
