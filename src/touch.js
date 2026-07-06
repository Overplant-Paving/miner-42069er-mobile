// On-screen touch controls for phones/tablets. Feeds the exact same `held` and
// `pressed` action sets the keyboard fills, so the game core needs no changes.
// Inert on devices with a fine pointer (desktop) unless forced with ?touch=1.

const SVG = {
  up:    '<svg viewBox="0 0 24 24"><path d="M12 5l7 9H5z"/></svg>',
  down:  '<svg viewBox="0 0 24 24"><path d="M12 19l-7-9h14z"/></svg>',
  left:  '<svg viewBox="0 0 24 24"><path d="M5 12l9-7v14z"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M19 12l-9 7V5z"/></svg>',
  jump:  '<svg viewBox="0 0 24 24"><path d="M12 4l6 7h-4v9h-4v-9H6z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  soundOn:  '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4 4 0 00-2.2-3.6v7.2A4 4 0 0016.5 12zM14 3.2v2.1a6.8 6.8 0 010 13.4v2.1a8.9 8.9 0 000-17.6z"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zm15.5 3l2.3-2.3-1.4-1.4L18 10.6l-2.3-2.3-1.4 1.4L16.6 12l-2.3 2.3 1.4 1.4L18 13.4l2.3 2.3 1.4-1.4z"/></svg>',
};

const CSS = `
body.touch { touch-action: none; overscroll-behavior: none; }
.mtc { position: fixed; inset: 0; z-index: 20; pointer-events: none;
  font-family: system-ui, sans-serif; -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent; }
.mtc.hidden { display: none; }
.mtc button { pointer-events: auto; touch-action: none; -webkit-user-select: none;
  user-select: none; margin: 0; padding: 0; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: rgba(242,233,220,.92); background: rgba(20,16,25,.42);
  border: 2px solid rgba(242,233,220,.28);
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
.mtc button svg { width: 60%; height: 60%; fill: currentColor; }
.mtc button.down { background: rgba(255,93,162,.55); border-color: rgba(255,210,74,.9); }

/* D-pad: fixed-size container with each key absolutely placed. No grid/flow —
   placement is unambiguous across browsers. Sizes are fixed px (not vh/vmin) so
   the mobile URL bar hiding on first touch can't move or resize the pad. */
.mtc .dpad { position: absolute;
  left: max(14px, env(safe-area-inset-left));
  bottom: max(18px, env(safe-area-inset-bottom));
  width: calc(var(--d) * 3); height: calc(var(--d) * 3); --d: 62px; }
.mtc .dpad button { position: absolute; width: var(--d); height: var(--d);
  border-radius: 14px; }
.mtc .dpad .up    { left: var(--d);           top: 0; }
.mtc .dpad .left  { left: 0;                   top: var(--d); }
.mtc .dpad .right { left: calc(var(--d) * 2);  top: var(--d); }
.mtc .dpad .down  { left: var(--d);            top: calc(var(--d) * 2); }

.mtc .jump { position: absolute;
  right: max(20px, env(safe-area-inset-right));
  bottom: max(24px, env(safe-area-inset-bottom));
  width: 96px; height: 96px; border-radius: 50%;
  background: rgba(63,167,255,.32); }

.mtc .util { position: absolute;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right)); display: flex; gap: 10px; }
.mtc .util button { width: 46px; height: 46px; border-radius: 12px; }

.mtc .start { position: absolute; inset: 0; margin: auto; width: min(76vw, 340px);
  height: 96px; border-radius: 18px;
  font: 700 22px/1 system-ui, sans-serif; letter-spacing: .08em;
  color: rgba(242,233,220,.95); background: rgba(20,16,25,.35);
  border: 2px solid rgba(255,210,74,.6); }

.mtc .restart { position: absolute; left: 0; right: 0; margin: 0 auto;
  bottom: 86px; width: min(60vw, 220px); height: 54px;
  border-radius: 14px; font: 600 16px/1 system-ui, sans-serif; letter-spacing: .06em; }

/* smaller controls on very short screens (small phones held in landscape) */
@media (max-height: 380px) {
  .mtc .dpad { --d: 52px; }
  .mtc .jump { width: 82px; height: 82px; }
}

/* group visibility per game mode (set via data-mode on .mtc) */
.mtc .dpad, .mtc .jump, .mtc .start, .mtc .restart { display: none; }
.mtc[data-mode="play"] .dpad { display: block; }
.mtc[data-mode="play"] .jump { display: flex; }
.mtc[data-mode="menu"] .start { display: flex; }
.mtc[data-mode="menu"].gameover .restart { display: flex; }

.mtc .rotate { position: absolute; inset: 0; display: none; pointer-events: none;
  align-items: center; justify-content: center; text-align: center;
  background: rgba(10,8,16,.82); color: rgba(242,233,220,.9);
  font: 600 clamp(15px, 5vmin, 22px)/1.5 system-ui, sans-serif; padding: 8vw; }
@media (orientation: portrait) { body.touch .mtc .rotate { display: flex; } }
`;

