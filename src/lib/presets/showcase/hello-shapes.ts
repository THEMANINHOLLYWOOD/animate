// Hello, Shapes!. Hand-built example film in the scene format Claude generates.
// Brief: A playful kids' cartoon in candy colours: a googly-eyed circle, square, triangle and star bounce in one by one and say hi, stack into a wobbly tower that nearly tips, then leap into a row under a confetti burst and a bouncy 'Hello, Shapes!' title.
export const film = {
  id: "ex-hello-shapes",
  title: "Hello, Shapes!",
  aspect: "1:1" as const,
  duration: 12,
  prompt: "A playful kids' cartoon in candy colours: a googly-eyed circle, square, triangle and star bounce in one by one and say hi, stack into a wobbly tower that nearly tips, then leap into a row under a confetti burst and a bouncy 'Hello, Shapes!' title.",
  code: String.raw`
// Hello, Shapes! -- a candy-coloured cartoon: four googly-eyed shapes drop in, say hi,
// stack into a wobbly tower, bail out in a row and cheer under a bouncing title.
const u = lib.u, E = lib.ease, cl = lib.clamp, L = lib.lerp, TAU = Math.PI * 2;
const wide = W / H >= 1.2, tall = W / H < 0.8;
const INK = '#3B2340', CREAM = '#FFF3DF';
const PINK = '#FF7AB6', YEL = '#FFD23F', SKY = '#5EC8FF', MINT = '#5FE0B7', TAN = '#FF9A3C';
const CANDY = [PINK, YEL, SKY, MINT, TAN];
const sec = p * T, cx = W / 2;
const gy = H * (tall ? 0.72 : wide ? 0.86 : 0.83);
const S = (wide ? 72 : 78) * u;
const M = Math.min(W, H) * 0.08;

// ---------- characters + choreography ----------
const CH = [
  { col: PINK, h: 2 * S, face: [-0.18, 0.34, 0.27, 0.32], sheen: [-0.42, -0.46], say: 'Hi!' },
  { col: YEL, h: 2 * S, face: [-0.2, 0.36, 0.28, 0.36], sheen: [-0.56, -0.6], say: 'Hello!' },
  { col: SKY, h: 2 * S, face: [0.24, 0.27, 0.23, 0.62], sheen: [-0.16, -0.3], say: 'Hiya!' },
  { col: TAN, h: 1.9 * S, face: [0.04, 0.22, 0.2, 0.4], sheen: [0.0, -0.5], say: 'Hi hi!', sink: 0.36 * S },
];
const ORDER = [1, 0, 2, 3], LVL = [1, 0, 2, 3];
const NAMES = ['Circle', 'Square', 'Triangle', 'Star'];
const slotA = [-375, -200, 200, 375].map(function (v) { return cx + v * u; });
const rowX = [-330, -110, 110, 330].map(function (v) { return cx + v * u; });
const LAND = [0.062, 0.135, 0.208, 0.282];
const STK = [[0.41, 0.465], [0.355, 0.41], [0.465, 0.52], [0.52, 0.575]];
const OFF = [0.659, 0.666, 0.652, 0.645];
const SPIN = [1, 0, -1, 1];
const MV = CH.map(function (c, i) {
  const ha = 0.875 + 0.02 * i;
  return [
    { a: LAND[i] - 0.05, ant: 0, b: LAND[i], from: { x: slotA[i], y: -30 * u }, to: { x: slotA[i], y: gy }, drop: true },
    { a: STK[i][0], ant: 0.02, b: STK[i][1], from: { x: slotA[i], y: gy }, to: 'T' },
    { a: OFF[i], ant: 0.02, b: OFF[i] + 0.06, from: 'T', to: { x: rowX[i], y: gy }, spin: SPIN[i] },
    { a: ha, ant: 0.014, b: ha + 0.05, from: { x: rowX[i], y: gy }, to: { x: rowX[i], y: gy }, hop: 110 * u },
  ];
});

function squash(i, q) {
  let sy = 1, land = 0, air = 0;
  for (const m of MV[i]) {
    const ta = m.a + m.ant;
    if (m.ant > 0 && q >= m.a && q < ta) {
      const k = (q - m.a) / m.ant;
      sy -= 0.3 * (k < 0.75 ? E.inOut(k / 0.75) : 1 - (k - 0.75) / 0.25);
    } else if (q >= ta && q < m.b) {
      const k = (q - ta) / (m.b - ta);
      air = m.drop ? 0.32 * k : 0.26 * Math.abs(1 - 2 * k) * Math.min(1, k * 8);
      sy += air;
    } else if (q >= m.b) {
      const d = (q - m.b) * T;
      if (d < 2.5) land += 0.5 * Math.exp(-5 * d) * Math.sin(18 * d + 0.35);
    }
  }
  sy -= land;
  return { sy: sy, sx: 1 + (1 - sy) * 0.85, land: land, air: air };
}

function theta(l, q) {
  const w = lib.seg(q, 0.575, 0.655);
  if (w <= 0) return 0;
  const amp = (2 + 6 * w) * (l === 0 ? 0.5 : 1) * Math.min(1, w * 6) * Math.PI / 180;
  return amp * Math.sin(q * T * 8 - l * 1.1) + (l > 0 ? w * w * 6 * Math.PI / 180 : 0);
}

function chain(i, q) {
  let x = cx, y = gy, r = 0;
  for (let l = 0; l <= LVL[i]; l++) {
    const c = ORDER[l];
    r += theta(l, q);
    if (c === i) {
      const s = CH[i].sink || 0;
      return { bx: x - Math.sin(r) * s, by: y + Math.cos(r) * s, rot: r };
    }
    const hh = CH[c].h * squash(c, q).sy;
    x += Math.sin(r) * hh; y -= Math.cos(r) * hh;
  }
}
function rest(spec, i, q) { return spec === 'T' ? chain(i, q) : { bx: spec.x, by: spec.y, rot: 0 }; }

function pose(i, q) {
  let m = null;
  for (const mm of MV[i]) if (q >= mm.a) m = mm;
  if (!m) return null;
  const ta = m.a + m.ant;
  if (q < ta) return rest(m.from, i, q);
  if (q >= m.b) return rest(m.to, i, q);
  const k = (q - ta) / (m.b - ta), h = CH[i].h;
  const A = rest(m.from, i, ta), B = rest(m.to, i, m.b);
  const ca = [A.bx + Math.sin(A.rot) * h / 2, A.by - Math.cos(A.rot) * h / 2];
  const cb = [B.bx + Math.sin(B.rot) * h / 2, B.by - Math.cos(B.rot) * h / 2];
  const arc = m.drop ? (cb[1] - ca[1]) / 4 : (m.hop || 150 * u + Math.abs(cb[1] - ca[1]) * 0.5);
  const x = L(ca[0], cb[0], k), y = L(ca[1], cb[1], k) - arc * 4 * k * (1 - k);
  const rot = L(A.rot, (m.spin || 0) * TAU + B.rot, E.inOut(k));
  return { bx: x - Math.sin(rot) * h / 2, by: y + Math.cos(rot) * h / 2, rot: rot };
}

// ---------- drawing helpers ----------
function rpoly(pts, r) {
  const n = pts.length;
  ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
  for (let j = 0; j < n; j++) ctx.arcTo(pts[j][0], pts[j][1], pts[(j + 1) % n][0], pts[(j + 1) % n][1], r);
  ctx.closePath();
}
function shapePath(i, sc) {
  const s = S * sc;
  ctx.beginPath();
  if (i === 0) ctx.arc(0, 0, s, 0, TAU);
  else if (i === 1) rpoly([[-s, -s], [s, -s], [s, s], [-s, s]], 0.34 * s);
  else if (i === 2) rpoly([[0, -s * 1.02], [1.18 * s, s], [-1.18 * s, s]], 0.3 * s);
  else {
    const R = 1.05 * s, pts = [];
    for (let j = 0; j < 10; j++) {
      const a = -Math.PI / 2 + j * Math.PI / 5, rr = j % 2 ? R * 0.5 : R;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr + 0.095 * R]);
    }
    rpoly(pts, 0.14 * s);
  }
}
function eye(x, y, r, gx, gyy, blink, wid, bob) {
  ctx.lineWidth = 4.5 * u; ctx.strokeStyle = INK;
  if (blink) {
    ctx.beginPath(); ctx.moveTo(x - r * 0.8, y); ctx.quadraticCurveTo(x, y + r * 0.7, x + r * 0.8, y); ctx.stroke();
    return;
  }
  const er = r * (1 + wid * 0.18);
  ctx.beginPath(); ctx.arc(x, y, er, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
  const pr = r * (0.5 - wid * 0.2), room = er - pr - 2 * u;
  let ox = gx * room, oy = gyy * room + bob * r;
  const len = Math.hypot(ox, oy);
  if (len > room) { ox *= room / len; oy *= room / len; }
  ctx.beginPath(); ctx.arc(x + ox, y + oy, pr, 0, TAU); ctx.fillStyle = INK; ctx.fill();
  ctx.beginPath(); ctx.arc(x + ox - pr * 0.35, y + oy - pr * 0.35, pr * 0.3, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
}
function mouth(y, w, talk, scared, happy) {
  ctx.lineWidth = 5 * u; ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (scared > 0.5) { ctx.ellipse(0, y + 0.06 * S, 0.08 * S, 0.11 * S, 0, 0, TAU); ctx.fill(); return; }
  const open = Math.max(talk, happy);
  if (open > 0.05) {
    const d = w * (0.35 + 1.5 * open);
    ctx.moveTo(-w, y); ctx.quadraticCurveTo(0, y + d * 2, w, y); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, y + d * 0.72, w * 0.42, d * 0.22, 0, 0, TAU); ctx.fillStyle = '#FF5C8A'; ctx.fill();
  } else { ctx.moveTo(-w, y); ctx.quadraticCurveTo(0, y + w * 0.75, w, y); ctx.stroke(); }
}

function drawChar(i, P, q, fx, fy) {
  const c = CH[i], st = squash(i, q), h = c.h, f = c.face;
  const talkW = lib.win(q, LAND[i] + 0.008, LAND[i] + 0.07, 0.01, 0.015).a + (i === 3 ? lib.win(q, 0.6, 0.645, 0.01, 0.01).a : 0);
  const talk = talkW * (0.45 + 0.55 * Math.abs(Math.sin(sec * 13 + i)));
  const scared = lib.win(q, 0.585, OFF[i] + 0.025, 0.01, 0.01).a * (i === 3 && q > 0.6 && q < 0.645 ? 0 : 1);
  const happy = lib.seg(q, OFF[i] + 0.06, OFF[i] + 0.08);
  const blink = scared < 0.5 && lib.pulse(sec + i * 0.77, 2.6 + i * 0.45) < 0.05;
  // gaze in world space -> local
  const ecx = P.bx + Math.sin(P.rot) * h / 2, ecy = P.by - Math.cos(P.rot) * h / 2;
  let dx = fx - ecx, dy = fy - ecy;
  const dl = Math.hypot(dx, dy) || 1, g = Math.min(1, dl / (120 * u)) * (1 - talkW * 0.85);
  dx = dx / dl * g; dy = dy / dl * g;
  const gx = dx * Math.cos(-P.rot) - dy * Math.sin(-P.rot), gyy = dx * Math.sin(-P.rot) + dy * Math.cos(-P.rot);
  ctx.save();
  ctx.translate(P.bx, P.by); ctx.rotate(P.rot); ctx.scale(st.sx, st.sy); ctx.translate(0, -h / 2);
  // body: shaded rim + lit face
  shapePath(i, 1); ctx.fillStyle = lib.mix(c.col, INK, 0.22); ctx.fill();
  ctx.save(); ctx.clip(); ctx.translate(-0.1 * S, -0.12 * S); shapePath(i, 1); ctx.fillStyle = c.col; ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.ellipse(c.sheen[0] * S, c.sheen[1] * S, 0.17 * S, 0.08 * S, -0.7, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
  shapePath(i, 1); ctx.lineWidth = 7 * u; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke();
  // face
  ctx.fillStyle = 'rgba(255,70,140,0.33)';
  for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sgn * (f[1] + 0.17) * S, f[3] * S - 0.02 * S, 0.12 * S, 0.065 * S, 0, 0, TAU); ctx.fill(); }
  const bob = st.land * 1.4 - st.air * 1.6;
  for (const sgn of [-1, 1]) eye(sgn * f[1] * S, f[0] * S, f[2] * S, gx, gyy, blink, scared, bob);
  mouth(f[3] * S, 0.2 * S, talk, scared, happy);
  ctx.restore();
}

function bubble(str, tx, ty, a, b, q, col) {
  if (q < a || q > b) return;
  const sc = lib.spring(cl((q - a) / 0.04), { damping: 0.32, freq: 2.2 }) * E.out(cl((b - q) / 0.018));
  if (sc <= 0.001) return;
  const fs = 56 * u;
  const tw = lib.text(ctx, str, -9999, -9999, { size: fs, family: 'sans', weight: 800, alpha: 0 }).width;
  const bw = tw + 60 * u, bh = 92 * u;
  const bx = cl(tx, M + bw / 2, W - M - bw / 2), by = ty - 34 * u - bh / 2;
  const tb = cl(tx, bx - bw / 2 + 34 * u, bx + bw / 2 - 34 * u);
  ctx.save();
  ctx.translate(tx, ty); ctx.scale(sc, sc); ctx.rotate(0.05 * Math.sin(sec * 5 + tx)); ctx.translate(-tx, -ty);
  ctx.lineWidth = 6 * u; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.fillStyle = lib.mix(col, '#FFFFFF', 0.72);
  const tail = function () { ctx.beginPath(); ctx.moveTo(tb - 18 * u, by + bh / 2 - 4 * u); ctx.lineTo(tx, ty); ctx.lineTo(tb + 14 * u, by + bh / 2 - 4 * u); };
  tail(); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); rpoly([[bx - bw / 2, by - bh / 2], [bx + bw / 2, by - bh / 2], [bx + bw / 2, by + bh / 2], [bx - bw / 2, by + bh / 2]], 40 * u);
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tb - 14 * u, by + bh / 2 - 8 * u); ctx.lineTo(tx, ty - 7 * u); ctx.lineTo(tb + 10 * u, by + bh / 2 - 8 * u); ctx.fill();
  lib.text(ctx, str, bx, by + 2 * u, { size: fs, family: 'sans', weight: 800, color: INK, align: 'center', baseline: 'middle' });
  ctx.restore();
}

function confetti(p0, ox, oy, n, seed, dir, spread, sp0) {
  const age = (p - p0) * T;
  if (age <= 0) return;
  const kd = 1.9, g = 1150 * u, e = 1 - Math.exp(-kd * age);
  for (let j = 0; j < n; j++) {
    const r = function (k) { return lib.rand(seed + j * 13 + k); };
    const ang = dir + (r(1) - 0.5) * spread, sp = sp0 * (0.4 + 0.8 * r(2)) * u;
    const x = ox + Math.cos(ang) * sp * e / kd + Math.sin(age * (3 + r(3) * 3) + r(4) * 6) * 22 * u * Math.min(1, age);
    const y = oy + Math.sin(ang) * sp * e / kd + (g / kd) * (age - e / kd);
    if (y > H + 30 * u) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(r(5) * 6 + age * (r(6) - 0.5) * 14);
    ctx.scale(1, Math.cos(age * (5 + r(3) * 6) + r(4) * 5));
    ctx.globalAlpha = cl(age * 10); ctx.fillStyle = CANDY[j % 5];
    ctx.beginPath();
    if (j % 3 === 0) ctx.rect(-10 * u, -5 * u, 20 * u, 10 * u);
    else if (j % 3 === 1) ctx.arc(0, 0, 7 * u, 0, TAU);
    else { ctx.moveTo(0, -8 * u); ctx.lineTo(8 * u, 6 * u); ctx.lineTo(-8 * u, 6 * u); }
    ctx.fill(); ctx.restore();
  }
}

// ---------- background ----------
lib.bg(ctx, W, H, CREAM);
const fin = lib.seg(p, 0.715, 0.8, E.out);
// polka dots drifting
lib.layer(ctx, 'Polka dots', function () {
  ctx.fillStyle = '#FFE4BD';
  const sp = 96 * u, off = (sec * 14 * u) % sp;
  ctx.beginPath();
  for (let yy = -sp; yy < H + sp; yy += sp) for (let xx = -sp; xx < W + sp; xx += sp) {
    const odd = Math.round(yy / sp) % 2 ? sp / 2 : 0;
    ctx.moveTo(xx + odd + off + 10 * u, yy + off * 0.5); ctx.arc(xx + odd + off, yy + off * 0.5, 10 * u, 0, TAU);
  }
  ctx.fill();
});
// title-time sunburst
const ty0 = wide ? H * 0.3 : tall ? H * 0.39 : H * 0.31;
if (fin > 0) lib.layer(ctx, 'Sunburst', function () {
  ctx.translate(cx, ty0); ctx.rotate(sec * 0.18); ctx.scale(lib.spring(fin, { damping: 0.5, freq: 1.4 }), lib.spring(fin, { damping: 0.5, freq: 1.4 }));
  ctx.fillStyle = '#FFE19A'; ctx.globalAlpha = 0.45; ctx.beginPath();
  const RR = Math.max(W, H) * 1.3;
  for (let j = 0; j < 18; j++) { const a0 = j * TAU / 18; ctx.moveTo(0, 0); ctx.arc(0, 0, RR, a0, a0 + TAU / 36); ctx.closePath(); }
  ctx.fill();
});
// puffy clouds
for (let j = 0; j < 3; j++) lib.layer(ctx, 'Cloud ' + (j + 1), function () {
  const cxx = ((lib.rand(j + 40) * W + sec * (10 + j * 6) * u) % (W + 400 * u)) - 200 * u;
  const cyy = H * (0.1 + 0.12 * j) + (tall ? H * 0.05 : 0);
  ctx.fillStyle = j === 1 ? '#FFD9EA' : '#D8F1FF'; ctx.beginPath();
  for (const b of [[-70, 10, 46], [-20, -18, 60], [40, -4, 50], [85, 14, 36], [10, 20, 44]]) { ctx.moveTo(cxx + (b[0] + b[2]) * u, cyy + b[1] * u); ctx.arc(cxx + b[0] * u, cyy + b[1] * u, b[2] * u, 0, TAU); }
  ctx.fill();
});

// ---------- the stage ----------
const zoom = lib.keys(p, [[0, 1.0], [0.52, 1.0], [0.6, 1.06], [0.655, 1.1], [0.73, 1.0], [1, 1.02]]);
const FK = [[0, cx, 0], [0.065, slotA[0], gy - 80 * u], [0.135, slotA[1], gy - 80 * u], [0.205, slotA[2], gy - 80 * u],
  [0.275, slotA[3], gy - 80 * u], [0.345, cx, gy - 60 * u], [0.4, cx, gy - 140 * u], [0.455, cx, gy - 280 * u],
  [0.51, cx, gy - 420 * u], [0.565, cx, gy - 600 * u], [0.66, cx, gy - 120 * u], [0.74, cx, ty0]];
const fx = lib.track(sec, FK.map(function (k) { return [k[0] * T, k[1]]; }), 90, 14);
const fy = lib.track(sec, FK.map(function (k) { return [k[0] * T, k[2]]; }), 90, 14);
const poses = [0, 1, 2, 3].map(function (i) { return pose(i, p); });

lib.camera(ctx, { zoom: zoom, cy: gy - 260 * u }, function () {
  // ground
  lib.layer(ctx, 'Ground', function () {
    ctx.fillStyle = '#C6F1DC'; ctx.fillRect(-W, gy, W * 3, H);
    ctx.fillStyle = '#B2EACF'; ctx.fillRect(-W, gy + 26 * u, W * 3, 14 * u);
    ctx.lineWidth = 7 * u; ctx.strokeStyle = INK; ctx.beginPath(); ctx.moveTo(-W, gy); ctx.lineTo(W * 2, gy); ctx.stroke();
  });
  // contact shadows (each belongs to its character's layer)
  poses.forEach(function (P, i) {
    if (!P) return;
    const hgt = Math.max(0, gy - P.by), k = 1 / (1 + hgt / (220 * u));
    if (P.by < -100 * u) return;
    lib.layer(ctx, NAMES[i], function () {
      ctx.fillStyle = 'rgba(59,35,64,0.16)';
      ctx.beginPath(); ctx.ellipse(P.bx, gy + 4 * u, S * 1.05 * k, 13 * u * k, 0, 0, TAU); ctx.fill();
    });
  });
  [1, 0, 2, 3].forEach(function (i) { if (poses[i]) lib.layer(ctx, NAMES[i], function () { drawChar(i, poses[i], p, fx, fy); }); });
  // speech
  poses.forEach(function (P, i) {
    if (!P) return;
    const tip = P.by - CH[i].h - 22 * u + (i === 2 ? 6 * u : 0);
    lib.layer(ctx, NAMES[i] + ' bubble', function () { bubble(CH[i].say, P.bx, tip - (i % 2) * 34 * u, LAND[i] + 0.006, LAND[i] + 0.078, p, CH[i].col); });
    if (i === 3) lib.layer(ctx, 'Uh-oh bubble', function () { bubble('Uh-oh!', P.bx, tip + 6 * u, 0.598, 0.648, p, MINT); });
  });
});

// ---------- finale: confetti + bouncing title ----------
lib.layer(ctx, 'Confetti burst', function () { confetti(0.724, cx, gy - 140 * u, 120, 11, -Math.PI / 2, 2.3, 1700); });
lib.layer(ctx, 'Left confetti', function () { confetti(0.875, W * 0.03, gy + 20 * u, 40, 500, -Math.PI / 2 + 0.5, 0.6, 1800); });
lib.layer(ctx, 'Right confetti', function () { confetti(0.875, W * 0.97, gy + 20 * u, 40, 900, -Math.PI / 2 - 0.5, 0.6, 1800); });

const fsz = (wide ? 140 : 168) * u;
const lines = wide ? ['Hello, Shapes!'] : ['Hello,', 'Shapes!'];
lib.layer(ctx, 'Title', function () {
ctx.font = lib.font({ family: 'sans', weight: 900, size: fsz });
ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
let li = 0;
lines.forEach(function (ln, row) {
  const ws = ln.split('').map(function (ch) { return ctx.measureText(ch).width + fsz * 0.03; });
  const tot = ws.reduce(function (a, b) { return a + b; }, 0);
  let x = cx - tot / 2;
  const base = ty0 + fsz * 0.36 + (lines.length > 1 ? (row - 0.5) * fsz * 1.08 : 0);
  ln.split('').forEach(function (ch, j) {
    const w = ws[j], lx = x + w / 2; x += w;
    if (ch === ' ') return;
    const s0 = 0.745 + li * 0.0095, idx = li++;
    const k = cl((p - s0) / 0.045);
    if (k <= 0) return;
    const d = Math.max(0, (p - s0 - 0.045) * T);
    const sq = k < 1 ? -0.18 * k : 0.55 * Math.exp(-5.5 * d) * Math.sin(17 * d + 0.4);
    const wave = Math.sin(sec * 4.2 - idx * 0.55) * 9 * u * cl(d / 0.8);
    const pop = row === 1;
    const y = base + wave + (pop ? 0 : -(1 - k * k) * 170 * u);
    const ps = pop ? lib.spring(cl((p - s0) / 0.06), { damping: 0.5, freq: 2.0 }) : 1;
    ctx.save(); ctx.globalAlpha = cl(k * 8);
    ctx.translate(lx, y); ctx.rotate((1 - k) * (idx % 2 ? 0.5 : -0.5) * (pop ? 0.4 : 1) + Math.sin(sec * 3 + idx) * 0.04 * cl(d));
    if (pop) { ctx.translate(0, -fsz * 0.35); ctx.scale(ps, ps); ctx.translate(0, fsz * 0.35); } else ctx.scale(1 + sq * 0.8, 1 - sq);
    ctx.lineWidth = 15 * u; ctx.strokeStyle = INK; ctx.fillStyle = INK;
    ctx.fillText(ch, 0, 10 * u); ctx.strokeText(ch, 0, 10 * u);
    ctx.strokeText(ch, 0, 0);
    ctx.fillStyle = CANDY[idx % 5]; ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
});
});
`,
};
