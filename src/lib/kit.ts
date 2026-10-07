/* eslint-disable @typescript-eslint/no-explicit-any */
// The animation kit exposed to every scene as `lib`.
// Scenes are pure functions of time, so everything here is stateless.

export type Fonts = { serif: string; sans: string; mono: string };

export const PALETTE = {
  ivory: "#FAF9F5",
  paper: "#F0EEE6",
  oat: "#E3DACC",
  cloud: "#D1CFC5",
  stone: "#87867F",
  slate: "#3D3D3A",
  ink: "#141413",
  clay: "#D97757",
  clayDeep: "#C6613F",
  olive: "#788C5D",
  sky: "#6A9BCC",
  fig: "#C46686",
  white: "#FFFFFF",
};

const D2R = Math.PI / 180;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const ease = {
  linear: (t: number) => t,
  in: (t: number) => t * t * t,
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t: number) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

type Ease = (t: number) => number;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function makeKit(W: number, H: number, fonts: Fonts) {
  const u = Math.min(W, H) / 1080;

  const fam = (f?: string) =>
    !f || f === "serif" ? fonts.serif : f === "sans" ? fonts.sans : f === "mono" ? fonts.mono : f;

  const font = (o: any = {}) =>
    `${o.italic ? "italic " : ""}${o.weight ?? 400} ${o.size ?? 48 * u}px ${fam(o.family)}`;

  function applyText(ctx: CanvasRenderingContext2D, o: any) {
    ctx.font = font(o);
    ctx.fillStyle = o.color ?? PALETTE.ink;
    if ("letterSpacing" in ctx) {
      (ctx as any).letterSpacing = `${(o.tracking ?? 0) * (o.size ?? 48 * u)}px`;
    }
  }

  function wrap(ctx: CanvasRenderingContext2D, str: string, maxWidth?: number): string[] {
    const out: string[] = [];
    for (const para of String(str).split("\n")) {
      if (!maxWidth) {
        out.push(para);
        continue;
      }
      let line = "";
      for (const w of para.split(" ")) {
        const test = line ? line + " " + w : w;
        if (line && ctx.measureText(test).width > maxWidth) {
          out.push(line);
          line = w;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  // Seconds-free timing: everything is expressed in fractions of the film (p),
  // so changing the length re-times the whole piece without regenerating it.
  const seg = (p: number, a: number, b: number, e: Ease = ease.linear) => e(clamp((p - a) / (b - a)));

  function win(p: number, a: number, b: number, fadeIn = 0.025, fadeOut = 0.025) {
    const on = p >= a && p <= b;
    const k = clamp((p - a) / (b - a));
    const i = fadeIn > 0 ? ease.out(clamp((p - a) / fadeIn)) : 1;
    const o = fadeOut > 0 ? ease.inOut(clamp((b - p) / fadeOut)) : 1;
    return { on, k, in: i, out: o, a: on ? Math.min(i, o) : 0 };
  }

  function keys(p: number, ks: [number, any][], e: Ease = ease.inOut) {
    if (p <= ks[0][0]) return ks[0][1];
    for (let i = 0; i < ks.length - 1; i++) {
      const [p0, v0] = ks[i];
      const [p1, v1] = ks[i + 1];
      if (p <= p1) {
        const k = e(clamp((p - p0) / (p1 - p0 || 1)));
        return Array.isArray(v0) ? v0.map((x: number, j: number) => lerp(x, v1[j], k)) : lerp(v0, v1, k);
      }
    }
    return ks[ks.length - 1][1];
  }

  function mix(a: string, b: string, t: number) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return `rgb(${A.map((x, i) => Math.round(lerp(x, B[i], clamp(t)))).join(",")})`;
  }

  function rand(seed: number) {
    let x = Math.imul((seed * 2654435761) | 0, 1597334677) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  const pulse = (t: number, period = 1.6) => (((t % period) + period) % period) / period;

  function bg(ctx: CanvasRenderingContext2D, w: number, h: number, color = PALETTE.ivory) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, o: any = {}) {
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    applyText(ctx, o);
    ctx.textAlign = o.align ?? "left";
    const size = o.size ?? 48 * u;
    const lh = (o.lineHeight ?? 1.2) * size;
    const lines = wrap(ctx, str, o.maxWidth);
    let y0 = y;
    if (o.baseline === "middle") {
      ctx.textBaseline = "middle";
      y0 = y - ((lines.length - 1) * lh) / 2;
    } else ctx.textBaseline = o.baseline ?? "alphabetic";
    let width = 0;
    lines.forEach((ln, i) => {
      ctx.fillText(ln, x, y0 + i * lh);
      width = Math.max(width, ctx.measureText(ln).width);
    });
    ctx.restore();
    return { width, height: lines.length * lh, lines: lines.length };
  }

  // Staggered word-by-word reveal, the house transition for type.
  function words(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, k: number, o: any = {}) {
    ctx.save();
    applyText(ctx, o);
    ctx.textAlign = "left";
    const size = o.size ?? 48 * u;
    const lh = (o.lineHeight ?? 1.2) * size;
    const lines = wrap(ctx, str, o.maxWidth);
    const space = ctx.measureText(" ").width;
    const spread = o.stagger ?? 0.55;
    const rise = o.rise ?? size * 0.35;
    const e: Ease = o.ease ?? ease.outQuint;
    const highlight: string[] = o.highlight ?? [];
    const total = lines.reduce((n, l) => n + l.split(" ").filter(Boolean).length, 0);
    let y0 = y;
    if (o.baseline === "middle") {
      ctx.textBaseline = "middle";
      y0 = y - ((lines.length - 1) * lh) / 2;
    } else ctx.textBaseline = o.baseline ?? "alphabetic";
    const base = ctx.globalAlpha * (o.alpha ?? 1);
    let i = 0;
    let width = 0;
    lines.forEach((line, li) => {
      const ws = line.split(" ").filter(Boolean);
      const lw = ctx.measureText(line).width;
      width = Math.max(width, lw);
      const align = o.align ?? "left";
      let cx = align === "center" ? x - lw / 2 : align === "right" ? x - lw : x;
      for (const w of ws) {
        const start = total > 1 ? (i / (total - 1)) * spread : 0;
        const wp = e(clamp((k - start) / (1 - spread)));
        const ww = ctx.measureText(w).width;
        if (wp > 0) {
          ctx.globalAlpha = base * wp;
          if (o.blur) ctx.filter = wp < 1 ? `blur(${(1 - wp) * o.blur}px)` : "none";
          ctx.fillStyle = highlight.includes(w) ? o.highlightColor ?? PALETTE.clay : o.color ?? PALETTE.ink;
          ctx.fillText(w, cx, y0 + li * lh + (1 - wp) * rise);
        }
        cx += ww + space;
        i++;
      }
    });
    ctx.restore();
    return { width, height: lines.length * lh, lines: lines.length };
  }

  function typewriter(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, k: number, o: any = {}) {
    const n = Math.floor(clamp(k) * str.length);
    const shown = str.slice(0, n);
    const r = text(ctx, shown, x, y, o);
    if (o.caret !== false && (k < 1 || pulse(o.t ?? 0, 1) < 0.5)) {
      ctx.save();
      applyText(ctx, o);
      const w = ctx.measureText(shown).width;
      const size = o.size ?? 48 * u;
      ctx.globalAlpha *= o.alpha ?? 1;
      ctx.fillStyle = o.caretColor ?? PALETTE.clay;
      const off = o.align === "center" ? w / 2 : 0;
      ctx.fillRect(x + w - off + size * 0.08, y - size * 0.78, Math.max(2, size * 0.06), size * 0.9);
      ctx.restore();
    }
    return r;
  }

  function shape(ctx: CanvasRenderingContext2D, o: any) {
    ctx.globalAlpha *= o.alpha ?? 1;
    if (o.fill) {
      ctx.fillStyle = o.fill;
      ctx.fill();
    }
    if (o.stroke) {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.lineWidth ?? 2 * u;
      ctx.stroke();
    }
  }

  function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, o: any = {}) {
    if (r <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    shape(ctx, o);
    ctx.restore();
  }

  function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, o: any = {}) {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    shape(ctx, o);
    ctx.restore();
  }

  // Draws a polyline up to fraction k of its length.
  function line(ctx: CanvasRenderingContext2D, pts: [number, number][], k = 1, o: any = {}) {
    if (pts.length < 2 || k <= 0) return;
    const lens = [0];
    for (let i = 1; i < pts.length; i++)
      lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const target = lens[lens.length - 1] * clamp(k);
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.strokeStyle = o.color ?? PALETTE.ink;
    ctx.lineWidth = o.width ?? 2 * u;
    ctx.lineCap = o.cap ?? "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      if (lens[i] <= target) ctx.lineTo(pts[i][0], pts[i][1]);
      else {
        const f = (target - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
        ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f));
        break;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k = 1, o: any = {}) {
    if (k <= 0 || r <= 0) return;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.strokeStyle = o.color ?? PALETTE.ink;
    ctx.lineWidth = o.width ?? 2 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    const s = (o.start ?? -90) * D2R;
    ctx.arc(x, y, r, s, s + clamp(k) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function image(ctx: CanvasRenderingContext2D, img: any, x: number, y: number, w: number, h: number, o: any = {}) {
    if (!img || !img.width) return;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const s = o.fit === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * s;
    const dh = ih * s;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    if (o.radius || o.fit === "cover") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, o.radius ?? 0);
      ctx.clip();
    }
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  // Orthographic line-art globe. rot = centre longitude, tilt = centre latitude (degrees).
  function globe(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, o: any = {}) {
    const rot = (o.rot ?? 0) * D2R;
    const tilt = (o.tilt ?? 18) * D2R;
    const k = o.k ?? 1;
    const color = o.color ?? PALETTE.ink;
    const lw = o.lineWidth ?? Math.max(1, 1.4 * u * (R / (300 * u)) ** 0.5);
    const st = Math.sin(tilt);
    const ct = Math.cos(tilt);
    const proj = (lat: number, lon: number): [number, number, number] => {
      const la = lat * D2R;
      const lo = lon * D2R - rot;
      const x = Math.cos(la) * Math.sin(lo);
      const y = ct * Math.sin(la) - st * Math.cos(la) * Math.cos(lo);
      const z = st * Math.sin(la) + ct * Math.cos(la) * Math.cos(lo);
      return [cx + R * x, cy - R * y, z];
    };
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    if (o.fill) circle(ctx, cx, cy, R, { fill: o.fill, alpha: seg(k, 0.2, 0.8) });

    const grid = seg(k, 0.35, 1, ease.out);
    if (grid > 0) {
      const curves: [number, number][][] = [];
      const nm = o.meridians ?? 12;
      for (let m = 0; m < nm; m++) {
        const lon = (m * 360) / nm;
        const c: [number, number][] = [];
        for (let lat = -90; lat <= 90; lat += 4) c.push([lat, lon]);
        curves.push(c);
      }
      for (const lat of o.parallels ?? [-60, -30, 0, 30, 60]) {
        const c: [number, number][] = [];
        for (let lon = 0; lon <= 360; lon += 4) c.push([lat, lon]);
        curves.push(c);
      }
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      for (const pass of [false, true]) {
        ctx.save();
        ctx.globalAlpha *= grid * (pass ? o.gridAlpha ?? 0.42 : o.backAlpha ?? 0.07);
        ctx.beginPath();
        for (const c of curves) {
          let pen = false;
          for (const [la, lo] of c) {
            const [px, py, z] = proj(la, lo);
            if (z > 0 === pass) {
              if (pen) ctx.lineTo(px, py);
              else ctx.moveTo(px, py);
              pen = true;
            } else pen = false;
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    ring(ctx, cx, cy, R, seg(k, 0, 0.6, ease.inOut), { color, width: lw * 1.4, start: -90 });

    for (const m of o.markers ?? []) {
      const [px, py, z] = proj(m.lat, m.lon);
      if (z <= 0.02) continue;
      const fade = clamp(z / 0.2) * (m.alpha ?? 1);
      const size = (m.size ?? 6) * u;
      if (m.pulse != null) {
        const ph = m.pulse;
        ring(ctx, px, py, size * (1 + 3.2 * ph), 1, {
          color: m.color ?? PALETTE.clay,
          width: 1.6 * u,
          alpha: fade * (1 - ph) * 0.9,
        });
      }
      circle(ctx, px, py, size, { fill: m.color ?? PALETTE.clay, alpha: fade });
      if (m.label)
        text(ctx, m.label, px + size * 2.2, py, {
          size: 20 * u,
          family: "sans",
          color: m.labelColor ?? PALETTE.slate,
          baseline: "middle",
          alpha: fade,
        });
    }
    ctx.restore();
    return { proj };
  }

  // A speaking-voice waveform. Deterministic in t.
  function wave(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, o: any = {}) {
    const n = o.bars ?? 28;
    const gap = w / n;
    const bw = Math.max(2 * u, gap * (o.thickness ?? 0.45));
    const amp = o.amp ?? 1;
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.fillStyle = o.color ?? PALETTE.clay;
    for (let i = 0; i < n; i++) {
      const v =
        Math.abs(
          Math.sin(t * 3.1 + i * 0.55) * 0.5 + Math.sin(t * 5.3 + i * 1.3) * 0.3 + Math.sin(t * 1.7 + i * 0.21) * 0.2,
        ) * amp;
      const env = Math.sin(((i + 0.5) / n) * Math.PI) ** 0.6;
      const bh = Math.max(bw, h * (0.12 + 0.88 * v * env));
      ctx.beginPath();
      ctx.roundRect(x + i * gap + (gap - bw) / 2, y - bh / 2, bw, bh, bw / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Smooth deterministic 3D value noise in [-1, 1].
  function noise(x: number, y = 0, z = 0) {
    const h = (i: number, j: number, k: number) => rand(i * 374761 + j * 668265 + k * 1274126) * 2 - 1;
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const s = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);
    const fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
    const l = (a: number, b: number, k: number) => a + (b - a) * k;
    const plane = (k: number) =>
      l(l(h(xi, yi, k), h(xi + 1, yi, k), fx), l(h(xi, yi + 1, k), h(xi + 1, yi + 1, k), fx), fy);
    return l(plane(zi), plane(zi + 1), fz);
  }

  // Damped spring from 0 to 1 with natural overshoot. k is progress 0..1.
  function spring(k: number, o: any = {}) {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    const damping = o.damping ?? 0.45;
    const freq = o.freq ?? 3.2;
    return 1 - Math.exp(-damping * 10 * k) * Math.cos(freq * Math.PI * 2 * k * (1 - damping * 0.3));
  }

  // Closed-form damped spring 0→1 in seconds (stiffness k, damping d), pure in t.
  function springT(t: number, k = 170, d = 26) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k);
    const z = d / (2 * w0);
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }

  // A value that changes target several times: one spring per change, summed.
  // keys: [[time, value], ...] sorted by time. Stays continuous and seekable.
  function track(t: number, keys: [number, number][], k = 170, d = 26) {
    if (!keys.length) return 0;
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * springT(t - keys[i][0], k, d);
    return v;
  }

  const loopT = (t: number, period: number) => ((t % period) + period) % period;

  // Per-item progress for n staggered items sharing one progress value k.
  function stagger(k: number, i: number, n: number, spread = 0.6, e: Ease = ease.outQuint) {
    const start = n > 1 ? (i / (n - 1)) * spread : 0;
    return e(clamp((k - start) / (1 - spread)));
  }

  // Virtual camera: zoom / pan / rotate around the frame centre, then draw.
  function camera(ctx: CanvasRenderingContext2D, o: any, draw: () => void) {
    ctx.save();
    const cx = o.cx ?? W / 2;
    const cy = o.cy ?? H / 2;
    ctx.translate(cx, cy);
    ctx.rotate(((o.rot ?? 0) * Math.PI) / 180);
    ctx.scale(o.zoom ?? 1, o.zoom ?? 1);
    ctx.translate(-cx + (o.x ?? 0), -cy + (o.y ?? 0));
    draw();
    ctx.restore();
  }

  // Clip drawing to a path built by shape(ctx).
  function mask(ctx: CanvasRenderingContext2D, shape: (c: CanvasRenderingContext2D) => void, draw: () => void) {
    ctx.save();
    ctx.beginPath();
    shape(ctx);
    ctx.clip();
    draw();
    ctx.restore();
  }

  const count = (k: number, from: number, to: number, decimals = 0) =>
    lerp(from, to, clamp(k)).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  return {
    noise,
    spring,
    springT,
    track,
    loopT,
    stagger,
    camera,
    mask,
    count,
    C: PALETTE,
    F: fonts,
    u,
    W,
    H,
    ease,
    clamp,
    lerp,
    seg,
    win,
    keys,
    mix,
    rand,
    pulse,
    font,
    wrap,
    bg,
    text,
    words,
    typewriter,
    circle,
    rrect,
    line,
    ring,
    image,
    globe,
    wave,
  };
}

export type Kit = ReturnType<typeof makeKit>;
