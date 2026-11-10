/* eslint-disable @typescript-eslint/no-explicit-any */
// Effects for the animation kit: cuts on a beat, camera shake, impact frames, colour split, glitches,
// smears, bloom, grain, fire and sparks, and type that hits. Everything is a pure function of the
// time passed in. Post effects redraw what is on the canvas so far (through scratch canvases), so
// they act on everything drawn before them in the frame; where there is no real canvas they do nothing.

type Ctx = CanvasRenderingContext2D;
type Ease = (t: number) => number;

export type FxDeps = {
  W: number;
  H: number;
  u: number;
  noise: (x: number, y?: number, z?: number) => number;
  rand: (seed: number) => number;
  ease: Record<string, Ease>;
  font: (o: any) => string;
  text: (ctx: Ctx, str: string, x: number, y: number, o?: any) => { width: number; height: number; lines: number };
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const TAU = Math.PI * 2;

const scratch = new Map<string, HTMLCanvasElement>();
function buffer(key: string, w: number, h: number) {
  if (typeof document === "undefined") return null;
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  let c = scratch.get(key);
  if (!c) scratch.set(key, (c = document.createElement("canvas")));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d");
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.filter = "none";
  g.globalCompositeOperation = "source-over";
  return { c, g };
}
const sizeOf = (ctx: Ctx) => {
  const cv = ctx.canvas as HTMLCanvasElement | undefined;
  return cv && cv.width > 0 && cv.height > 0 ? { cv, w: cv.width, h: cv.height } : null;
};
// The frame so far, copied to a scratch canvas.
function snap(ctx: Ctx, key = "snap") {
  const s = sizeOf(ctx);
  const b = s && buffer(key, s.w, s.h);
  if (!s || !b) return null;
  b.g.globalCompositeOperation = "copy";
  b.g.drawImage(s.cv, 0, 0);
  b.g.globalCompositeOperation = "source-over";
  return { c: b.c, w: s.w, h: s.h };
}
// Run fn in canvas pixels with a clean state (whatever camera or alpha the scene is under).
function raw(ctx: Ctx, fn: () => void) {
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    fn();
  } finally {
    ctx.restore();
  }
}

