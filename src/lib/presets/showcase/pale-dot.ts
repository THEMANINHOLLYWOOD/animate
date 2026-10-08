// You are here. Hand-built example film in the scene format Claude generates.
// Brief: One continuous logarithmic zoom out from a glowing Earth past the Moon, the Sun's orbits, the Milky Way and into a field of galaxies, with a tiny 'you are here' label always pointing at Earth and a mono scale readout counting from km to AU to light-years. Vast, quiet, humbling; end on 'Everything you've ever known / fits in one pixel.'
export const film = {
  id: "ex-pale-dot",
  title: "You are here",
  aspect: "9:16" as const,
  duration: 18,
  prompt: "One continuous logarithmic zoom out from a glowing Earth past the Moon, the Sun's orbits, the Milky Way and into a field of galaxies, with a tiny 'you are here' label always pointing at Earth and a mono scale readout counting from km to AU to light-years. Vast, quiet, humbling; end on 'Everything you've ever known / fits in one pixel.'",
  code: String.raw`
const u = lib.u, C = lib.clamp, TAU = Math.PI * 2;
const wide = W / H >= 1.2, tall = W / H < 0.8;
const SS = Math.min(W, H);
const KM_AU = 1.496e8, KM_LY = 9.461e12;
const R = (i) => lib.rand(i);
const sstep = (x) => { x = C(x); return x * x * (3 - 2 * x); };
const band = (v, a, b, c, d) => sstep((v - a) / (b - a)) * (1 - sstep((v - c) / (d - c)));
const blob = (arr, color, alpha) => { if (!arr.length) return; ctx.beginPath(); for (const b of arr) { ctx.moveTo(b[0] + b[2], b[1]); ctx.arc(b[0], b[1], b[2], 0, TAU); } ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); };
const smin = (x) => { const x4 = x * x * x * x; return x4 / (1 + x4); };

lib.bg(ctx, W, H, '#020309');

// ---------- the zoom: log of the field of view (km across the short side) ----------
const KEYS = [[0, 1.8e4], [0.09, 2.2e4], [0.2, 9e5], [0.26, 4e6], [0.33, 3e8], [0.4, 3e9], [0.46, 1e12], [0.5, 6e13], [0.57, 6e14], [0.63, 1.5e17], [0.72, 1.1e18], [0.84, 3.4e20], [1, 4.4e20]];
const LK = KEYS.map((k) => [k[0], Math.log(k[1])]);
const Lraw = (q) => lib.keys(C(q), LK, lib.ease.linear);
let L = 0;
for (let j = -6; j <= 6; j++) L += Lraw(p + j * 0.005) / 13;
const view = Math.exp(L), s = SS / view;
const L0 = Math.log(1.8e4);

// ---------- world (km), Earth at origin ----------
const aS = 2.5, SUN = [KM_AU * Math.cos(aS), KM_AU * Math.sin(aS)];
const R0 = 26000 * KM_LY, phiS = 0.85, GC = [SUN[0] - R0 * Math.cos(phiS), SUN[1] - R0 * Math.sin(phiS)];
const kS = smin(0.6 * view / KM_AU), kG = smin(0.55 * view / R0);
const cx = kS * SUN[0] + kG * (GC[0] - SUN[0]), cy = kS * SUN[1] + kG * (GC[1] - SUN[1]);
const ang = -0.05 * (L - L0) + 0.2, ca = Math.cos(ang), sa = Math.sin(ang);
const sq = lib.keys(L, [[Math.log(3e4), 0.62], [Math.log(1e6), 0.5], [Math.log(1e9), 0.4], [Math.log(1e12), 0.42], [Math.log(1e17), 0.5], [Math.log(2e18), 0.56], [Math.log(2e20), 0.78]], lib.ease.inOut);
const FX = W / 2, FY = H * (tall ? 0.5 : 0.52);
const P = (wx, wy) => {
  const dx = wx - cx, dy = wy - cy;
  return [FX + (dx * ca - dy * sa) * s, FY + (dx * sa + dy * ca) * s * sq];
};
const onScreen = (x, y, r) => x > -r && x < W + r && y > -r && y < H + r;

// ---------- deep background: nebula + log-periodic parallax starfield ----------
const bgDim = 1 - 0.7 * sstep((L - Math.log(1e17)) / (Math.log(3e19) - Math.log(1e17)));
ctx.save();
ctx.globalCompositeOperation = 'lighter';
const NEB = ['#24306e', '#4a2160', '#14505e', '#3a1f3a'];
for (let i = 0; i < 6; i++) {
  const q = ((L - L0) / 14 + i / 6) % 1;
  const f = 2.4 * Math.exp(-3.2 * q);
  const nx = FX + (R(i * 7 + 1) - 0.5) * SS * 1.6 * f, ny = FY + (R(i * 7 + 2) - 0.5) * H * 1.2 * f;
  const rr = SS * (0.5 + R(i * 7 + 3) * 0.6) * f;
  const al = 0.2 * Math.sin(Math.PI * q) * (0.6 + 0.4 * lib.noise(i * 3.1, t * 0.08)) * bgDim;
  for (let k = 0; k < 2; k++) {
    const ox = lib.noise(i, k * 2.3) * rr * 0.5, oy = lib.noise(k * 1.7, i + 9) * rr * 0.4;
    const gr = Math.min(rr * (0.55 + 0.3 * k), 1.3 * SS);
    if (!onScreen(nx + ox, ny + oy, gr) || al < 0.01) continue;
    const g = ctx.createRadialGradient(nx + ox, ny + oy, 0, nx + ox, ny + oy, gr);
    g.addColorStop(0, NEB[(i + k) % 4]); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = al; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(nx + ox, ny + oy, gr, 0, TAU); ctx.fill();
  }
}
ctx.restore();

const STARC = ['#9fb6ff', '#ffffff', '#ffe2b8'];
for (let layer = 0; layer < 5; layer++) {
  const q = ((L - L0) / 6 + layer / 5) % 1;
  const f = 3 * Math.exp(-4.2 * q);
  const la = Math.sin(Math.PI * Math.pow(q, 0.7)) * Math.sqrt(1 - q) * bgDim;
  for (let cls = 0; cls < 3; cls++) {
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const id = layer * 1000 + cls * 300 + i;
      const x = FX + (R(id) - 0.5) * W * 1.15 * f, y = FY + (R(id + 77) - 0.5) * H * 1.15 * f;
      if (!onScreen(x, y, 4)) continue;
      const tw = 0.65 + 0.35 * Math.sin(t * (1.5 + R(id + 5) * 3) + id);
      const r = (0.6 + R(id + 9) * (cls === 1 ? 1.6 : 1.0)) * u * tw * (0.6 + 0.6 * (1 - q));
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
    }
    ctx.globalAlpha = la * (cls === 1 ? 0.9 : 0.6); ctx.fillStyle = STARC[cls]; ctx.fill();
  }
}
ctx.globalAlpha = 1;

// ---------- galaxy field ----------
const fieldA = sstep((L - Math.log(2e18)) / (Math.log(4e19) - Math.log(2e18)));
if (fieldA > 0.01) {
  for (let i = 0; i < 280; i++) {
    const a = R(i * 13 + 1) * TAU, d = (i === 0 ? 2.5e6 : 2.5e6 + Math.pow(R(i * 13 + 2), 0.85) * 3e7) * KM_LY;
    const g = P(GC[0] + Math.cos(a) * d, GC[1] + Math.sin(a) * d * 1.4);
    const rad = Math.max(1.8 * u, (i === 0 ? 2.4e5 : 5e4 + Math.pow(R(i * 13 + 3), 2) * 3e5) * KM_LY * s);
    if (!onScreen(g[0], g[1], rad * 3)) continue;
    const tw = 0.8 + 0.2 * Math.sin(t * 0.7 + i);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.translate(g[0], g[1]); ctx.rotate(R(i * 13 + 4) * TAU); ctx.scale(1, 0.25 + R(i * 13 + 5) * 0.75);
    const warm = R(i * 13 + 6) > 0.5;
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rad * 2.2);
    gr.addColorStop(0, warm ? 'rgba(255,236,205,0.95)' : 'rgba(215,228,255,0.95)');
    gr.addColorStop(0.18, warm ? 'rgba(255,200,150,0.35)' : 'rgba(150,175,255,0.35)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = fieldA * tw * (0.55 + 0.45 * R(i * 13 + 7));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rad * 2.2, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

// ---------- the Milky Way ----------
const gpx = 50000 * KM_LY * s; // galactic radius in px
const galA = 1 - sstep((gpx - 25 * SS) / (60 * SS));
if (galA > 0.01) {
  const gc = P(GC[0], GC[1]);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(gc[0], gc[1], 0, gc[0], gc[1], gpx * 0.55);
  halo.addColorStop(0, 'rgba(255,225,180,0.55)'); halo.addColorStop(0.25, 'rgba(200,170,255,0.12)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = galA; ctx.translate(gc[0], gc[1]); ctx.scale(1, sq); ctx.translate(-gc[0], -gc[1]);
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(gc[0], gc[1], gpx * 0.55, 0, TAU); ctx.fill();
  if (gpx < 12 * u) { const g2 = ctx.createRadialGradient(gc[0], gc[1], 0, gc[0], gc[1], 7 * u); g2.addColorStop(0, 'rgba(255,230,200,0.5)'); g2.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(gc[0], gc[1], 7 * u, 0, TAU); ctx.fill(); }
  ctx.restore();
  const r0 = 3000 * KM_LY, b = 0.22, thS = Math.log(R0 / r0) / b, phi0 = phiS - thS;
  const thMax = Math.log(52000 * KM_LY / r0) / b;
  const dot = Math.max(0.6 * u, Math.min(2.4 * u, gpx * 0.004));
  const GCOL = ['#ffe6c2', '#cddcff', '#ff9ec4'];
  const paths = [[], [], []];
  for (let i = 0; i < 2400; i++) {
    let r, ph, cls;
    if (i < 500) { r = Math.abs(lib.noise(i * 0.37, 1.3) + R(i) * 0.6) * 5000 * KM_LY; ph = R(i + 5000) * TAU; cls = 0; }
    else {
      const th = R(i + 1) * thMax, arm = i % 4;
      const jit = (R(i + 2) + R(i + 3) - 1) * 0.5;
      r = r0 * Math.exp(b * th) * (1 + jit * 0.22) + (R(i + 4) - 0.5) * 1500 * KM_LY;
      ph = th + phi0 + arm * TAU / 4 + jit * 0.25;
      cls = R(i + 6) > 0.93 ? 2 : (r < 9000 * KM_LY ? 0 : 1);
    }
    const g = P(GC[0] + r * Math.cos(ph), GC[1] + r * Math.sin(ph));
    if (!onScreen(g[0], g[1], 3)) continue;
    const dd = dot * (0.5 + R(i + 8));
    paths[cls].push([g[0], g[1], dd]);
  }
  const tw = 0.85 + 0.15 * Math.sin(t * 1.3);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let c = 0; c < 3; c++) { blob(paths[c], GCOL[c], galA * (c === 1 ? 0.55 : 0.7) * tw); }
  ctx.restore();
}

// ---------- the Oort cloud: a faint shell of icy bodies ----------
const oortPx = 50000 * KM_AU * s;
const oA = band(oortPx, 0.1 * SS, 0.4 * SS, 1.5 * SS, 5 * SS);
if (oA > 0.01) {
  const arr = [];
  for (let i = 0; i < 700; i++) {
    const a = R(i + 9000) * TAU, d = (2000 + Math.pow(R(i + 9100), 0.6) * 98000) * KM_AU;
    const g = P(SUN[0] + Math.cos(a) * d, SUN[1] + Math.sin(a) * d / (0.45 + 0.55 * R(i + 9200)));
    if (onScreen(g[0], g[1], 2)) arr.push([g[0], g[1], (0.5 + R(i + 9300)) * u]);
  }
  blob(arr, '#a9c4e8', oA * 0.8);
  ctx.globalAlpha = 1;
}

// ---------- nearest star ----------
const NS = [SUN[0] + 4.24 * KM_LY * Math.cos(1.1), SUN[1] + 4.24 * KM_LY * Math.sin(1.1)];
const nsA = band(4.24 * KM_LY * s, 0.04 * SS, 0.15 * SS, 0.6 * SS, 2 * SS);
if (nsA > 0.01) {
  const n = P(NS[0], NS[1]);
  const g = ctx.createRadialGradient(n[0], n[1], 0, n[0], n[1], 26 * u);
  g.addColorStop(0, 'rgba(255,190,150,0.9)'); g.addColorStop(0.15, 'rgba(255,150,110,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = nsA; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n[0], n[1], 26 * u, 0, TAU); ctx.fill();
  lib.circle(ctx, n[0], n[1], 2.2 * u, { fill: '#fff1e6', alpha: nsA });
  ctx.globalAlpha = 1;
}

// ---------- solar system ----------
const sp = P(SUN[0], SUN[1]);
const auPx = KM_AU * s;
const ORB = [0.39, 0.72, 1, 1.52, 5.2, 9.58, 19.2, 30.1];
ctx.lineWidth = 1 * u;
for (let i = 0; i < ORB.length; i++) {
  const rp = ORB[i] * auPx;
  const a = band(rp, 0.03 * SS, 0.12 * SS, 1.5 * SS, 5 * SS) * (i === 2 ? 0.55 : 0.32);
  if (a < 0.01) continue;
  ctx.globalAlpha = a; ctx.strokeStyle = i === 2 ? '#8fb8ff' : '#c9d2e6';
  ctx.beginPath(); ctx.ellipse(sp[0], sp[1], rp, rp * sq, 0, 0, TAU); ctx.stroke();
  if (i !== 2) {
    const pa = R(i + 300) * TAU + t * 0.02 / Math.sqrt(ORB[i]);
    const px = sp[0] + Math.cos(pa) * rp, py = sp[1] + Math.sin(pa) * rp * sq;
    lib.circle(ctx, px, py, (i >= 4 ? 2.6 : 1.8) * u, { fill: '#e8e2d6', alpha: Math.min(1, a * 2.5) });
  }
}
ctx.globalAlpha = 1;
const sunA = band(auPx, 0.01 * SS, 0.05 * SS, 1e9, 2e9);
if (sunA > 0.01 && onScreen(sp[0], sp[1], 400 * u)) {
  const rs = Math.max(696000 * s, 4 * u), gr = Math.max(rs * 7, 60 * u) * (0.4 + 0.6 * C(auPx / (0.15 * SS)));
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], gr);
  g.addColorStop(0, 'rgba(255,246,220,1)'); g.addColorStop(0.08, 'rgba(255,200,120,0.6)'); g.addColorStop(0.4, 'rgba(255,140,60,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = sunA; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sp[0], sp[1], gr, 0, TAU); ctx.fill();
  ctx.restore();
  lib.circle(ctx, sp[0], sp[1], rs, { fill: '#fff8ea', alpha: sunA });
}

// ---------- Earth & Moon ----------
const ep = P(0, 0);
let lx = sp[0] - ep[0], ly = sp[1] - ep[1];
const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
const L3 = [lx * 0.95, ly * 0.95, 0.3];
const HT = new Float32Array(512);
for (let i = 0; i < 512; i++) HT[i] = R(i + 777) * 2 - 1;
const hh = (x, y) => HT[(Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) & 511];
const vn = (x, y) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hh(xi, yi), b = hh(xi + 1, yi), c = hh(xi, yi + 1), d = hh(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
};
function earthTex(x, y, r) {
  const N = Math.max(24, Math.min(140, Math.ceil(r / 2.1)));
  const saved = ctx.getImageData(0, 0, N, N), img = ctx.createImageData(N, N), d = img.data;
  const rot = t * 0.05 + p * 1.4;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let nx = (i + 0.5) / N * 2 - 1, ny = (j + 0.5) / N * 2 - 1, rr = nx * nx + ny * ny;
    if (rr > 1.1) continue;
    if (rr > 0.998) { const k = Math.sqrt(0.998 / rr); nx *= k; ny *= k; rr = 0.998; }
    const z = Math.sqrt(1 - rr), tx = nx * 0.94 - ny * 0.34, ty = -(nx * 0.34 + ny * 0.94);
    const lat = Math.asin(ty), lon = Math.atan2(tx, z) + rot;
    const lv = vn(lon * 1.1 + 7, lat * 1.7 + 2) + 0.45 * vn(lon * 3.2, lat * 3.4) + 0.2 * vn(lon * 9, lat * 9);
    const lk = sstep((lv - 0.12) / 0.08), sh = sstep((lv + 0.05) / 0.3);
    let R0 = 8 + 22 * sh, G0 = 34 + 50 * sh, B0 = 92 + 70 * sh;
    const dryk = sstep((vn(lon * 2 + 11, lat * 2.5) + 0.25 * vn(lon * 8, lat * 8) - 0.05) / 0.3);
    const mtn = 0.8 + 0.25 * vn(lon * 16, lat * 16);
    const LR = (52 + 110 * dryk) * mtn, LG = (96 + 42 * dryk) * mtn, LB = (62 + 30 * dryk) * mtn;
    R0 += (LR - R0) * lk; G0 += (LG - G0) * lk; B0 += (LB - B0) * lk;
    const ik = sstep((Math.abs(lat) - 1.15 - 0.08 * vn(lon * 4, 3.3)) / 0.08);
    R0 += (232 - R0) * ik; G0 += (240 - G0) * ik; B0 += (250 - B0) * ik;
    const cv = vn(lon * 1.8 + t * 0.012, lat * 6) * 0.75 + 0.4 * vn(lon * 5 + 3, lat * 13) + 0.18 * vn(lon * 15, lat * 24) + 0.12 * Math.cos(lat * 5);
    const ck = sstep((cv - 0.12) / 0.5) * 0.95;
    R0 += (246 - R0) * ck; G0 += (249 - G0) * ck; B0 += (255 - B0) * ck;
    const lit = nx * L3[0] + ny * L3[1] + z * L3[2];
    const diff = sstep((lit + 0.06) / 0.45), shade = 0.025 + 0.975 * diff * (0.75 + 0.25 * lit);
    const rim = Math.pow(1 - z, 2.2), night = 1 - sstep((lit + 0.12) / 0.22);
    const city = night * lk * (1 - ik) * (1 - ck) * Math.max(0, vn(lon * 26, lat * 26) + 0.6 * vn(lon * 70 + 5, lat * 70) - 0.55) * 3.5;
    const o = (j * N + i) * 4;
    d[o] = C(R0 * shade + 80 * rim * (0.25 + 0.75 * diff) + 255 * city, 0, 255);
    d[o + 1] = C(G0 * shade + 145 * rim * (0.25 + 0.75 * diff) + 170 * city, 0, 255);
    d[o + 2] = C(B0 * shade + 255 * rim * (0.25 + 0.75 * diff) + 80 * city, 0, 255);
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(ctx.canvas, 0, 0, N, N, x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.putImageData(saved, 0, 0);
}
function sphere(x, y, r, kind) {
  if (r < 1.5 * u) return;
  if (kind === 'earth') {
    const g = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.22);
    g.addColorStop(0, 'rgba(90,160,255,0.55)'); g.addColorStop(0.3, 'rgba(90,160,255,0.18)'); g.addColorStop(1, 'rgba(90,160,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.22, 0, TAU); ctx.fill();
  }
  if (kind === 'earth' && r > 14 * u) earthTex(x, y, r);
  else {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    const base = ctx.createRadialGradient(x + lx * r * 0.4, y + ly * r * 0.4, 0, x, y, r);
    base.addColorStop(0, kind === 'earth' ? '#3a7ad0' : '#c4c2bc'); base.addColorStop(1, kind === 'earth' ? '#0a1e4a' : '#5c5a58');
    ctx.fillStyle = base; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    const sh = ctx.createLinearGradient(x + lx * r, y + ly * r, x - lx * r, y - ly * r);
    sh.addColorStop(0, 'rgba(2,3,9,0)'); sh.addColorStop(0.42, 'rgba(2,3,9,0.05)'); sh.addColorStop(0.6, 'rgba(2,3,9,0.9)'); sh.addColorStop(1, 'rgba(2,3,9,0.97)');
    ctx.fillStyle = sh; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }
  if (kind === 'earth') {
    ctx.save(); ctx.strokeStyle = '#a8d4ff'; ctx.lineCap = 'round';
    const a0 = Math.atan2(ly, lx);
    for (let k = 0; k < 4; k++) { ctx.globalAlpha = 0.2; ctx.lineWidth = Math.max(1, r * 0.008); ctx.beginPath(); ctx.arc(x, y, r * 1.002, a0 - 0.5 - k * 0.3, a0 + 0.5 + k * 0.3); ctx.stroke(); }
    ctx.restore();
  }
}
const moonOrbPx = 384400 * s;
const mA = band(moonOrbPx, 0.02 * SS, 0.08 * SS, 2 * SS, 6 * SS);
const ma = 0.5 + t * 0.012;
const mp = P(384400 * Math.cos(ma), 384400 * Math.sin(ma));
if (mA > 0.01) {
  ctx.globalAlpha = mA * 0.35; ctx.strokeStyle = '#c9d2e6'; ctx.lineWidth = u;
  ctx.beginPath(); ctx.ellipse(ep[0], ep[1], moonOrbPx, moonOrbPx * sq, 0, 0, TAU); ctx.stroke();
  ctx.globalAlpha = mA;
  sphere(mp[0], mp[1], 1737 * s, 'moon');
  if (1737 * s < 2.5 * u) { lib.circle(ctx, mp[0], mp[1], 7 * u, { fill: '#d8d6d0', alpha: mA * 0.12 }); lib.circle(ctx, mp[0], mp[1], 2.4 * u, { fill: '#e4e2dc', alpha: mA }); }
  ctx.globalAlpha = 1;
}
const rE = 6371 * s;
const dotR = Math.max(rE, lib.lerp(2.4, 1.1, sstep((L - Math.log(1e15)) / 12)) * u);
if (rE < 3 * u) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(ep[0], ep[1], 0, ep[0], ep[1], dotR * 7);
  g.addColorStop(0, 'rgba(140,195,255,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ep[0], ep[1], dotR * 7, 0, TAU); ctx.fill(); ctx.restore();
  lib.circle(ctx, ep[0], ep[1], dotR, { fill: '#cfe6ff' });
} else sphere(ep[0], ep[1], rE, 'earth');

// ---------- "you are here" ----------
const mk = lib.seg(p, 0.04, 0.12, lib.ease.inOut);
if (mk > 0) {
  const ring = Math.max(rE * 1.08, 9 * u), rc = Math.min(ring, 0.15 * SS);
  const left = ep[0] > W * 0.55;
  const dir = left ? -1 : 1, d45 = Math.SQRT1_2;
  const a0 = [ep[0] + dir * rc * d45, ep[1] - rc * d45];
  if (rc < ring) { lib.circle(ctx, a0[0], a0[1], 4 * u, { fill: '#ffffff', alpha: mk }); lib.circle(ctx, a0[0], a0[1], 10 * u, { stroke: '#ffffff', lineWidth: 1.2 * u, alpha: 0.7 * mk }); }
  const diag = 70 * u + Math.min(rE, 0.3 * SS) * 0.12;
  const a1 = [a0[0] + dir * diag * d45, a0[1] - diag * d45];
  const lbl = 'you are here';
  const tw = lib.text(ctx, lbl, -9999, -9999, { size: 30 * u, family: 'serif', italic: true, weight: 300, alpha: 0 }).width + 30 * u;
  const a2 = [a1[0] + dir * (tw + 16 * u), a1[1]];
  lib.line(ctx, [a0, a1, a2], mk, { color: '#e9eef8', width: 1.2 * u, alpha: 0.75 });
  if (rE < 30 * u) {
    lib.ring(ctx, ep[0], ep[1], ring, mk, { color: '#e9eef8', width: 1.2 * u, alpha: 0.6, start: -90 });
    const pr = lib.pulse(t, 2.4);
    lib.circle(ctx, ep[0], ep[1], ring + pr * 26 * u, { stroke: '#cfe6ff', lineWidth: u, alpha: 0.35 * (1 - pr) * mk });
  }
  const ta = lib.seg(p, 0.09, 0.14, lib.ease.out);
  lib.text(ctx, lbl, left ? a2[0] : a1[0] + 8 * u, a1[1] - 12 * u, { size: 30 * u, family: 'serif', italic: true, weight: 300, color: '#f2f5fb', alpha: ta });
}

// ---------- readout ----------
const M = SS * 0.08;
const ruler = SS * 0.5, rv = view * 0.5;
const fmt = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
let val, unit;
if (rv < 1.5e7) { val = fmt(Math.round(rv), 0); unit = 'km'; }
else if (rv < 0.3 * KM_LY) { const a = rv / KM_AU; val = fmt(a, a < 10 ? 2 : a < 100 ? 1 : 0); unit = 'AU'; }
else { const l = rv / KM_LY; val = fmt(l, l < 10 ? 2 : l < 100 ? 1 : 0); unit = 'light-years'; }
const rA = lib.seg(p, 0.02, 0.08, lib.ease.out);
const ry = tall ? H * 0.875 : H - M - 40 * u;
const rx = wide ? W - M - ruler : (W - ruler) / 2;
ctx.save(); ctx.globalAlpha = rA * 0.55; ctx.strokeStyle = '#dfe6f2'; ctx.lineWidth = u;
ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + ruler, ry);
ctx.moveTo(rx, ry - 8 * u); ctx.lineTo(rx, ry + 8 * u); ctx.moveTo(rx + ruler, ry - 8 * u); ctx.lineTo(rx + ruler, ry + 8 * u);
const ph = ((L / Math.log(10)) % 1 + 1) % 1;
for (let k = 1; k < 10; k++) { const xx = rx + ruler * (Math.log10(k) * (1 - ph) + 0); ctx.moveTo(xx, ry - 4 * u); ctx.lineTo(xx, ry); }
ctx.stroke(); ctx.restore();
const rcx = rx + ruler / 2;
lib.text(ctx, val + ' ' + unit, rcx, ry + 52 * u, { size: 40 * u, family: 'mono', weight: 400, color: '#f2f5fb', align: 'center', alpha: rA, maxWidth: ruler * 1.6 });
lib.text(ctx, 'THIS WIDE', rcx, ry - 22 * u, { size: 18 * u, family: 'mono', color: '#b4c0d8', align: 'center', tracking: 0.35, alpha: rA * 0.8 });

// ---------- milestones (driven by the zoom itself) ----------
const LN = Math.log;
const MS = [
  ['HOME', 'Earth \u00b7 12,742 km across', LN(1e3), LN(1.1e3), LN(9e4), LN(2.5e5)],
  ['THE MOON', '384,400 km away', LN(7e5), LN(1.2e6), LN(6e6), LN(1.5e7)],
  ['THE SUN', '1 AU · 150 million km', LN(1.5e8), LN(3e8), LN(3e9), LN(8e9)],
  ['THE NEAREST STAR', '4.2 light-years', LN(4e13), LN(7e13), LN(8e14), LN(2e15)],
  ['THE MILKY WAY', '100,000 light-years across', LN(2e17), LN(4e17), LN(1.5e18), LN(3e18)],
  ['A FIELD OF GALAXIES', 'each one, billions of suns', LN(4e18), LN(8e18), 1e9, 2e9],
];
const endOut = 1 - lib.seg(p, 0.8, 0.84, lib.ease.in);
const capY = tall ? H * 0.13 : M + 40 * u;
const capX = wide ? M : W / 2, capAl = wide ? 'left' : 'center';
MS.forEach((m, i) => {
  const a = band(L, m[2], m[3], m[4], m[5]) * endOut * (i === 0 ? lib.seg(p, 0.015, 0.06, lib.ease.out) : 1);
  if (a < 0.01) return;
  const k = sstep((L - m[2]) / (m[3] - m[2]));
  lib.text(ctx, m[0], capX, capY + (1 - k) * 10 * u, { size: 20 * u, family: 'mono', color: '#b4c0d8', tracking: 0.35, align: capAl, alpha: a });
  lib.text(ctx, m[1], capX, capY + 58 * u + (1 - k) * 18 * u, { size: 46 * u, family: 'serif', weight: 300, color: '#f2f5fb', align: capAl, alpha: a, maxWidth: W - 2 * M });
});

// ---------- closing lines ----------
const e1 = lib.seg(p, 0.84, 0.91), e2 = lib.seg(p, 0.89, 0.95);
if (e1 > 0) {
  const sz = (tall ? 62 : 58) * u, ey = tall ? H * 0.16 : M + 70 * u;
  const ex = wide ? M : W / 2, al = wide ? 'left' : 'center';
  lib.words(ctx, 'Everything you’ve ever known', ex, ey, e1, { size: sz, family: 'serif', weight: 300, color: '#f2f5fb', align: al, maxWidth: W - 2 * M, stagger: 0.5 });
  lib.words(ctx, 'fits in one pixel.', ex, ey + sz * 1.3, e2, { size: sz, family: 'serif', italic: true, weight: 300, color: '#cfe6ff', align: al, maxWidth: W - 2 * M, stagger: 0.5 });
}
`,
};
