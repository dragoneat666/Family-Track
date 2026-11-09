// Sparkly clouds over a body part (dress up), drawn on a 2D canvas on top of
// the 3D view in exactly the body part's shape. The kid rubs them away with a
// finger; once most of it is gone the rest fades out and onDone() runs.
//
// mask: Uint8Array (maskW × maskH, row 0 at the top) covering the whole
// stage, 1 where the body part shows on screen.

const BRUSH = 0.05; // finger size, as a share of the stage's smaller side
const DONE_AT = 0.88; // share of the body part rubbed clean that counts as done
const PASTELS = ['#ffb8ec', '#d2b8ff', '#b8dcff', '#ffe39e', '#ffc4dc'];
const GLITTER = ['#ffffff', '#fff3a8', '#ffc8f0', '#d9c8ff', '#bfe9ff'];

export class CloudCover {
  constructor(container, { mask, maskW, maskH, onProgress, onDone }) {
    this.container = container;
    this.onProgress = onProgress;
    this.onDone = onDone;
    this.maskW = maskW;
    this.maskH = maskH;
    this.mask = mask;
    this.cleared = new Uint8Array(mask.length);
    this.total = mask.reduce((n, v) => n + v, 0) || 1;
    this.erased = 0;
    this.particles = [];
    this.finished = false;

    const cssW = container.clientWidth || 1;
    const cssH = container.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.radius = BRUSH * Math.min(cssW, cssH); // css px

    const make = (z, events) => {
      const c = document.createElement('canvas');
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      Object.assign(c.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: z,
        touchAction: 'none', pointerEvents: events ? 'auto' : 'none', transition: 'opacity 0.6s ease'
      });
      container.appendChild(c);
      return c;
    };
    this.canvas = make(2, true);
    this.sparkles = make(3, false);
    this.ctx = this.canvas.getContext('2d');
    this.sctx = this.sparkles.getContext('2d');

    this.findSpots();
    this.paintClouds();

