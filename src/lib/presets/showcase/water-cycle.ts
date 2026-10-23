// The water cycle. Hand-built example film in the scene format Claude generates.
// Brief: A beautiful, accurate museum-style explainer of the water cycle for a curious 12-year-old: one continuous illustrated cross-section (ocean, coast, lake, snowy mountain, with soil and groundwater cut away below) that the camera travels across, following one drop through evaporation, transpiration, condensation, precipitation and collection, and ending on the whole loop traced in arrows.
export const film = {
  id: "ex-water-cycle",
  title: "The water cycle",
  aspect: "16:9" as const,
  duration: 32,
  prompt: "A beautiful, accurate museum-style explainer of the water cycle for a curious 12-year-old: one continuous illustrated cross-section (ocean, coast, lake, snowy mountain, with soil and groundwater cut away below) that the camera travels across, following one drop through evaporation, transpiration, condensation, precipitation and collection, and ending on the whole loop traced in arrows.",
  code: String.raw`
const { ease, seg, u, clamp, lerp, mix, rand, noise } = lib;
const TAU = Math.PI * 2, wide = W / H >= 1.2, tall = W / H < 0.8;
const M = Math.min(W, H) * 0.08;
const ss = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const gs = (x, m, s) => Math.exp(-((x - m) / s) * ((x - m) / s));
const wob = (x, s, k) => Math.sin(x / s + k) * 0.6 + Math.sin(x / (s * 0.37) + k * 2.3) * 0.4; // cheap organic wobble in [-1, 1]
const INK = '#0E2A45', INK2 = '#3D5B78', ACC = '#E8692A', WHITE = '#FFFFFF';

// ── The world: one cross-section, ocean (left) to mountains (right). y up is negative, sea level 0. ──
const XC = 1040, D = 56, YL = -62; // coastline, depth of the land's top strip, lake level
const Lf = (x) => { // near ground (back edge of the top strip); for x < XC, depth of the seabed
  if (x < XC) { const d = XC - x; return 24 * (1 - Math.exp(-d / 80)) + Math.max(0, d - 140) * 0.9; }
  const k = x - XC;
  return -92 * ss(k / 760) - 14 * Math.sin(k / 64) ** 2 * ss(k / 150) * (1 - ss((k - 640) / 200)) + 110 * gs(x, 2110, 100) - 150 * ss((x - 2300) / 500) - 18 * wob(x, 60, 4) * ss((x - 2300) / 300);
};
const Mt = (x) => -110 - 670 * gs(x, 2920, 290) - 380 * gs(x, 3520, 300) - 200 * gs(x, 3980, 380) + 10 * wob(x, 40, 3);
const WT = (x) => lerp(Math.max(Lf(x) + D + 34 * ss((x - XC + 220) / 220), D + 26 + 0.55 * Lf(x)), YL + D + 4, gs(x, 2110, 170));
const BR = (x) => Math.min(WT(x) + 170 + 40 * wob(x, 180, 3.1), Lf(x) + D + 240 - 0.3 * Math.max(0, -Lf(x) - 100));
const yR = (x) => Lf(x) + D * (0.5 + 0.26 * Math.sin(x / 45 + 1));

// ── Camera (wide framing; the copy lives top-left over the sky) ──
const CK = [
  [0.0, [380, -60, 1.2]], [0.165, [420, -75, 1.26]],
  [0.21, [1400, -260, 1.35]], [0.29, [1420, -270, 1.38]],
  [0.345, [1850, -620, 0.9]], [0.455, [1870, -630, 0.93]],
  [0.505, [2050, -560, 0.82]], [0.61, [2070, -570, 0.84]],
  [0.665, [2380, -330, 0.8]], [0.715, [2380, -330, 0.82]],
  [0.76, [1600, -170, 0.9]], [0.8, [1590, -170, 0.92]],
  [0.865, [1700, -500, 0.55]], [1, [1700, -500, 0.56]],
];
let [cx, cy, cz] = lib.keys(p, CK, ease.inOut);
const fin = seg(p, 0.8, 0.865, ease.inOut);
const AZ = wide ? 1 : lerp(tall ? 0.74 : 0.8, tall ? 0.66 : 0.58, fin);
if (!wide) cx += ((tall ? 330 : 220) / cz) * (1 - fin);
const FX = W / 2, FY = wide ? H / 2 : H * (tall ? 0.62 : 0.58);
const Z = cz * u * AZ;
const X = (x) => FX + (x - cx) * Z, Y = (y) => FY + (y - cy) * Z;
const X0 = 1700, Y0 = -500;
const PX = (x, f) => FX + (x - X0 - (cx - X0) * f) * Z, PY = (y, f) => FY + (y - Y0 - (cy - Y0) * f) * Z;
const xa = cx - FX / Z - 60, xb = cx + (W - FX) / Z + 60, BOT = cy + (H - FY) / Z + 60;
const st = Math.max(5, (xb - xa) / 280);

// closed band between two world curves over [a, b] (f < 1: parallax layer)
function band(a, b, top, bot, f) {
  a = Math.max(a, xa - 300); b = Math.min(b, xb + 300);
  if (b <= a) return false;
  const n = Math.ceil((b - a) / st), px = f ? (x) => PX(x, f) : X, py = f ? (y) => PY(y, f) : Y;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) { const x = a + ((b - a) * i) / n; ctx.lineTo(px(x), py(top(x))); }
  for (let i = n; i >= 0; i--) { const x = a + ((b - a) * i) / n; ctx.lineTo(px(x), py(bot(x))); }
  ctx.closePath();
  return true;
}
const fillB = (c, al) => { const g = ctx.globalAlpha; ctx.globalAlpha = g * (al ?? 1); ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = g; };
const vgrad = (y0, y1, stops) => { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; };
function curve(fn, a, b, n) { ctx.beginPath(); for (let i = 0; i <= n; i++) { const x = a + ((b - a) * i) / n; ctx.lineTo(X(x), Y(fn(x))); } }
const dot = (x, y, r) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); };

// ── Weather state ──
const storm = seg(p, 0.45, 0.53) * (1 - seg(p, 0.66, 0.76));
const evapA = seg(p, 0, 0.02) * (1 - 0.55 * seg(p, 0.3, 0.36)) + 0.35 * seg(p, 0.85, 0.9);
const transA = seg(p, 0.185, 0.225) * (1 - 0.6 * seg(p, 0.31, 0.36)) + 0.4 * seg(p, 0.85, 0.9);
const rainA = seg(p, 0.5, 0.53) * (1 - seg(p, 0.6, 0.645)) + 0.4 * seg(p, 0.88, 0.92);
const snowA = seg(p, 0.53, 0.56) * (1 - seg(p, 0.6, 0.645)) + 0.5 * seg(p, 0.88, 0.92);
const flowA = 0.45 + 0.55 * seg(p, 0.6, 0.66);

// ── Sky + sun ──
lib.bg(ctx, W, H, '#B3D6EE');
{ // sky: thin solid bands (cheaper than a full-frame gradient), darkening a little in the storm
  const h3 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const SK = [['#5E9DD2', '#8392A6', 0.55], ['#8EC0E6', '#A3B1C0', 0.55], ['#BFDDF1', '#C6CED6', 0.5], ['#F2E7D0', '#DCDCD5', 0.5]].map(([a, b, k]) => h3(a).map((v, i) => lerp(v, h3(b)[i], storm * k)));
  const end = clamp(Y(D), 0, H), y0 = Y(-1500), y1 = Y(10);
  for (let i = 0; i < 64; i++) {
    const ya = Math.floor((end * i) / 64), yb = Math.ceil((end * (i + 1)) / 64), f = clamp(((ya + yb) / 2 - y0) / (y1 - y0)) * 2.999, j = Math.floor(f), k = f - j;
    ctx.fillStyle = 'rgb(' + SK[j].map((v, q) => Math.round(lerp(v, SK[j + 1][q], k))).join(',') + ')';
    ctx.fillRect(0, ya, W, yb - ya + 1);
  }
}
const SX = X(450), SY = Y(-360), SR = 46 * Z;
const sunA = clamp((SX + SR * 1.5) / (SR * 3));
if (sunA > 0) {
  ctx.save(); ctx.globalAlpha = sunA;
  const hg = ctx.createRadialGradient(SX, SY, SR, SX, SY, SR * 4.5);
  hg.addColorStop(0, 'rgba(255,226,160,0.6)'); hg.addColorStop(1, 'rgba(255,226,160,0)');
  ctx.beginPath(); dot(SX, SY, SR * 4.5); ctx.fillStyle = hg; ctx.fill();
  ctx.save(); ctx.strokeStyle = '#FFC85A'; ctx.lineWidth = 3.2 * Z; ctx.lineCap = 'round'; ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + t * 0.04, r1 = SR * (1.62 + 0.14 * Math.sin(t * 1.4 + i * 1.7));
    ctx.moveTo(SX + Math.cos(a) * SR * 1.3, SY + Math.sin(a) * SR * 1.3); ctx.lineTo(SX + Math.cos(a) * r1, SY + Math.sin(a) * r1);
  }
  ctx.globalAlpha *= 0.85 * (1 - 0.6 * storm); ctx.stroke(); ctx.restore();
  lib.circle(ctx, SX, SY, SR, { fill: '#FFC53F' });
  lib.circle(ctx, SX - SR * 0.12, SY - SR * 0.12, SR * 0.74, { fill: '#FFD978' });
  ctx.restore();
}
// sunlight arriving at the sea (beat 1, and in the final loop)
const heat = seg(p, 0.015, 0.06) * (1 - seg(p, 0.17, 0.22)) + 0.45 * seg(p, 0.87, 0.92);
if (heat > 0.01) {
  ctx.save(); ctx.strokeStyle = '#F39B33'; ctx.lineWidth = 2.6 * Z; ctx.lineCap = 'round';
  ctx.setLineDash([12 * Z, 16 * Z]); ctx.lineDashOffset = -t * 46 * Z; ctx.globalAlpha = heat * 0.75;
  ctx.beginPath();
  [-260, -110, 40, 190, 330].forEach((dx) => {
    const a = Math.atan2(360, dx), r = SR * 2.1;
    ctx.moveTo(SX + Math.cos(a) * r, SY + Math.sin(a) * r); ctx.lineTo(X(450 + dx * 0.95), Y(8));
  });
  ctx.stroke(); ctx.restore();
}

// ── Far range, back hills, and the mountain (forest, stone, snow, shaded ridge) ──
const Lm = (x) => -(500 * gs(x, 2560, 240) + 600 * gs(x, 3160, 280) + 540 * gs(x, 3760, 300) + 230 * gs(x, 2020, 260) + 22 * wob(x, 55, 7));
if (band(1500, 4600, Lm, () => 60, 0.86)) fillB(mix('#B4C7DC', '#A2AFBE', storm));
if (band(1500, 4600, Lm, (x) => Lm(x) + Math.max(0, (-430 + 18 * wob(x, 22, 9) - Lm(x)) * 0.8), 0.86)) fillB('#EEF3F8');
const Lb = (x) => Lf(x) - (70 + 60 * Math.sin(x / 170 + 0.6) ** 2 + 26 * wob(x, 90, 2)) * ss((x - XC + 30) / 380) * (1 - ss((x - 2330) / 280));
if (band(XC - 30, 2700, Lb, (x) => Lf(x) + D, 0.94)) fillB('#B2D58F');
if (band(XC - 30, 2700, Lb, (x) => Lb(x) + 4, 0.94)) fillB('#D3E9B3', 0.9);
const SL = -560 + 75 * seg(p, 0.53, 0.63, ease.inOut) - 40 * seg(p, 0.64, 0.78, ease.inOut); // snowline
if (band(2250, 4600, Mt, (x) => Lf(x) + D)) fillB(vgrad(Y(-800), Y(-150), ['#D9CBB9', '#B9A894']));
if (band(2250, 4600, (x) => Math.max(Mt(x), -280 + 10 * Math.abs(Math.sin(x / 7)) + 30 * wob(x, 48, 8)), (x) => Lf(x) + D)) fillB('#6E9F55');
if (band(2400, 4600, Mt, (x) => Math.max(Mt(x), SL + 26 * wob(x, 16, 4)))) fillB('#F7FAFD');
ctx.beginPath();
[[2920, 3250, 3110], [3520, 4400, 3700]].forEach(([pk, sx2, rx]) => {
  ctx.moveTo(X(pk), Y(Mt(pk)));
  for (let x = pk; x <= sx2; x += 12) ctx.lineTo(X(x), Y(Mt(x)));
  if (sx2 > 4000) ctx.lineTo(X(sx2), Y(-90));
  ctx.lineTo(X(rx), Y(-90)); ctx.closePath();
});
fillB('#3A3F6E', 0.2);

// ── Sea surface strip, waves, glitter under the sun ──
if (band(-3000, XC + 4, () => 0, () => D)) fillB(vgrad(Y(0), Y(D), ['#A3D3EC', '#4E9BCF']));
{
  ctx.save(); ctx.strokeStyle = WHITE; ctx.lineCap = 'round'; ctx.beginPath();
  for (let r = 0; r < 4; r++) {
    const y = D * (0.16 + r * 0.23), gap = 80 + r * 26, o = (t * (14 + r * 7)) % gap, w = 9 + r * 4;
    for (let x = Math.floor(xa / gap) * gap + o + (r % 2) * gap * 0.5; x < XC - 40; x += gap) {
      ctx.moveTo(X(x - w), Y(y)); ctx.quadraticCurveTo(X(x), Y(y - 3 - r), X(x + w), Y(y));
    }
  }
  ctx.lineWidth = 2 * Z; ctx.globalAlpha = 0.5; ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 30; i++) {
    const x = 450 + (rand(i + 60) - 0.5) * 520, y = D * (0.08 + 0.85 * rand(i + 61)), a = Math.sin(t * 2.6 + i * 2.3);
    if (a > 0.2) { ctx.moveTo(X(x - 7 * a), Y(y)); ctx.lineTo(X(x + 7 * a), Y(y)); }
  }
  ctx.strokeStyle = '#FFF6D8'; ctx.lineWidth = 2.6 * Z; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.restore();
}

// ── Land strip (top surface), lake, river, trees ──
if (band(XC, 4600, Lf, (x) => Lf(x) + D)) {
  const g = ctx.createLinearGradient(X(XC), 0, X(3000), 0);
  [[0, '#E6D29E'], [0.035, '#A5CC69'], [0.45, '#8BBE58'], [0.7, '#78AE52'], [1, '#6A9E4C']].forEach(([o, c]) => g.addColorStop(o, c));
  fillB(g);
}
curve(Lf, Math.max(XC, xa), xb, 200); ctx.strokeStyle = 'rgba(255,255,240,0.55)'; ctx.lineWidth = 2.4 * Z; ctx.stroke();
const lakeTop = (x) => YL + D * (1 - 0.88 * Math.sqrt(clamp(1 - ((x - 2110) / 114) ** 2)));
if (band(1996, 2224, lakeTop, () => YL + D)) fillB('#7FC0E9');
const wR = (x) => (x < 2100 ? lerp(12, 7, (x - XC) / 958) : lerp(6, 3.5, (x - 2222) / 300));
for (const [a, b] of [[XC - 6, 1998], [2222, 2522]]) if (band(a, b, (x) => yR(x) - wR(x) / 2, (x) => yR(x) + wR(x) / 2)) fillB('#3E8FD0');
// the stream that drains the snowfield, down the mountain's face
const SP = []; for (let i = 0; i <= 24; i++) { const k = i / 24; SP.push([lerp(2810, 2522, k) + 16 * Math.sin(k * 7), lerp(-528, yR(2522), Math.pow(k, 0.9))]); }
{
  const melt = 0.55 + 0.45 * seg(p, 0.64, 0.68);
  lib.line(ctx, SP.map(([x, y]) => [X(x), Y(y)]), 1, { color: '#3E8FD0', width: 3.4 * Z, alpha: melt });
  ctx.save(); ctx.strokeStyle = '#D4ECFB'; ctx.lineWidth = 1.8 * Z; ctx.lineCap = 'round';
  ctx.setLineDash([9 * Z, 15 * Z]); ctx.lineDashOffset = -t * (22 + 30 * flowA) * Z; ctx.globalAlpha = 0.9;
  ctx.beginPath();
  SP.forEach(([x, y]) => ctx.lineTo(X(x), Y(y)));
  for (let x = 2522; x >= 2222; x -= 8) ctx.lineTo(X(x), Y(yR(x)));
  ctx.moveTo(X(1998), Y(yR(1998)));
  for (let x = 1998; x >= XC; x -= 8) ctx.lineTo(X(x), Y(yR(x)));
  ctx.stroke(); ctx.restore();
}
// trees, back to front; the sun is on the left so the left flank is lit
const TR = [];
for (let i = 0; i < 26; i++) { const x = 1110 + i * 33 + rand(i * 7 + 1) * 18; if (x < 1985) TR.push([x, 0.1 + rand(i * 7 + 2) * 0.75, 0.85 + rand(i * 7 + 3) * 0.4, 0]); }
for (let i = 0; i < 34; i++) TR.push([2262 + i * 36 + rand(i * 5 + 90) * 16, 0.1 + rand(i * 5 + 91) * 0.75, 0.8 + rand(i * 5 + 92) * 0.4, 1]);
TR.sort((a, b) => a[1] - b[1]);
for (const [x, f, s, kind] of TR) {
  if (x < xa || x > xb) continue;
  const bx = X(x), by = Y(Lf(x) + D * f), k = Z * s * (0.78 + 0.32 * f), sw = Math.sin(t * 1.1 + x) * 1.2 * k;
  if (kind) {
    ctx.beginPath(); ctx.moveTo(bx + sw, by - 40 * k); ctx.lineTo(bx + 10 * k, by - 3 * k); ctx.lineTo(bx - 10 * k, by - 3 * k); fillB('#2D6645');
    ctx.beginPath(); ctx.moveTo(bx + sw, by - 40 * k); ctx.lineTo(bx - 10 * k, by - 3 * k); ctx.lineTo(bx - 2 * k, by - 3 * k); fillB('#478A5C');
  } else {
    ctx.fillStyle = '#6B4A32'; ctx.fillRect(bx - 1.6 * k, by - 13 * k, 3.2 * k, 13 * k);
    ctx.beginPath(); [[0, -23, 12], [-8, -16, 9], [8, -15, 9]].forEach(([dx, dy, r]) => dot(bx + dx * k + sw, by + dy * k, r * k)); fillB('#3E7E3A');
    ctx.beginPath(); [[-4, -26, 7.5], [-9, -18, 5]].forEach(([dx, dy, r]) => dot(bx + dx * k + sw, by + dy * k, r * k)); fillB('#6EAD4B');
  }
}

// ── Cut-away section: soil, groundwater, bedrock, ocean, lake ──
if (band(-3000, 4600, (x) => Lf(x) + D, (x) => Math.max(Lf(x) + D, Math.min(WT(x), BR(x)) + 2))) fillB(vgrad(Y(0), Y(300), ['#E4CC9F', '#CDAA78']));
if (band(-3000, 4600, WT, (x) => Math.max(WT(x), BR(x)) + 2)) fillB(vgrad(Y(0), Y(320), ['#A8C6DA', '#7FA3C2']));
if (band(-3000, 4600, BR, () => BOT)) fillB(vgrad(Y(0), Y(500), ['#8A7F72', '#5E564D']));
ctx.beginPath();
for (let j = 1; j <= 3; j++) { const fn = (x) => BR(x) + j * 46 + 12 * wob(x, 80, j * 5); for (let i = 0; i <= 90; i++) { const x = xa + ((xb - xa) * i) / 90; i ? ctx.lineTo(X(x), Y(fn(x))) : ctx.moveTo(X(x), Y(fn(x))); } }
ctx.strokeStyle = 'rgba(30,24,20,0.22)'; ctx.lineWidth = 1.8 * Z; ctx.stroke();
{
  const G = [[], []], c0 = Math.floor(xa / 26), c1 = Math.ceil(xb / 26);
  for (let c = c0; c <= c1; c++) for (let r = 0; r < 7; r++) {
    const id = c * 7 + r + 5000, x = c * 26 + rand(id) * 22, top = Lf(x) + D + 18, y = top + r * 34 + rand(id + 1) * 26;
    if (y > BR(x) - 6) break;
    G[y > WT(x) ? 1 : 0].push([X(x), Y(y), (1.4 + rand(id + 2) * 1.4) * Z]);
  }
  [['#B08A5A', 0.55], ['#E6D3A6', 0.75]].forEach(([c, a], i) => { ctx.beginPath(); G[i].forEach(([x, y, r]) => dot(x, y, r)); fillB(c, a); });
}
if (band(XC, 4600, (x) => Lf(x) + D, (x) => Lf(x) + D + 14)) fillB('#6A4A33');
if (band(-3000, XC + 2, (x) => Lf(x) + D, (x) => Lf(x) + D + 12)) fillB('#D9C08F');
if (band(-3000, XC + 2, () => D, (x) => Lf(x) + D)) fillB(vgrad(Y(D), Y(D + 480), ['#2F80BC', '#11487A', '#0A2D52']));
if (band(1996, 2224, () => YL + D, (x) => Math.max(YL + D, Lf(x) + D))) fillB(vgrad(Y(YL + D), Y(YL + D + 80), ['#4F9EDA', '#2A69A3']));
curve((x) => Lf(x) + D, Math.max(XC, xa), xb, 200); ctx.strokeStyle = 'rgba(50,34,24,0.45)'; ctx.lineWidth = 2 * Z; ctx.stroke();
ctx.save(); ctx.setLineDash([7 * Z, 9 * Z]); curve(WT, Math.max(XC - 100, xa), xb, 160);
ctx.strokeStyle = '#1F6FB4'; ctx.globalAlpha = 0.7; ctx.lineWidth = 2 * Z; ctx.stroke(); ctx.restore();
// groundwater: slow drift toward the sea; infiltration: rain soaking down to the water table
{
  const gwA = 0.55 + 0.45 * seg(p, 0.73, 0.78);
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const r1 = rand(i * 3 + 400), r2 = rand(i * 3 + 401);
    const x = 2700 - ((t * 16 * (0.7 + 0.6 * r1) + r1 * 1850) % 1850);
    const top = WT(x), y = lerp(top + 8, Math.min(BR(x), top + 150) - 6, r2);
    const r = 3.4 * Z * clamp(Math.min((2700 - x) / 80, (x - 860) / 80));
    if (r > 0.3 && y < BR(x) - 4) dot(X(x), Y(y), r);
  }
  fillB('#1E66A8', gwA * 0.75);
  const infA = seg(p, 0.58, 0.64) * (1 - 0.5 * seg(p, 0.84, 0.88));
  if (infA > 0) {
    ctx.beginPath();
    for (let i = 0; i < 50; i++) {
      const r1 = rand(i * 3 + 700), r2 = rand(i * 3 + 701), x = 1120 + r1 * 1500;
      if (x > 1990 && x < 2230) continue;
      const y0 = Lf(x) + D + 16, y1 = WT(x), age = (t * 0.22 * (0.7 + 0.6 * r2) + r2) % 1, y = lerp(y0, y1, age);
      ctx.moveTo(X(x), Y(y - 5)); ctx.lineTo(X(x), Y(y + 5));
    }
    ctx.strokeStyle = '#2B78C0'; ctx.lineWidth = 3 * Z; ctx.lineCap = 'round'; ctx.globalAlpha = infA * 0.85; ctx.stroke(); ctx.globalAlpha = 1;
  }
}

// ── Vapour (an invisible gas: faint, wavy, rising) ──
function wisps(n, seed, x0, x1, base, rise, drift, a, len) {
  if (a <= 0.01) return;
  ctx.save(); ctx.strokeStyle = WHITE; ctx.lineCap = 'round'; ctx.lineWidth = 2.6 * Z;
  for (let i = 0; i < n; i++) {
    const r1 = rand(seed + i * 3), r2 = rand(seed + i * 3 + 1), r3 = rand(seed + i * 3 + 2);
    const age = (t / (3.6 + r2 * 2.4) + r1) % 1, bx = lerp(x0, x1, r3);
    const x = bx + drift * age * age, y = (typeof base === 'function' ? base(bx) : base) - age * rise * (0.75 + 0.5 * r2);
    ctx.globalAlpha = a * Math.sin(Math.PI * age) * 0.85;
    ctx.beginPath();
    for (let j = 0; j <= 6; j++) { const f = j / 6; ctx.lineTo(X(x + Math.sin(f * 5 + t * 1.6 + r1 * 9) * 6 * (0.4 + f)), Y(y - f * len)); }
    ctx.stroke();
  }
  ctx.restore();
}
wisps(34, 11, 150, 1010, D * 0.35, 470, 160, evapA, 44);
wisps(30, 51, 1110, 1980, (x) => Lf(x) + D * 0.3 - 36, 260, 70, transA, 36);
wisps(24, 91, 1700, 2500, -260, 560, 60, seg(p, 0.31, 0.35) * (1 - seg(p, 0.46, 0.5)) + 0.3 * seg(p, 0.87, 0.91), 50);

// ── Rain + snow ──
const CH = 2420 + 380 * seg(p, 0.44, 0.56, ease.inOut); // the drop's cloud drifts inland to the peak
if (rainA > 0.01) {
  ctx.beginPath();
  for (let i = 0; i < 100; i++) {
    const r1 = rand(i * 2 + 900), r2 = rand(i * 2 + 901), x = 2150 + (r1 - 0.5) * 380, by = -770, gy = Lf(x) + D * 0.5, hf = gy - by;
    const y = by + ((t * 520 * (0.85 + 0.3 * r2) + r2 * 997) % hf), xx = x - (y - by) * 0.1;
    ctx.moveTo(X(xx), Y(y)); ctx.lineTo(X(xx + 2.6), Y(y - 26));
  }
  ctx.strokeStyle = '#3F78B0'; ctx.lineWidth = 2 * Z; ctx.lineCap = 'round'; ctx.globalAlpha = rainA * 0.75; ctx.stroke(); ctx.globalAlpha = 1;
}
if (snowA > 0.01) {
  ctx.beginPath();
  for (let i = 0; i < 70; i++) {
    const r1 = rand(i * 2 + 1300), r2 = rand(i * 2 + 1301), x0 = CH + (r1 - 0.5) * 420, by = -880, gy = Mt(x0) + 18, hf = gy - by;
    if (hf < 20) continue;
    const y = by + ((t * 62 * (0.8 + 0.4 * r2) + r2 * 997) % hf), x = x0 + Math.sin(t * 1.3 + i) * 9, rr = 6 * Z, a0 = t * 0.6 + i;
    for (let j = 0; j < 3; j++) { const a = a0 + (j * Math.PI) / 3; ctx.moveTo(X(x) - Math.cos(a) * rr, Y(y) - Math.sin(a) * rr); ctx.lineTo(X(x) + Math.cos(a) * rr, Y(y) + Math.sin(a) * rr); }
  }
  ctx.strokeStyle = WHITE; ctx.lineWidth = 2 * Z; ctx.lineCap = 'round'; ctx.globalAlpha = snowA; ctx.stroke(); ctx.globalAlpha = 1;
}

// ── Clouds: two-tone puffs with flat bases; they build upward, then darken ──
function cloud(x0, by, w, g, dk, seed) {
  if (g <= 0.01) return;
  const top = mix('#FFFFFF', '#9AA7B8', dk), sh = mix('#CFDDEB', '#627087', dk);
  const pf = [];
  for (let i = 0; i < 9; i++) {
    const f = i / 8 - 0.5, k = ss(g * 1.8 - Math.abs(f) * 1.2);
    const r = w * (0.17 - Math.abs(f) * 0.12 + 0.05 * rand(seed + i)) * k * (1 + 0.03 * Math.sin(t * 0.7 + i));
    if (r > 0) pf.push([x0 + f * w * 0.86 + noise(t * 0.15, seed + i) * 6, by - r * 0.45, r]);
  }
  [[-0.17, 0.15], [0.04, 0.19], [0.22, 0.13]].forEach(([f, rr], j) => {
    const k = ss(g * 1.7 - 0.55 - j * 0.12), r = w * rr * k;
    if (r > 0) pf.push([x0 + f * w + noise(t * 0.12, seed + 20 + j) * 5, by - w * 0.17 - r * 0.3, r]);
  });
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, Y(by)); ctx.clip();
  const draw = (lift, sc, col) => { ctx.beginPath(); for (const [x, y, r] of pf) dot(X(x), Y(y - r * lift), r * sc * Z); fillB(col); };
  draw(0, 1, sh); draw(0.22, 0.84, top);
  ctx.restore();
}
const darkK = seg(p, 0.44, 0.52) * (1 - 0.65 * seg(p, 0.68, 0.8));
const clear = (g) => g * (1 - seg(p, 0.615, 0.67, ease.inOut)) + 0.85 * seg(p, 0.83, 0.88, ease.inOut);
if (wide) cloud(260 + t * 3, -600, 260, 1 - 0.6 * seg(p, 0.85, 0.89), 0, 3);
cloud(3400, -930, 360, clear(seg(p, 0.36, 0.48, ease.inOut)), 0.5 * storm, 29);
cloud(CH, -880, 560, clear(seg(p, 0.31, 0.45, ease.inOut)), 0.8 * darkK, 53);
cloud(2150, -780, 520, clear(seg(p, 0.27, 0.42, ease.inOut)), darkK, 41);

// ── The drop we follow ──
const HP = [], LM = [0];
const push = (x, y) => HP.push([x, y]);
const bez = (a, c, b, n) => { for (let i = 1; i <= n; i++) { const k = i / n; push((1 - k) * (1 - k) * a[0] + 2 * k * (1 - k) * c[0] + k * k * b[0], (1 - k) * (1 - k) * a[1] + 2 * k * (1 - k) * c[1] + k * k * b[1]); } LM.push(HP.length - 1); };
const yS = Mt(2840) + 22;
push(760, 25);
bez([760, 25], [780, -280], [960, -330], 14);
bez([960, -330], [1250, -380], [1560, -470], 14);
bez([1560, -470], [2250, -560], [2400, -950], 18);
bez([2400, -950], [2600, -965], [2770, -960], 10);
{ for (let i = 1; i <= 16; i++) { const k = i / 16; push(lerp(2770, 2840, k) + Math.sin(k * 9) * 16 * (1 - k), lerp(-960, yS, k)); } LM.push(HP.length - 1); }
push(2810, -528); SP.forEach((q) => push(q[0], q[1]));
for (let x = 2510; x >= 2224; x -= 12) push(x, yR(x));
LM.push(HP.length - 1);
bez([2224, YL + D * 0.6], [2160, YL + D * 0.7], [2110, YL + D * 0.75], 6);
bez([2110, YL + D * 0.75], [2105, Lf(2105) + D], [2090, Lf(2090) + D + 60], 8);
for (let x = 2060; x >= 1000; x -= 30) push(x, lerp(WT(x), Math.min(BR(x), WT(x) + 150), 0.4));
bez([1000, lerp(WT(1000), BR(1000), 0.4)], [940, Lf(940) + D + 10], [880, D + 64], 6);
bez([880, D + 64], [800, D + 30], [770, D * 0.45], 6);
const HL = [0];
for (let i = 1; i < HP.length; i++) HL.push(HL[i - 1] + Math.hypot(HP[i][0] - HP[i - 1][0], HP[i][1] - HP[i - 1][1]));
const atL = (d) => { d = clamp(d, 0, HL[HL.length - 1]); let i = 1; while (i < HL.length - 1 && HL[i] < d) i++; const f = (d - HL[i - 1]) / (HL[i] - HL[i - 1] || 1); return [lerp(HP[i - 1][0], HP[i][0], f), lerp(HP[i - 1][1], HP[i][1], f)]; };
// landmarks: sea, over the coast, cloud, drift to peak, on the snow, lake inlet, lake, in ground, seabed, home
const HK = [[0.035, 0], [0.175, 1], [0.3, 2], [0.425, 3], [0.55, 4], [0.61, 5], [0.655, 5], [0.715, 6], [0.735, 7], [0.76, 8], [0.83, 9], [0.85, 10]];
const hd = lib.keys(p, HK.map(([q, i]) => [q, HL[LM[i]]]), ease.inOut);
const [hx, hy] = atL(hd);
const state = p < 0.415 ? 0 : p < 0.55 ? 1 : p < 0.64 ? 2 : 1; // gas, liquid, ice, liquid
const heroA = seg(p, 0.03, 0.06) * (1 - seg(p, 0.85, 0.865));
if (heroA > 0.01) {
  const tr = [];
  for (let i = 0; i <= 18; i++) { const q = atL(hd - 260 + (i / 18) * 260); tr.push([X(q[0]), Y(q[1])]); }
  ctx.save(); ctx.setLineDash([3 * u, 7 * u]); lib.line(ctx, tr, 1, { color: ACC, width: 2.4 * u, alpha: 0.7 * heroA }); ctx.restore();
  const sx = X(hx), sy = Y(hy), r = 9 * u;
  lib.circle(ctx, sx, sy, r * 2.4, { fill: WHITE, alpha: 0.4 * heroA });
  ctx.save(); ctx.globalAlpha = heroA; ctx.translate(sx, sy);
  if (state === 0) { lib.circle(ctx, 0, 0, r, { stroke: ACC, lineWidth: 3 * u }); lib.circle(ctx, 0, 0, 3 * u, { fill: ACC }); }
  else if (state === 2) { ctx.strokeStyle = ACC; ctx.lineWidth = 2.6 * u; ctx.lineCap = 'round'; ctx.beginPath(); for (let j = 0; j < 3; j++) { const a = t * 0.8 + (j * Math.PI) / 3; ctx.moveTo(-Math.cos(a) * r * 1.2, -Math.sin(a) * r * 1.2); ctx.lineTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2); } ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(0, -r * 1.5); ctx.bezierCurveTo(r * 0.9, -r * 0.3, r, r * 0.9, 0, r * 0.95); ctx.bezierCurveTo(-r, r * 0.9, -r * 0.9, -r * 0.3, 0, -r * 1.5); fillB(ACC); lib.circle(ctx, -r * 0.3, r * 0.15, r * 0.22, { fill: WHITE, alpha: 0.8 }); }
  ctx.restore();
}

const rip = seg(p, 0.84, 0.9);
if (rip > 0 && rip < 1) for (let j = 0; j < 2; j++) {
  const k = clamp(rip * 1.4 - j * 0.35);
  if (k > 0 && k < 1) { ctx.beginPath(); ctx.ellipse(X(770), Y(D * 0.45), (10 + 70 * ease.out(k)) * Z, (3 + 16 * ease.out(k)) * Z, 0, 0, TAU); ctx.strokeStyle = WHITE; ctx.lineWidth = 2.4 * Z; ctx.globalAlpha = 1 - k; ctx.stroke(); ctx.globalAlpha = 1; }
}
// ── Lenses: a leaf breathing out vapour (beat 2), vapour condensing (beat 3); and temperature with height ──
function lens(LX, LY, LR, a, ax, ay, inside) {
  if (a <= 0.01) return;
  const ang = Math.atan2(ay - LY, ax - LX);
  lib.line(ctx, [[ax, ay], [LX + Math.cos(ang) * LR, LY + Math.sin(ang) * LR]], a, { color: INK, width: 1.6 * u, alpha: 0.8 });
  lib.circle(ctx, ax, ay, 4 * u, { fill: INK, alpha: a });
  const lr = LR * ease.outBack(clamp(a));
  lib.circle(ctx, LX, LY, lr + 6 * u, { fill: WHITE, alpha: a });
  ctx.save(); ctx.globalAlpha = a; lib.mask(ctx, (c) => c.arc(LX, LY, lr, 0, TAU), () => inside(lr)); ctx.restore();
  lib.circle(ctx, LX, LY, lr, { stroke: INK, lineWidth: 2 * u, alpha: a });
}
const L2 = seg(p, 0.215, 0.24) * (1 - seg(p, 0.3, 0.315));
const L2X = wide ? W * 0.74 : W * 0.68, L2Y = wide ? H * 0.34 : H * (tall ? 0.42 : 0.5), LR = 140 * u;
lens(L2X, L2Y, LR, L2, X(1640), Y(Lf(1640) - 6), (lr) => {
  lib.circle(ctx, L2X, L2Y, lr, { fill: '#A9D1EC' });
  const qx = L2X, qy = L2Y + 34 * u, LW = lr * 0.9, LH = lr * 0.95, hh = (x) => (LH / 2) * (1 - (x / LW) ** 2), ca = Math.cos(-0.15), sa = Math.sin(-0.15);
  ctx.save(); ctx.translate(qx, qy); ctx.rotate(-0.15);
  ctx.beginPath(); ctx.moveTo(-LW, 0); ctx.quadraticCurveTo(0, -LH, LW, 0); ctx.quadraticCurveTo(0, LH, -LW, 0); fillB('#72AC4E');
  ctx.beginPath(); ctx.moveTo(-LW, 0); ctx.quadraticCurveTo(0, -LH, LW, 0); ctx.closePath(); fillB('#84BF5E');
  ctx.strokeStyle = '#5A9140'; ctx.lineWidth = 3 * u; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-LW * 1.2, 0); ctx.lineTo(LW * 0.94, 0);
  for (let i = -3; i <= 2; i++) { const x = i * LW * 0.24 + LW * 0.05, x2 = x + LW * 0.2; ctx.moveTo(x, 0); ctx.lineTo(x2, -hh(x2) * 0.78); ctx.moveTo(x, 0); ctx.lineTo(x2, hh(x2) * 0.78); }
  ctx.stroke();
  const pts = [[-0.62, -0.42], [-0.3, -0.52], [0.08, -0.5], [0.44, -0.42], [-0.46, 0.46], [-0.08, 0.52], [0.3, 0.46]].map(([fx, fy]) => {
    const x = fx * LW, y = fy * hh(x);
    ctx.beginPath(); ctx.ellipse(x, y, 8 * u, 5 * u, 0, 0, TAU); fillB('#4A8538');
    ctx.beginPath(); ctx.ellipse(x, y, 4.6 * u, 1.5 * u, 0, 0, TAU); fillB('#244A1C');
    return [qx + x * ca - y * sa, qy + x * sa + y * ca];
  });
  ctx.restore();
  ctx.save(); ctx.strokeStyle = WHITE; ctx.lineWidth = 2.8 * u; ctx.lineCap = 'round';
  pts.forEach(([px, py], i) => {
    for (let j = 0; j < 2; j++) {
      const age = (t * 0.45 + i * 0.29 + j * 0.5) % 1;
      ctx.beginPath();
      for (let q = 0; q <= 5; q++) { const f = q / 5; ctx.lineTo(px + Math.sin(f * 5 + t * 2 + i) * 4 * u * (0.3 + f), py - 6 * u - (age * 80 + f * 24) * u); }
      ctx.globalAlpha = L2 * Math.sin(Math.PI * age); ctx.stroke();
    }
  });
  ctx.restore();
});
const b3 = seg(p, 0.335, 0.36) * (1 - seg(p, 0.465, 0.485));
if (b3 > 0.01) {
  const bx = X(1560), y0 = Y(-140), y1 = Y(-770);
  const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#F08A3A'); g.addColorStop(1, '#3E7FC4');
  ctx.save(); ctx.globalAlpha = b3; ctx.strokeStyle = g; ctx.lineWidth = 6 * u; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bx, y0); ctx.lineTo(bx, lerp(y0, y1, ease.out(seg(p, 0.34, 0.39)))); ctx.stroke(); ctx.restore();
}
const L3 = seg(p, 0.39, 0.41) * (1 - seg(p, 0.465, 0.48));
const L3X = wide ? W * 0.72 : W * 0.7, L3Y = wide ? H * 0.66 : H * (tall ? 0.36 : 0.62);
lens(L3X, L3Y, LR, L3, X(hx), Y(hy), (lr) => {
  lib.circle(ctx, L3X, L3Y, lr, { fill: '#DCEBF6' });
  const k = seg(p, 0.405, 0.46, ease.inOut), C = [[-44, -34], [42, -46], [-8, 32], [58, 40], [-64, 38]];
  ctx.beginPath();
  for (let i = 0; i < 50; i++) {
    const c = C[i % 5], mk = ease.inOut(clamp(k * 1.6 - rand(i + 2000) * 0.6));
    const r = 3 * u * (1 - mk);
    if (r > 0.2) dot(L3X + lerp(noise(i * 1.3, t * 0.9) * 110, c[0], mk) * u, L3Y + lerp(noise(i * 2.1 + 5, t * 0.9) * 110, c[1], mk) * u, r);
  }
  fillB('#5D9CCF');
  C.forEach(([x, y], i) => {
    const r = (4 + 15 * clamp(k * 1.3 - i * 0.06)) * u;
    lib.circle(ctx, L3X + x * u, L3Y + y * u, r, { fill: '#3E8FD0' });
    lib.circle(ctx, L3X + x * u - r * 0.3, L3Y + y * u - r * 0.3, r * 0.3, { fill: WHITE, alpha: 0.8 });
  });
});

// ── Final beat: the whole loop as arrows ──
function arrow(pts, k, a, dash) {
  if (k <= 0) return;
  const sp = pts.map(([x, y]) => [X(x), Y(y)]);
  lib.line(ctx, sp, k, { color: WHITE, width: 11 * u, alpha: a * 0.9 });
  ctx.save(); if (dash) ctx.setLineDash([12 * u, 10 * u]);
  lib.line(ctx, sp, k, { color: ACC, width: 5.5 * u, alpha: a }); ctx.restore();
  const L = [0]; for (let i = 1; i < sp.length; i++) L.push(L[i - 1] + Math.hypot(sp[i][0] - sp[i - 1][0], sp[i][1] - sp[i - 1][1]));
  const d = L[L.length - 1] * clamp(k); let i = 1; while (i < sp.length - 1 && L[i] < d) i++;
  const f = (d - L[i - 1]) / (L[i] - L[i - 1] || 1), tx = lerp(sp[i - 1][0], sp[i][0], f), ty = lerp(sp[i - 1][1], sp[i][1], f);
  const ang = Math.atan2(sp[i][1] - sp[i - 1][1], sp[i][0] - sp[i - 1][0]), hs = 17 * u;
  ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(hs * 0.7, 0); ctx.lineTo(-hs, -hs * 0.8); ctx.lineTo(-hs * 0.55, 0); ctx.lineTo(-hs, hs * 0.8); ctx.closePath();
  ctx.lineJoin = 'round'; ctx.strokeStyle = WHITE; ctx.lineWidth = 3.5 * u; ctx.globalAlpha = a; ctx.stroke(); ctx.fillStyle = ACC; ctx.fill(); ctx.restore();
}
const qb = (a, c, b, n = 24) => { const o = []; for (let i = 0; i <= n; i++) { const k = i / n; o.push([(1 - k) * (1 - k) * a[0] + 2 * k * (1 - k) * c[0] + k * k * b[0], (1 - k) * (1 - k) * a[1] + 2 * k * (1 - k) * c[1] + k * k * b[1]]); } return o; };
// name, path, label anchor (world), label offset (px), align
const RV = []; for (let x = 2500; x >= 1090; x -= 30) RV.push([x, (x > 1996 && x < 2224 ? YL : Lf(x)) + D * 0.35 - 22]);
const ARROWS = [
  ['EVAPORATION', qb([720, -30], [740, -430], [1080, -560]), [790, -330], [26, 0], 'left'],
  ['TRANSPIRATION', qb([1460, -160], [1470, -320], [1540, -470]), [1480, -300], [24, 0], 'left'],
  ['CONDENSATION', qb([1180, -610], [1500, -730], [1900, -760]), [1500, -700], [0, -40], 'center'],
  ['PRECIPITATION', qb([2690, -860], [2700, -700], [2690, -560]), [2700, -700], [wide ? 24 : -24, 0], wide ? 'left' : 'right'],
  ['COLLECTION', RV, [1640, Lf(1640) + D + 30], [0, 0], 'center'],
  ['GROUNDWATER', qb([2100, 130], [1600, 150], [1120, 150], 30), [1600, 150], [0, 34], 'center'],
];
const finA = seg(p, 0.845, 0.865);
const arK = (i) => seg(p, 0.85 + i * 0.013, 0.88 + i * 0.013, ease.inOut);
if (finA > 0) ARROWS.forEach(([nm, pts], i) => arrow(pts, arK(i), finA, i === 5));

// ── Labels and facts (plain text, drawn last) ──
const LS = 18 * u, LO = { family: 'sans', weight: 600, size: LS, tracking: 0.12, color: INK, baseline: 'middle' };
const lab = (str, wx, wy, dx, dy, a, gap) => {
  if (a <= 0.01) return;
  const x0 = X(wx), y0 = Y(wy), tw = str.length * LS * 0.72 + 40 * u;
  if ((dx < 0 && x0 + dx * u - tw < M) || (dx > 0 && x0 + dx * u + tw > W - M)) dx = -dx;
  const x1 = x0 + dx * u, y1 = y0 + dy * u, s = dx >= 0 ? 1 : -1, g = gap ? 16 * u / Math.hypot(dx * u, dy * u) : 0;
  lib.line(ctx, [[lerp(x0, x1, g), lerp(y0, y1, g)], [x1, y1], [x1 + s * 16 * u, y1]], ease.out(clamp(a * 1.4)), { color: INK, width: 1.6 * u, alpha: 0.85 });
  if (!gap) lib.circle(ctx, x0, y0, 4 * u, { fill: INK, alpha: a });
  lib.text(ctx, str, x1 + s * 24 * u, y1, { ...LO, align: s > 0 ? 'left' : 'right', alpha: clamp(a * 1.6 - 0.5) });
};
const wa = (a, b, fi = 0.015, fo = 0.012) => seg(p, a, a + fi) * (1 - seg(p, b - fo, b));
lab('FOLLOW THIS DROP', hx, hy, -70, 40, wa(0.06, 0.155), true);
lab('WATER VAPOUR', 300, -150, -60, 40, wa(0.08, 0.165));
if (L2 > 0.01) lib.text(ctx, 'TINY PORES RELEASE VAPOUR', L2X, L2Y - LR - 26 * u, { ...LO, align: 'center', alpha: L2 });
if (b3 > 0.01) {
  lib.text(ctx, 'COLDER', X(1560) + 18 * u, Y(-770), { ...LO, alpha: b3 * seg(p, 0.37, 0.39) });
  lib.text(ctx, 'WARMER', X(1560) + 18 * u, Y(-140), { ...LO, alpha: b3 });
}
if (L3 > 0.01) lib.text(ctx, 'VAPOUR CONDENSES INTO DROPLETS', L3X, L3Y + LR + 38 * u, { ...LO, align: 'center', alpha: L3 });
lab('RAIN', 2060, -470, -70, 50, wa(0.52, 0.635));
lab('SNOW', CH - 60, -800, -90, 40, wa(0.545, 0.635));
lab('SNOWMELT', 2800, -520, 70, -40, wa(0.66, 0.73));
lab('RIVER', 2400, yR(2400), 60, 70, wa(0.675, 0.735));
lab('LAKE', 2110, YL + D * 0.6, -60, -70, wa(0.69, 0.75));
lab('INFILTRATION', 1600, Lf(1600) + D + 40, 70, 30, wa(0.745, 0.835));
lab('GROUNDWATER', 1250, WT(1250) + 70, -60, 60, wa(0.755, 0.835));
const fact = (num, cap, sx, sy, a, col) => {
  if (a <= 0.01) return;
  lib.text(ctx, num, sx, sy, { family: 'serif', size: 72 * u, color: col, alpha: a });
  lib.text(ctx, cap, sx, sy + 38 * u, { family: 'sans', weight: 600, size: 16 * u, tracking: 0.12, color: col, maxWidth: 380 * u, lineHeight: 1.45, alpha: a });
};
fact(lib.count(seg(p, 0.085, 0.125, ease.out), 0, 97) + '%', "OF EARTH'S WATER IS IN THE OCEANS", X(330), Y(D + 160), wa(0.085, 0.185, 0.015, 0.016), WHITE);
fact('The rest', 'IS MOSTLY GROUNDWATER', X(1820), Y(250), wa(0.765, 0.84), WHITE);
if (finA > 0) ARROWS.forEach(([nm, , [ax, ay], [ox, oy], al], i) => {
  const k = clamp(arK(i) * 2 - 0.6);
  if (k > 0) lib.text(ctx, nm, X(ax) + ox * u, Y(ay) + oy * u, { ...LO, weight: 700, size: 17 * u, align: al, alpha: k * finA });
});

// ── Copy column ──
const TX = M, TY = M + (tall ? 30 : 0) * u, TW = wide ? 740 * u : W - 2 * M, HS = (wide ? 62 : tall ? 64 : 52) * u;
const titleA = 1 - seg(p, 0.038, 0.052, ease.in);
if (titleA > 0.01) lib.words(ctx, 'The water cycle', TX, TY + 104 * u - (1 - titleA) * 20 * u, seg(p, -0.012, 0.03), { family: 'serif', size: 108 * u, color: INK, alpha: titleA, stagger: 0.4 });
const BEATS = [
  [0.058, 0.165, '1', 'EVAPORATION', 'Sunlight turns seawater into invisible vapour.'],
  [0.2, 0.315, '2', 'TRANSPIRATION', 'Plants breathe out water vapour too.'],
  [0.315, 0.47, '3', 'CONDENSATION', 'Rising vapour cools and forms clouds.'],
  [0.47, 0.635, '4', 'PRECIPITATION', 'Droplets grow heavy and fall.'],
  [0.645, 0.835, '5', 'COLLECTION', 'Rivers and groundwater carry it back.'],
];
BEATS.forEach(([a, b, n, name, head]) => {
  const kin = seg(p, a, a + 0.05), out = seg(p, b - 0.014, b, ease.in);
  if (kin <= 0 || out >= 1) return;
  const oy = -out * 14 * u, al = 1 - out, y = TY + 56 * u + oy;
  lib.text(ctx, 'THE WATER CYCLE', TX, TY + 12 * u, { ...LO, size: 16 * u, tracking: 0.24, color: INK2, baseline: 'alphabetic', alpha: al * clamp(kin * 3) });
  lib.circle(ctx, TX + 14 * u, y - 6 * u, 14 * u * ease.outBack(clamp(kin * 3)), { fill: ACC, alpha: al });
  lib.text(ctx, n, TX + 14 * u, y - 5 * u, { ...LO, weight: 700, size: 16 * u, tracking: 0, color: WHITE, align: 'center', alpha: al * clamp(kin * 3) });
  lib.text(ctx, name, TX + 40 * u, y - 5 * u, { ...LO, weight: 700, size: 19 * u, tracking: 0.16, alpha: al * clamp(kin * 2.5 - 0.2) });
  const hr = lib.words(ctx, head, TX, y + 26 * u + HS, kin, { family: 'serif', size: HS, color: INK, maxWidth: TW, lineHeight: 1.08, stagger: 0.45, alpha: al });
  if (n === '4') fact('2%', 'OF EARTH’S WATER IS FROZEN AS ICE AND SNOW', TX, y + 26 * u + HS + hr.height + 70 * u, wa(0.525, 0.635), INK);
});
// closing line
const endK = seg(p, 0.855, 0.905);
if (endK > 0) lib.words(ctx, 'The water in your glass has made this journey for billions of years.', TX, tall ? H * 0.3 : TY + 54 * u, endK, { family: 'serif', size: (wide ? 64 : 58) * u, color: INK, maxWidth: wide ? 1150 * u : TW, lineHeight: 1.08, stagger: 0.5 });
`,
};