// Contextual label for the big menu button, keyed by game state.
const START_LABEL = {
  title: 'TAP TO START', intro: 'TAP TO START',
  victory: 'PLAY AGAIN', gameover: 'CONTINUE',
};

export function setupTouchControls({ held, pressed, unlock }) {
  const forced = /[?&]touch=1\b/.test(location.search);
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse && !forced) return { setState() {}, setMuted() {} };

  document.body.classList.add('touch');
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'mtc';
  root.innerHTML = `
    <div class="dpad">
      <button class="up"    aria-label="Up">${SVG.up}</button>
      <button class="left"  aria-label="Left">${SVG.left}</button>
      <button class="right" aria-label="Right">${SVG.right}</button>
      <button class="down"  aria-label="Down">${SVG.down}</button>
    </div>
    <button class="jump" aria-label="Jump">${SVG.jump}</button>
    <div class="util">
      <button class="pause" aria-label="Pause">${SVG.pause}</button>
      <button class="mute"  aria-label="Mute">${SVG.soundOn}</button>
    </div>
    <button class="start" aria-label="Start">TAP TO START</button>
    <button class="restart" aria-label="New game">NEW GAME</button>
    <div class="rotate">&#8635;<br>Rotate your device<br>to landscape to play</div>`;
  document.body.appendChild(root);

  // long-press context menu would fight with held buttons
  root.addEventListener('contextmenu', e => e.preventDefault());

  // Press/hold: capture the pointer so the release always fires on this button,
  // even if the finger drifts. Mirrors the keyboard's held/pressed edge logic.
  const bind = (sel, action) => {
    const el = root.querySelector(sel);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      unlock();
      try { el.setPointerCapture(e.pointerId); } catch {}
      el.classList.add('down');
      if (!held.has(action)) pressed.add(action);
      held.add(action);
    });
    const release = () => { el.classList.remove('down'); held.delete(action); };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    return el;
  };

  bind('.up', 'up'); bind('.down', 'down');
  bind('.left', 'left'); bind('.right', 'right');
  bind('.jump', 'jump');
  bind('.pause', 'pause');
  bind('.mute', 'mute');
  bind('.restart', 'restart');
  const startBtn = bind('.start', 'start');
  const muteBtn = root.querySelector('.mute');

  return {
    setState(state) {
      const mode = state === 'playing' ? 'play'
        : state === 'paused' ? 'paused'
        : (state in START_LABEL) ? 'menu'
        : 'idle';
      root.dataset.mode = mode;
      root.classList.toggle('gameover', state === 'gameover');
      if (mode === 'menu') startBtn.textContent = START_LABEL[state];
    },
    setMuted(muted) {
      muteBtn.innerHTML = muted ? SVG.soundOff : SVG.soundOn;
    },
  };
}
