// Flow Field. Hand-built example film in the scene format Claude generates.
// Brief: Pure generative abstract art: thousands of particle streaks tracing a noise flow field, from sparse black ink lines on bone to dense glowing silk ribbons in deep teal, coral and gold, a vortex that forms and dissolves, then calm. Gallery-grade and hypnotic, with only a tiny mono caption at the end.
export const film = {
  id: "ex-flow-field",
  title: "Flow Field",
  aspect: "9:16" as const,
  duration: 15,
  prompt: "Pure generative abstract art: thousands of particle streaks tracing a noise flow field, from sparse black ink lines on bone to dense glowing silk ribbons in deep teal, coral and gold, a vortex that forms and dissolves, then calm. Gallery-grade and hypnotic, with only a tiny mono caption at the end.",
  code: String.raw`
// FLOW FIELD — generative streaks along a noise field, recomputed from t every frame.
// Movements: I ink on bone · II silk ribbons (teal → coral → gold, additive) · III vortex · IV calm.
const u = lib.u, K = lib.keys, E = lib.ease, TAU = Math.PI * 2;
const wide = W / H >= 1.2, tall = W / H < 0.8;
const S = Math.min(W, H);

// ---- movement curves (all by p) ----
const e1 = lib.seg(p, 0.16, 0.3, E.inOut), e2 = lib.seg(p, 0.79, 0.9, E.inOut);
const dark = e1 * (1 - e2);
const turb = K(p, [[0, 0.5], [0.3, 0.85], [0.5, 1.1], [0.66, 0.9], [0.8, 1.3], [0.9, 0.6], [1, 0.45]], E.inOut);
const vort = K(p, [[0.5, 0], [0.62, 1], [0.72, 1], [0.84, 0]], E.inOut);
const nCur = K(p, [[0, 140], [0.08, 260], [0.18, 420], [0.34, 1450], [0.5, 1750], [0.76, 1650], [0.9, 360], [1, 300]], E.inOut);
const tail = K(p, [[0, 20], [0.2, 19], [0.36, 13], [0.75, 14], [0.9, 22], [1, 23]], E.inOut);
const stepL = K(p, [[0, 11.5], [0.3, 14], [0.6, 15], [0.9, 11.5], [1, 10]], E.inOut) * u;
const lw = K(p, [[0, 1.2], [0.18, 1.5], [0.36, 2.9], [0.55, 2.4], [0.76, 2.1], [0.9, 1.3], [1, 1.15]], E.inOut) * u;
const hue = K(p, [[0.3, -0.22], [0.5, 0.05], [0.66, 0.08], [0.8, 0]], E.inOut);
const gold = K(p, [[0.84, 0], [1, 0.22]]);

// ---- ground ----
const BONE = '#ece5d6', NIGHT = '#061215';
lib.bg(ctx, W, H, e1 >= 1 && e2 < 1 ? NIGHT : BONE); // night is the base ground from full night through the exit
// a soft disc of the other ground blooms from the centre and carries the film across (world space)
const blobR = (e1 > 0 && e1 < 1 ? e1 : e2 > 0 && e2 < 1 ? e2 : 0) * Math.hypot(W, H) * 0.66;
const bx = 0, by = H * (e2 > 0 ? 0.02 : -0.04), feather = blobR * 0.35 + 60 * u;
const exiting = e2 > 0;

// ---- camera: slow rotation + push, leaning into the vortex ----
const ax = K(p, [[0.45, (wide ? 0.22 : 0.16) * W], [0.62, 0.06 * W], [0.84, -0.04 * W]], E.inOut);
const ay = K(p, [[0.45, -0.12 * H], [0.62, -0.03 * H], [0.84, 0.02 * H]], E.inOut);
const rot = -5 + 11 * p + 9 * lib.seg(p, 0.5, 0.86, E.inOut);
const zoom = 1.04 + 0.1 * lib.seg(p, 0, 1, E.inOutSine) + 0.12 * vort;

// ---- field grid: unit direction vectors sampled from lib.noise ----
const cell = 34 * u;
const extX = 0.5 * W * 1.32, extY = 0.5 * H * 1.2;
const gw = Math.ceil(2 * extX / cell) + 2, gh = Math.ceil(2 * extY / cell) + 2;
const fs = 1 / (420 * u), z = t * 0.04 + p * 1.1;
const base = (wide ? 0 : -Math.PI / 2) + 0.35 * Math.sin(t * 0.07);
const GX = new Float32Array(gw * gh), GY = new Float32Array(gw * gh);
for (let j = 0; j < gh; j++) {
  for (let i = 0; i < gw; i++) {
    const x = -extX + i * cell, y = -extY + j * cell;
    const n = lib.noise(x * fs, y * fs, z) + 0.35 * lib.noise(x * fs * 2.3 + 7.1, y * fs * 2.3 - 3.3, z * 1.6 + 4);
    const a = base + n * TAU * 0.62 * turb;
    GX[j * gw + i] = Math.cos(a);
    GY[j * gw + i] = Math.sin(a);
  }
}
const R2 = Math.pow(0.46 * S, 2), beta = 0.22;
let dX = 0, dY = 0;
function dir(x, y) {
  let fx = (x + extX) / cell, fy = (y + extY) / cell;
  fx = fx < 0 ? 0 : fx > gw - 1.001 ? gw - 1.001 : fx;
  fy = fy < 0 ? 0 : fy > gh - 1.001 ? gh - 1.001 : fy;
  const i = fx | 0, j = fy | 0, a = fx - i, b = fy - j, k = j * gw + i;
  let vx = (GX[k] * (1 - a) + GX[k + 1] * a) * (1 - b) + (GX[k + gw] * (1 - a) + GX[k + gw + 1] * a) * b;
  let vy = (GY[k] * (1 - a) + GY[k + 1] * a) * (1 - b) + (GY[k + gw] * (1 - a) + GY[k + gw + 1] * a) * b;
  if (vort > 0.001) {
    const rx = x - ax, ry = y - ay, d2 = rx * rx + ry * ry, d = Math.sqrt(d2) + 1e-3;
    const w = Math.min(0.96, vort * 1.25 * Math.exp(-d2 / (R2 * 1.7))) * Math.min(1, d / (90 * u));
    const tx = (-ry * Math.cos(beta) - rx * Math.sin(beta)) / d;
    const ty = (rx * Math.cos(beta) - ry * Math.sin(beta)) / d;
    vx = vx * (1 - w) + tx * w;
    vy = vy * (1 - w) + ty * w;
  }
  const m = Math.sqrt(vx * vx + vy * vy) + 1e-6;
  dX = vx / m; dY = vy / m;
}

// ---- particles -> batched buckets (6 colours x 4 alpha levels) ----
const NC = 6, NL = 6, M = 22, Lp = 3.0;
const B = [];
for (let b = 0; b < 2 * NC * NL; b++) B.push([]);
const baseMode = dark > 0.5 ? 1 : 0;
const spX = extX * 0.98, spY = extY * 0.98;
const nMax = Math.ceil(nCur) + 80;
for (let i = 0; i < nMax; i++) {
  const dens = lib.clamp((nCur - i) / 80);
  if (dens <= 0) break;
  const ph = t / Lp + lib.rand(i * 13 + 1), c = Math.floor(ph), f = ph - c;
  const life = Math.pow(Math.sin(Math.PI * f), 0.6) * dens;
  if (life < 0.03) continue;
  const seed = i * 7919 + c * 104729;
  let x = (lib.rand(seed) * 2 - 1) * spX, y = (lib.rand(seed + 1) * 2 - 1) * spY;
  // colour: drifting diagonal bands perturbed by noise -> teal / coral / gold rivers
  const cv = lib.clamp(0.5 + hue + 0.62 * lib.noise(x * fs * 0.55 + 31, y * fs * 0.55, t * 0.03) + 0.28 * (y / extY) * (wide ? 0 : 1) + 0.28 * (x / extX) * (wide ? 1 : 0), 0, 0.999);
  const cb = Math.floor(cv * NC);
  const head = f * M, t0 = Math.max(0, head - tail * (0.75 + 0.5 * lib.rand(i * 3 + 7)));
  const span = head - t0 + 1e-3;
  const jit = (lib.rand(i * 5 + 3) - 0.5) * feather;
  let last = -1;
  for (let s = 0; s < head; s++) {
    dir(x, y);
    const st = Math.min(1, head - s) * stepL;
    const nx = x + dX * st, ny = y + dY * st;
    if (s + 1 > t0) {
      const tf = lib.clamp((s + 1 - t0) / span);
      const lv = Math.min(NL - 1, Math.floor(life * Math.pow(tf, 0.9) * NL));
      if (lv >= 0 && life * tf > 0.06) {
        let md = baseMode;
        if (blobR > 0) {
          const inside = Math.hypot(x - bx, y - by) + jit < blobR;
          md = inside !== exiting ? 1 : 0;
        }
        const bi = md * NC * NL + cb * NL + lv, arr = B[bi];
        if (bi !== last) arr.push(NaN, x, y);
        arr.push(nx, ny);
        last = bi;
      } else last = -1;
    }
    x = nx; y = ny;
  }
}

// ---- draw ----
const PAL = ['#0b4a55', '#13807f', '#4fb3a4', '#e8694f', '#f0915a', '#f5c35b'];
const INK = '#16120e';
function replay(arr) {
  ctx.beginPath();
  for (let k = 0; k < arr.length; ) {
    if (arr[k] !== arr[k]) { ctx.moveTo(arr[k + 1], arr[k + 2]); k += 3; }
    else { ctx.lineTo(arr[k], arr[k + 1]); k += 2; }
  }
}
lib.camera(ctx, { rot, zoom, x: -ax * 0.18 * vort, y: -ay * 0.18 * vort }, () => {
  ctx.translate(W / 2, H / 2);
  if (blobR > 0) lib.layer(ctx, 'Ground bloom', () => {
    const g = ctx.createRadialGradient(bx, by, Math.max(0, blobR - feather), bx, by, blobR + feather * 0.5);
    const col = exiting ? '236,229,214' : '6,18,21';
    g.addColorStop(0, 'rgba(' + col + ',1)');
    g.addColorStop(0.6, 'rgba(' + col + ',0.85)');
    g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(-W, -H, 2 * W, 2 * H);
  });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const strokes = (md, c0, c1) => {
    const glow = md === 1;
    ctx.globalCompositeOperation = glow ? 'lighter' : 'source-over';
    for (let cb = c0; cb < c1; cb++) {
      for (let lv = 0; lv < NL; lv++) {
        const arr = B[md * NC * NL + cb * NL + lv];
        if (!arr.length) continue;
        replay(arr);
        const la = (lv + 1) / NL;
        if (glow) {
          ctx.lineCap = 'butt';
          ctx.strokeStyle = PAL[cb];
          ctx.globalAlpha = la * 0.62;
          ctx.lineWidth = lw * (0.7 + 0.5 * la);
        } else {
          ctx.lineCap = 'round';
          ctx.strokeStyle = lib.mix(INK, PAL[cb], 0.1 + gold * (cb > 3 ? 2.8 : 0.5));
          ctx.globalAlpha = la * 0.9;
          ctx.lineWidth = lw * (0.65 + 0.35 * la);
        }
        ctx.stroke();
      }
    }
  };
  lib.layer(ctx, 'Ink lines', () => strokes(0, 0, NC));
  lib.layer(ctx, 'Teal ribbons', () => strokes(1, 0, 3));
  lib.layer(ctx, 'Coral ribbons', () => strokes(1, 3, 5));
  lib.layer(ctx, 'Gold ribbons', () => strokes(1, 5, NC));
});
ctx.globalCompositeOperation = 'source-over';
ctx.globalAlpha = 1;

// ---- vignette: warm paper edge on bone, deep falloff at night ----
const vg = ctx.createRadialGradient(W / 2, H / 2, S * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.56);
vg.addColorStop(0, 'rgba(0,0,0,0)');
vg.addColorStop(1, 'rgba(' + Math.round(lib.lerp(110, 0, dark)) + ',' + Math.round(lib.lerp(92, 4, dark)) + ',' + Math.round(lib.lerp(66, 6, dark)) + ',' + (0.16 + 0.5 * dark).toFixed(3) + ')');
lib.layer(ctx, 'Vignette', () => {
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
});

// ---- caption ----
const cap = lib.seg(p, 0.86, 0.95);
if (cap > 0) {
  const m = S * 0.08, cx = m + 4 * u, cy = H - m - 6 * u;
  lib.layer(ctx, 'Caption fog', () => {
    const fog = ctx.createLinearGradient(0, cy - 150 * u, 0, H);
    fog.addColorStop(0, 'rgba(236,229,214,0)');
    fog.addColorStop(0.55, 'rgba(232,224,208,0.88)');
    fog.addColorStop(1, 'rgba(226,218,201,0.95)');
    ctx.globalAlpha = lib.ease.inOut(cap);
    ctx.fillStyle = fog;
    ctx.fillRect(0, cy - 150 * u, W, H);
  });
  lib.layer(ctx, 'Caption rule', () => {
    ctx.globalAlpha = lib.ease.out(cap);
    ctx.fillStyle = INK;
    ctx.fillRect(cx, cy - 7 * u, 36 * u * lib.ease.outExpo(cap), 1.5 * u);
  });
  lib.layer(ctx, 'Caption', () => {
    lib.typewriter(ctx, 'flow field · seed 0417', cx + 50 * u, cy, lib.seg(p, 0.87, 0.95), {
      size: 22 * u, family: 'mono', color: INK, alpha: 0.82, tracking: 0.16, caret: false, maxWidth: W - 2 * m - 60 * u,
    });
  });
}
`,
};