// A fixed tile of film grain (seeded, so every render matches).
let grainTile: HTMLCanvasElement | null = null;
function grainOf() {
  if (grainTile || typeof document === "undefined") return grainTile;
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(n, n);
  let s = 0x2f6e2b1;
  for (let i = 0; i < n * n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = 128 + (((s >>> 16) & 255) - 128) * 0.9;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (grainTile = c);
}

export function makeFx(d: FxDeps) {
  const { W, H, u, noise, rand, ease, font, text } = d;

  // ── Time: beats, shots, hits ───────────────────────────────────────────

  // The film as `total` beats (total = length in seconds × BPM / 60): x is the position in beats,
  // n the beat it's on, k the progress through that beat, hit a pulse that's 1 on each beat and
  // decays through it, and bar/inBar count in fours.
  function beats(p: number, total: number) {
    const x = clamp(p) * total;
    const n = Math.min(Math.max(0, total - 1), Math.floor(x));
    const k = x - n;
    return { x, n, k, hit: Math.exp(-k * 5), bar: Math.floor(n / 4), inBar: n % 4, total };
  }

  // Which shot x falls in, for cuts at the given positions (same unit as x: beats, or fractions of
  // the film): i its index, k the progress through it, since and left how far in and how far to go.
  function shot(x: number, cuts: number[]) {
    let i = 0;
    while (i < cuts.length - 1 && x >= cuts[i + 1]) i++;
    const start = cuts[i] ?? 0;
    const end = cuts[i + 1] ?? start + 1;
    return { i, k: clamp((x - start) / Math.max(1e-6, end - start)), since: x - start, left: end - x, start, end };
  }

  // A pulse that jumps to 1 at `at` and decays (for a flash, a punch or a shake right after a cut).
  const hit = (x: number, at: number, decay = 0.25) => (x >= at ? Math.exp(-(x - at) / Math.max(1e-6, decay)) : 0);

  // ── Camera ─────────────────────────────────────────────────────────────

  // Handheld shake: amt in px at 1080p (8 is a rattle, 30 an earthquake).
  function shake(ctx: Ctx, t: number, amt: number, draw: () => void, o: any = {}) {
    if (!(amt > 0)) return draw();
    const sp = o.speed ?? 32;
    const a = amt * u;
    ctx.save();
    try {
      ctx.translate(W / 2 + noise(t * sp, 1.3) * a, H / 2 + noise(t * sp, 7.7) * a);
      ctx.rotate(noise(t * sp * 0.8, 4.1) * (o.rot ?? 0.0012) * amt);
      const s = 1 + (2.4 * a) / Math.min(W, H);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
      draw();
    } finally {
      ctx.restore();
    }
  }

  // Motion smear by drawing earlier moments faintly behind now: draw(time, i) for i = n..0.
  function trail(ctx: Ctx, t: number, n: number, dt: number, draw: (tt: number, i: number) => void) {
    for (let i = Math.max(0, Math.round(n)); i >= 0; i--) {
      ctx.save();
      try {
        if (i > 0) ctx.globalAlpha *= 0.55 / (i + 0.6);
        draw(t - i * dt, i);
      } finally {
        ctx.restore();
      }
    }
  }

  // Reveal draw() through a moving shape: 'slash' (a diagonal blade), 'iris' (a growing circle),
  // 'blinds', 'split' (opens from the middle) or 'bars' (vertical strips).
  function wipe(ctx: Ctx, k: number, kind: string, draw: () => void, o: any = {}) {
    if (k <= 0) return;
    if (k >= 1) return draw();
    ctx.save();
    try {
      ctx.beginPath();
      if (kind === "iris") ctx.arc(o.cx ?? W / 2, o.cy ?? H / 2, k * Math.hypot(W, H) * 0.62, 0, TAU);
      else if (kind === "blinds" || kind === "bars") {
        const n = o.n ?? 9;
        for (let i = 0; i < n; i++) {
          const ki = clamp(k * 1.6 - (i / n) * 0.6);
          if (kind === "blinds") ctx.rect(0, (i * H) / n, W, (H / n) * ki + 1);
          else ctx.rect((i * W) / n, 0, (W / n) * ki + 1, H);
        }
      } else if (kind === "split") ctx.rect(0, (H / 2) * (1 - k), W, H * k);
      else {
        const lean = (o.lean ?? 0.28) * H;
        const x = -lean + k * (W + 2 * lean);
        ctx.moveTo(-lean, 0);
        ctx.lineTo(x + lean, 0);
        ctx.lineTo(x - lean, H);
        ctx.lineTo(-lean, H);
      }
      ctx.clip();
      draw();
    } finally {
      ctx.restore();
    }
  }

  // ── Post effects (act on everything drawn so far this frame) ───────────

  // A full-frame flash: flash(ctx, lib.hit(...)) right after a cut. { add: true } adds light instead of covering.
  function flash(ctx: Ctx, a: number, color = "#ffffff", o: any = {}) {
    if (!(a > 0.004)) return;
    const s = sizeOf(ctx);
    raw(ctx, () => {
      ctx.globalAlpha = clamp(a);
      if (o.add) ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, s?.w ?? W, s?.h ?? H);
    });
  }

  // Negative image (a = 1 fully inverted).
  function invert(ctx: Ctx, a = 1) {
    if (!(a > 0.004)) return;
    const s = sizeOf(ctx);
    raw(ctx, () => {
      ctx.globalCompositeOperation = "difference";
      ctx.globalAlpha = clamp(a);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, s?.w ?? W, s?.h ?? H);
    });
  }

  // An impact frame: the picture crushed to stark black and white (optionally inverted, optionally
  // tinted) for the one to three frames of a hit.
  function impact(ctx: Ctx, a = 1, o: any = {}) {
    const s = a > 0.004 ? snap(ctx) : null;
    if (!s) return;
    raw(ctx, () => {
      ctx.globalAlpha = clamp(a);
      ctx.filter = `grayscale(1) contrast(${o.contrast ?? 7})${o.invert ? " invert(1)" : ""}`;
      ctx.drawImage(s.c, 0, 0);
      ctx.filter = "none";
      if (o.color) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = o.color;
        ctx.fillRect(0, 0, s.w, s.h);
      }
    });
  }

  // Chromatic aberration: red and blue pulled apart by amt px (at 1080p) along angle (degrees).
  function rgbSplit(ctx: Ctx, amt: number, angle = 0) {
    const s = Math.abs(amt) > 0.05 ? snap(ctx) : null;
    const ch = s && buffer("channel", s.w, s.h);
    if (!s || !ch) return;
    const dx = Math.cos((angle * Math.PI) / 180) * amt * u, dy = Math.sin((angle * Math.PI) / 180) * amt * u;
    raw(ctx, () => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, s.w, s.h);
      ctx.globalCompositeOperation = "lighter";
      for (const [color, k] of [["#ff0000", 1], ["#00ff00", 0], ["#0000ff", -1]] as const) {
        ch.g.globalCompositeOperation = "copy";
        ch.g.drawImage(s.c, 0, 0);
        ch.g.globalCompositeOperation = "multiply";
        ch.g.fillStyle = color;
        ch.g.fillRect(0, 0, s.w, s.h);
        ctx.drawImage(ch.c, dx * k, dy * k);
      }
    });
  }

  // Digital tearing: slices of the frame jump sideways, with colour split. amt 0..1.
  function glitch(ctx: Ctx, t: number, amt: number, o: any = {}) {
    const s = amt > 0.01 ? snap(ctx, "glitch") : null;
    if (!s) return;
    const f = Math.floor(t * (o.rate ?? 16)) + (o.seed ?? 0) * 131;
    const n = o.slices ?? 14;
    raw(ctx, () => {
      for (let i = 0; i < n; i++) {
        if (rand(f * 13.1 + i * 7.3) > 0.25 + amt * 0.7) continue;
        const y = Math.floor(rand(f * 3.7 + i * 11.9) * s.h), hh = Math.ceil((0.012 + rand(f * 5.3 + i * 2.1) * 0.11) * s.h);
        const dx = (rand(f * 9.1 + i * 4.7) - 0.5) * 2 * amt * 0.16 * s.w;
        ctx.drawImage(s.c, 0, y, s.w, hh, dx, y, s.w, hh);
      }
      if (rand(f * 2.3) < amt * 0.6) {
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = ["#00ffff", "#ff00ff", "#ffffff"][Math.floor(rand(f * 6.1) * 3)];
        ctx.fillRect(0, rand(f * 8.9) * s.h, s.w, (0.004 + rand(f * 1.9) * 0.03) * s.h);
      }
    });
    rgbSplit(ctx, amt * (o.split ?? 14), rand(f) * 30 - 15);
  }

  // A radial smear from a point, as if the camera rushed in. amt 0..1.
  function zoomBlur(ctx: Ctx, amt: number, o: any = {}) {
    const s = amt > 0.01 ? snap(ctx) : null;
    if (!s) return;
    const n = o.steps ?? 10;
    const cx = ((o.cx ?? W / 2) / W) * s.w, cy = ((o.cy ?? H / 2) / H) * s.h;
    raw(ctx, () => {
      for (let i = 1; i <= n; i++) {
        const sc = 1 + (amt * 0.22 * i) / n;
        ctx.globalAlpha = 1 / (i + 1);
        ctx.setTransform(sc, 0, 0, sc, cx - cx * sc, cy - cy * sc);
        ctx.drawImage(s.c, 0, 0);
      }
    });
  }

  // A directional smear (a whip pan): amt px at 1080p along angle (degrees).
  function smear(ctx: Ctx, amt: number, angle = 0, o: any = {}) {
    const s = Math.abs(amt) > 0.5 ? snap(ctx) : null;
    if (!s) return;
    const n = o.steps ?? 12;
    const dx = Math.cos((angle * Math.PI) / 180) * amt * u, dy = Math.sin((angle * Math.PI) / 180) * amt * u;
    raw(ctx, () => {
      for (let i = 1; i <= n; i++) {
        ctx.globalAlpha = 1 / (i + 1);
        const k = (i / n - 0.5) * 2;
        ctx.drawImage(s.c, dx * k, dy * k);
      }
    });
  }

  // Glow bleeding off the bright parts of the frame (for dark frames with bright accents). amt 0..1.
  function bloom(ctx: Ctx, amt = 0.5, o: any = {}) {
    const s = amt > 0.01 ? sizeOf(ctx) : null;
    const b = s && buffer("bloom", s.w / 6, s.h / 6);
    if (!s || !b) return;
    b.g.filter = `blur(${Math.max(1, ((o.radius ?? 28) * u) / 6)}px) brightness(${o.brightness ?? 0.72}) contrast(${o.contrast ?? 2.1})`;
    b.g.globalCompositeOperation = "copy";
    b.g.drawImage(s.cv, 0, 0, b.c.width, b.c.height);
    b.g.filter = "none";
    raw(ctx, () => {
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = clamp(amt);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(b.c, 0, 0, s.w, s.h);
    });
  }

  // Film grain that changes every frame. amt 0..1 (0.12 is film stock, 0.35 is gritty).
  function grain(ctx: Ctx, t: number, amt = 0.14, o: any = {}) {
    const s = amt > 0.004 ? sizeOf(ctx) : null;
    const tile = s && grainOf();
    if (!s || !tile) return;
    const f = Math.floor(t * (o.rate ?? 24));
    const sc = Math.max(1, (o.size ?? 1.6) * u);
    raw(ctx, () => {
      const pat = ctx.createPattern(tile, "repeat");
      if (!pat) return;
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = clamp(amt * 2.2);
      ctx.setTransform(sc, 0, 0, sc, -rand(f * 1.7) * 256 * sc, -rand(f * 3.1) * 256 * sc);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, s.w / sc + 256, s.h / sc + 256);
    });
  }

  // Darkened corners.
  function vignette(ctx: Ctx, amt = 0.5, color = "#000000") {
    if (!(amt > 0.004)) return;
    const s = sizeOf(ctx) ?? { w: W, h: H };
    raw(ctx, () => {
      const g = ctx.createRadialGradient(s.w / 2, s.h / 2, Math.min(s.w, s.h) * 0.32, s.w / 2, s.h / 2, Math.hypot(s.w, s.h) * 0.62);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, color);
      ctx.globalAlpha = clamp(amt);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s.w, s.h);
    });
  }

  // CRT lines.
  function scanlines(ctx: Ctx, amt = 0.2, gap = 4) {
    if (!(amt > 0.004)) return;
    const s = sizeOf(ctx) ?? { w: W, h: H };
    const g = Math.max(2, Math.round(gap * u));
    raw(ctx, () => {
      ctx.globalAlpha = clamp(amt);
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      for (let y = 0; y < s.h; y += g) ctx.rect(0, y, s.w, Math.max(1, g * 0.4));
      ctx.fill();
    });
  }

  // Soft coloured light washing across the frame (a film burn). a 0..1.
  function lightLeak(ctx: Ctx, t: number, a = 0.5, o: any = {}) {
    if (!(a > 0.004)) return;
    const s = sizeOf(ctx) ?? { w: W, h: H };
    const colors: string[] = o.colors ?? ["#ff5a1f", "#ffb347", "#ff2d6f"];
    raw(ctx, () => {
      ctx.globalCompositeOperation = "screen";
      colors.forEach((c, i) => {
        const x = s.w * (0.5 + 0.6 * noise(t * (o.speed ?? 0.35) + i * 9.1, i)), y = s.h * (0.5 + 0.6 * noise(i * 4.3, t * (o.speed ?? 0.35) + i));
        const r = Math.max(s.w, s.h) * (0.45 + 0.2 * noise(t * 0.5, i * 7.7));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, c);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = clamp(a * (0.6 + 0.4 * noise(t * 1.3, i * 2.9)));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s.w, s.h);
      });
    });
  }

  // The frame in two inks: shadows become `dark`, highlights `light`.
  function duotone(ctx: Ctx, dark: string, light: string, o: any = {}) {
    const s = snap(ctx);
    if (!s) return;
    raw(ctx, () => {
      ctx.filter = `grayscale(1) contrast(${o.contrast ?? 1.25})`;
      ctx.drawImage(s.c, 0, 0);
      ctx.filter = "none";
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, s.w, s.h);
      ctx.globalCompositeOperation = "lighten";
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, s.w, s.h);
    });
  }

  // Big square pixels of `size` px at 1080p (a mosaic cut: animate size down to 1).
  function pixelate(ctx: Ctx, size: number) {
    const px = Math.round(size * u);
    const s = px > 1 ? sizeOf(ctx) : null;
    const b = s && buffer("pixel", s.w / px, s.h / px);
    if (!s || !b) return;
    b.g.imageSmoothingEnabled = true;
    b.g.globalCompositeOperation = "copy";
    b.g.drawImage(s.cv, 0, 0, b.c.width, b.c.height);
    raw(ctx, () => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(b.c, 0, 0, s.w, s.h);
    });
  }

  // The frame repeated as an n × n video wall.
  function tiles(ctx: Ctx, n: number) {
    const k = Math.round(n);
    const s = k > 1 ? snap(ctx) : null;
    if (!s) return;
    raw(ctx, () => {
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) ctx.drawImage(s.c, (i * s.w) / k, (j * s.h) / k, s.w / k + 1, s.h / k + 1);
    });
  }

  // Heat haze: rows of the frame ripple sideways. amt px at 1080p; { y0, y1 } limits it to a band.
  function heat(ctx: Ctx, t: number, amt: number, o: any = {}) {
    const s = amt > 0.2 ? snap(ctx) : null;
    if (!s) return;
    const rh = Math.max(2, Math.round(3 * u));
    const y0 = Math.round(((o.y0 ?? 0) / H) * s.h), y1 = Math.round(((o.y1 ?? H) / H) * s.h);
    raw(ctx, () => {
      for (let y = y0; y < y1; y += rh) {
        const dx = (Math.sin(y * (o.freq ?? 0.035) - t * (o.speed ?? 6)) + noise(y * 0.01, t * 1.7)) * amt * u * 0.5;
        ctx.drawImage(s.c, 0, y, s.w, rh, dx, y, s.w, rh);
      }
    });
  }

  // ── Things that burn, burst and streak ─────────────────────────────────

  // Glowing embers rising (or falling: speed < 0) and flickering out.
  function embers(ctx: Ctx, t: number, o: any = {}) {
    const n = o.n ?? 70, seed = o.seed ?? 1;
    const x0 = o.x0 ?? 0, x1 = o.x1 ?? W, y0 = o.y ?? H, rise = o.rise ?? H * 0.9;
    const hot = o.color ?? "#ffb347", cool = o.cool ?? "#ff3d00";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const a0 = ctx.globalAlpha * (o.alpha ?? 1);
    for (let i = 0; i < n; i++) {
      const r1 = rand(i * 12.9 + seed), r2 = rand(i * 78.2 + seed), r3 = rand(i * 37.7 + seed), r4 = rand(i * 5.3 + seed);
      const life = 1.6 + r1 * 3.2;
      const ph = (((t * (o.speed ?? 1) + r2 * life) % life) + life) % life / life;
      const x = x0 + r3 * (x1 - x0) + (noise(i * 3.1, t * 0.7) * 90 + (o.wind ?? 0) * ph * 200) * u * (0.3 + ph);
      const y = y0 - ph * rise * (0.45 + r4 * 0.75);
      const size = (1.2 + r1 * 3.6) * u * (o.size ?? 1) * (1 - ph * 0.55);
      const flick = 0.65 + 0.35 * Math.sin(t * 23 + i * 7.1);
      ctx.fillStyle = ph < 0.5 ? hot : cool;
      ctx.globalAlpha = a0 * Math.pow(Math.sin(Math.PI * ph), 0.7) * flick * 0.16;
      ctx.beginPath();
      ctx.arc(x, y, size * 4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = a0 * Math.pow(Math.sin(Math.PI * ph), 0.7) * flick;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // A burst of sparks from a point: k runs 0..1 over the burst's life.
  function sparks(ctx: Ctx, x: number, y: number, k: number, o: any = {}) {
    if (k <= 0 || k >= 1) return;
    const n = o.n ?? 36, seed = o.seed ?? 1, len = (o.len ?? 420) * u;
    const dir = ((o.angle ?? -90) * Math.PI) / 180, spread = ((o.spread ?? 360) * Math.PI) / 180;
    const e = ease.outQuint(k);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.strokeStyle = o.color ?? "#ffd76a";
    const a0 = ctx.globalAlpha;
    for (let i = 0; i < n; i++) {
      const a = dir + (rand(i * 9.7 + seed) - 0.5) * spread, r = len * (0.25 + rand(i * 3.3 + seed) * 0.75);
      const g = (o.gravity ?? 260) * u * k * k;
      const d1 = r * e, d0 = r * ease.outQuint(Math.max(0, k - 0.09));
      ctx.globalAlpha = a0 * (1 - k) * (0.5 + rand(i * 6.1 + seed) * 0.5);
      ctx.lineWidth = (1 + rand(i * 2.2 + seed) * 2.6) * u * (o.width ?? 1);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * d0, y + Math.sin(a) * d0 + g * 0.8);
      ctx.lineTo(x + Math.cos(a) * d1, y + Math.sin(a) * d1 + g);
      ctx.stroke();
    }
    ctx.restore();
  }

  // An expanding ring from a hit: k runs 0..1.
  function shockwave(ctx: Ctx, x: number, y: number, k: number, o: any = {}) {
    if (k <= 0 || k >= 1) return;
    ctx.save();
    ctx.globalAlpha *= (1 - k) * (o.alpha ?? 1);
    ctx.strokeStyle = o.color ?? "#ffffff";
    ctx.lineWidth = Math.max(0.5, (o.width ?? 26) * u * (1 - k));
    ctx.beginPath();
    ctx.arc(x, y, ease.outExpo(k) * (o.r ?? Math.hypot(W, H) * 0.6), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Radial speed lines converging on a point (they jitter every few frames).
  function speedLines(ctx: Ctx, cx: number, cy: number, t: number, o: any = {}) {
    const n = o.n ?? 70, f = Math.floor(t * (o.rate ?? 14)), R = Math.hypot(W, H);
    ctx.save();
    ctx.fillStyle = o.color ?? "#ffffff";
    ctx.globalAlpha *= o.alpha ?? 0.9;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rand(i * 7.7 + f * 3.1) * TAU, w = 0.003 + rand(i * 1.3 + f) * (o.width ?? 0.014);
      const r0 = Math.min(W, H) * (o.inner ?? 0.36) * (0.75 + rand(i * 5.9 + f * 1.7) * 0.6);
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R);
      ctx.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  // Stylised fire rising from a base line: (x, y) is its bottom-left, w wide, flames up to h tall.
  function flames(ctx: Ctx, x: number, y: number, w: number, h: number, t: number, o: any = {}) {
    const colors: string[] = o.colors ?? ["#5c0a00", "#d92b06", "#ff7a1a", "#ffd76a"];
    const steps = o.detail ?? 56, sp = o.speed ?? 1;
    ctx.save();
    if (o.add) ctx.globalCompositeOperation = "lighter";
    colors.forEach((c, li) => {
      const tall = 1 - li * (0.78 / colors.length);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i <= steps; i++) {
        const nx = i / steps;
        const lick = 0.5 * Math.abs(noise(nx * 3.2 + li * 5, t * 1.7 * sp + li)) + 0.32 * Math.abs(noise(nx * 8.5 + li, t * 3.3 * sp)) + 0.18 * Math.abs(noise(nx * 21, t * 6.1 * sp + li * 2));
        const edge = Math.pow(Math.sin(Math.PI * nx), 0.35);
        ctx.lineTo(x + nx * w + noise(nx * 6 + li, t * 2.2 * sp) * w * 0.012, y - h * tall * edge * (0.28 + 1.25 * lick));
      }
      ctx.lineTo(x + w, y);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  // ── Type that hits ─────────────────────────────────────────────────────

  // A word slammed onto the frame: it arrives huge and lands at size as k goes 0..1 (text options in o,
  // plus from: the scale it starts at).
  function slam(ctx: Ctx, str: string, x: number, y: number, k: number, o: any = {}) {
    if (k <= 0) return { width: 0, height: 0, lines: 0 };
    const e = ease.outExpo(clamp(k));
    const sc = (o.from ?? 3.4) + (1 - (o.from ?? 3.4)) * e;
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      return text(ctx, str, 0, 0, { ...o, alpha: (o.alpha ?? 1) * clamp(k * 8) });
    } finally {
      ctx.restore();
    }
  }

  // A line of type animated letter by letter as k goes 0..1. o.mode: 'rise' | 'drop' | 'pop' | 'spin' |
  // 'flip' | 'scatter'; o.spread staggers the letters (0 = together, 1 = one at a time); o.colors cycles
  // colours per letter. Other text options as lib.text (one line).
  function letters(ctx: Ctx, str: string, x: number, y: number, k: number, o: any = {}) {
    const size = o.size ?? 48 * u;
    const chars = Array.from(String(str));
    ctx.save();
    ctx.font = font({ ...o, size });
    ctx.textBaseline = o.baseline ?? "alphabetic";
    ctx.textAlign = "left";
    const track = (o.tracking ?? 0) * size;
    const widths = chars.map((c) => ctx.measureText(c).width + track);
    const total = widths.reduce((a, b) => a + b, 0) - track;
    let cx = x - (o.align === "center" ? total / 2 : o.align === "right" ? total : 0);
    const n = chars.length, spread = o.spread ?? 0.7, mode = o.mode ?? "rise", a0 = ctx.globalAlpha * (o.alpha ?? 1);
    const e: Ease = o.ease ?? (mode === "pop" || mode === "drop" ? ease.outBack : ease.outQuint);
    chars.forEach((c, i) => {
      const w = widths[i];
      const raw_ = n > 1 ? clamp((k - (i / (n - 1)) * spread) / Math.max(1e-6, 1 - spread)) : clamp(k);
      const ki = e(raw_);
      if (raw_ > 0 && c.trim()) {
        ctx.save();
        ctx.translate(cx + (w - track) / 2, y);
        ctx.globalAlpha = a0 * clamp(raw_ * 5);
        if (mode === "rise") ctx.translate(0, (1 - ki) * size * 0.9);
        else if (mode === "drop") ctx.translate(0, -(1 - ki) * size * 1.4);
        else if (mode === "pop") ctx.scale(Math.max(0.001, ki), Math.max(0.001, ki));
        else if (mode === "spin") {
          ctx.rotate((1 - ki) * -1.1);
          ctx.scale(Math.max(0.001, ki), Math.max(0.001, ki));
        } else if (mode === "flip") ctx.scale(1, Math.max(0.001, ki));
        else if (mode === "scatter") {
          ctx.translate((rand(i * 7.1 + 3) - 0.5) * size * 5 * (1 - ki), (rand(i * 3.3 + 9) - 0.5) * size * 4 * (1 - ki));
          ctx.rotate((rand(i * 5.7) - 0.5) * 3 * (1 - ki));
        }
        ctx.fillStyle = o.colors ? o.colors[i % o.colors.length] : (o.color ?? "#ffffff");
        ctx.textAlign = "center";
        ctx.fillText(c, 0, 0);
        ctx.restore();
      }
      cx += w;
    });
    ctx.restore();
    return { width: total, height: size, lines: 1 };
  }

  // Hollow type: just the outline (o.lineWidth px at 1080p), optionally stacked: o.echo copies, each
  // offset by (o.dx, o.dy) and fainter.
  function outline(ctx: Ctx, str: string, x: number, y: number, o: any = {}) {
    const size = o.size ?? 48 * u;
    ctx.save();
    ctx.font = font({ ...o, size });
    ctx.textAlign = o.align ?? "left";
    ctx.textBaseline = o.baseline ?? "alphabetic";
    if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${(o.tracking ?? 0) * size}px`;
    ctx.lineJoin = "round";
    ctx.lineWidth = (o.lineWidth ?? 3) * u;
    ctx.strokeStyle = o.color ?? "#ffffff";
    const a0 = ctx.globalAlpha * (o.alpha ?? 1), n = o.echo ?? 0;
    for (let i = n; i >= 0; i--) {
      ctx.globalAlpha = a0 * (i ? 0.75 / (i + 0.4) : 1);
      ctx.strokeText(str, x + i * (o.dx ?? 0), y + i * (o.dy ?? size * 0.16));
    }
    const width = ctx.measureText(str).width;
    ctx.restore();
    return { width, height: size, lines: 1 };
  }

  // Text still decoding: the first k of it reads true, the rest flickers through random glyphs.
  function scramble(str: string, k: number, t: number, o: any = {}) {
    const glyphs: string = o.glyphs ?? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&$@/<>";
    const chars = Array.from(String(str)), shown = Math.floor(clamp(k) * chars.length + 1e-6), f = Math.floor(t * (o.rate ?? 22));
    return chars.map((c, i) => (i < shown || !c.trim() ? c : glyphs[Math.floor(rand(i * 13.7 + f * 7.3) * glyphs.length)])).join("");
  }

  // A band of repeating type scrolling across the frame at y: o.speed px/s at 1080p (negative runs the
  // other way), o.angle degrees, o.outline for hollow letters, o.band a colour for a bar behind it.
  function marquee(ctx: Ctx, str: string, y: number, t: number, o: any = {}) {
    const size = o.size ?? 120 * u;
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.rotate(((o.angle ?? 0) * Math.PI) / 180);
    ctx.font = font({ weight: 800, family: "sans", ...o, size });
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const unit = `${str}${o.sep ?? "  ✦  "}`;
    const w = Math.max(1, ctx.measureText(unit).width);
    const span = Math.hypot(W, H);
    if (o.band) {
      ctx.fillStyle = o.band;
      ctx.fillRect(-span, -size * 0.66, span * 2, size * 1.32);
    }
    const off = ((((t * (o.speed ?? 320) * u) % w) + w) % w);
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.fillStyle = ctx.strokeStyle = o.color ?? "#ffffff";
    ctx.lineWidth = (o.lineWidth ?? 3) * u;
    for (let x = -span - off; x < span; x += w) {
      if (o.outline) ctx.strokeText(unit, x, 0);
      else ctx.fillText(unit, x, 0);
    }
    ctx.restore();
  }

  // Art seen only through letterforms: draw(c) paints on c, and only where the text is shows.
  function textFill(ctx: Ctx, str: string, x: number, y: number, o: any, draw: (c: Ctx) => void) {
    const s = sizeOf(ctx);
    const b = s && buffer("textfill", s.w, s.h);
    if (!s || !b) return void text(ctx, str, x, y, o);
    const m = ctx.getTransform();
    b.g.clearRect(0, 0, s.w, s.h);
    b.g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    text(b.g, str, x, y, { ...o, color: "#ffffff", alpha: 1 });
    b.g.globalCompositeOperation = "source-atop";
    b.g.save();
    try {
      draw(b.g);
    } finally {
      b.g.restore();
      b.g.globalCompositeOperation = "source-over";
    }
    const a = ctx.globalAlpha * (o?.alpha ?? 1);
    raw(ctx, () => {
      ctx.globalAlpha = clamp(a);
      ctx.drawImage(b.c, 0, 0);
    });
  }

  return {
    beats, shot, hit, shake, trail, wipe,
    flash, invert, impact, rgbSplit, glitch, zoomBlur, smear, bloom, grain, vignette, scanlines, lightLeak, duotone, pixelate, tiles, heat,
    embers, sparks, shockwave, speedLines, flames,
    slam, letters, outline, scramble, marquee, textFill,
  };
}
