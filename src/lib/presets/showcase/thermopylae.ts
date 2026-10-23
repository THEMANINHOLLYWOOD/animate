// Thermopylae, 480 BC. Hand-built example film in the scene format Claude generates.
// Brief: A cinematic, historically careful short about the last stand at Thermopylae in the look of Greek black-figure pottery: terracotta and black figures with bronze rim light, a meander border opening into a 2.39 letterbox, a vast Persian host pouring into the pass, a map of the Hot Gates, the phalanx holding for two days, Ephialtes' torch-lit mountain path, the final stand on Kolonos, and Simonides' epitaph over a lone helmet against the sunset.
export const film = {
  id: "ex-thermopylae",
  title: "Thermopylae, 480 BC",
  aspect: "16:9" as const,
  duration: 40,
  prompt: "A cinematic, historically careful short about the last stand at Thermopylae in the look of Greek black-figure pottery: terracotta and black figures with bronze rim light, a meander border opening into a 2.39 letterbox, a vast Persian host pouring into the pass, a map of the Hot Gates, the phalanx holding for two days, Ephialtes' torch-lit mountain path, the final stand on Kolonos, and Simonides' epitaph over a lone helmet against the sunset.",
  code: String.raw`
// THERMOPYLAE, 480 BC. Black-figure pottery fused with cinema: a meander band opens into a 2.39 letterbox.
// Day is black figures on terracotta with bronze rim light; the night map flips to red-figure;
// every return to the fight dives through a Greek shield on the map.
const L = lib, U = L.u, E = L.ease, R = L.rand, NZ = L.noise, cl = L.clamp, lerp = L.lerp, PI = Math.PI;
const rgb = (c) => (c[0] === '#' ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.match(/[\d.]+/g).map(Number));
const mix = (a, b, k) => { const A = rgb(a), B = rgb(b), q = cl(k); return '#' + A.slice(0, 3).map((v, i) => Math.round(v + (B[i] - v) * q).toString(16).padStart(2, '0')).join(''); };
const wide = W / H >= 1.2, tall = W / H < 0.8;
const C = { terra: '#C8692B', ink: '#140C07', bronze: '#D9A35A', cream: '#F1E2C2', sun: '#FBE6B8', lit: '#E8A872', dust: '#E7B07A' };
const sg = (a, b, e) => L.seg(p, a, b, e || E.inOut);
const SAFE = 0.08 * Math.min(W, H);
L.bg(ctx, W, H, C.ink);

// ---------- frame: the cinematic band and its vase borders ----------
const bh = wide ? W / 2.39 : tall ? W * 1.05 : W / 1.78, cT = (H - bh) / 2, cB = cT + bh, BY = (f) => cT + f * bh;
const bandH = L.keys(p, [[0.018, 0], [0.058, bh], [0.186, bh], [0.214, H], [0.3, H], [0.33, bh], [0.444, bh], [0.47, H], [0.548, H], [0.578, bh]]);
const bT = (H - bandH) / 2, bB = (H + bandH) / 2;
const capS = (wide ? 34 : tall ? 42 : 34) * U, capY = wide ? cB + 38 * U : tall ? cB + 150 * U : cB + 84 * U;

// ---------- frieze geometry (side view) ----------
const fs = wide ? bh * 0.36 : tall ? W * 0.2 : bh * 0.36, sp = fs * 0.19;
const gy = BY(wide ? 0.85 : 0.8), hzF = BY(0.6), gx0 = W * (wide ? 0.5 : 0.42);
const hx = W * (wide ? 0.64 : 0.66), hw = W * (wide ? 0.19 : 0.3), hH = fs * 0.66 * sg(0.696, 0.735);
const GAP = fs * 0.34, GS = (wide ? hx : W * 0.53) - (13 * sp + 2 * GAP) / 2, HMX = hx + fs * 0.09, HMY = gy - fs * 1.52; // where the final helmet rests
const hill = (x) => { const u = (x - hx) / hw; return Math.abs(u) < 1 ? hH * (0.5 + 0.5 * Math.cos(u * PI)) : 0; };

// sky palettes: dawn, day, dusk, night (top, middle, horizon); tod runs through them cyclically
const SKY = [['#6A2E14', '#C2622A', '#F2B766'], ['#A8521F', '#CC6C2E', '#EDB26A'], ['#3A160C', '#963D1A', '#EE8E3E'], ['#0B0809', '#1A0F0F', '#3A1C10']];
const skyC = (td, j) => { const i = Math.floor(td); return mix(SKY[i % 4][j], SKY[(i + 1) % 4][j], td - i); };
const tod = L.keys(p, [[0.3, 1.2], [0.355, 1.9], [0.368, 2.7], [0.374, 3.2], [0.382, 4], [0.4, 5], [0.43, 5.75], [0.452, 6.6], [0.54, 7.2], [0.572, 8], [0.64, 8.7], [0.7, 9.2], [0.79, 9.95], [1, 10.15]], E.linear);
function sunPos() {
  if (p < 0.5) {
    const ph = p < 0.37 ? lerp(0.42, 1.14, sg(0.29, 0.37, E.linear)) : lerp(-0.14, 1.0, sg(0.37, 0.455, E.linear));
    return [W * lerp(0.9, 0.1, ph), BY(0.62 - 0.44 * Math.sin(ph * PI))];
  }
  const k = L.keys(p, [[0.55, [0.86, 0.64]], [0.65, [0.8, 0.34]], [0.72, [0.74, 0.24]], [0.86, [HMX / W + 0.012, (HMY - cT) / bh - 0.03]], [1, [HMX / W, (HMY - cT) / bh + 0.005]]], E.inOutSine);
  return [W * k[0], BY(k[1])];
}

// ---------- shared drawing ----------
function poly(pts, close) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); if (close) ctx.closePath(); }
function sun(x, y, r, a) {
  if (a <= 0) return;
  const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 6);
  g.addColorStop(0, 'rgba(251,230,184,' + 0.5 * a + ')'); g.addColorStop(0.3, 'rgba(240,160,80,' + 0.2 * a + ')'); g.addColorStop(1, 'rgba(240,160,80,0)');
  ctx.fillStyle = g; ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
  const d = ctx.createRadialGradient(x, y - r * 0.2, 0, x, y, r); d.addColorStop(0, '#FFF4DC'); d.addColorStop(0.75, C.sun); d.addColorStop(1, '#F6CF8E');
  L.circle(ctx, x, y, r, { fill: d, alpha: a });
}
function puff(x, y, r, a) { if (a <= 0.005 || r <= 1) return; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(231,176,122,' + a + ')'); g.addColorStop(1, 'rgba(231,176,122,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
function motes(n, y0, y1, a, sx, sy, seed) { // dust hanging in the light, brighter near the sun
  ctx.save(); ctx.fillStyle = '#FBE3B0';
  for (let i = 0; i < n; i++) {
    const w = W * 1.1, h = y1 - y0;
    const x = ((R(i * 7.3 + seed) * w + t * (5 + 9 * R(i)) * U + NZ(i, t * 0.15) * 40 * U) % w + w) % w - W * 0.05;
    const y = y0 + ((R(i * 3.1 + seed) * h - t * (3 + 6 * R(i + 9)) * U) % h + h) % h;
    const near = cl(1 - Math.hypot(x - sx, y - sy) / (bh * 0.9));
    ctx.globalAlpha = a * (0.12 + 0.75 * near) * (0.55 + 0.45 * Math.sin(t * 1.7 + i));
    const s = (1.2 + 2.4 * R(i + 5)) * U; ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}
const KEY = [[0, 8], [0, 0], [8, 0], [8, 6], [4, 6], [4, 4], [6, 4], [6, 2], [2, 2], [2, 8]];
function meander(y, h, k, off) { // the Greek key, drawn outward from the centre
  const s = h / 8, uw = 10 * s, n = Math.ceil(W / uw) + 2, x0 = -uw + (((off % uw) + uw) % uw), pts = [];
  for (let i = 0; i < n; i++) for (const q of KEY) pts.push([x0 + i * uw + q[0] * s, y + q[1] * s]);
  const m = Math.floor(pts.length / 2), o = { color: C.terra, width: Math.max(1.4, s * 0.85), cap: 'butt' };
  L.line(ctx, pts.slice(m), k, o); L.line(ctx, pts.slice(0, m + 1).reverse(), k, o);
  [-2.4, 10.4].forEach((d) => { L.line(ctx, [[W / 2, y + d * s], [W, y + d * s]], k, { color: C.terra, width: s * 0.55 }); L.line(ctx, [[W / 2, y + d * s], [0, y + d * s]], k, { color: C.terra, width: s * 0.55 }); });
}
function helmetPath() { // unit Corinthian helmet facing right, centred on the skull; crest on a stilt
  ctx.moveTo(-0.46, 0.52); ctx.quadraticCurveTo(-0.6, 0.15, -0.55, -0.15); ctx.quadraticCurveTo(-0.5, -0.62, 0, -0.6); ctx.quadraticCurveTo(0.46, -0.58, 0.52, -0.16);
  poly([[0.55, -0.06], [0.56, 0.17], [0.48, 0.24], [0.48, 0.47], [0.36, 0.58], [0.1, 0.44], [-0.05, 0.32], [-0.2, 0.38]], true);
  poly([[-0.06, -0.58], [-0.06, -0.83], [0.08, -0.83], [0.08, -0.58]], true);
  ctx.moveTo(0.42, -0.78); ctx.quadraticCurveTo(-0.1, -1.55, -1.02, -0.42); ctx.quadraticCurveTo(-0.3, -0.92, 0.42, -0.78); ctx.closePath();
}
// a hoplite in profile: facing right in local units (height 1, feet at 0); face -1 mirrors
function hoplite(x, y, s, face, o) {
  const col = o.col || C.ink, sa = (o.sp == null ? 4 : o.sp) * PI / 180, lw = 1.4 * U / s;
  let f = face * (o.fl == null ? 1 : o.fl); f = Math.sign(f || 1) * Math.max(0.04, Math.abs(f));
  ctx.save(); ctx.translate(x, y); ctx.scale(f * s, s); ctx.globalAlpha *= o.a == null ? 1 : o.a;
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const w = o.walk == null ? 0 : Math.sin(o.walk) * 0.08, jb = o.jab || 0, dx = Math.cos(sa), dy = -Math.sin(sa), hx0 = 0.04 + jb, hy0 = -0.745;
  ctx.lineWidth = 0.017; ctx.beginPath(); ctx.moveTo(hx0 - dx * 0.42, hy0 - dy * 0.42); ctx.lineTo(hx0 + dx * 0.95, hy0 + dy * 0.95); ctx.stroke();
  ctx.lineWidth = 0.078; ctx.beginPath(); ctx.moveTo(0, -0.44); ctx.lineTo(0.08 + w * 0.5, -0.22); ctx.moveTo(0, -0.44); ctx.lineTo(-0.05 - w * 0.5, -0.22); ctx.stroke();
  ctx.lineWidth = 0.056; ctx.beginPath(); ctx.moveTo(0.08 + w * 0.5, -0.22); ctx.lineTo(0.15 + w, -0.01); ctx.lineTo(0.2 + w, 0); ctx.moveTo(-0.05 - w * 0.5, -0.22); ctx.lineTo(-0.13 - w, -0.01); ctx.lineTo(-0.08 - w, 0); ctx.stroke();
  ctx.beginPath(); poly([[-0.085, -0.48], [0.09, -0.48], [0.13, -0.36], [-0.12, -0.36]], true);
  ctx.moveTo(-0.07, -0.46); ctx.quadraticCurveTo(-0.13, -0.66, -0.06, -0.78); ctx.lineTo(0.06, -0.79); ctx.quadraticCurveTo(0.12, -0.62, 0.08, -0.46); ctx.closePath();
  ctx.save(); ctx.translate(0.015, -0.845); ctx.scale(0.13, 0.13); helmetPath(); ctx.restore();
  ctx.moveTo(0.31, -0.56); ctx.arc(0.11, -0.56, 0.2, 0, PI * 2); ctx.fill();
  if (o.detail !== false) { // incisions scratched through the black glaze
    ctx.strokeStyle = C.terra; ctx.lineWidth = lw; ctx.beginPath();
    ctx.moveTo(0.29, -0.56); ctx.arc(0.11, -0.56, 0.18, 0, PI * 2); ctx.moveTo(0.16, -0.56); ctx.arc(0.11, -0.56, 0.05, 0, PI * 2);
    ctx.moveTo(0.035, -0.857); ctx.lineTo(0.074, -0.855); ctx.moveTo(-0.055, -0.905); ctx.quadraticCurveTo(-0.03, -0.96, 0.035, -0.93);
    ctx.moveTo(-0.07, -0.45); ctx.lineTo(0.09, -0.45); ctx.stroke();
  }
  if (o.rim === 0) { ctx.restore(); return; }
  const la = f > 0 ? o.sun : PI - o.sun; // bronze rim light on the side facing the sun
  ctx.strokeStyle = C.bronze; ctx.lineWidth = lw * 2; ctx.globalAlpha *= o.rim == null ? 1 : o.rim;
  ctx.beginPath(); ctx.arc(0.11, -0.56, 0.2, la - 0.75, la + 0.75); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx0 + dx * 0.95, hy0 + dy * 0.95); ctx.lineTo(hx0 + dx * 1.04, hy0 + dy * 1.04); ctx.lineWidth = 0.022; ctx.stroke();
  ctx.restore();
}
function persian(x, y, s, f, run, col, a) { // soft hood, long tunic, wicker shield, short spear
  f = Math.sign(f || 1) * Math.max(0.04, Math.abs(f));
  ctx.save(); ctx.translate(x, y); ctx.scale(f * s, s); ctx.globalAlpha *= a;
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const ph = Math.sin(run) * 0.09; ctx.lineWidth = 0.058; ctx.beginPath();
  poly([[0, -0.4], [0.07 + ph * 0.5, -0.21], [0.14 + ph, 0]]); poly([[0, -0.4], [-0.05 - ph * 0.5, -0.2], [-0.13 - ph, -0.01]]); ctx.stroke();
  ctx.lineWidth = 0.015; ctx.beginPath(); ctx.moveTo(-0.16, -0.5); ctx.lineTo(0.62, -0.84); ctx.stroke();
  ctx.beginPath(); poly([[-0.065, -0.73], [0.06, -0.73], [0.1, -0.34], [-0.11, -0.34]], true);
  ctx.moveTo(0.06, -0.8); ctx.arc(0.01, -0.8, 0.05, 0, PI * 2);
  ctx.moveTo(-0.07, -0.72); ctx.quadraticCurveTo(-0.08, -0.87, -0.01, -0.885); ctx.quadraticCurveTo(0.06, -0.9, 0.1, -0.93); ctx.quadraticCurveTo(0.08, -0.86, 0.05, -0.84); ctx.lineTo(0.05, -0.74); ctx.closePath();
  ctx.moveTo(0.1, -0.3); ctx.lineTo(0.1, -0.66); ctx.quadraticCurveTo(0.145, -0.72, 0.19, -0.66); ctx.lineTo(0.19, -0.3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.terra; ctx.globalAlpha *= 0.4; ctx.lineWidth = 1.1 * U / s; ctx.beginPath(); ctx.moveTo(0.145, -0.68); ctx.lineTo(0.145, -0.32); ctx.moveTo(-0.08, -0.5); ctx.lineTo(0.07, -0.5); ctx.stroke(); ctx.restore();
}
function trireme(x, y, s, a) { // black-figure warship with sail, eye on the bow and sweeping oars
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= a; ctx.fillStyle = C.ink; ctx.strokeStyle = C.ink;
  ctx.beginPath(); ctx.moveTo(-0.44, 0); ctx.lineTo(-0.5, -0.05); ctx.quadraticCurveTo(-0.6, -0.16, -0.5, -0.27); ctx.quadraticCurveTo(-0.53, -0.12, -0.42, -0.085);
  [[0.42, -0.085], [0.47, -0.13], [0.465, -0.05], [0.6, -0.012], [0.44, 0]].forEach((q) => ctx.lineTo(q[0], q[1])); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-0.15, -0.46); ctx.lineTo(0.19, -0.46); ctx.quadraticCurveTo(0.22, -0.3, 0.17, -0.19); ctx.lineTo(-0.13, -0.19); ctx.quadraticCurveTo(-0.18, -0.3, -0.15, -0.46); ctx.fill();
  ctx.lineCap = 'round'; ctx.lineWidth = 0.012; ctx.beginPath(); ctx.moveTo(0.02, -0.08); ctx.lineTo(0.02, -0.52); ctx.moveTo(-0.18, -0.47); ctx.lineTo(0.22, -0.47);
  for (let i = 0; i < 12; i++) { const ox = -0.36 + i * 0.064, sw = Math.sin(t * 3.4 - i * 0.22) * 0.05; ctx.moveTo(ox, -0.03); ctx.lineTo(ox - 0.04 + sw, 0.1); }
  ctx.stroke(); ctx.strokeStyle = C.terra; ctx.lineWidth = 1.2 * U / s; ctx.beginPath(); ctx.moveTo(0.37, -0.055); ctx.arc(0.355, -0.055, 0.015, 0, PI * 2);
  for (let i = 1; i < 4; i++) { ctx.moveTo(-0.14 + i * 0.08, -0.44); ctx.lineTo(-0.13 + i * 0.08, -0.21); } ctx.stroke(); ctx.restore();
}

// ---------- shot 1: dawn over the pass, the host pours in ----------
function landscape() {
  const kc = sg(0.184, 0.222), dy = kc * bh * 1.3, push = sg(0, 0.2, E.inOutSine);
  const vx = W * (wide ? 0.6 : 0.76), hz = BY(0.62) + dy, bot = cB + dy, sB = W * (wide ? 0.0 : -0.15), fB = W * (wide ? 0.84 : 1.0), ext = (bx) => vx + (bx - vx) * (bot + H - hz) / (bot - hz);
  const sk = [mix('#7A3416', C.terra, kc), mix('#C8692B', C.terra, kc), mix('#F3BE78', C.terra, kc)];
  const g = ctx.createLinearGradient(0, BY(0) + dy * 0.3, 0, hz); g.addColorStop(0, sk[0]); g.addColorStop(0.55, sk[1]); g.addColorStop(1, sk[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sx = vx - W * 0.01, sy = hz - bh * (0.01 + 0.08 * push);
  sun(sx, sy, bh * 0.07, 1 - kc);
  const layer = (k, fn) => { ctx.save(); const z = 1 + k * push * 0.07; ctx.translate(vx, hz); ctx.scale(z, z); ctx.translate(-vx, -hz); fn(); ctx.restore(); };
  const ridge = (x0, amp, sd, fr) => { const pts = []; for (let i = 0; i <= 72; i++) { const x = lerp(x0, W * 1.15, i / 72), f = (x - x0) / (W * 1.15 - x0), env = 1 - Math.pow(1 - Math.min(1, f * 1.5), 2.4); pts.push([x, hz - bh * amp * env * (0.62 + 0.38 * (1 - Math.abs(NZ(x / W * fr, sd)))) - bh * 0.02 * NZ(x / W * fr * 4, sd + 2)]); } return pts; };
  layer(0.15, () => { // far shore across the gulf, far range in haze
    ctx.fillStyle = mix(sk[2], C.ink, 0.28); ctx.beginPath(); ctx.moveTo(-W * 0.1, hz);
    for (let i = 0; i <= 30; i++) { const x = lerp(-W * 0.1, vx - W * 0.03, i / 30); ctx.lineTo(x, hz - bh * (0.02 + 0.022 * (1 + NZ(i * 0.3, 4)))); }
    ctx.lineTo(vx, hz); ctx.fill();
    ctx.fillStyle = mix(sk[1], sk[2], 0.15); ctx.globalAlpha = 0.9; ctx.beginPath(); poly([[vx - W * 0.01, hz]].concat(ridge(vx - W * 0.01, 0.42, 1, 7), [[W * 1.15, hz]]), true); ctx.fill(); ctx.globalAlpha = 1;
  });
  layer(0.35, () => { // sea with the sun's road on it, and the mid range
    const sea = ctx.createLinearGradient(0, hz, 0, bot); sea.addColorStop(0, mix(sk[2], sk[1], 0.3)); sea.addColorStop(1, mix(sk[1], C.ink, 0.5));
    ctx.fillStyle = sea; ctx.beginPath(); poly([[-W * 3, hz], [vx, hz], [ext(sB), bot + H], [-W * 3, bot + H]], true); ctx.fill();
    ctx.fillStyle = C.sun; ctx.beginPath();
    for (let i = 0; i < 70; i++) { const d = R(i * 5.1), y = hz + 2 * U + d * d * (bot - hz) * 0.9, spr = (8 + (y - hz) * 0.6) * U * (R(i) - 0.5), len = (6 + (y - hz) * 0.22) * (0.4 + 0.6 * (0.5 + 0.5 * NZ(i, t * 1.4)));
      if (sx + spr < lerp(vx, sB, (y - hz) / (bot - hz)) - len) ctx.rect(sx + spr - len / 2, y, len, Math.max(1, 1.6 * U)); }
    ctx.globalAlpha = 0.85 * (1 - kc); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = mix(sk[1], C.ink, 0.45); ctx.beginPath(); poly([[vx + W * 0.004, hz]].concat(ridge(vx + W * 0.004, 0.6, 3, 9), [[W * 1.15, hz]]), true); ctx.fill();
  });
  layer(0.7, () => { // the coastal plain narrowing to the gap; the host marches into it
    const pg = ctx.createLinearGradient(0, hz, 0, bot); pg.addColorStop(0, mix(sk[2], C.terra, 0.3)); pg.addColorStop(0.5, C.terra); pg.addColorStop(1, mix(C.terra, C.ink, 0.35));
    ctx.fillStyle = pg; ctx.beginPath(); poly([[vx - W * 0.004, hz], [vx + W * 0.006, hz], [ext(fB), bot + H], [ext(sB), bot + H]], true); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.18; ctx.lineWidth = 1.2 * U; ctx.beginPath();
    for (let i = 1; i < 9; i++) { const y = hz + (bot - hz) * Math.pow(i / 9, 2.2); ctx.moveTo(lerp(vx, sB, (y - hz) / (bot - hz)), y); ctx.lineTo(lerp(vx, fB, (y - hz) / (bot - hz)), y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    const kH = sg(0.07, 0.17, E.inOut), ph = (t * 0.45) % 1, zF = 0.8 * Math.pow(1.13, 34 * kH);
    if (kH > 0) {
      const tips = [];
      ctx.fillStyle = C.ink; ctx.strokeStyle = C.ink;
      for (let i = 33; i >= 0; i--) {
        const z = 0.8 * Math.pow(1.13, i + ph); if (z > zF) continue;
        const y = hz + (bot - hz) / z, fy = (y - hz) / (bot - hz), xl = lerp(vx, sB, fy), xr = lerp(vx, fB, fy), h = bh * 0.09 / z, n = 40;
        ctx.beginPath(); const sp3 = [];
        for (let j = 0; j < n; j++) {
          const x = lerp(xl, xr, (j + 0.5 + (R(i * 13 + j) - 0.5) * 0.8) / n), yb = y - Math.abs(Math.sin(t * 6 + j * 1.7 + i)) * h * 0.05;
          ctx.moveTo(x - h * 0.08, yb); ctx.lineTo(x - h * 0.05, yb - h * 0.6); ctx.lineTo(x + h * 0.05, yb - h * 0.6); ctx.lineTo(x + h * 0.08, yb); ctx.closePath();
          ctx.moveTo(x + h * 0.075, yb - h * 0.7); ctx.arc(x, yb - h * 0.7, h * 0.075, 0, PI * 2);
          sp3.push(x + h * 0.07, yb - h * 0.3, x + h * 0.1 + (R(j + i) - 0.5) * h * 0.1, yb - h * 1.5);
          if (R(i * 7 + j * 3) > 0.45) tips.push(x + h * 0.09, yb - h * 1.56, Math.max(1.4, h * 0.035), Math.max(2.4, h * 0.1));
        }
        ctx.fill(); ctx.lineWidth = Math.max(1, h * 0.022); ctx.beginPath(); for (let q = 0; q < sp3.length; q += 4) { ctx.moveTo(sp3[q], sp3[q + 1]); ctx.lineTo(sp3[q + 2], sp3[q + 3]); } ctx.stroke();
      }
      ctx.fillStyle = C.bronze; ctx.globalAlpha = 0.8 + 0.2 * Math.sin(t * 3); ctx.beginPath(); for (let i = 0; i < tips.length; i += 4) ctx.rect(tips[i], tips[i + 1], tips[i + 2], tips[i + 3]); ctx.fill(); ctx.globalAlpha = 1;
    }
    const hg = ctx.createLinearGradient(0, hz - 2, 0, hz + (bot - hz) * 0.35); hg.addColorStop(0, mix(sk[2], C.sun, 0.2)); hg.addColorStop(1, 'rgba(243,190,120,0)');
    ctx.globalAlpha = 0.8; ctx.fillStyle = hg; ctx.fillRect(0, hz - 2, W, (bot - hz) * 0.35); ctx.globalAlpha = 1;
  });
  layer(1.2, () => { // the near mountain wall: black glaze, incised strata, bronze edge in the dawn light
    const top = ridge(vx + W * 0.008, 1.0, 7, 5), face = [[vx + W * 0.008, hz], [ext(fB), bot + H], [W * 3, bot + H]].concat(top.slice().reverse());
    ctx.fillStyle = C.ink; ctx.beginPath(); poly(face, true); ctx.fill();
    L.mask(ctx, (c) => poly(face, true), () => {
      ctx.strokeStyle = C.terra; ctx.lineWidth = 1.4 * U; ctx.globalAlpha = 0.5; ctx.beginPath();
      [0.05, 0.11, 0.19, 0.3, 0.44].forEach((d, k) => top.forEach((q, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, q[0] + d * bh * 0.25, q[1] + d * bh + Math.sin(i * 0.7 + k * 2) * 5 * U)));
      ctx.stroke(); ctx.globalAlpha = 1;
    });
    L.line(ctx, top.filter((q) => q[0] < W * 0.92), 1, { color: C.bronze, width: 2.4 * U, alpha: 0.85 * (1 - kc) });
  });
  motes(50, BY(0.05) + dy, hz, 1 - kc, sx, sy, 1);
}

// ---------- the map (day: black-figure; night: red-figure) ----------
const mH = wide ? H : W * 0.92, mY0 = (H - mH) / 2, MX = (x) => x * W, MY = (y) => mY0 + y * mH;
const coast = (x) => 0.44 + 0.07 * Math.exp(-((x - 0.57) ** 2) / 0.005) + 0.012 * Math.sin(x * 11);
const foot = (x) => 0.71 - 0.1 * Math.exp(-((x - 0.585) ** 2) / 0.004) + 0.012 * Math.sin(x * 15 + 2);
const mid = (x) => (coast(x) + foot(x)) / 2, WALL = 0.578, PXm = 0.564, PX = MX(PXm), PY = MY(mid(PXm)), PR = 9 * U;
const ANO = [[0.3, 0], [0.33, 0.67], [0.37, 0.73], [0.42, 0.77], [0.47, 0.8], [0.52, 0.78], [0.57, 0.82], [0.63, 0.81], [0.68, 0.76], [0.72, 0.7], [0.75, 0]].map((q) => [q[0], q[1] || mid(q[0])]);
function anoPts() { // Catmull-Rom through the Anopaea waypoints, with a switchback wiggle
  const out = [];
  for (let i = 0; i < ANO.length - 1; i++) for (let k = 0; k < 10; k++) {
    const a = ANO[Math.max(0, i - 1)], b = ANO[i], c = ANO[i + 1], d = ANO[Math.min(ANO.length - 1, i + 2)], s = k / 10, s2 = s * s, s3 = s2 * s;
    const f = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * s + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * s2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * s3);
    out.push([MX(f(0)), MY(f(1) + 0.008 * Math.sin((i * 10 + k) * 0.9))]);
  }
  out.push([MX(ANO[ANO.length - 1][0]), MY(ANO[ANO.length - 1][1])]);
  return out;
}
function drawMap(nt, kd) {
  const gnd = mix(C.terra, '#130C09', nt), dark = mix(C.ink, '#0B0705', nt), ln = mix(C.ink, C.terra, nt), xs = [];
  for (let i = 0; i <= 64; i++) xs.push(i / 64 * 1.3 - 0.15);
  ctx.globalAlpha = cl(kd * 5); ctx.fillStyle = gnd; ctx.fillRect(-W, -H, W * 3, H * 3); ctx.globalAlpha = 1;
  const cpts = xs.map((x) => [MX(x), MY(coast(x))]);
  ctx.globalAlpha = L.seg(kd, 0.12, 0.4); ctx.fillStyle = mix(C.ink, '#1D120E', nt); ctx.beginPath(); poly([[MX(-0.15), -H * 2]].concat(cpts, [[MX(1.15), -H * 2]]), true); ctx.fill();
  ctx.strokeStyle = C.terra; ctx.lineWidth = 1.5 * U; ctx.setLineDash([14 * U, 10 * U]); ctx.lineDashOffset = -t * 14 * U; ctx.globalAlpha *= 0.7;
  [0.016, 0.036, 0.062].forEach((d) => { ctx.beginPath(); poly(xs.map((x) => [MX(x), MY(coast(x) - d)])); ctx.stroke(); });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  L.line(ctx, cpts, L.seg(kd, 0, 0.35), { color: nt > 0.5 ? C.terra : C.ink, width: 2.4 * U });
  // mountains: black mass with antique-map peaks incised in rows
  const fpts = xs.map((x) => [MX(x), MY(foot(x))]);
  ctx.globalAlpha = L.seg(kd, 0.15, 0.4); ctx.fillStyle = dark; ctx.beginPath(); poly(fpts.concat([[MX(1.15), H * 3], [MX(-0.15), H * 3]]), true); ctx.fill(); ctx.globalAlpha = 1;
  const rows = Math.ceil(((H - mY0) / mH - 0.6) / 0.075) + 1;
  for (let r = rows; r >= 0; r--) for (let j = -1; j < 19; j++) {
    const x = (j + (r % 2) * 0.5) / 17 + (R(j * 7 + r * 13) - 0.5) * 0.014, b = foot(x) + 0.04 + r * 0.075;
    const kk = E.outBack(L.seg(kd, 0.18 + 0.35 * cl(x), 0.38 + 0.35 * cl(x))), h = (0.07 + 0.04 * R(j + r * 29)) * kk, w = 0.04 + 0.012 * R(j * 3 + r);
    if (kk <= 0.002) continue;
    const pk = [[MX(x - w), MY(b)], [MX(x - w * 0.15), MY(b - h)], [MX(x + w * 0.1), MY(b - h * 0.97)], [MX(x + w), MY(b)]];
    ctx.fillStyle = dark; ctx.beginPath(); poly(pk); ctx.fill();
    ctx.strokeStyle = C.terra; ctx.lineWidth = 1.3 * U; ctx.globalAlpha = r ? 0.5 : 1; ctx.beginPath(); poly(pk);
    for (let q = 1; q < 3; q++) { ctx.moveTo(MX(x + w * 0.1 + q * w * 0.24), MY(b - h * (0.97 - q * 0.3))); ctx.lineTo(MX(x + w * 0.1 + q * w * 0.14), MY(b)); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // the road through the pass
  ctx.setLineDash([10 * U, 9 * U]); L.line(ctx, xs.map((x) => [MX(x), MY(mid(x) + 0.006 * Math.sin(x * 20))]), L.seg(kd, 0.45, 0.8), { color: ln, width: 2 * U, alpha: 0.75 }); ctx.setLineDash([]);
  // hot springs: pools and rising steam
  const ks = L.seg(kd, 0.6, 0.9);
  if (ks > 0) {
    ctx.strokeStyle = ln; ctx.lineWidth = 1.6 * U; ctx.globalAlpha = ks; ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const x = MX(0.598 + i * 0.016), y = MY(foot(0.598 + i * 0.016) - 0.022 - (i % 2) * 0.014);
      ctx.moveTo(x + 10 * U, y); ctx.ellipse(x, y, 10 * U, 4 * U, 0, 0, PI * 2);
      for (let q = 0; q < 2; q++) { const ph = (t * 0.45 + q * 0.5 + i * 0.3) % 1, yy = y - 8 * U - ph * 40 * U; ctx.moveTo(x, yy); ctx.quadraticCurveTo(x + 9 * U * Math.sin(ph * 6 + i), yy - 10 * U, x, yy - 20 * U); }
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  // the Persian host on the western road (campfires at night)
  const kp = L.seg(kd, 0.55, 1);
  if (kp > 0) {
    ctx.fillStyle = nt > 0.5 ? C.terra : C.ink; ctx.beginPath();
    for (let i = 0; i < 460; i++) {
      const x = 0.0 + Math.sqrt(R(i * 3.3)) * (0.33 + 0.1 * kp) + 0.004 * Math.sin(t * 1.5 + i), yy = lerp(coast(x) + 0.02, foot(x) - 0.018, R(i * 5.7));
      if (R(i * 9.1) < kp) ctx.rect(MX(x), MY(yy), 3.2 * U, 3.2 * U);
    }
    ctx.globalAlpha = nt > 0.5 ? 0.55 : 1; ctx.fill(); ctx.globalAlpha = 1;
  }
  // the Phocian wall and the Greek shields in front of it
  const kw = E.outBack(L.seg(kd, 0.55, 0.8));
  if (kw > 0.002) {
    const y0 = MY(coast(WALL)) - 6 * U, y1 = MY(foot(WALL)) + 6 * U, x = MX(WALL);
    ctx.fillStyle = dark; ctx.fillRect(x - 6 * U, lerp((y0 + y1) / 2, y0, kw), 12 * U, (y1 - y0) * kw);
    ctx.strokeStyle = C.terra; ctx.lineWidth = 1.2 * U; ctx.strokeRect(x - 6 * U, lerp((y0 + y1) / 2, y0, kw), 12 * U, (y1 - y0) * kw);
  }
  const kg = L.seg(kd, 0.7, 0.92);
  for (let i = 0; i < 5; i++) {
    const a = E.outBack(L.seg(kg, i * 0.12, 0.5 + i * 0.12)); if (a <= 0.002) continue;
    const y = PY + (i - 2) * PR * 2.3;
    L.circle(ctx, PX, y, PR * a, { fill: C.ink }); L.ring(ctx, PX, y, PR * a * 0.98, 1, { color: i === 2 ? C.bronze : C.terra, width: 1.6 * U });
  }
}
// screen transform for the map: zoom z around the portal shield, drifting it to frame centre
function mapXf(z, km) { const sx = lerp(PX, W / 2, km), sy = lerp(PY, H / 2, km); return { sx, sy, z, apply: () => { ctx.translate(sx, sy); ctx.scale(z, z); ctx.translate(-PX, -PY); }, at: (x, y) => [sx + (x - PX) * z, sy + (y - PY) * z] }; }

// ---------- the frieze: side view of the pass ----------
const WV = [0.318, 0.343, 0.388, 0.41, 0.433];
const recoil = () => { let r = 0; for (const c of WV) { const u = (p - c) / 0.022; if (u > 0 && u < 4) r += Math.exp(-u * 3) * Math.sin(u * 9); } return r * fs * 0.05; };
const shake = () => { let r = 0; for (const c of WV) { const u = (p - c) / 0.022; if (u > 0 && u < 1.2) r += Math.exp(-u * 5) * Math.sin(u * 55); } return r * 5 * U; };
const press = () => { let r = 0; for (const c of WV) { const u = (p - c) / 0.022; r += cl(1 - Math.abs(u - 0.15) / 0.6); } return cl(r); };
function frieze() {
  const sp2 = sunPos(), sx = sp2[0], sy = sp2[1], s2 = skyC(tod, 2), s1 = skyC(tod, 1);
  const g = ctx.createLinearGradient(0, BY(0), 0, hzF); g.addColorStop(0, skyC(tod, 0)); g.addColorStop(0.6, s1); g.addColorStop(1, s2);
  ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, hzF + H + 2);
  const night = cl((tod % 4) - 2.2) * cl(4 - (tod % 4)) * 1.2, lit = cl(1 - night * 1.5);
  sun(sx, sy, bh * (p > 0.8 ? lerp(0.07, 0.1, sg(0.8, 0.95)) : 0.07), lit);
  ctx.fillStyle = mix(s2, C.ink, 0.3); ctx.beginPath(); ctx.moveTo(-W * 0.1, hzF);
  for (let i = 0; i <= 40; i++) { const x = lerp(-W * 0.1, W * 1.1, i / 40); ctx.lineTo(x, hzF - bh * (0.016 + 0.024 * (1 + NZ(i * 0.25, 5))) * (x < W * 0.5 ? 1 : 0.4)); }
  ctx.lineTo(W * 1.1, hzF); ctx.fill();
  // a bright strip of sea, then the lit plain the figures stand out against
  const sea = ctx.createLinearGradient(0, hzF, 0, BY(0.665)); sea.addColorStop(0, mix(s2, C.sun, 0.25 * lit)); sea.addColorStop(1, mix(s2, s1, 0.6));
  ctx.fillStyle = sea; ctx.fillRect(-W, hzF, W * 3, BY(0.67) - hzF);
  ctx.fillStyle = C.sun; ctx.globalAlpha = 0.8 * lit * cl((hzF - sy) / (bh * 0.05) + 1); ctx.beginPath();
  for (let i = 0; i < 46; i++) { const y = hzF + 2 * U + R(i * 5.1) * bh * 0.09, len = (10 + R(i) * 34) * U * (0.5 + 0.5 * NZ(i, t * 1.3)); ctx.rect(sx + (R(i * 2.3) - 0.5) * (40 + (y - hzF) * 3) * U - len / 2, y, len, 1.6 * U); }
  ctx.fill(); ctx.globalAlpha = 1;
  const pl = ctx.createLinearGradient(0, BY(0.66), 0, gy); pl.addColorStop(0, mix(s1, s2, 0.35)); pl.addColorStop(1, mix(s1, C.ink, 0.12));
  ctx.fillStyle = pl; ctx.beginPath(); ctx.moveTo(-W, BY(0.67)); for (let i = 0; i <= 24; i++) ctx.lineTo(i / 24 * W, BY(0.664 + 0.008 * NZ(i * 0.4, 2))); ctx.lineTo(W * 2, BY(0.67)); ctx.lineTo(W * 2, H * 2); ctx.lineTo(-W, H * 2); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.12; ctx.lineWidth = 1.2 * U; ctx.beginPath();
  for (let i = 1; i < 6; i++) { const y = lerp(BY(0.67), gy, Math.pow(i / 6, 1.6)); ctx.moveTo(-W, y); ctx.lineTo(W * 2, y); }
  ctx.stroke(); ctx.globalAlpha = 1;
  // the Phocian wall behind the line
  const wx = W * 0.86, wtop = gy - fs * 0.5, wa = 1 - sg(0.76, 0.8); ctx.globalAlpha = wa; ctx.fillStyle = mix(s1, C.ink, 0.72); ctx.beginPath();
  poly([[wx, gy], [wx, wtop + fs * 0.06], [wx + fs * 0.08, wtop]]); for (let i = 0; i < 12; i++) { const x = wx + fs * (0.08 + i * 0.16); ctx.lineTo(x, wtop + (i % 2) * fs * 0.03); ctx.lineTo(x + fs * 0.16, wtop + (i % 2) * fs * 0.03); }
  ctx.lineTo(W * 1.2, gy); ctx.fill();
  ctx.strokeStyle = C.terra; ctx.globalAlpha = 0.4 * wa; ctx.lineWidth = 1.2 * U; ctx.beginPath();
  for (let r = 1; r < 4; r++) for (let i = 0; i < 14; i++) { const y = wtop + r * fs * 0.12, x = wx + fs * (i * 0.18 + (r % 2) * 0.09); ctx.moveTo(x, y); ctx.lineTo(x + fs * 0.15, y); }
  ctx.stroke(); ctx.globalAlpha = 1;
  // ground band (the exergue) and the hill of Kolonos rising out of it
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(-W, gy);
  for (let i = 0; i <= 60; i++) { const x = lerp(hx - hw, hx + hw, i / 60); ctx.lineTo(x, gy - hill(x)); }
  ctx.lineTo(W * 2, gy); ctx.lineTo(W * 2, H * 2); ctx.lineTo(-W, H * 2); ctx.fill();
  ctx.strokeStyle = C.terra; ctx.lineWidth = 1.4 * U; ctx.beginPath(); ctx.moveTo(-W, gy + 10 * U); ctx.lineTo(W * 2, gy + 10 * U);
  if (hH > 2) for (let k = 1; k < 4; k++) for (let i = 0; i <= 40; i++) { const x = lerp(hx - hw * (1 - k * 0.2), hx + hw * (1 - k * 0.2), i / 40); (i ? ctx.lineTo : ctx.moveTo).call(ctx, x, gy - hill(x) + k * hH * 0.22); }
  ctx.stroke();
  if (hH > 2) L.line(ctx, Array.from({ length: 41 }, (_, i) => { const x = lerp(hx - hw, hx + hw, i / 40); return [x, gy - hill(x)]; }), 1, { color: C.bronze, width: 2 * U, alpha: 0.5 });
  // attacking waves on days one and two: surge, break on the spears, fall back
  const clashX = gx0 - fs * 0.6;
  WV.forEach((c, w) => {
    const u = (p - c) / 0.022; if (u < -1 || u > 1.7) return;
    const fx = u < 0 ? lerp(-W * 0.12, clashX, E.in(u + 1)) : u < 0.3 ? clashX + Math.sin(u * 25) * fs * 0.02 : lerp(clashX, -W * 0.45, E.inOut(cl((u - 0.3) / 1.4)));
    const fl = Math.cos(PI * cl((u - 0.3) / 0.2)), cmp = u > -0.25 && u < 0.7 ? 0.3 : 0;
    for (let r = 2; r >= 0; r--) for (let c2 = 4; c2 >= 0; c2--) {
      const j = c2 * 3 + r, x = fx - c2 * fs * 0.36 * (1 - cmp) - r * fs * 0.1 - R(j + w * 17) * fs * 0.12;
      persian(x, gy - r * fs * 0.065, fs * [0.95, 0.88, 0.8][r], fl, t * 11 + j * 1.3, ['#140C07', '#24130B', '#33190E'][r], 1);
    }
    if (u > 0) { // dust thrown up where the wave breaks
      const k = cl(u / 1.6);
      for (let i = 0; i < 8; i++) { const a = -PI / 2 + (R(i + w * 7) - 0.5) * 2.6, d = fs * 0.8 * E.out(k) * (0.3 + 0.7 * R(i * 3 + w)); puff(clashX + fs * 0.2 + Math.cos(a) * d, gy - fs * 0.2 + Math.sin(a) * d * 0.5, fs * (0.12 + 0.24 * E.out(k)) * (0.6 + R(i * 5 + w)), 0.45 * (1 - k)); }
    }
  });
  // Kolonos: the enemy closes from both sides, arrows fall, dust swallows the hilltop
  const kT = sg(0.712, 0.775, E.inOut), aT = 1 - sg(0.772, 0.795);
  if (kT > 0 && aT > 0) for (let side = -1; side <= 1; side += 2) for (let r = 1; r >= 0; r--) for (let i = 9; i >= 0; i--) {
    const front = lerp(side < 0 ? -W * 0.1 : W * 1.1, hx + side * hw * 0.6, kT) + Math.sin(t * 5 + i + side) * fs * 0.025;
    const x = front - side * (i * fs * 0.26 + r * fs * 0.13), y = gy - hill(x) * 0.85 - r * fs * 0.05;
    persian(x, y, fs * (r ? 0.74 : 0.8), -side, t * 9 + i, r ? '#2A160C' : C.ink, aT);
  }
  greeks(sx, sy);
  const kA = sg(0.718, 0.735) * (1 - sg(0.77, 0.785));
  if (kA > 0) {
    ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = 1.8 * U; ctx.globalAlpha = kA; ctx.beginPath(); const hd = [];
    for (let i = 0; i < 56; i++) { const ph = (t * 0.7 + R(i)) % 1, a = 0.62 + R(i * 3) * 0.14 + ph * 0.12, x = lerp(-W * 0.25, W * 0.75, R(i * 7)) + Math.cos(a) * ph * W * 0.5, y = BY(-0.12) + Math.sin(a) * ph * W * 0.5, l = fs * 0.15, c = Math.cos(a), sn = Math.sin(a);
      ctx.moveTo(x, y); ctx.lineTo(x - c * l, y - sn * l); ctx.moveTo(x - c * l, y - sn * l); ctx.lineTo(x - c * l * 0.85 - sn * 5 * U, y - sn * l * 0.85 + c * 5 * U); hd.push(x, y, c, sn); }
    ctx.stroke(); ctx.beginPath(); for (let i = 0; i < hd.length; i += 4) { const x = hd[i], y = hd[i + 1], c = hd[i + 2], sn = hd[i + 3]; ctx.moveTo(x + c * 7 * U, y + sn * 7 * U); ctx.lineTo(x - sn * 3 * U, y + c * 3 * U); ctx.lineTo(x + sn * 3 * U, y - c * 3 * U); ctx.closePath(); }
    ctx.fill(); ctx.globalAlpha = 1;
  }
  const kD = sg(0.755, 0.79) * (1 - sg(0.8, 0.84));
  if (kD > 0) for (let i = 0; i < 14; i++) { const a = R(i * 3) * PI * 2, d = fs * 0.8 * R(i * 7) * (0.5 + 0.5 * kD); puff(hx + Math.cos(a) * d * 1.5, gy - hH - fs * 0.4 + Math.sin(a) * d * 0.5 - t * 4 * U, fs * (0.4 + 0.42 * R(i)) * (0.4 + 0.7 * kD), 0.8 * kD); }
  // after: a helmet on a planted spear, a shield against it; the fleet on the gulf
  const kM = sg(0.785, 0.81);
  if (kM > 0) memorial(hx + fs * 0.04, gy - hH, fs, kM);
  const kS = sg(0.78, 0.8) * (1 - sg(0.92, 0.96));
  if (kS > 0) for (let i = 0; i < 3; i++) trireme(W * (-0.12 + 0.13 * i) + W * 0.4 * sg(0.76, 1, E.linear), hzF + bh * (0.035 + 0.02 * i), bh * (0.12 + 0.025 * i), kS);
  motes(60, BY(0.02), gy, 0.8, sx, sy, 3);
}
function greeks(sx, sy) {
  const rec = recoil(), pr = press(), kGrp = sg(0.636, 0.662), kRing = sg(0.698, 0.736), aG = 1 - sg(0.774, 0.795);
  if (aG <= 0) return;
  for (let f = 2; f >= 0; f--) {
    const sc = [1, 0.9, 0.81][f], col = [C.ink, '#1F110A', '#2B170D'][f];
    for (let i = 13; i >= 0; i--) {
      let x = gx0 + i * sp * sc + f * fs * 0.24 + rec * (i < 4 ? 1 : 0.5), y = gy - f * fs * 0.075, fl = 1, walk = null, face = -1;
      let spA = p > 0.55 ? 72 : i < 3 ? 4 : 10 + Math.min(1, (i - 2) / 3) * 58, jab = i < 3 && p < 0.45 ? pr * 0.07 * Math.max(0, Math.sin(t * 10 + i * 1.7)) : 0;
      if (f > 0) { // most of the army leaves on day three
        const ts = 0.584 + (13 - i) * 0.0006 + R(i + f * 31) * 0.006 + (2 - f) * 0.003, kt = sg(ts, ts + 0.006), kw = sg(ts + 0.004, ts + 0.052, E.in);
        if (kw >= 1) continue;
        fl = Math.cos(PI * kt); x += kw * W * 0.8; if (kt > 0) walk = t * 9 + i;
      } else {
        const cg = i < 3 ? 0 : i < 10 ? 1 : 2; x = lerp(x, GS + i * sp + cg * GAP, kGrp);
        const back = i % 2, rx = hx + ((i - 6.5) / 13) * hw * 0.85;
        x = lerp(x, rx, kRing); y = lerp(y, gy - hill(rx) - back * fs * 0.05, kRing);
        if (i >= 7) fl = Math.cos(PI * sg(0.706 + i * 0.001, 0.716 + i * 0.001));
        spA = lerp(spA, 8, kRing);
        hoplite(x, y + (R(i * 3) - 0.5) * fs * 0.012, fs * (1 - back * 0.08 * kRing) * (1 + (R(i * 7) - 0.5) * 0.05), face, { sp: spA, fl, walk, jab, sun: Math.atan2(sy - (y - fs * 0.56), sx - x), a: aG, col: back && kRing > 0.5 ? '#1F110A' : col });
        continue;
      }
      hoplite(x, y + (R(i * 3 + f) - 0.5) * fs * 0.012, fs * sc * (1 + (R(i * 7 + f) - 0.5) * 0.05), face, { col, sp: spA, fl, walk, sun: Math.atan2(sy - (y - fs * 0.5), sx - x), detail: f < 2, rim: f === 2 ? 0 : f ? 0.6 : 1 });
    }
  }
}
function memorial(x, y, s, a) { // the helmet rests on a planted spear, a shield leans at its foot
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = C.ink; ctx.strokeStyle = C.ink; ctx.lineCap = 'round';
  const tx = x + s * 0.05, ty = y - s * 0.86, hs = s * 0.26;
  ctx.lineWidth = s * 0.024; ctx.beginPath(); ctx.moveTo(x, y + s * 0.02); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.save(); ctx.translate(x - s * 0.2, y - s * 0.2); ctx.rotate(-0.24); ctx.beginPath(); ctx.ellipse(0, 0, s * 0.19, s * 0.215, 0, 0, PI * 2); ctx.fill();
  ctx.strokeStyle = C.terra; ctx.lineWidth = 1.4 * U; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.165, s * 0.19, 0, 0, PI * 2); ctx.stroke();
  ctx.strokeStyle = C.bronze; ctx.lineWidth = 2.6 * U; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.19, s * 0.215, 0, -2.6, -0.4); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(tx, ty); ctx.scale(-hs, hs); ctx.beginPath(); helmetPath(); ctx.fill();
  ctx.fillStyle = '#F8DDA6'; ctx.beginPath(); ctx.moveTo(0.16, -0.1); ctx.quadraticCurveTo(0.3, -0.18, 0.45, -0.11); ctx.lineTo(0.45, -0.06); ctx.quadraticCurveTo(0.3, -0.02, 0.16, -0.1); ctx.rect(0.41, -0.09, 0.026, 0.43); ctx.fill();
  ctx.strokeStyle = C.bronze; ctx.globalAlpha *= 0.85; ctx.lineWidth = 2.2 * U / hs; ctx.beginPath(); helmetPath(); ctx.stroke();
  const qd = (a, c, b, k) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * c + k * k * b;
  ctx.strokeStyle = C.terra; ctx.lineWidth = 1.4 * U / hs; ctx.beginPath();
  for (let i = 0; i < 9; i++) { const k = 0.12 + i * 0.09, ox = qd(0.42, -0.1, -1.02, k), oy = qd(-0.78, -1.55, -0.42, k), ix = qd(0.42, -0.3, -1.02, k), iy = qd(-0.78, -0.92, -0.42, k); ctx.moveTo(lerp(ix, ox, 0.2), lerp(iy, oy, 0.2)); ctx.lineTo(lerp(ix, ox, 0.8), lerp(iy, oy, 0.8)); }
  ctx.stroke();
  ctx.restore(); ctx.restore();
}

// ---------- compose ----------
const kz1 = sg(0.288, 0.322, E.in), kz2 = 1 - sg(0.442, 0.476, E.out), kz3 = sg(0.538, 0.572, E.in);
const inMap = p >= 0.19 && p < 0.323 ? 0 : p >= 0.44 && p < 0.573 ? 1 : -1;
const fz = L.keys(p, [[0.3, 1.0], [0.44, 1.05], [0.55, 1.0], [0.69, 1.03], [0.785, 1.08], [0.86, 1.12], [0.97, 1.62], [1, 1.66]]);
const fc = L.keys(p, [[0.3, [gx0 - fs * 0.3, gy - fs * 0.6]], [0.56, [gx0 + fs * 0.6, gy - fs * 0.6]], [0.7, [hx, gy - fs * 0.7]], [0.86, [HMX, HMY]]]);
const drawFrieze = () => { const k = shake(); L.camera(ctx, { zoom: fz, cx: fc[0], cy: fc[1], x: k, y: k * 0.6 }, frieze); };
if (p < 0.222) landscape();
if (inMap >= 0) {
  const kz = inMap === 0 ? kz1 : Math.max(kz2, kz3), z = (1 + 0.025 * (inMap === 0 ? sg(0.21, 0.29) : sg(0.47, 0.54))) * Math.exp(Math.log(3.2) * E.inOut(kz));
  const X = mapXf(z, E.inOut(kz)), rr = PR * z * Math.exp(Math.log(42) * E.inOut(kz)), diag = Math.hypot(W, H) / 2 + 20 * U;
  if (rr < diag) { ctx.save(); X.apply(); drawMap(inMap, inMap === 0 ? sg(0.196, 0.262, E.linear) : 1); if (inMap === 1) torches(sg(0.468, 0.535, E.inOut)); ctx.restore(); }
  if (kz > 0.002 && rr > 6 * U) {
    const Q = [gx0 - fs * 0.3, gy - fs * 0.55], m = lerp(0.45, 1, kz), A = [lerp(X.sx, Q[0], E.out(kz)), lerp(X.sy, Q[1], E.out(kz))];
    const fn = () => { ctx.translate(A[0], A[1]); ctx.scale(m, m); ctx.translate(-Q[0], -Q[1]); drawFrieze(); };
    if (rr >= diag) { ctx.save(); fn(); ctx.restore(); } else L.mask(ctx, (c) => c.arc(X.sx, X.sy, rr, 0, PI * 2), fn);
    if (rr < diag) { L.ring(ctx, X.sx, X.sy, rr, 1, { color: C.ink, width: Math.min(rr * 0.12, 70 * U) }); L.ring(ctx, X.sx, X.sy, rr * 1.0, 1, { color: C.bronze, width: Math.min(rr * 0.035, 16 * U) }); }
  }
  mapText(inMap, X);
} else if (p >= 0.3) drawFrieze();
function torches(k) {
  const pts = anoPts(), lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = lens[lens.length - 1], head = tot * k, at = (d) => { let i = 1; while (i < lens.length - 1 && lens[i] < d) i++; const f = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1); return [lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]; };
  if (k <= 0) return;
  ctx.setLineDash([3 * U, 6 * U]); L.line(ctx, pts, k, { color: C.terra, width: 1.6 * U, alpha: 0.7 }); ctx.setLineDash([]);
  const gl = [], co = [];
  for (let d = head, n = 0; d > 0; d -= 15 * U, n++) { const q = at(d), fl = 0.6 + 0.4 * NZ(n * 1.3, t * 5); gl.push(q[0], q[1], (9 + 5 * fl) * U); co.push(q[0], q[1], (2.2 + 1.8 * fl) * U); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(244,140,50,0.3)'; ctx.beginPath(); for (let i = 0; i < gl.length; i += 3) { ctx.moveTo(gl[i] + gl[i + 2], gl[i + 1]); ctx.arc(gl[i], gl[i + 1], gl[i + 2], 0, PI * 2); } ctx.fill();
  ctx.fillStyle = '#FFE2A8'; ctx.beginPath(); for (let i = 0; i < co.length; i += 3) { ctx.moveTo(co[i] + co[i + 2], co[i + 1]); ctx.arc(co[i], co[i + 1], co[i + 2], 0, PI * 2); } ctx.fill();
  const hq = at(head), pu = L.pulse(t, 1.1); ctx.restore();
  L.circle(ctx, hq[0], hq[1], 28 * U, { fill: 'rgba(255,190,110,0.22)' }); L.circle(ctx, hq[0], hq[1], 5 * U, { fill: C.sun });
  if (k >= 1) L.ring(ctx, hq[0], hq[1], 10 * U + pu * 30 * U, 1, { color: C.sun, width: 2 * U, alpha: 1 - pu });
}
function mapText(nt, X) {
  const lab = (s, x, y, a, col, al) => L.text(ctx, s, x, y, { size: 21 * U, family: 'sans', weight: 600, tracking: 0.26, color: col, alpha: a, align: al || 'center', baseline: 'middle' });
  const tx = SAFE + (wide ? 40 * U : 0), ty = Math.max(SAFE + 20 * U, MY(0.12));
  if (nt === 0) {
    const a = 1 - sg(0.282, 0.292, E.in);
    if (a <= 0) return;
    lab('THERMOPYLAE MEANS', tx, ty, sg(0.204, 0.218) * a, C.lit, 'left');
    L.words(ctx, 'THE HOT GATES', tx, ty + 92 * U, sg(0.208, 0.232), { size: (wide ? 84 : 68) * U, family: 'serif', weight: 600, tracking: 0.08, color: C.cream, alpha: a, rise: 14 * U });
    L.words(ctx, 'named for its hot springs', tx, ty + 146 * U, sg(0.222, 0.246), { size: 34 * U, family: 'serif', italic: true, color: C.lit, alpha: a, rise: 8 * U });
    const q = (x, y) => X.at(MX(x), MY(y));
    let c = q(0.8, 0.3); lab('MALIAN GULF', c[0], c[1], sg(0.246, 0.256) * a, C.lit);
    c = q(WALL, coast(WALL) - 0.1); lab('PHOCIAN WALL', c[0], c[1], sg(0.252, 0.262) * a, C.lit);
    const c2 = q(WALL, coast(WALL) - 0.075), c3 = q(WALL, coast(WALL) - 0.012); L.line(ctx, [c2, c3], sg(0.254, 0.264), { color: C.lit, width: 1.4 * U, alpha: a });
    c = q(0.2, coast(0.2) + 0.04); lab('PERSIANS', c[0], c[1], sg(0.256, 0.266) * a, C.ink);
    c = q(0.65, 0.6); lab('HOT SPRINGS', c[0], c[1], sg(0.258, 0.268) * a, C.ink, 'left');
    c = q(0.548, 0.6); lab('GREEKS', c[0], c[1], sg(0.26, 0.27) * a, C.ink, 'right');
  } else {
    const a = sg(0.452, 0.466) * (1 - sg(0.532, 0.542, E.in));
    if (a <= 0) return;
    lab('THAT NIGHT', tx, ty, a, C.terra, 'left');
    L.words(ctx, 'A local man, Ephialtes, shows the Persians a mountain path.', tx, ty + 70 * U, sg(0.454, 0.472), { size: 46 * U, family: 'serif', color: C.cream, alpha: a, maxWidth: wide ? W * 0.5 : W - 2 * SAFE, lineHeight: 1.2, rise: 10 * U });
    const c = X.at(MX(0.6), MY(0.87)); lab('ANOPAEA PATH', c[0], c[1], sg(0.49, 0.5) * a, '#F4C27A');
  }
}

// ---------- vignette, in-picture type, letterbox ----------
const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
vg.addColorStop(0, 'rgba(12,6,3,0)'); vg.addColorStop(1, 'rgba(12,6,3,0.55)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
{ const gf = Math.floor(t * 12); ctx.save(); [['#FBE3B0', 0.06, 1], [C.ink, 0.16, 2]].forEach((g) => { ctx.fillStyle = g[0]; ctx.globalAlpha = g[1]; ctx.beginPath(); for (let i = 0; i < 360; i++) ctx.rect(R(i * 3 + gf * 977 + g[2]) * W, R(i * 7 + gf * 131 + g[2]) * H, 1.6 * U, 1.6 * U); ctx.fill(); }); ctx.restore(); }
{ // title
  const kt = sg(0.03, 0.06, E.out), ot = 1 - sg(0.094, 0.106, E.in);
  if (kt > 0 && ot > 0) {
    const tS0 = 104 * U, al = 'left', tx = SAFE + (wide ? 40 * U : 0), ty = BY(wide ? 0.4 : 0.3);
    ctx.font = L.font({ size: tS0, family: 'serif', weight: 600 }); const est = ctx.measureText('THERMOPYLAE').width + tS0 * 0.15 * 10, tS = tS0 * Math.min(1, (wide ? W * 0.5 : W * 0.7 - tx) / est);
    L.text(ctx, 'THERMOPYLAE', tx, ty + (1 - kt) * 18 * U, { size: tS, family: 'serif', weight: 600, tracking: 0.1 + 0.05 * sg(0.03, 0.11, E.out), color: C.ink, alpha: kt * ot, align: al });
    const rw = 220 * U * sg(0.045, 0.075, E.out); L.line(ctx, [[tx, ty + 34 * U], [tx + rw, ty + 34 * U]], 1, { color: C.ink, width: 2 * U, alpha: ot });
    L.text(ctx, 'LATE SUMMER, 480 BC', tx, ty + 80 * U, { size: (wide ? 24 : 22) * U, family: 'sans', weight: 600, tracking: 0.32, color: C.ink, alpha: sg(0.05, 0.072) * ot, align: al });
  }
}
const inPic = (s, a, b, y, o) => { const k = sg(a, a + 0.012, E.out), out = 1 - sg(b - 0.008, b, E.in); return k > 0 && out > 0 ? L.text(ctx, s, SAFE + (wide ? 40 * U : 0), y + (1 - k) * 10 * U, Object.assign({ alpha: k * out, family: 'serif', color: C.ink }, o)) : null; };
inPic('DAY I', 0.322, 0.366, BY(0.2), { size: 48 * U, weight: 600, tracking: 0.2 });
inPic('DAY II', 0.386, 0.436, BY(0.2), { size: 48 * U, weight: 600, tracking: 0.2 });
inPic('DAY III', 0.58, 0.636, BY(0.2), { size: 48 * U, weight: 600, tracking: 0.2 });
{ // day three: who stays
  const a = sg(0.646, 0.662) * (1 - sg(0.69, 0.7, E.in));
  if (a > 0) [['c. 300', 'SPARTANS', 0, 3], ['c. 700', 'THESPIANS', 3, 7], ['c. 400', 'THEBANS', 10, 4]].forEach((g, k) => {
    const x = GS + (g[2] + (g[3] - 1) / 2) * sp + k * GAP - fs * 0.04, y = gy - fs * 1.86, kk = sg(0.646 + k * 0.006, 0.662 + k * 0.006);
    L.text(ctx, g[0], x, y + (1 - kk) * 12 * U, { size: 54 * U, family: 'serif', weight: 600, color: C.ink, align: 'center', alpha: a * kk });
    L.text(ctx, g[1], x, y + 34 * U, { size: 18 * U, family: 'sans', weight: 600, tracking: 0.28, color: C.ink, align: 'center', alpha: a * kk });
  });
  const ak = sg(0.72, 0.735) * (1 - sg(0.766, 0.776));
  if (ak > 0) L.text(ctx, 'KOLONOS', hx, gy - hH * 0.3, { size: 18 * U, family: 'sans', weight: 600, tracking: 0.32, color: C.lit, align: 'center', alpha: ak, baseline: 'middle' });
}
{ // coda
  const cs = (wide ? 64 : 52) * U, cy0 = BY(wide ? 0.24 : 0.17), r = inPic('Their stand bought time.', 0.79, 0.858, cy0, { size: cs, color: C.cream, maxWidth: wide ? W * 0.5 : W * 0.56 - SAFE, lineHeight: 1.1 });
  const dy0 = cy0 + (r ? r.height - cs * 1.1 : 0) + 58 * U;
  inPic('SALAMIS, 480 BC', 0.8, 0.858, dy0, { size: 22 * U, family: 'sans', weight: 600, tracking: 0.3, color: C.lit });
  inPic('PLATAEA, 479 BC', 0.806, 0.858, dy0 + 34 * U, { size: 22 * U, family: 'sans', weight: 600, tracking: 0.3, color: C.lit });
}
const inBar = !wide && !tall; // square: the epitaph sits in the lower bar, clear of the sun
function epitaph() {
  const ex = inBar ? W / 2 : SAFE + (wide ? 40 * U : 0), es = (inBar ? 32 : wide ? 44 : 46) * U, ey = inBar ? cB + 46 * U : BY(wide ? 0.22 : 0.16);
  const eo = { size: es, family: 'serif', italic: true, color: C.cream, maxWidth: inBar ? W * 0.86 : wide ? W * 0.5 : W - 2 * SAFE, rise: 10 * U, stagger: 0.6, align: inBar ? 'center' : 'left' };
  const r1 = L.words(ctx, 'Go tell the Spartans, stranger passing by,', ex, ey, sg(0.862, 0.892), eo);
  L.words(ctx, 'that here, obedient to their laws, we lie.', ex, ey + r1.height + es * 0.12, sg(0.89, 0.92), eo);
}
if (!inBar) epitaph();
// letterbox bars with the meander band; captions live in the lower bar
ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, bT + 1); ctx.fillRect(0, bB - 1, W, H - bB + 1);
const mh = (wide ? 20 : 26) * U, km = 0.04 + 0.96 * sg(0, 0.036), ga = 1 - sg(0.028, 0.044);
meander(bT - 12 * U - mh, mh, km, t * 5 * U);
if (ga > 0) [-1, 1].forEach((d) => { const x = W / 2 + d * km * W / 2, y = bT - 12 * U - mh / 2, g = ctx.createRadialGradient(x, y, 0, x, y, 60 * U); g.addColorStop(0, 'rgba(255,214,150,' + 0.9 * ga + ')'); g.addColorStop(0.15, 'rgba(240,160,80,' + 0.35 * ga + ')'); g.addColorStop(1, 'rgba(240,160,80,0)'); ctx.fillStyle = g; ctx.fillRect(x - 60 * U, y - 60 * U, 120 * U, 120 * U); });
L.line(ctx, [[W / 2, bB + 9 * U], [0, bB + 9 * U]], 0.04 + 0.96 * sg(0, 0.036), { color: C.terra, width: 1.6 * U }); L.line(ctx, [[W / 2, bB + 9 * U], [W, bB + 9 * U]], 0.04 + 0.96 * sg(0, 0.036), { color: C.terra, width: 1.6 * U });
function cap(s, a, b) {
  if (p < a || p > b) return;
  L.words(ctx, s, W / 2, capY, sg(a, a + 0.016, E.linear), { size: capS, family: 'serif', color: C.cream, align: 'center', baseline: 'middle', maxWidth: W * (wide ? 0.8 : 0.84), alpha: 1 - sg(b - 0.008, b, E.in), rise: 8 * U, stagger: 0.5, lineHeight: 1.25 });
}
cap('Xerxes I of Persia invades Greece with a vast army.', 0.098, 0.19);
cap('For two days, a few thousand Greeks under Leonidas of Sparta hold the pass.', 0.318, 0.446);
cap('Leonidas sends most of the Greeks away.', 0.582, 0.64);
cap('The last defenders fight to the end on a small hill.', 0.698, 0.788);
if (inBar) epitaph();
L.text(ctx, 'EPITAPH ATTRIBUTED TO SIMONIDES', W / 2, inBar ? cB + 150 * U : capY, { size: 18 * U, family: 'sans', weight: 600, tracking: 0.32, color: C.lit, align: 'center', baseline: 'middle', alpha: sg(0.91, 0.93) });
`,
};
