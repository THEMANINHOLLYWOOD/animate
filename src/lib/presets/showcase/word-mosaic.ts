// Every word a pixel. Hand-built example film in the scene format Claude generates.
// Brief: A glitchy black-ground promo for animate: a terminal types "$ animate --mosaic", then the frame fills with a dense mosaic of tiny monospace word tiles (FRAME, EASE, SPRING, TWEEN...) whose colours paint a sunrise, a beating heart and a scrolling ANIMATE, with crisp red and white label boxes (EVERY WORD A PIXEL, TYPE IN, FILM OUT, POWERED BY ANIMATE), ending as the tiles scatter into pixels and DESCRIBE IT / GET A FILM.
export const film = {
  id: "ex-word-mosaic",
  title: "Every word a pixel",
  aspect: "16:9" as const,
  duration: 26,
  prompt: "A glitchy black-ground promo for animate: a terminal types \"$ animate --mosaic\", then the frame fills with a dense mosaic of tiny monospace word tiles (FRAME, EASE, SPRING, TWEEN...) whose colours paint a sunrise, a beating heart and a scrolling ANIMATE, with crisp red and white label boxes (EVERY WORD A PIXEL, TYPE IN, FILM OUT, POWERED BY ANIMATE), ending as the tiles scatter into pixels and DESCRIBE IT / GET A FILM.",
  code: String.raw`
// Every word a pixel: a terminal prompt opens a mosaic of tiny word tiles whose colours paint
// a sunrise, a beating heart, then the word ANIMATE, before it all dissolves into loose pixels.
const E = lib.ease, u = lib.u, clamp = lib.clamp, lerp = lib.lerp, seg = lib.seg, R = lib.rand;
const wide = W / H >= 1.2, tall = W / H < 0.8;
const S = Math.min(W, H), MG = S * 0.08;
lib.bg(ctx, W, H, '#000000');

// ── palette: tile fills and the ink each fill carries ──────────────────────
const PAL = ['#060607', '#151A3D', '#1D4F9E', '#4A2A9E', '#9C1427', '#E0232D', '#EE5B25', '#D8B497', '#6D7079', '#D3D4D8', '#F6F4EE', '#26272D'];
const INKS = ['#0B0B0D', '#F3F1EC', '#80838D'];
const INKOF = [2, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 2];
const BLK = '#0B0B0D', WHT = PAL[10], RED = PAL[5];
const VOC = ['KEY', 'CUT', 'ARC', 'INK', 'HUE', 'FPS', 'EASE', 'LOOP', 'BEAT', 'FADE', 'MASK', 'BLUR', 'TIME', 'CLIP', 'TYPE', 'FILM', 'SHOT', 'PATH', 'TONE', 'GLOW', 'SNAP', 'KERN',
  'FRAME', 'LAYER', 'TWEEN', 'GLYPH', 'PIXEL', 'CURVE', 'SCENE', 'GRAIN', 'SPRING', 'RENDER', 'MOTION', 'SPLINE', 'CAMERA', 'BEZIER', 'VECTOR', 'CANVAS', 'TIMING', 'STROKE'];
const BYLEN = {};
VOC.forEach((w) => { (BYLEN[w.length] = BYLEN[w.length] || []).push(w); });
const ci = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : Math.floor(v));
const ramp = (arr, v) => arr[ci(v * arr.length, arr.length)];
const bump = (c, w) => Math.max(0, 1 - Math.abs(p - c) / w);

// ── timeline (fractions of the film) ────────────────────────────────────────
const rise = E.inOut(seg(p, 0.13, 0.42));
const mAB = seg(p, 0.40, 0.46, E.inOut), mBC = seg(p, 0.612, 0.662, E.inOut);
const kD = seg(p, 0.79, 0.93);
const G = Math.min(1, bump(0.137, 0.022) + bump(0.43, 0.03) + bump(0.637, 0.028) + bump(0.80, 0.02) * 0.7);
const gst = Math.floor(t * 12);

// ── images painted by tile colour (X, Y in short-side units from the centre) ─
const HXn = wide ? 0.30 : 0, HYn = wide ? 0.0 : -0.1;
const SKY = [6, 5, 5, 4, 4, 3, 3, 1, 1, 0];
function imgA(X, Y, j) {                       // sunrise over a striped sea
  const hz = 0.14, sy = lerp(0.22, -0.10, rise), sr = 0.17;
  const d = Math.sqrt(X * X + (Y - sy) * (Y - sy));
  if (Y < hz) {
    if (d < sr * 0.84 + j * 0.03) return 10;
    if (d < sr + j * 0.03) return 9;
    if (d < sr * 1.24 + j * 0.06) return 7;
    return ramp(SKY, (hz - Y) * 1.3 + (d - sr) * 0.5 + 0.05 * Math.sin(X * 5 + t * 0.4) + j * 0.14);
  }
  const dep = Y - hz;
  const st = Math.sin(Math.log(dep + 0.03) * 9 - t * 1.5 + Math.sin(X * 6 + t * 0.8) * 0.8);
  const cw = sr * (0.7 + dep * 1.8) * (0.85 + 0.25 * Math.sin(Y * 40 + t));
  if (Math.abs(X) < cw + j * 0.06 && sy < hz + sr) {
    if (st > 0.1) return dep < 0.1 ? 10 : dep < 0.22 ? 9 : 7;
    return dep < 0.14 ? 6 : 5;
  }
  if (st > 0.55 + j * 0.3) return dep < 0.08 ? 4 : 2;
  return dep < 0.05 ? 3 : dep < 0.2 + j * 0.1 ? 1 : 0;
}
const FIELD = [0, 1, 1, 3, 3, 2, 2];
function imgB(X, Y, j) {                       // beating heart on a waving field
  const ph = lib.pulse(t, 0.86);
  const thump = Math.exp(-ph * 10) + 0.6 * Math.exp(-Math.abs(ph - 0.24) * 16);
  const hs = 0.26 * (1 + 0.07 * thump);
  const hx = (X - HXn) / hs, hy = -(Y - HYn) / hs + 0.15;
  const a = hx * hx + hy * hy - 1, q = a * a * a - hx * hx * hy * hy * hy;
  if (q < j * 0.04) {
    const hl = (hx + 0.42) * (hx + 0.42) + (hy - 0.5) * (hy - 0.5);
    if (hl < 0.05 + j * 0.04) return 10;
    if (hl < 0.13 + j * 0.05) return 6;
    if (q > -0.035 || hx - hy > 0.95 + j * 0.3) return 4;
    return 5;
  }
  if (q < 0.22 && j > 0.2) return 4;
  const f = X * 0.9 + Y * 0.45;
  return ramp(FIELD, 0.5 + 0.5 * Math.sin(f * 6 - t * 1.3 + Math.sin(Y * 4 + t * 0.6) * 1.1) + j * 0.28);
}
const GL = { // bold 9-row glyphs, strokes two cells thick
  A: ['..###..', '.##.##.', '##...##', '##...##', '##...##', '#######', '##...##', '##...##', '##...##'],
  N: ['##...##', '###..##', '####.##', '##.####', '##..###', '##...##', '##...##', '##...##', '##...##'],
  I: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '######'],
  M: ['##....##', '###..###', '########', '##.##.##', '##.##.##', '##....##', '##....##', '##....##', '##....##'],
  T: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
  E: ['######', '##....', '##....', '##....', '#####.', '##....', '##....', '##....', '######'] };
const LINES = ['ANIMATE'];                     // one line, run past like a marquee so strokes stay several tiles thick
const LW = LINES.map((s) => s.split('').reduce((n, c) => n + GL[c][0].length + 1, -1));
const NROW = 9;
const CELL = (wide ? 0.44 : tall ? 0.26 : 0.4) * H / 9 / S;
const GY0 = (wide ? -0.09 : -0.1) - NROW * CELL / 2;
const WW = LW[0] * CELL, mq = seg(p, 0.64, 0.86);
const XC = lerp(0.05 * W / S + WW / 2, -0.1 * W / S - WW / 2, mq);
function bit(X, Y) {
  const rr = Math.floor((Y - GY0) / CELL);
  if (rr < 0 || rr >= NROW) return 0;
  const li = 0, ry = rr;
  const s = LINES[li];
  let cx = Math.floor((X + LW[li] * CELL / 2) / CELL);
  if (cx < 0 || cx >= LW[li]) return 0;
  for (let g = 0; g < s.length; g++) {
    const row = GL[s[g]][ry];
    if (cx < row.length) return row[cx] === '#' ? 1 : 0;
    cx -= row.length + 1;
    if (cx < 0) return 0;
  }
  return 0;
}
const CBG = [0, 0, 0, 11, 1, 1, 3];
const sweep = lerp(-1.5, 1.5, seg(p, 0.68, 0.80, E.inOut));
function imgC(X, Y, j, hw) {                   // the word ANIMATE drawn in tiles
  if (bit(X - XC, Y)) {
    const d = Math.abs(X - sweep + Y * 0.5);
    if (d < 0.05) return 5;
    if (d < 0.08 + j * 0.03) return 6;
    return j > 0.45 ? 9 : 10;
  }
  return ramp(CBG, (0.5 + 0.5 * Math.sin(X * 2.4 - Y * 1.6 - t * 0.8)) * 0.9 + j * 0.2);
}
// A and B live in the world (the camera flies into them); ANIMATE is pinned to the screen, so zooming only changes tile size
const img = (n, X, Y, j, hw, Xs, Ys) => (n === 0 ? imgA(X, Y, j) : n === 1 ? imgB(X, Y, j) : imgC(Xs, Ys, j, hw * z));
function pick(X, Y, j, j2, hw, Xs, Ys) {               // sweeping morph between images, glitch band at the front
  let k = mAB, a = 0, b = 1;
  if (p > 0.53) { k = mBC; a = 1; b = 2; }
  if (k <= 0) return img(a, X, Y, j, hw, Xs, Ys);
  if (k >= 1) return img(b, X, Y, j, hw, Xs, Ys);
  const th = 0.5 + (X * 0.6 + Y * 0.45) * 0.62 + j2 * 0.16, kk = k * 1.5 - 0.25;
  const bw = 0.045 / z;
  if (kk > th + bw) return img(b, X, Y, j, hw, Xs, Ys);
  if (kk < th - bw) return img(a, X, Y, j, hw, Xs, Ys);
  return j2 > 0 ? 10 : 5;
}

// ── glitch block noise (screen space, flickers at 15 steps a second) ────────
const GCOL = [WHT, BLK, RED, PAL[8], WHT];
function blocks(cx, cy, w, h, amt, seed) {
  const n = Math.round(amt * 14);
  if (n <= 0) return;
  const st = Math.floor(t * 15), q = 4 * u;
  for (let k = 0; k < n; k++) {
    const rk = seed * 977 + k * 131 + st * 7919;
    const bx = Math.round((cx + (R(rk) - 0.5) * w) / q) * q, by = Math.round((cy + (R(rk + 1) - 0.5) * h) / q) * q;
    const nw = 2 + Math.floor(R(rk + 2) * 11), nh = 1 + Math.floor(R(rk + 3) * 4);
    ctx.fillStyle = GCOL[Math.floor(R(rk + 4) * GCOL.length)];
    ctx.beginPath();
    if (R(rk + 5) < 0.65) {
      for (let a = 0; a < nw; a++) for (let b = 0; b < nh; b++) if (R(rk + a * 17 + b * 31 + 7) < 0.55) ctx.rect(bx + a * q, by + b * q, q, q);
    } else ctx.rect(bx, by, nw * q, nh * q);
    ctx.fill();
  }
}

// ── label box: stepped glitch wipe in, collapses out; copy stays plain lib text ─
const ADV = 0.6;
function label(str, x, y, size, box, ink, kin, kout, seed, tr, caret) {
  if (kin <= 0 || kout >= 1) return;
  tr = tr == null ? 0.18 : tr;
  const padX = size * 0.5, bh = size * 1.5;
  const tw = str.length * size * (ADV + tr) - size * tr, bw = tw + padX * 2 + (caret ? size * 0.75 : 0);
  const s = clamp(Math.ceil(E.out(kin) * 8) / 8), sh = 1 - E.in(clamp(kout));
  const h = bh * sh;
  ctx.fillStyle = box;
  ctx.fillRect(x, y - h / 2, bw * s, h);
  if (s < 1) blocks(x + bw * s, y, size * 2, bh * 1.4, 0.5, seed);
  if (kout > 0) blocks(x + bw / 2, y, bw, bh * 2, kout * 1.2, seed + 3);
  if (sh > 0.55) {
    lib.typewriter(ctx, str, x + padX, y + size * 0.35, s, { size: size, family: 'mono', weight: 400, color: ink, tracking: tr, caret: false, alpha: clamp((sh - 0.55) / 0.45) });
  }
  if (caret && s >= 1 && lib.pulse(t, 1) < 0.55) {
    ctx.fillStyle = ink;
    ctx.fillRect(x + padX + tw + size * 0.22, y - size * 0.42, size * 0.5, size * 0.84);
  }
  return bw;
}

// ── camera: arrive zoomed into the words, pull back to the picture, push into the heart ─
const cam = lib.keys(p, [[0, [2.6, 0.47, 0.58]], [0.15, [2.6, 0.47, 0.58]], [0.30, [1.0, 0.5, 0.5]], [0.595, [1.04, 0.5, 0.5]],
  [0.655, [2.3, 0.5 + HXn * S / W, 0.5 + HYn * S / H]], [0.715, [0.82, 0.5, 0.5]], [1, [0.88, 0.5, 0.5]]], E.inOut);
const z = cam[0], ccx = cam[1] * W, ccy = cam[2] * H;

// ── the mosaic ──────────────────────────────────────────────────────────────
const RH = 20 * u, FS = RH * 0.62;
if (p > 0.125) {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(z, z);
  ctx.translate(-ccx, -ccy);
  ctx.font = lib.font({ size: FS, family: 'mono', weight: 400 });
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const CW = ctx.measureText('MMMMMMMMMM').width / 10;
  const vx0 = ccx - W / 2 / z, vx1 = ccx + W / 2 / z, vy0 = ccy - H / 2 / z, vy1 = ccy + H / 2 / z;
  const runs = PAL.map(() => []), pix = {}, rows = [];
  const entering = p < 0.25, kE = (p - 0.128) / 0.075;
  for (let r = Math.floor(vy0 / RH); r < Math.ceil(vy1 / RH); r++) {
    const ry = r * RH, rs = (r + 500) * 977 + 13;
    const sp = R(rs + 3) < 0.25 ? 0 : (R(rs + 4) - 0.5) * 5.2;
    let off = t * sp + (r % 2 ? 1 : -1) * (1 - E.outQuint(seg(p, 0.13 + 0.04 * R(rs + 5), 0.24 + 0.05 * R(rs + 5)))) * 60;
    if (G > 0 && R(rs * 3 + gst * 7) < G * 0.35) off += Math.round((R(rs + gst * 11) - 0.5) * 24);
    const c0 = Math.floor(vx0 / CW + off) - 1, c1 = Math.ceil(vx1 / CW + off) + 1;
    let pos = -330 + Math.floor(R(rs) * 9), i = 0, runC = -1, runX = 0, runE = 0, txt0 = null;
    const strs = ['', '', ''];
    const flush = () => { if (runC > 0) runs[runC].push(runX, ry, runE - runX); runC = -1; };
    while (pos < c1) {
      const sd = rs * 7 + i * 101, wi = Math.floor(R(sd) * VOC.length), L = VOC[wi].length;
      const st0 = pos, end = pos + L + (R(sd + 1) < 0.22 ? 2 : 1);
      pos = end; i++;
      if (end <= c0) continue;
      const xa = (st0 - 0.5 - off) * CW, xb = (end - 0.5 - off) * CW, cx = (xa + xb) / 2, cy = ry + RH / 2;
      const sx = (cx - ccx) * z + W / 2, sy = (cy - ccy) * z + H / 2;
      if (entering && kE < Math.abs(sy - H / 2) / H * 0.9 + Math.abs(sx - W / 2) / W * 0.8 + R(sd + 2) * 0.12) { flush(); continue; }
      const X = (cx - W / 2) / S, Y = (cy - H / 2) / S, j = R(sd + 3) - 0.5, j2 = R(sd + 4) - 0.5;
      let col = pick(X, Y, j, j2, (xb - xa) / 2 / S, (sx - W / 2) / S, (sy - H / 2) / S);
      if (R(sd * 3 + gst * 7919) < (p > 0.66 ? 0.002 : 0.008) + G * 0.05) col = j2 > 0.1 ? 10 : 5;
      if (kD > 0) {
        const edge = 1 - Math.max(Math.abs(sx - W / 2) / (W / 2), Math.abs(sy - H / 2) / (H / 2));
        const dk = clamp((kD * 1.35 - (0.55 * R(sd + 11) + 0.45 * (1 - clamp(edge)))) / 0.35);
        if (dk > 0) {
          flush();
          const stay = R(sd + 12) < 0.09, a = Math.PI * 2 * R(sd + 13), dd = (40 + 220 * R(sd + 14)) * u * dk * dk;
          const al = stay ? (R(sd + gst * 13) < 0.7 ? 0.9 : 0.3) : 1 - E.in(dk);
          if (col > 0 && al > 0.04 && (stay || dk < 1)) {
            const key = col * 5 + ci(al * 5, 5), sz = lerp(RH * 0.9, (stay ? 9 : 5) * u, E.out(Math.min(1, dk * 2.5)));
            (pix[key] = pix[key] || []).push(cx + Math.cos(a) * dd - sz / 2, cy + Math.sin(a) * dd - sz / 2, sz);
          }
          continue;
        }
      }
      if (col === runC && Math.abs(xa - runE) < 0.01) runE = xb;
      else { flush(); runC = col; runX = xa; runE = xb; }
      const list = BYLEN[L], rate = R(sd + 5) < 0.35 ? 0.4 + 2 * R(sd + 6) : 0;
      const word = rate ? list[Math.floor(R(sd * 5 + Math.floor(t * rate + R(sd + 7) * 10)) * list.length)] : VOC[wi];
      if (txt0 === null) txt0 = st0;
      const ink = INKOF[col], rel = st0 - txt0;
      strs[ink] += ' '.repeat(Math.max(0, rel - strs[ink].length)) + word;
    }
    flush();
    if (txt0 !== null) rows.push((txt0 - off) * CW, ry + RH / 2, strs);
  }
  const ov = 0.8 / z;
  for (let c = 1; c < PAL.length; c++) {
    const a = runs[c];
    if (!a.length) continue;
    ctx.fillStyle = PAL[c];
    ctx.beginPath();
    for (let k = 0; k < a.length; k += 3) ctx.rect(a[k], a[k + 1], a[k + 2] + ov, RH + ov);
    ctx.fill();
  }
  // tile words: whole rows per ink in one call (maxWidth keeps these texture rows out of the editable layers)
  for (let k = 0; k < rows.length; k += 3) {
    const s = rows[k + 2];
    for (let n = 0; n < 3; n++) if (s[n]) { ctx.fillStyle = INKS[n]; ctx.fillText(s[n], rows[k], rows[k + 1], 1e6); }
  }
  for (const key in pix) {
    const a = pix[key], c = Math.floor(key / 5);
    ctx.globalAlpha = (key % 5 + 0.5) / 5;
    ctx.fillStyle = PAL[c];
    ctx.beginPath();
    for (let k = 0; k < a.length; k += 3) ctx.rect(a[k], a[k + 1], a[k + 2], a[k + 2]);
    ctx.fill();
  }
  ctx.restore();
}

// ── glitch bursts on transitions ────────────────────────────────────────────
if (G > 0) blocks(W / 2, H / 2, W * 1.1, H * 1.1, G * 1.6, 900);

// ── the terminal prompt ─────────────────────────────────────────────────────
if (p < 0.16) {
  const PR = '$ animate --mosaic', tsz = (wide ? 64 : 44) * u, ttr = 0.1, adv = tsz * (ADV + ttr);
  const tx = W / 2 - PR.length * adv / 2, ty = H / 2;
  const kT = seg(p, 0.035, 0.10), n = 2 + Math.floor(kT * (PR.length - 2) + 1e-6);
  const ap = Math.floor(E.out(seg(p, 0.006, 0.03)) * 6) / 6;
  const shat = seg(p, 0.118, 0.152);
  const vis = shat <= 0 || R(Math.floor(t * 20) * 7 + 3) > shat;
  const pad = tsz * 0.45, bh = tsz * 1.5, cw = tsz * 0.55;
  blocks(W / 2, ty, PR.length * adv * 1.6, bh * 4, 0.25 + 0.3 * lib.pulse(t, 0.7) + shat * 2, 40);
  if (ap > 0 && vis) {
    const bw = (n * adv + cw + tsz * 0.2 + pad * 2) * ap;
    const jx = shat > 0 ? Math.round((R(Math.floor(t * 20)) - 0.5) * 40 * shat) * u : 0;
    ctx.fillStyle = WHT;
    ctx.fillRect(tx - pad + jx, ty - bh / 2, bw, bh);
    if (shat > 0) { ctx.fillStyle = RED; ctx.fillRect(tx - pad - jx * 2, ty + bh * 0.1, bw * 0.4, bh * 0.25); }
    if (ap >= 1) {
      lib.typewriter(ctx, PR, tx + jx, ty + tsz * 0.35, n / PR.length + 1e-6, { size: tsz, family: 'mono', weight: 400, color: BLK, tracking: ttr, caret: false });
      if (kT > 0 && kT < 1 || lib.pulse(t, 0.9) < 0.55) { ctx.fillStyle = BLK; ctx.fillRect(tx + jx + n * adv + tsz * 0.06, ty - tsz * 0.45, cw, tsz * 0.9); }
    }
  }
}

// ── labels cut in over the mosaic ───────────────────────────────────────────
const LS = (wide ? 58 : 44) * u;
label('EVERY WORD A PIXEL', MG, H * (wide ? 0.2 : 0.16), LS, WHT, BLK, seg(p, 0.285, 0.315), seg(p, 0.375, 0.392), 11);
label('TYPE IN, FILM OUT', MG, H * 0.8, LS, RED, WHT, seg(p, 0.47, 0.50), seg(p, 0.572, 0.59), 23);
const l3y = H * (wide ? 0.76 : 0.74), kin3 = seg(p, 0.71, 0.74), kout3 = seg(p, 0.805, 0.825);
label('POWERED BY', MG, l3y - LS * 0.95, LS * 0.62, WHT, BLK, kin3, kout3, 31);
label('ANIMATE', MG, l3y + LS * 0.45, LS * 1.3, RED, WHT, seg(p, 0.725, 0.755), kout3, 37);

// ── the end: two lines on black ─────────────────────────────────────────────
if (p > 0.85) {
  const fs = (wide ? 64 : 46) * u, tr = 0.18;
  const w1 = 'DESCRIBE IT'.length * fs * (ADV + tr) - fs * tr + fs;
  const x = W / 2 - w1 / 2, y = H / 2;
  label('DESCRIBE IT', x, y - fs * 0.82, fs, WHT, BLK, seg(p, 0.865, 0.9), 0, 51);
  label('GET A FILM', x, y + fs * 0.82, fs, RED, WHT, seg(p, 0.885, 0.92), 0, 57, tr, true);
}
`,
};