    this.handlers = {
      down: (e) => this.down(e),
      move: (e) => this.move(e),
      up: (e) => this.up(e)
    };
    this.canvas.addEventListener('pointerdown', this.handlers.down);
    this.canvas.addEventListener('pointermove', this.handlers.move);
    this.canvas.addEventListener('pointerup', this.handlers.up);
    this.canvas.addEventListener('pointercancel', this.handlers.up);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  // Mask cells as css-pixel points, the box around them, and spots for twinkles.
  findSpots() {
    const sx = this.cssW / this.maskW;
    const sy = this.cssH / this.maskH;
    this.cells = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < this.maskH; y++) {
      for (let x = 0; x < this.maskW; x++) {
        if (!this.mask[y * this.maskW + x]) continue;
        this.cells.push(y * this.maskW + x);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    this.box = this.cells.length
      ? { x: x0 * sx, y: y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy }
      : { x: 0, y: 0, w: this.cssW, h: this.cssH };
    const pick = () => {
      const i = this.cells[Math.floor(Math.random() * this.cells.length)] ?? 0;
      return { x: ((i % this.maskW) + Math.random()) * sx, y: (Math.floor(i / this.maskW) + Math.random()) * sy, cell: i };
    };
    this.pick = pick;
    this.twinkles = Array.from({ length: 28 }, () => ({ ...pick(), phase: Math.random() * Math.PI * 2, size: 5 + Math.random() * 7 }));
  }

  paintClouds() {
    const { ctx, dpr } = this;
    const W = this.canvas.width, H = this.canvas.height;
    const unit = Math.min(this.cssW, this.cssH) * dpr;
    ctx.save();
    // A soft base so there are no gaps between puffs.
    const b = this.box;
    const base = ctx.createLinearGradient(0, b.y * dpr, 0, (b.y + b.h) * dpr);
    base.addColorStop(0, '#f3dcff');
    base.addColorStop(1, '#d9c9ff');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    // Cut the base to the body part's shape (a little bigger, soft edges).
    // The puffs on top aren't cut, so the outline billows like a real cloud.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.shape(W, H, unit), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    // Puffs, in two passes so they melt into one cloud: first every puff's
    // lavender underside, then the puffs themselves (white, a few pastel),
    // each solid in the middle and fading at the edge.
    const count = Math.round(40 + (b.w * b.h) / (this.radius * this.radius) * 1.2);
    const puffs = Array.from({ length: count }, (_, i) => {
      const p = this.pick();
      return { x: p.x * dpr, y: p.y * dpr, r: unit * (0.04 + Math.random() * 0.06), tint: i % 4 === 0 ? PASTELS[i % PASTELS.length] : null };
    });
    for (const { x, y, r } of puffs) {
      const sy = y + r * 0.35;
      const g = ctx.createRadialGradient(x, sy, 0, x, sy, r * 1.1);
      g.addColorStop(0, 'rgba(165, 135, 225, 0.5)');
      g.addColorStop(0.6, 'rgba(165, 135, 225, 0.3)');
      g.addColorStop(1, 'rgba(165, 135, 225, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, sy, r * 1.1, 0, Math.PI * 2); ctx.fill();
    }
    for (const { x, y, r, tint } of puffs) {
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, 0, x, y, r);
      g.addColorStop(0, 'rgba(255, 255, 255, 1)');
      g.addColorStop(0.3, tint ? hexA(tint, 0.95) : 'rgba(255, 255, 255, 0.98)');
      g.addColorStop(0.7, tint ? hexA(tint, 0.9) : 'rgba(255, 255, 255, 0.92)');
      g.addColorStop(1, tint ? hexA(tint, 0) : 'rgba(255, 250, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Glitter.
    const dots = count * 6;
    for (let i = 0; i < dots; i++) {
      const p = this.pick();
      ctx.fillStyle = GLITTER[i % GLITTER.length];
      ctx.globalAlpha = 0.55 + Math.random() * 0.45;
      const s = (0.8 + Math.random() * 1.8) * dpr;
      ctx.fillRect(p.x * dpr, p.y * dpr, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  shape(W, H, unit) {
    const small = document.createElement('canvas');
    small.width = this.maskW;
    small.height = this.maskH;
    const sctx = small.getContext('2d');
    const img = sctx.createImageData(this.maskW, this.maskH);
    for (let i = 0; i < this.mask.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = this.mask[i] ? 255 : 0;
    }
    sctx.putImageData(img, 0, 0);
    const big = document.createElement('canvas');
    big.width = W;
    big.height = H;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    // Grow it a bit (drawn around in a ring), then blur the edge.
    const grow = unit * 0.018;
    bctx.filter = `blur(${Math.round(unit * 0.012)}px)`;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      bctx.drawImage(small, Math.cos(a) * grow, Math.sin(a) * grow, W, H);
    }
    bctx.drawImage(small, 0, 0, W, H);
    return big;
  }

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.cssW, y: ((e.clientY - r.top) / r.height) * this.cssH };
  }

  down(e) {
    if (this.finished) return;
    this.stroke = { id: e.pointerId, at: this.point(e) };
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* finger already gone */ }
    this.rub(this.stroke.at);
  }

  move(e) {
    if (!this.stroke || e.pointerId !== this.stroke.id) return;
    const to = this.point(e);
    const from = this.stroke.at;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (this.radius / 3)));
    for (let i = 1; i <= steps; i++) this.rub({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    this.stroke.at = to;
  }

  up(e) {
    if (this.stroke && e.pointerId === this.stroke.id) this.stroke = null;
  }

  // Wipe a soft circle at p (css px) and count what's been cleared.
  rub(p) {
    if (this.finished) return;
    const { ctx, dpr } = this;
    const r = this.radius * dpr;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createRadialGradient(p.x * dpr, p.y * dpr, r * 0.45, p.x * dpr, p.y * dpr, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x * dpr, p.y * dpr, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const sx = this.maskW / this.cssW, sy = this.maskH / this.cssH;
    const cr = this.radius * 0.75;
    const x0 = Math.max(0, Math.floor((p.x - cr) * sx)), x1 = Math.min(this.maskW - 1, Math.ceil((p.x + cr) * sx));
    const y0 = Math.max(0, Math.floor((p.y - cr) * sy)), y1 = Math.min(this.maskH - 1, Math.ceil((p.y + cr) * sy));
    let hit = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * this.maskW + x;
        if (!this.mask[i] || this.cleared[i]) continue;
        if (Math.hypot((x + 0.5) / sx - p.x, (y + 0.5) / sy - p.y) > cr) continue;
        this.cleared[i] = 1;
        this.erased++;
        hit++;
      }
    }
    if (hit) {
      // A few sparkles fly off the finger.
      for (let k = 0; k < Math.min(3, 1 + hit / 20); k++) {
        const a = Math.random() * Math.PI * 2;
        const v = 40 + Math.random() * 90;
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.7, age: 0, color: GLITTER[Math.floor(Math.random() * GLITTER.length)] });
      }
      const share = this.erased / this.total;
      this.onProgress?.(share);
      if (share >= DONE_AT) this.finish();
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.stroke = null;
    this.canvas.style.opacity = '0';
    // A burst of sparkles over the whole body part.
    for (let k = 0; k < 40; k++) {
      const p = this.pick();
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * 120;
      this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 1.1, age: 0, color: GLITTER[k % GLITTER.length] });
    }
    setTimeout(() => this.onDone?.(), 900);
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { sctx, dpr } = this;
    sctx.clearRect(0, 0, this.sparkles.width, this.sparkles.height);
    const t = now / 1000;
    if (!this.finished) {
      for (const s of this.twinkles) {
        if (this.cleared[s.cell]) continue;
        const k = Math.max(0, Math.sin(t * 2.2 + s.phase));
        if (k > 0.05) star(sctx, s.x * dpr, s.y * dpr, s.size * dpr * k, `rgba(255,255,255,${0.9 * k})`);
      }
    }
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 140 * dt;
      const k = 1 - p.age / p.life;
      if (k <= 0) return false;
      star(sctx, p.x * dpr, p.y * dpr, 5 * dpr * k, p.color, k);
      return true;
    });
    this.raf = requestAnimationFrame((tt) => this.tick(tt));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.handlers.down);
    this.canvas.removeEventListener('pointermove', this.handlers.move);
    this.canvas.removeEventListener('pointerup', this.handlers.up);
    this.canvas.removeEventListener('pointercancel', this.handlers.up);
    this.canvas.remove();
    this.sparkles.remove();
  }
}

// A four-pointed twinkle.
function star(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
  ctx.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
