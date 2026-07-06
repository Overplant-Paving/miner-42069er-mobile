// Preloader (manifest-driven), animation player (pipeline-meta-driven), draw helpers.

// ---------------------------------------------------------------- preloader

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode(); // decoded before first frame (quality-bar preload gate)
  return img;
}

// Expect entries starting with assets/ or data/ resolve from the game root;
// everything else resolves under the job's output_dir (manifest-schema rule).
function resolveExpect(job, entry) {
  if (entry.startsWith('assets/') || entry.startsWith('data/')) return entry;
  return `${job.output_dir}/${entry}`;
}

// Loads every accepted job's expect files (+ sibling pipeline-meta already listed
// there). Returns { images: Map<path,Image>, data: Map<path,object>, manifest }.
export async function loadAssets(onProgress) {
  const manifest = await (await fetch('assets/manifest.json')).json();
  const accepted = manifest.jobs.filter(j => j.status === 'accepted');
  // Engine-owned data (authored, not a manifest deliverable — tech-plan file layout).
  const paths = ['data/levels.json'];
  for (const job of accepted) {
    for (const entry of job.expect) {
      const p = resolveExpect(job, entry);
      if (p.endsWith('.png') || p.endsWith('.json')) paths.push(p);
    }
  }
  const images = new Map();
  const data = new Map();
  let done = 0;
  await Promise.all(paths.map(async p => {
    if (p.endsWith('.png')) images.set(p, await loadImage(p));
    else data.set(p, await (await fetch(p)).json());
    done++;
    if (onProgress) onProgress(done / paths.length);
  }));
  return { images, data, manifest };
}

// ---------------------------------------------------------------- animation

// One action sheet. Frames are row-major cells; body sizes and the feet line come
// from pipeline-meta (never hardcoded). The sheet is prescaled once so the body
// renders at targetBodyH with good downsampling, then drawn 1:1 at runtime.
export class Anim {
  constructor(img, meta, targetBodyH, { fps, loop }) {
    this.rows = meta.rows;
    this.cols = meta.cols;
    this.frameCount = meta.frames.length;
    this.fps = fps;
    this.loop = loop;
    const srcCellW = img.width / this.cols;
    const srcCellH = img.height / this.rows;
    const bodyH = Math.max(...meta.frames.map(f => f.output_size[1]));
    const feetY = meta.frames[0].paste_position[1] + meta.frames[0].output_size[1];
    this.scale = targetBodyH / bodyH;
    this.cellW = Math.round(srcCellW * this.scale);
    this.cellH = Math.round(srcCellH * this.scale);
    this.feetY = feetY * this.scale;
    const canvas = document.createElement('canvas');
    canvas.width = this.cellW * this.cols;
    canvas.height = this.cellH * this.rows;
    const c = canvas.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    this.sheet = canvas;
  }

  // Feet anchor: (x, y) is bottom-center of the body (quality-bar anchoring rule).
  draw(ctx, frame, x, y, flipX = false) {
    const i = Math.max(0, Math.min(this.frameCount - 1, frame | 0));
    const sx = (i % this.cols) * this.cellW;
    const sy = ((i / this.cols) | 0) * this.cellH;
    const dx = Math.round(x - this.cellW / 2);
    const dy = Math.round(y - this.feetY);
    if (flipX) {
      ctx.save();
      ctx.translate(Math.round(x), 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.sheet, sx, sy, this.cellW, this.cellH,
        Math.round(-this.cellW / 2), dy, this.cellW, this.cellH);
      ctx.restore();
    } else {
      ctx.drawImage(this.sheet, sx, sy, this.cellW, this.cellH, dx, dy, this.cellW, this.cellH);
    }
  }
}

// Clock-driven playback state for an Anim.
export class AnimPlayer {
  constructor(anim) { this.set(anim); }
  set(anim) {
    if (this.anim === anim) return;
    this.anim = anim;
    this.t = 0;
  }
  update(dt) { this.t += dt; }
  get frame() {
    const a = this.anim;
    if (a.fps <= 0) return 0; // phase-mapped anims pick their own frame
    const f = this.t * a.fps;
    return a.loop ? (f | 0) % a.frameCount : Math.min(f | 0, a.frameCount - 1);
  }
  get finished() {
    const a = this.anim;
    return !a.loop && a.fps > 0 && this.t * a.fps >= a.frameCount;
  }
  draw(ctx, x, y, flipX, frameOverride) {
    this.anim.draw(ctx, frameOverride ?? this.frame, x, y, flipX);
  }
}

// ------------------------------------------------------------------- props

// A prop image prescaled to its render size (style-bible size table).
export function makeProp(img, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  // Fit inside w x h preserving aspect, bottom-aligned (props sit on surfaces).
  const s = Math.min(w / img.width, h / img.height);
  const dw = Math.round(img.width * s), dh = Math.round(img.height * s);
  c.drawImage(img, Math.round((w - dw) / 2), h - dh, dw, dh);
  return canvas;
}

// ------------------------------------------------------------------- text

export function drawText(ctx, text, x, y, size, color, align = 'center', bold = true) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px "Courier New", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  // Chunky retro read: dark offset shadow behind bright text.
  ctx.fillStyle = '#141019';
  ctx.fillText(text, x + Math.max(2, size / 12), y + Math.max(2, size / 12));
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
