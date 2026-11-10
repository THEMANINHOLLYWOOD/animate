// The Inca, in one minute. Hand-built example film in the scene format Claude generates.
// Brief: A one-minute flat-vector science-explainer history of the Inca, in rich indigo, magenta and teal with a glowing smiling Inti sun carried through every scene: from the Lake Titicaca legend and Cusco to Pachacuti's Tawantinsuyu, the roads, rope bridges, Machu Picchu and quipu, then smallpox, civil war, Pizarro at Cajamarca, the ransom room and Vilcabamba, ending on a calm Andes sunrise and the Quechua spoken today.
export const film = {
  id: "ex-inca",
  title: "The Inca, in one minute",
  aspect: "16:9" as const,
  duration: 60,
  prompt: "A one-minute flat-vector science-explainer history of the Inca, in rich indigo, magenta and teal with a glowing smiling Inti sun carried through every scene: from the Lake Titicaca legend and Cusco to Pachacuti's Tawantinsuyu, the roads, rope bridges, Machu Picchu and quipu, then smallpox, civil war, Pizarro at Cajamarca, the ransom room and Vilcabamba, ending on a calm Andes sunrise and the Quechua spoken today.",
  code: String.raw`
// THE INCA, IN ONE MINUTE. A flat-vector science-explainer world: one illustrated Andes panorama the camera
// travels across, a map of Tawantinsuyu it dives in and out of, and a ransom room. Inti, the sun, carries
// through every beat: it rises over Lake Titicaca, marks Cusco on the map, sets in the ransom-room window
// and rises again over the last wide shot.
const { ease, seg, u, clamp, lerp, rand } = lib;
const TAU = Math.PI * 2, wide = W / H >= 1.2, tall = W / H < 0.8, M = Math.min(W, H) * 0.08;
const ss = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const bump = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));
const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb = (c, a) => 'rgba(' + c.map(Math.round).join(',') + ',' + (a == null ? 1 : a) + ')';
const mixA = (A, B, k) => A.map((v, i) => lerp(v, B[i], k));
const GOLD = '#FFC23D', INK = '#1A1240', WHITE = '#FFFFFF', MAG = '#E8467C', TEAL = '#2EC4B6', ORNG = '#FF8A3D';
const blinkK = (s) => (lib.pulse(t + s * 1.7, 3.6 + s % 1.3) > 0.965 ? 0.12 : 1);

// ── Time of day: skyTop, skyMid, skyHorizon, far, farLit, mid, midLit, near, nearLit, ground, groundLit, water ──
const PK = {
  dawn: ['#120E3A', '#47227A', '#F0607A', '#3A2C7A', '#5A3F9E', '#2C2163', '#47308A', '#211A56', '#352873', '#1E1748', '#33266F', '#5BC8D8'],
  day: ['#1D3596', '#3D7AD2', '#9FE3EE', '#6C7FD8', '#93A6EE', '#4C55B8', '#6C77D4', '#2F6F72', '#3F9585', '#24664E', '#3E9A63', '#3FB8D8'],
  gold: ['#28247E', '#8448A8', '#FFB06A', '#7656B4', '#A27BCE', '#553A96', '#7856B8', '#2C5E62', '#3E8476', '#22573F', '#3B8659', '#4FB0C8'],
  night: ['#060620', '#121042', '#2B226C', '#1C1A4E', '#272566', '#141339', '#1D1B4E', '#0F2A33', '#173D42', '#0B1E24', '#143439', '#1E3F70'],
  rise: ['#1E185A', '#6E3696', '#FF9460', '#5B3F9E', '#8A5FC0', '#3E2C80', '#5E44A6', '#2E2670', '#4A3A96', '#2B2368', '#5A469E', '#6FD0E0'],
};
for (const k in PK) PK[k] = PK[k].map(hx);
const TOD = [[0, 'dawn'], [0.1, 'dawn'], [0.17, 'day'], [0.45, 'day'], [0.53, 'gold'], [0.6, 'gold'], [0.79, 'night'], [0.855, 'night'], [0.95, 'rise'], [1, 'rise']];
let ti = 0; while (ti < TOD.length - 2 && p > TOD[ti + 1][0]) ti++;
const todK = ease.inOutSine(clamp((p - TOD[ti][0]) / (TOD[ti + 1][0] - TOD[ti][0])));
const [skyT, skyM, skyH, far, farL, mid, midL, near, nearL, gnd, gndL, wat] = PK[TOD[ti][1]].map((c, j) => mixA(c, PK[TOD[ti + 1][1]][j], todK));

// ── Panorama camera: [world x, world y, zoom] ──
const QX = wide ? 7115 : 7330;
const CAMK = [
  [0, [0, -170, 1]], [0.07, [60, -175, 1.06]], [0.085, [200, -120, 1.25]], [0.142, [1380, -100, 1.3]],
  [0.16, [1960, -80, 1.7]], [0.19, [1990, -85, 1.8]], [0.21, [1960, -220, 0.62]],
  [0.355, [3830, -320, 0.62]], [0.378, [3830, -150, 1.35]], [0.435, [3880, -150, 1.42]],
  [0.462, [5640, -330, 0.95]], [0.495, [5660, -340, 1]],
  [0.515, [7250, -170, 1.1]], [0.535, [QX, -92, 2.3]], [0.578, [QX + 10, -95, 2.4]], [0.6, [7300, -260, 0.8]],
  [0.812, [9050, -110, 2.6]], [0.837, [9060, -100, 2.1]], [0.892, [9080, -100, 2.2]],
  [0.945, [9760, -330, 0.7]], [1, [9800, -340, 0.68]],
];
const [camX, camY, camZ] = lib.keys(p, CAMK, ease.inOut);
const FY = H * (tall ? 0.62 : 0.64), U = u * (tall ? 1.25 : 1);
const zl = (f) => U * (1 + (camZ - 1) * f);
const Z = zl(1), X = (x) => W / 2 + (x - camX) * Z, Y = (y) => FY + (y - camY) * Z;
const onS = (x, r) => X(x) > -r * Z && X(x) < W + r * Z;
const G = (x) => -18 * Math.sin(x / 520) - 10 * Math.sin(x / 190 + 1) + 600 * ss((470 - x) / 160) - 150 * bump(x, 3830, 420)
  + 1400 * ss((150 - Math.abs(x - 3830)) / 40) - 120 * bump(x, 9050, 520) - 90 * bump(x, 10300, 260);

// ── Inti: halo of stacked translucent discs, turning rays, a calm face ──
function sun(x, y, r, g, face) {
  ctx.save();
  for (let i = 5; i >= 0; i--) { ctx.beginPath(); ctx.arc(x, y, r * (1.2 + i * 0.55), 0, TAU); ctx.fillStyle = 'rgba(255,196,110,' + (0.075 * g) + ')'; ctx.fill(); }
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + t * 0.06, L = r * (i % 2 ? 1.34 : 1.56 + 0.04 * Math.sin(t * 2 + i));
    ctx.moveTo(x + Math.cos(a - 0.09) * r * 1.05, y + Math.sin(a - 0.09) * r * 1.05);
    ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
    ctx.lineTo(x + Math.cos(a + 0.09) * r * 1.05, y + Math.sin(a + 0.09) * r * 1.05);
  }
  ctx.fillStyle = '#FFC94A'; ctx.globalAlpha *= 0.4 + 0.6 * g; ctx.fill();
  lib.circle(ctx, x, y, r, { fill: '#FFB43A' });
  lib.circle(ctx, x - r * 0.06, y - r * 0.06, r * 0.88, { fill: '#FFD35C' });
  lib.circle(ctx, x - r * 0.36, y - r * 0.36, r * 0.24, { fill: 'rgba(255,244,205,0.55)' });
  if (face) {
    const b = blinkK(0.3);
    ctx.fillStyle = '#B4561E';
    ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.06, r * 0.075, r * 0.11 * b, 0, 0, TAU); ctx.ellipse(x + r * 0.3, y - r * 0.06, r * 0.075, r * 0.11 * b, 0, 0, TAU); ctx.fill();
    lib.circle(ctx, x - r * 0.48, y + r * 0.2, r * 0.11, { fill: 'rgba(255,120,80,0.35)' });
    lib.circle(ctx, x + r * 0.48, y + r * 0.2, r * 0.11, { fill: 'rgba(255,120,80,0.35)' });
    ctx.beginPath(); ctx.arc(x, y + r * 0.1, r * 0.2, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.strokeStyle = '#B4561E'; ctx.lineWidth = r * 0.05; ctx.lineCap = 'round'; ctx.stroke();
  }
  ctx.restore();
}

// ── Characters: round people in checkerboard (tocapu) tunics, and llamas ──
function person(x, y, s, o) {
  const sd = o.seed || 0, walk = o.walk || 0, ph = t * 9 + sd * 3;
  const bob = walk ? Math.abs(Math.sin(ph)) * 2.4 * s : Math.sin(t * 2 + sd) * 0.7 * s, lg = walk ? Math.sin(ph) * 5 * s : 0;
  ctx.save(); ctx.translate(x, y); if (o.dir < 0) ctx.scale(-1, 1);
  ctx.fillStyle = '#24163A'; ctx.fillRect(-7 * s + lg, -15 * s, 5 * s, 15 * s); ctx.fillRect(2 * s - lg, -15 * s, 5 * s, 15 * s);
  ctx.translate(0, -bob);
  if (o.staff) { ctx.fillStyle = GOLD; ctx.fillRect(13 * s, -86 * s + (o.sink || 0) * s, 3.2 * s, 80 * s - (o.sink || 0) * s); lib.circle(ctx, 14.6 * s, -88 * s + (o.sink || 0) * s, 4.5 * s, { fill: '#FFE08A' }); }
  ctx.beginPath(); ctx.moveTo(-11 * s, -52 * s); ctx.lineTo(11 * s, -52 * s); ctx.lineTo(16 * s, -12 * s); ctx.lineTo(-16 * s, -12 * s); ctx.closePath();
  ctx.fillStyle = o.tunic; ctx.fill();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? o.c1 : o.c2; ctx.fillRect((-12 + i * 6) * s, (-34 + j * 6) * s, 6 * s, 6 * s); }
  ctx.beginPath(); ctx.moveTo(0, -52 * s); ctx.lineTo(11 * s, -52 * s); ctx.lineTo(16 * s, -12 * s); ctx.lineTo(0, -12 * s); ctx.fillStyle = 'rgba(20,8,50,0.16)'; ctx.fill();
  ctx.strokeStyle = o.tunic; ctx.lineWidth = 5 * s; ctx.lineCap = 'round'; ctx.beginPath();
  ctx.moveTo(-10 * s, -48 * s); ctx.lineTo(-15 * s + lg * 0.6, -30 * s); ctx.moveTo(10 * s, -48 * s); ctx.lineTo(o.staff ? 14 * s : 15 * s - lg * 0.6, o.staff ? -40 * s : -30 * s); ctx.stroke();
  lib.circle(ctx, 0, -64 * s, 13.5 * s, { fill: '#C27B50' });
  ctx.beginPath(); ctx.arc(0, -65 * s, 14 * s, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fillStyle = '#1E1230'; ctx.fill();
  ctx.fillStyle = o.royal ? '#D62A3A' : o.c1; ctx.fillRect(-13.5 * s, -71 * s, 27 * s, 3.4 * s);
  if (o.royal) { ctx.fillRect(-1 * s, -68 * s, 9 * s, 6 * s); lib.circle(ctx, 3 * s, -76 * s, 3.6 * s, { fill: GOLD }); }
  const b = blinkK(sd);
  ctx.fillStyle = WHITE; ctx.beginPath(); ctx.ellipse(5 * s, -62 * s, 4.6 * s, 4.6 * s * b, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1E1230'; ctx.beginPath(); ctx.ellipse(6.3 * s, -61.6 * s, 2.5 * s, 2.5 * s * b, 0, 0, TAU); ctx.fill();
  ctx.restore();
}
function llama(x, y, s, o) {
  const sd = o.seed || 0, walk = o.walk || 0, ph = t * 7 + sd * 2, col = o.col || '#F3E7D3', sh = o.sh || '#D2BD9C';
  ctx.save(); ctx.translate(x, y); if (o.dir < 0) ctx.scale(-1, 1);
  ctx.strokeStyle = sh; ctx.lineWidth = 3.6 * s; ctx.lineCap = 'round'; ctx.beginPath();
  [-15, -8, 9, 16].forEach((lx, i) => { const sw = walk ? Math.sin(ph + (i % 2) * Math.PI + (i > 1 ? 1.6 : 0)) * 4 * s : 0; ctx.moveTo(lx * s, -22 * s); ctx.lineTo(lx * s + sw, 0); });
  ctx.stroke();
  ctx.translate(0, -(walk ? Math.abs(Math.sin(ph)) * 1.6 * s : 0));
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, -28 * s, 22 * s, 11 * s, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.roundRect(11 * s, -60 * s + Math.sin(t * 1.3 + sd) * s, 9 * s, 36 * s, 4.5 * s); ctx.fill();
  const hy = -60 * s + Math.sin(t * 1.3 + sd) * s;
  ctx.beginPath(); ctx.ellipse(20 * s, hy, 9.5 * s, 6.2 * s, 0.12, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12 * s, hy - 3 * s); ctx.lineTo(13 * s, hy - 14 * s); ctx.lineTo(16.5 * s, hy - 4 * s); ctx.moveTo(16 * s, hy - 4 * s); ctx.lineTo(18.5 * s, hy - 15 * s); ctx.lineTo(20.5 * s, hy - 4 * s); ctx.fill();
  lib.circle(ctx, 13 * s, hy - 14 * s, 2.4 * s, { fill: MAG }); lib.circle(ctx, 18.5 * s, hy - 15 * s, 2.4 * s, { fill: GOLD });
  ctx.fillStyle = o.blanket || MAG; ctx.fillRect(-11 * s, -38 * s, 18 * s, 13 * s);
  ctx.fillStyle = GOLD; ctx.fillRect(-11 * s, -33 * s, 18 * s, 3 * s);
  ctx.beginPath(); ctx.ellipse(0, -23 * s, 19 * s, 5 * s, 0, 0, Math.PI); ctx.fillStyle = 'rgba(40,20,60,0.12)'; ctx.fill();
  ctx.fillStyle = '#1E1230'; ctx.beginPath(); ctx.ellipse(23 * s, hy - 1.5 * s, 2.2 * s, 2.2 * s * blinkK(sd + 2), 0, 0, TAU); ctx.fill();
  lib.circle(ctx, -22 * s, -31 * s, 4.5 * s, { fill: col });
  ctx.restore();
}
function house(x, y, w, h, s, wall, roof) {
  ctx.fillStyle = wall; ctx.fillRect(x - (w / 2) * s, y - h * s, w * s, h * s);
  ctx.fillStyle = 'rgba(20,10,50,0.2)'; ctx.fillRect(x + w * 0.15 * s, y - h * s, w * 0.35 * s, h * s);
  ctx.fillStyle = '#2A1838'; ctx.beginPath(); ctx.moveTo(x - 6 * s, y); ctx.lineTo(x - 4.2 * s, y - 17 * s); ctx.lineTo(x + 4.2 * s, y - 17 * s); ctx.lineTo(x + 6 * s, y); ctx.fill();
  ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(x - (w / 2 + 5) * s, y - h * s); ctx.lineTo(x, y - (h + w * 0.55) * s); ctx.lineTo(x + (w / 2 + 5) * s, y - h * s); ctx.fill();
  ctx.fillStyle = 'rgba(255,236,190,0.22)'; ctx.beginPath(); ctx.moveTo(x - (w / 2 + 5) * s, y - h * s); ctx.lineTo(x, y - (h + w * 0.55) * s); ctx.lineTo(x, y - h * s); ctx.fill();
}

// ── Panorama ──
function range(f, sp, base, hv, seed, A, L, snowH, bot, round) {
  const z = zl(f), cx = camX * f, half = W / 2 / z + sp * 1.5;
  const Xs = (x) => W / 2 + (x - cx) * z, Ys = (y) => FY + (y - camY * f) * z;
  const i0 = Math.floor((cx - half) / sp), i1 = Math.ceil((cx + half) / sp), P = [], V = [];
  for (let i = i0; i <= i1; i++) {
    P.push([i * sp + (rand(seed + i * 7) - 0.5) * sp * 0.5, -(base + hv * Math.pow(rand(seed + i * 7 + 1), 0.8))]);
    V.push([(i + 0.5) * sp + (rand(seed + i * 7 + 3) - 0.5) * sp * 0.3, -(base * 0.3 + hv * 0.35 * rand(seed + i * 7 + 2))]);
  }
  const g = ctx.createLinearGradient(0, Ys(-(base + hv)), 0, Math.min(bot, Ys(40)));
  g.addColorStop(0, rgb(A)); g.addColorStop(1, rgb(mixA(A, skyH, 0.3)));
  ctx.beginPath(); ctx.moveTo(Xs(V[0][0]), bot); ctx.lineTo(Xs(V[0][0]), Ys(V[0][1]));
  for (let i = 1; i < P.length; i++) round ? ctx.quadraticCurveTo(Xs(P[i][0]), Ys(P[i][1] * 1.5), Xs(V[i][0]), Ys(V[i][1])) : (ctx.lineTo(Xs(P[i][0]), Ys(P[i][1])), ctx.lineTo(Xs(V[i][0]), Ys(V[i][1])));
  ctx.lineTo(Xs(V[V.length - 1][0]), bot); ctx.fillStyle = g; ctx.fill();
  if (round) { ctx.strokeStyle = rgb(L, 0.8); ctx.lineWidth = 5 * z; ctx.stroke(); return; }
  ctx.beginPath();
  for (let i = 1; i < P.length; i++) { const q = P[i], v = V[i], bx = lerp(q[0], v[0], 0.18); ctx.moveTo(Xs(q[0]), Ys(q[1])); ctx.lineTo(Xs(v[0]), Ys(v[1])); ctx.lineTo(Xs(v[0]), bot); ctx.lineTo(Xs(bx), bot); }
  ctx.fillStyle = rgb(L, 0.6); ctx.fill();
  if (snowH) {
    ctx.beginPath();
    for (let i = 1; i < P.length; i++) {
      const q = P[i]; if (-q[1] < snowH) continue;
      const d = (-q[1] - snowH) * 0.55 + 30, a = V[i - 1], b = V[i];
      const pl = (v, k) => [lerp(q[0], v[0], k), lerp(q[1], v[1], k)], A1 = pl(a, d / (a[1] - q[1])), B1 = pl(b, d / (b[1] - q[1]));
      ctx.moveTo(Xs(q[0]), Ys(q[1])); ctx.lineTo(Xs(A1[0]), Ys(A1[1])); ctx.lineTo(Xs(lerp(A1[0], q[0], 0.45)), Ys(A1[1] - d * 0.3));
      ctx.lineTo(Xs(lerp(q[0], A1[0], 0.1)), Ys(q[1] + d * 0.9)); ctx.lineTo(Xs(lerp(B1[0], q[0], 0.35)), Ys(B1[1] - d * 0.25)); ctx.lineTo(Xs(B1[0]), Ys(B1[1]));
    }
    ctx.fillStyle = rgb(mixA(hx('#F4F0FF'), skyM, 0.2)); ctx.fill();
  }
  return Ys(-base * 0.3);
}
function mist(y0, y1, a) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, rgb(skyH, 0)); g.addColorStop(1, rgb(skyH, a)); ctx.fillStyle = g; ctx.fillRect(0, y0, W, y1 - y0); }
function cloud(x, y, w, a) {
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - w * 0.12, w, w * 0.24, w * 0.12);
  [[-0.2, 0.17], [0.05, 0.24], [0.27, 0.15]].forEach(([dx, r]) => { ctx.moveTo(x + dx * w + r * w, y - w * 0.04); ctx.arc(x + dx * w, y - w * 0.04, r * w, 0, TAU); });
  ctx.fillStyle = rgb(mixA(hx('#FFFFFF'), skyH, 0.25), a); ctx.fill();
}
function poly(pts, fill) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }
function panorama() {
  const ysAt = (f, y) => FY + (y - camY * f) * zl(f), skyB = Math.min(H, ysAt(0.2, -40));
  const g = ctx.createLinearGradient(0, 0, 0, skyB);
  g.addColorStop(0, rgb(skyT)); g.addColorStop(0.55, rgb(skyM)); g.addColorStop(1, rgb(skyH));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, skyB);
  const starA = lib.keys(p, [[0, 0.9], [0.07, 0.3], [0.13, 0], [0.74, 0], [0.81, 1], [0.88, 1], [0.95, 0.1]]);
  if (starA > 0.02) {
    ctx.save(); ctx.fillStyle = '#FFF4DA'; ctx.beginPath();
    for (let i = 0; i < 110; i++) {
      const x = ((rand(i) * W * 1.4 - camX * 0.02 * u) % W + W) % W, y = rand(i + 400) * FY * 0.75, r = (0.8 + rand(i + 800) * 1.8) * u * (0.6 + 0.4 * Math.sin(t * 2.2 + i));
      ctx.moveTo(x + r, y); ctx.arc(x, y, Math.max(0.2, r), 0, TAU);
    }
    ctx.globalAlpha *= starA; ctx.fill(); ctx.restore();
  }
  const [sx, sy, sr] = lib.keys(p, [[0, [0.6, 0.78, 80]], [0.065, [0.6, 0.34, 84]], [0.14, [0.72, 0.24, 72]], [0.2, [0.76, 0.2, 66]], [0.36, [0.78, 0.2, 64]],
    [0.5, [0.8, 0.2, 62]], [0.6, [0.84, 0.3, 62]], [0.79, [0.72, 0.98, 62]], [0.86, [0.66, 0.95, 84]], [0.97, [0.66, 0.27, 92]]], ease.inOut);
  const SX = W * (tall ? lerp(sx, 0.5, 0.35) : sx), SY = H * sy * (tall ? 0.85 : 1);
  sun(SX, SY, sr * u, 1 - 0.5 * starA, true);
  for (let i = 0; i < 5; i++) {
    const cx3 = ((rand(i + 40) * 3 * W + t * 6 * u * (1 + i % 2) - camX * 0.3 * zl(0.3)) % (3 * W) + 3 * W) % (3 * W) - W * 0.6;
    cloud(cx3, ysAt(0.3, -420 - 150 * rand(i + 41)), (160 + 120 * rand(i + 42)) * zl(0.3), 0.5 * (1 - starA));
  }
  range(0.2, 420, 230, 280, 11, far, farL, 400, ysAt(0.45, -42) + 6);
  mist(ysAt(0.2, -260), ysAt(0.45, -42) + 6, 0.35);
  range(0.45, 300, 140, 170, 37, mid, midL, 0, ysAt(0.75, -15) + 6);
  mist(ysAt(0.45, -150), ysAt(0.75, -15) + 6, 0.3);
  for (let i = 0; i < 2; i++) { // condors gliding
    const k = lib.pulse(t + i * 23, 46), bx = lerp(-0.1, 1.1, k) * W, by = H * (0.2 + 0.12 * i) + Math.sin(t * 0.6 + i) * 20 * u, fl = Math.sin(t * 2.2 + i) * 0.5, s = (16 - i * 4) * u;
    ctx.beginPath(); ctx.moveTo(bx - s * 2.2, by - s * fl); ctx.quadraticCurveTo(bx - s, by - s * 0.5, bx, by); ctx.quadraticCurveTo(bx + s, by - s * 0.5, bx + s * 2.2, by - s * fl);
    ctx.strokeStyle = rgb(mixA(skyT, hx('#000000'), 0.3), 0.8 * (1 - starA)); ctx.lineWidth = 3.5 * u; ctx.lineCap = 'round'; ctx.stroke();
  }
  range(0.75, 260, 50, 100, 71, near, nearL, 0, H, true);
  // Machu Picchu: a saddle of ruins under the sugarloaf peak; the storehouse hill
  const mpG = rgb(mixA(hx('#2C7A5C'), near, 0.35)), mpL = rgb(mixA(hx('#5BB27C'), nearL, 0.3));
  if (onS(5700, 800)) {
    const MH = (x) => -Math.max(300 * ss((x - 5200) / 160) * ss((5830 - x) / 120), 740 * bump(x, 5850, 105), 470 * bump(x, 5270, 150), 200 * bump(x, 6050, 220));
    const mp = (c) => { c.moveTo(X(5000), Y(60)); for (let x = 5000; x <= 6400; x += 14) c.lineTo(X(x), Y(MH(x))); c.lineTo(X(6400), Y(60)); c.closePath(); };
    ctx.beginPath(); mp(ctx); ctx.fillStyle = mpG; ctx.fill();
    lib.mask(ctx, mp, () => {
      ctx.beginPath(); for (let y = -280; y < 0; y += 30) ctx.rect(X(5000), Y(y), 1400 * Z, 13 * Z);
      ctx.fillStyle = mpL; ctx.globalAlpha *= 0.55; ctx.fill(); ctx.globalAlpha /= 0.55;
      ctx.beginPath(); ctx.moveTo(X(5850), Y(-740)); for (let x = 5850; x <= 6100; x += 12) ctx.lineTo(X(x), Y(MH(x))); ctx.lineTo(X(5900), Y(60)); ctx.lineTo(X(5830), Y(-300)); ctx.fillStyle = 'rgba(255,240,200,0.12)'; ctx.fill();
    });
    for (let i = 0; i < 9; i++) house(X(5430 + i * 34), Y(-300 + (i % 3) * 3), 24, 15, Z * (0.85 + 0.12 * (i % 2)), '#D3CBE2', '#6B4A3A');
    for (let i = 0; i < 4; i++) cloud(X(5300 + i * 260 + Math.sin(t * 0.3 + i) * 40), Y(-170 - 60 * (i % 2)), (220 + 60 * (i % 3)) * Z, 0.75);
  }
  if (onS(7250, 800)) {
    const hy = (x) => -230 * bump(x, 7150, 420) - 10;
    ctx.beginPath(); ctx.moveTo(X(6500), Y(60)); for (let x = 6500; x <= 7900; x += 25) ctx.lineTo(X(x), Y(hy(x))); ctx.lineTo(X(7900), Y(60));
    ctx.fillStyle = rgb(mixA(near, nearL, 0.5)); ctx.fill();
    ctx.beginPath(); for (let r = 0; r < 3; r++) for (let x = 6700; x <= 7650; x += 20) (x === 6700 ? ctx.moveTo : ctx.lineTo).call(ctx, X(x), Y(hy(x) + 22 + r * 40));
    ctx.strokeStyle = rgb(nearL, 0.9); ctx.lineWidth = 4 * Z; ctx.stroke();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) {
      const x = 6800 + c * 56 + r * 28, y = hy(x) + 22 + r * 40, s = Z * 0.62;
      ctx.fillStyle = '#D9B48A'; ctx.beginPath(); ctx.roundRect(X(x) - 15 * s, Y(y) - 28 * s, 30 * s, 28 * s, 6 * s); ctx.fill();
      ctx.fillStyle = 'rgba(30,10,40,0.2)'; ctx.fillRect(X(x) + 4 * s, Y(y) - 26 * s, 10 * s, 26 * s);
      ctx.fillStyle = '#B9722A'; ctx.beginPath(); ctx.moveTo(X(x) - 19 * s, Y(y) - 26 * s); ctx.quadraticCurveTo(X(x), Y(y) - 62 * s, X(x) + 19 * s, Y(y) - 26 * s); ctx.fill();
    }
  }
  // the lake, then the foreground ground and the road
  const step = 8 * u, xs = (sx2) => camX + (sx2 - W / 2) / Z;
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let s2 = 0; s2 <= W + step; s2 += step) ctx.lineTo(s2, Y(G(xs(s2))));
  ctx.lineTo(W + step, H); const gg = ctx.createLinearGradient(0, Y(-60), 0, Y(260)); gg.addColorStop(0, rgb(mixA(gnd, gndL, 0.55))); gg.addColorStop(1, rgb(mixA(gnd, skyT, 0.35)));
  ctx.fillStyle = gg; ctx.fill();
  ctx.beginPath(); for (let s2 = 0; s2 <= W + step; s2 += step) ctx.lineTo(s2, Y(G(xs(s2))) + 3 * Z);
  ctx.strokeStyle = rgb(gndL); ctx.lineWidth = 7 * Z; ctx.stroke();
  if (X(478) > 0) {
    const wg = ctx.createLinearGradient(0, Y(0), 0, H); wg.addColorStop(0, rgb(wat)); wg.addColorStop(1, rgb(mixA(wat, skyT, 0.75)));
    ctx.fillStyle = wg; ctx.fillRect(0, Y(0), X(478), H - Y(0));
    ctx.save(); ctx.strokeStyle = '#FFE08A'; ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const y = Y(8 + i * 16), w = (70 - i * 5) * Z * (0.7 + 0.3 * Math.sin(t * 2.4 + i * 1.7)); if (SX < X(470)) { ctx.moveTo(SX - w, y); ctx.lineTo(SX + w, y); } }
    ctx.lineWidth = 4 * Z; ctx.globalAlpha *= 0.7; ctx.stroke();
    ctx.strokeStyle = '#FFFFFF'; ctx.globalAlpha *= 0.4; ctx.beginPath();
    for (let i = 0; i < 16; i++) { const x = -800 + rand(i + 50) * 1200 + Math.sin(t + i) * 10, y = 14 + rand(i + 70) * 120; ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x + 30), Y(y)); }
    ctx.lineWidth = 2.5 * Z; ctx.stroke(); ctx.restore();
  }
  if (onS(420, 200)) { // totora reeds at the shore
    ctx.beginPath();
    for (let i = 0; i < 26; i++) { const x = 330 + i * 7 + rand(i + 500) * 6, h = 50 + rand(i + 501) * 50, sw = Math.sin(t * 1.2 + i * 0.4) * 6; ctx.moveTo(X(x), Y(Math.min(G(x), 0) + 6)); ctx.quadraticCurveTo(X(x + sw * 0.3), Y(-h * 0.5), X(x + sw), Y(-h)); }
    ctx.strokeStyle = rgb(mixA(hx('#C9A35A'), gnd, 0.45)); ctx.lineWidth = 3 * Z; ctx.lineCap = 'round'; ctx.stroke();
  }
  ctx.save(); ctx.setLineDash([16 * Z, 9 * Z]); ctx.beginPath();
  for (let s2 = 0; s2 <= W + step; s2 += step) { const x = xs(s2); if (x > 1500 && Math.abs(x - 3830) > 150) ctx.lineTo(s2, Y(G(x)) + 12 * Z); else ctx.moveTo(s2, Y(G(x)) + 12 * Z); }
  ctx.strokeStyle = '#E8C690'; ctx.globalAlpha *= 0.55; ctx.lineWidth = 6 * Z; ctx.stroke(); ctx.restore();
  // Cusco: a small kingdom
  if (onS(2000, 500)) {
    const hs = [[1760, 0.8], [1840, 0.75], [2120, 0.8], [2210, 0.78], [1800, 1], [1890, 1.05], [2060, 1], [2160, 1.05], [2260, 0.95]];
    hs.forEach(([x, s], i) => house(X(x), Y(G(x) + (s < 0.9 ? -24 : 4)), 38, 26, Z * s, i % 3 ? '#D6B48E' : '#C9A7D6', '#E09A3C'));
    const cx2 = X(1975), cy2 = Y(G(1975) + 4);
    ctx.fillStyle = '#C8B6DE'; ctx.fillRect(cx2 - 60 * Z, cy2 - 42 * Z, 120 * Z, 42 * Z);
    ctx.fillStyle = GOLD; ctx.fillRect(cx2 - 60 * Z, cy2 - 36 * Z, 120 * Z, 8 * Z);
    ctx.fillStyle = '#2A1838'; [-34, 0, 34].forEach((d) => { ctx.beginPath(); ctx.moveTo(cx2 + (d - 7) * Z, cy2); ctx.lineTo(cx2 + (d - 5) * Z, cy2 - 20 * Z); ctx.lineTo(cx2 + (d + 5) * Z, cy2 - 20 * Z); ctx.lineTo(cx2 + (d + 7) * Z, cy2); ctx.fill(); });
    [[2300, 0.4, -1], [1700, 0.7, 1]].forEach(([x, sp2, d], i) => { const xx = x + d * ((t * 14 * sp2) % 120); llama(X(xx), Y(G(xx) + 6), Z * 0.9, { walk: 1, dir: d, seed: i + 4, blanket: i ? TEAL : MAG }); });
    [[2020, 1, 0.5], [2100, -1, 0.35], [1930, 1, 0]].forEach(([x, d, wv], i) => { const xx = x + d * wv * ((t * 18) % 80); person(X(xx), Y(G(xx) + 8), Z, { tunic: ['#E8467C', '#2EC4B6', '#FF8A3D'][i], c1: INK, c2: '#F5EBDD', walk: wv, dir: d, seed: i + 1 }); });
  }
  // Manco Capac, the legendary founder, walks from the lake to Cusco
  if (p < 0.21) {
    const mx = lerp(600, 1690, seg(p, 0.078, 0.15, ease.inOut)), walking = seg(p, 0.078, 0.082) * (1 - seg(p, 0.147, 0.152));
    person(X(mx), Y(G(mx) + 8), Z * 1.15, { tunic: GOLD, c1: '#D62A3A', c2: INK, royal: 1, staff: 1, walk: walking, seed: 9, sink: 26 * seg(p, 0.16, 0.19, ease.inOut) });
  }
  // the road, the gorge, the rope bridge
  if (onS(3830, 700)) {
    const ax = 3672, bx = 3988, ay = G(ax) - 6, by = G(bx) - 6, sag = 58;
    const qb = (k, y0) => [lerp(ax, bx, k), lerp(ay, by, k) + y0 + 4 * sag * k * (1 - k) + Math.sin(t * 1.6) * 3 * Math.sin(Math.PI * k)];
    ctx.save(); ctx.strokeStyle = '#C79A5C'; ctx.lineCap = 'round';
    ctx.beginPath(); for (let i = 0; i <= 24; i++) { const [x, y] = qb(i / 24, -40), [x2, y2] = qb(i / 24, 0); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(x2), Y(y2)); }
    ctx.lineWidth = 1.6 * Z; ctx.stroke();
    [[-40, 3], [0, 7]].forEach(([o, w]) => { ctx.beginPath(); for (let i = 0; i <= 24; i++) { const [x, y] = qb(i / 24, o); ctx.lineTo(X(x), Y(y)); } ctx.lineWidth = w * Z; ctx.strokeStyle = o ? '#E3B878' : '#A6773E'; ctx.stroke(); });
    ctx.restore();
    [ax, bx].forEach((x) => { ctx.fillStyle = '#8D86B0'; ctx.fillRect(X(x) - 10 * Z, Y(G(x)) - 46 * Z, 20 * Z, 48 * Z); });
    const lk = ((t * 0.07) % 1.2) - 0.1;
    if (lk > 0 && lk < 1) { const [lx, ly] = qb(lk, 0); llama(X(lx), Y(ly), Z * 0.85, { walk: 1, seed: 7, blanket: TEAL }); }
    const rx = 3300 + ((t * 40) % 340);
    person(X(rx), Y(G(rx) + 8), Z, { tunic: ORNG, c1: INK, c2: '#F5EBDD', walk: 1, seed: 5 });
    llama(X(4250), Y(G(4250) + 8), Z, { seed: 3, dir: -1 });
  }
  // the quipu keeper in front of the storehouses
  if (onS(7360, 500)) {
    const kx = X(7360), ky = Y(G(7360) + 10), s = Z * 1.25;
    person(kx, ky, s, { tunic: TEAL, c1: INK, c2: GOLD, seed: 3 });
    const cy3 = ky - 34 * s, x0 = kx - 70 * s, x1 = kx + 52 * s, cols = [MAG, GOLD, '#F5EBDD', ORNG, TEAL, '#F5EBDD', MAG, GOLD, ORNG, TEAL];
    lib.line(ctx, [[x0, cy3 - 4 * s], [kx - 14 * s, cy3], [x1, cy3 - 6 * s]], 1, { color: '#F5EBDD', width: 3.4 * s });
    const knotK = seg(p, 0.52, 0.565);
    cols.forEach((c, i) => {
      const x = lerp(x0 + 6 * s, x1 - 6 * s, i / 9), L = (52 + 18 * rand(i + 30)) * s, sw = Math.sin(t * 1.4 + i * 0.6) * 4 * s;
      ctx.beginPath(); ctx.moveTo(x, cy3 - 3 * s); ctx.quadraticCurveTo(x + sw * 0.4, cy3 + L * 0.5, x + sw, cy3 + L);
      ctx.strokeStyle = c; ctx.lineWidth = 2.6 * s; ctx.lineCap = 'round'; ctx.stroke();
      const nk = Math.floor(clamp(knotK * 1.6 - i * 0.06) * (2 + Math.floor(rand(i + 60) * 4)));
      for (let k = 0; k < nk; k++) { const f = 0.3 + k * 0.17; lib.circle(ctx, x + sw * f * f, cy3 + L * f, 3.4 * s, { fill: c }); }
    });
  }
  // Vilcabamba: jungle hills, a fire, the last free Inca
  if (onS(9100, 900)) {
    const fx = X(9060), fy = Y(G(9060) + 4), fl = 1 + 0.12 * Math.sin(t * 13) + 0.08 * Math.sin(t * 7.3), nightA = 1 - seg(p, 0.89, 0.95);
    ctx.save(); ctx.globalAlpha *= nightA;
    for (let i = 5; i >= 0; i--) lib.circle(ctx, fx, fy - 14 * Z, (18 + i * 19) * Z * fl, { fill: 'rgba(255,140,60,0.07)' });
    ctx.fillStyle = ORNG; ctx.beginPath(); ctx.moveTo(fx - 13 * Z, fy); ctx.quadraticCurveTo(fx - 12 * Z, fy - 24 * Z, fx, fy - 42 * Z * fl); ctx.quadraticCurveTo(fx + 12 * Z, fy - 24 * Z, fx + 13 * Z, fy); ctx.fill();
    ctx.fillStyle = '#FFD35C'; ctx.beginPath(); ctx.moveTo(fx - 6 * Z, fy); ctx.quadraticCurveTo(fx - 6 * Z, fy - 12 * Z, fx, fy - 24 * Z * fl); ctx.quadraticCurveTo(fx + 6 * Z, fy - 12 * Z, fx + 6 * Z, fy); ctx.fill();
    ctx.restore();
    person(X(8990), Y(G(8990) + 8), Z * 1.1, { tunic: '#B23A5A', c1: GOLD, c2: INK, royal: 1, seed: 6 });
    person(X(9135), Y(G(9135) + 8), Z, { tunic: '#2E8C86', c1: INK, c2: '#F5EBDD', seed: 2, dir: -1 });
    const tg = rgb(mixA(near, hx('#0C3A34'), 0.5)), tl = rgb(mixA(nearL, hx('#1F6B55'), 0.4));
    [[8700, 1], [8820, 1.2], [9300, 1.1], [9420, 0.9], [8600, 0.8]].forEach(([x, s], i) => {
      const bx = X(x), by = Y(G(x) + 10), k = Z * s, sw = Math.sin(t * 0.9 + i) * 2 * k;
      ctx.fillStyle = '#3B2440'; ctx.fillRect(bx - 4 * k, by - 70 * k, 8 * k, 70 * k);
      ctx.beginPath(); [[0, -96, 40], [-34, -74, 28], [34, -76, 30]].forEach(([dx, dy, r]) => { ctx.moveTo(bx + dx * k + sw + r * k, by + dy * k); ctx.arc(bx + dx * k + sw, by + dy * k, r * k, 0, TAU); });
      ctx.fillStyle = tg; ctx.fill();
      ctx.beginPath(); ctx.arc(bx - 10 * k + sw, by - 104 * k, 22 * k, 0, TAU); ctx.fillStyle = tl; ctx.fill();
    });
    const ff = seg(p, 0.81, 0.84) * (1 - seg(p, 0.88, 0.92));
    if (ff > 0) { ctx.save(); ctx.fillStyle = '#D8FF8A'; ctx.beginPath(); for (let i = 0; i < 26; i++) { const x = X(8700 + rand(i + 900) * 700 + Math.sin(t * 0.7 + i) * 30), y = Y(G(9000) - 40 - rand(i + 950) * 200 + Math.sin(t * 1.1 + i * 2) * 20), r = 2.6 * Z * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.7 + i))); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); } ctx.globalAlpha *= ff * 0.9; ctx.fill(); ctx.restore(); }
  }
  // the final wide shot: a herder and a llama on the ridge at sunrise
  if (p > 0.86) {
    const fx = X(10300), fy = Y(G(10300) + 8);
    llama(fx + 30 * Z, fy, Z * 1.1, { seed: 11, dir: -1, blanket: MAG });
    person(fx - 28 * Z, fy, Z * 1.05, { tunic: ORNG, c1: INK, c2: '#F5EBDD', seed: 4 });
  }
}

// ── Map of Tawantinsuyu ([lat, lon]) ──
const SAM = [[12, -72], [11, -64], [10, -61], [8, -59.5], [5.5, -54], [4, -51.5], [0, -50], [-1.5, -45], [-3, -40], [-5, -35.5], [-8, -35], [-13, -38.8], [-18, -39.5], [-23, -42], [-24, -46.5], [-28.5, -48.8], [-33, -52.5], [-35, -56], [-38.5, -58], [-41, -63], [-42.5, -64.5], [-47, -66], [-50, -68.5], [-52.5, -68.5], [-55, -67], [-54.5, -71], [-50, -75.5], [-45, -74], [-40, -73.8], [-35, -72.3], [-30, -71.4], [-27, -70.9], [-24, -70.5], [-21, -70.2], [-18.5, -70.4], [-17, -72.5], [-15.5, -75], [-14, -76.3], [-12, -77.2], [-9, -78.5], [-6, -81], [-4.5, -81.3], [-2.5, -80.8], [0, -80], [2.5, -78.5], [7, -77.8], [8.5, -77], [9, -76], [11, -74.5]];
const EMP = [[1.2, -77.5], [0.6, -79.6], [-1, -80.4], [-2.5, -80.6], [-4.5, -81.1], [-6, -80.8], [-9, -78.4], [-12, -77.1], [-14, -76.2], [-15.5, -74.9], [-17, -72.4], [-18.5, -70.4], [-21, -70.2], [-24, -70.5], [-27, -70.9], [-30, -71.4], [-33, -71.7], [-35, -72.2], [-35, -71], [-33, -69.3], [-29, -67.2], [-26.5, -65.3], [-23, -64.6], [-19, -63.8], [-16.5, -66], [-14.5, -68.4], [-12.5, -70.6], [-10, -73.6], [-7, -76.4], [-4, -77.8], [-1, -77.2]];
const ANDES = [[6, -75.6], [2, -77], [-1, -78.5], [-4, -79], [-7, -78], [-10, -77], [-13, -74], [-15, -71.5], [-18, -69], [-21, -68], [-24, -67.5], [-27, -68.5], [-30, -69.8], [-33, -70.2], [-37, -70.8], [-41, -71.6], [-46, -72.8], [-50, -73.3]];
const CUS = [-13.5, -72], QUI = [-0.2, -78.5], CAJ = [-7.16, -78.5], LON0 = wide ? -79 : tall ? -69 : -75;
const PIZ = [[8.9, -79.5], [3, -81.5], [-3.6, -80.8], [-6, -79.6], CAJ];
function mapEnv() {
  const MK = [[0.19, [CUS[0], CUS[1], 7]], [0.238, [-17, LON0, 1]], [0.34, [-17, LON0, 1.04]], [0.378, [CUS[0], CUS[1], 4.5]],
    [0.575, [CUS[0], CUS[1], 6]], [0.61, [-17, LON0, 1]], [0.685, [-17, LON0, 1.03]], [0.705, [-8, LON0 - 3, 1.6]], [0.722, [-7, -78.2, 1.9]], [0.745, [CAJ[0], CAJ[1], 9]]];
  const [clat, clon, mz] = lib.keys(p, MK, ease.inOut);
  const K = Math.min((0.9 * H) / 38, (0.92 * W) / 24) * mz;
  const P = (la, lo) => [W / 2 + (lo - clon) * K, H / 2 - (la - clat) * K];
  const path = (pts) => { ctx.beginPath(); pts.forEach(([la, lo], i) => { const [x, y] = P(la, lo); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
  const dim = seg(p, 0.6, 0.66) * 0.5;
  const og = ctx.createLinearGradient(0, 0, 0, H); og.addColorStop(0, rgb(mixA(hx('#1D1858'), hx('#0E0B2E'), dim))); og.addColorStop(1, rgb(mixA(hx('#2C1F70'), hx('#160F3C'), dim)));
  ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.strokeStyle = '#6A5FD0'; ctx.lineWidth = 3 * u; ctx.lineCap = 'round'; ctx.globalAlpha *= 0.6; ctx.beginPath();
  for (let i = 0; i < 60; i++) { const [x, y] = P(14 - rand(i + 3) * 60, -100 + rand(i + 9) * 70 + Math.sin(t * 0.5 + i) * 0.3), w = 12 * u; ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y - 6 * u, x + w, y); }
  ctx.stroke(); ctx.restore();
  path(SAM); ctx.fillStyle = rgb(mixA(hx('#3E3088'), hx('#261D58'), dim)); ctx.fill();
  ctx.strokeStyle = '#6C5AC0'; ctx.lineWidth = 3 * u; ctx.stroke();
  const grow = seg(p, 0.212, 0.278, ease.inOut), [cx, cy] = P(CUS[0], CUS[1]);
  if (grow > 0) {
    const R = grow * 24 * K;
    [[Math.PI, Math.PI * 1.68, MAG], [Math.PI * 1.68, Math.PI * 2.1, TEAL], [Math.PI * 0.1, Math.PI * 0.62, ORNG], [Math.PI * 0.62, Math.PI, GOLD]].forEach(([a0, a1, c]) => {
      ctx.save(); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.clip();
      path(EMP); ctx.fillStyle = c; ctx.globalAlpha *= 0.85 - dim * 0.6; ctx.fill(); ctx.restore();
    });
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip(); path(EMP); ctx.strokeStyle = '#FFE9B8'; ctx.lineWidth = 3 * u; ctx.stroke(); ctx.restore();
  }
  // the Andes spine
  const sz = Math.min(K * 0.75, 34 * u), tri = [[], [], []];
  for (let i = 0; i < ANDES.length - 1; i++) for (let k = 0; k < 4; k++) {
    const f = k / 4, la = lerp(ANDES[i][0], ANDES[i + 1][0], f), lo = lerp(ANDES[i][1], ANDES[i + 1][1], f), [x, y] = P(la, lo), h = sz * (0.8 + 0.5 * rand(i * 4 + k));
    tri[0].push([x - sz * 0.6, y, x, y - h, x + sz * 0.6, y]); tri[1].push([x, y - h, x + sz * 0.6, y, x + sz * 0.1, y]); tri[2].push([x, y - h, x - sz * 0.17, y - h * 0.7, x + sz * 0.17, y - h * 0.7]);
  }
  ['#7C66CC', '#A08AE6', '#F2EEFF'].forEach((c, j) => { ctx.beginPath(); tri[j].forEach((q) => { ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]); ctx.lineTo(q[4], q[5]); }); ctx.fillStyle = c; ctx.fill(); });
  // ten million people; smallpox sweeps south ahead of the Spanish
  const pop = seg(p, 0.3, 0.345), front = lerp(10, -38, seg(p, 0.6, 0.655, ease.inOut));
  if (pop > 0) {
    const ok = [], sick = [], r = Math.max(2.5, 3.2 * u * Math.sqrt(mz));
    for (let i = 0; i < 560; i++) {
      const la = 1.5 - rand(i + 1000) * 37, lo = -81.5 + rand(i + 2000) * 18;
      if (rand(i + 3000) > pop || !pip(la, lo)) continue;
      const [x, y] = P(la, lo), past = clamp((la - front) / 6);
      if (past > 0 && rand(i + 4000) < 0.5 * past) continue;
      (la > front ? sick : ok).push([x, y + Math.sin(t * 1.5 + i) * 1.2 * u]);
    }
    if (front < 9.9) {
      const fy = P(front, 0)[1];
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, fy); ctx.clip(); path(EMP); ctx.fillStyle = 'rgba(16,10,34,0.5)'; ctx.fill(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(0, fy - 40 * u, W, 40 * u); ctx.clip(); path(EMP);
      const gl = ctx.createLinearGradient(0, fy - 40 * u, 0, fy); gl.addColorStop(0, 'rgba(170,220,120,0)'); gl.addColorStop(1, 'rgba(170,220,120,' + 0.6 * (1 - seg(p, 0.66, 0.68)) + ')');
      ctx.fillStyle = gl; ctx.fill(); ctx.restore();
    }
    const dots = (L, c, a) => { ctx.save(); ctx.beginPath(); L.forEach(([x, y]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }); ctx.fillStyle = c; ctx.globalAlpha *= a; ctx.fill(); ctx.restore(); };
    dots(ok, '#FFF1D6', 0.95); dots(sick, '#B8DC8E', 0.8);
  }
  sun(cx, cy, Math.min(14 * u * Math.sqrt(mz), 70 * u), 1 - dim * 1.4, mz > 3);
  // civil war: north against south
  const war = seg(p, 0.65, 0.668) * (1 - seg(p, 0.7, 0.712));
  if (war > 0) {
    ctx.save(); ctx.globalAlpha *= war; ctx.beginPath();
    for (let i = 0; i <= 10; i++) { const [x, y] = P(-8.6 + (i % 2 ? 0.6 : -0.6), -81 + i * 0.8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = '#FF4D5E'; ctx.lineWidth = 4 * u; ctx.lineJoin = 'round'; ctx.stroke();
    const [qx, qy] = P(QUI[0], QUI[1]), lbl = { size: 30 * u, family: 'sans', weight: 700, color: WHITE, align: tall ? 'left' : 'right', baseline: 'middle' };
    lib.circle(ctx, qx, qy, 7 * u, { fill: MAG }); lib.circle(ctx, cx, cy, 7 * u, { fill: ORNG });
    lib.text(ctx, 'Atahualpa', qx + (tall ? 22 : -22) * u, qy, lbl); lib.text(ctx, 'Huáscar', cx + (tall ? 30 : -30) * u, cy + 44 * u, lbl);
    ctx.restore();
  }
  // Pizarro's men: 170 dots
  const pk = seg(p, 0.69, 0.725, ease.inOut);
  if (pk > 0 && p < 0.75) {
    const L = [0]; for (let i = 1; i < PIZ.length; i++) L.push(L[i - 1] + Math.hypot(PIZ[i][0] - PIZ[i - 1][0], PIZ[i][1] - PIZ[i - 1][1]));
    let d = pk * L[L.length - 1], j = 1; while (j < L.length - 1 && L[j] < d) j++;
    const f = (d - L[j - 1]) / (L[j] - L[j - 1]), at = P(lerp(PIZ[j - 1][0], PIZ[j][0], f), lerp(PIZ[j - 1][1], PIZ[j][1], f));
    ctx.save(); ctx.setLineDash([6 * u, 8 * u]); ctx.beginPath(); PIZ.slice(0, j).forEach(([la, lo], i) => { const [x, y] = P(la, lo); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.lineTo(at[0], at[1]);
    ctx.strokeStyle = '#D8DCE8'; ctx.lineWidth = 2.4 * u; ctx.globalAlpha *= 0.7; ctx.stroke(); ctx.restore();
    ctx.beginPath(); const rr = Math.max(1.2, 1.3 * u * Math.sqrt(mz));
    for (let i = 0; i < 170; i++) { const a = i * 2.39996, rd = rr * 2.4 * Math.sqrt(i); ctx.moveTo(at[0] + Math.cos(a) * rd + rr, at[1] + Math.sin(a) * rd); ctx.arc(at[0] + Math.cos(a) * rd, at[1] + Math.sin(a) * rd, rr, 0, TAU); }
    ctx.fillStyle = '#E6E9F2'; ctx.save(); ctx.globalAlpha *= 1 - seg(p, 0.722, 0.736); ctx.fill(); ctx.restore();
    lib.text(ctx, '~170 men', at[0] - 64 * u * Math.sqrt(mz), at[1], { size: 28 * u, family: 'mono', weight: 700, color: '#E6E9F2', align: 'right', baseline: 'middle', alpha: seg(p, 0.692, 0.7) * (1 - seg(p, 0.724, 0.732)) });
  }
  const nk = seg(p, 0.315, 0.35, ease.out) * (1 - seg(p, 0.352, 0.36));
  if (nk > 0) {
    const nx = wide ? M : tall ? W / 2 : W * 0.76, ny = tall ? H * 0.18 : H * (wide ? 0.4 : 0.3), na = wide ? 'left' : 'center';
    lib.text(ctx, lib.count(nk, 0, 10) + ' million+', nx, ny, { size: 92 * u, family: 'sans', weight: 800, color: GOLD, align: na, alpha: clamp(nk * 3) });
    lib.text(ctx, 'PEOPLE', nx + (wide ? 4 * u : 0), ny + 50 * u, { size: 26 * u, family: 'mono', weight: 700, color: WHITE, align: na, tracking: 0.14, alpha: clamp(nk * 3) });
  }
}
function pip(la, lo) {
  let c = false;
  for (let i = 0, j = EMP.length - 1; i < EMP.length; j = i++) { const [ay, ax] = EMP[i], [by, bx] = EMP[j]; if ((ay > la) !== (by > la) && lo < ((bx - ax) * (la - ay)) / (by - ay) + ax) c = !c; }
  return c;
}

// ── The ransom room at Cajamarca ──
function room() {
  const z = lib.keys(p, [[0.725, 1.25], [0.75, 1.02], [0.835, 1.09]], ease.inOut), fl = H * (tall ? 0.68 : 0.8), dark = seg(p, 0.784, 0.806, ease.inOut);
  lib.camera(ctx, { zoom: z }, () => {
    ctx.fillStyle = '#4E3880'; ctx.fillRect(-W, -H, W * 3, H * 3);
    ctx.beginPath();
    for (let r = -1; r < 13; r++) { let x = -W * 0.2 + (r % 2) * 40 * u; const y = r * 64 * u; while (x < W * 1.2) { const w = (90 + 70 * rand(r * 31 + Math.floor(x))) * u; ctx.roundRect(x + 3 * u, y + 3 * u, w - 6 * u, 58 * u, 14 * u); x += w; } }
    ctx.fillStyle = '#5D4593'; ctx.fill();
    const nx = [0.2, 0.38, 0.62], nw = 70 * u, top = fl - 520 * u;
    nx.forEach((f, i) => {
      const x = W * f, win = i === 1, w0 = win ? nw * 1.5 : nw;
      ctx.beginPath(); ctx.moveTo(x - w0, top + 250 * u); ctx.lineTo(x - w0 * 0.72, top); ctx.lineTo(x + w0 * 0.72, top); ctx.lineTo(x + w0, top + 250 * u); ctx.closePath();
      if (!win) { ctx.fillStyle = '#2E1F55'; ctx.fill(); return; }
      lib.mask(ctx, (c) => { c.moveTo(x - w0, top + 250 * u); c.lineTo(x - w0 * 0.72, top); c.lineTo(x + w0 * 0.72, top); c.lineTo(x + w0, top + 250 * u); c.closePath(); }, () => {
        const g = ctx.createLinearGradient(0, top, 0, top + 250 * u); g.addColorStop(0, rgb(mixA(hx('#3D7AD2'), hx('#2A1650'), dark))); g.addColorStop(1, rgb(mixA(hx('#FFB06A'), hx('#B2406A'), dark)));
        ctx.fillStyle = g; ctx.fillRect(x - w0, top, w0 * 2, 250 * u);
        sun(x, top + lerp(95, 300, dark) * u, 40 * u, 1 - dark * 0.6, false);
      });
    });
    ctx.fillStyle = '#33255E'; ctx.fillRect(-W, fl, W * 3, H);
    const wx = W * nx[1], gA = 1 - dark * 0.8;
    for (let i = 0; i < 4; i++) lib.circle(ctx, wx, top + 125 * u, (150 + i * 90) * u, { fill: 'rgba(255,190,110,' + 0.05 * gA + ')' });
    ctx.beginPath(); ctx.moveTo(wx - nw * 1.4, top + 250 * u); ctx.lineTo(wx + nw * 1.4, top + 250 * u); ctx.lineTo(wx + nw * 3.4, fl + 140 * u); ctx.lineTo(wx - nw * 0.6, fl + 140 * u);
    ctx.fillStyle = 'rgba(255,214,140,' + 0.1 * gA + ')'; ctx.fill();
    const reach = fl - 330 * u;
    ctx.save(); ctx.setLineDash([18 * u, 12 * u]); ctx.strokeStyle = '#FF5A6A'; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.moveTo(W * 0.08, reach); ctx.lineTo(W * (tall ? 0.9 : 0.74), reach); ctx.stroke(); ctx.restore();
    const hk = seg(p, 0.748, 0.778, ease.out), x0 = W * 0.1, x1 = W * (tall ? 0.88 : 0.72);
    const top2 = (x) => fl - hk * 320 * u * (0.86 + 0.14 * Math.sin((x - x0) / (90 * u))) * ss(Math.min((x - x0) / (120 * u), (x1 - x) / (120 * u)) + 0.15);
    if (hk > 0) {
      const g = ctx.createLinearGradient(0, reach, 0, fl); g.addColorStop(0, '#FFD35C'); g.addColorStop(1, '#D9801E');
      ctx.beginPath(); ctx.moveTo(x0, fl); for (let x = x0; x <= x1; x += 12 * u) ctx.lineTo(x, top2(x)); ctx.lineTo(x1, fl); ctx.fillStyle = g; ctx.fill();
      for (let i = 0; i < 46; i++) {
        const x = lerp(x0 + 40 * u, x1 - 40 * u, rand(i + 70)), y = lerp(top2(x) + 14 * u, fl - 10 * u, rand(i + 90) * rand(i + 95));
        if (rand(i + 99) < 0.3) lib.circle(ctx, x, y, 11 * u, { fill: '#DCE0EC' }); else lib.circle(ctx, x, y, 12 * u, { fill: '#FFE18A', stroke: '#E0951F', lineWidth: 2.5 * u });
      }
      ctx.fillStyle = '#FFF6D6'; ctx.beginPath();
      for (let i = 0; i < 9; i++) { const x = lerp(x0, x1, rand(i + 300)), y = top2(x) + 10 * u, s = 14 * u * Math.max(0, Math.sin(t * 3 + i * 2)); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.25, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.25, y); ctx.moveTo(x - s, y); ctx.lineTo(x, y - s * 0.25); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 0.25); }
      ctx.fill();
    }
    const aA = 1 - seg(p, 0.786, 0.8);
    if (aA > 0 && !tall) { ctx.save(); ctx.globalAlpha *= aA; person(W * 0.85, fl + 8 * u, (wide ? 3.6 : 2.8) * u, { tunic: '#B23A5A', c1: GOLD, c2: INK, royal: 1, seed: 8, dir: -1 }); ctx.restore(); }
    ctx.fillStyle = 'rgba(10,6,30,' + dark * 0.5 + ')'; ctx.fillRect(-W, -H, W * 3, H * 3);
  });
}

// ── Compose: panorama → map → panorama → map → room → panorama, each change a dive or a pull ──
const XF = [[0.19, 0.212, panorama, mapEnv], [0.356, 0.378, mapEnv, panorama], [0.578, 0.6, panorama, mapEnv], [0.725, 0.745, mapEnv, room], [0.812, 0.834, room, panorama]];
lib.bg(ctx, W, H, rgb(skyT));
let cur = panorama, mixed = false;
for (const [a, b, A, B] of XF) {
  if (p >= b) cur = B;
  else if (p > a) { A(); ctx.save(); ctx.globalAlpha = ss((p - a) / (b - a)); B(); ctx.restore(); mixed = true; break; }
  else break;
}
if (!mixed) cur();
const vg = ctx.createLinearGradient(0, tall ? 0 : H * 0.55, 0, tall ? H * 0.42 : H);
vg.addColorStop(tall ? 1 : 0, 'rgba(10,6,36,0)'); vg.addColorStop(tall ? 0 : 1, 'rgba(10,6,36,0.6)');
ctx.fillStyle = vg; ctx.fillRect(0, tall ? 0 : H * 0.55, W, H * (tall ? 0.42 : 0.45));

// ── Copy ──
function cap(a, b, chip, str, o) {
  o = o || {};
  if (p < a || p > b) return;
  const kin = seg(p, a, a + 0.014), kout = seg(p, b - 0.008, b, ease.in), size = (o.size || 58) * u, mw = Math.min(W - 2 * M, (wide ? 1450 : 900) * u), lh = 1.12;
  ctx.save(); ctx.font = lib.font({ size, family: 'sans', weight: 700 }); const n = lib.wrap(ctx, str, mw).length; ctx.restore();
  const chipH = 42 * u, y = tall ? M + size + (chip ? chipH + 22 * u : 0) : H - M - (n - 1) * size * lh - size * 0.12 - (o.sub ? 50 * u : 0), rise = -24 * u * kout;
  if (chip) {
    ctx.save(); ctx.font = lib.font({ size: 26 * u, family: 'mono', weight: 700 }); const cw = ctx.measureText(chip).width + 34 * u + chip.length * 3.4 * u; ctx.restore();
    const ck = seg(p, a, a + 0.01, ease.outQuint);
    lib.rrect(ctx, M, y - size - chipH - 4 * u + rise, cw * ck, chipH, chipH / 2, { fill: GOLD, alpha: 1 - kout });
    lib.text(ctx, chip, M + 15 * u, y - size - chipH / 2 - 3 * u + rise, { size: 26 * u, family: 'mono', weight: 700, color: INK, baseline: 'middle', tracking: 0.1, alpha: clamp(ck * 5 - 4) * (1 - kout) });
  }
  lib.words(ctx, str, M, y + rise, kin, { size, family: 'sans', weight: 700, color: WHITE, maxWidth: mw, lineHeight: lh, alpha: 1 - kout, stagger: 0.5 });
  if (o.sub) lib.text(ctx, o.sub, M, y + (n - 1) * size * lh + 50 * u + rise, { size: 30 * u, family: 'sans', weight: 500, color: '#FFE3A8', maxWidth: mw, alpha: seg(p, a + 0.01, a + 0.02) * (1 - kout) });
}
{ // title
  const ki = seg(p, 0.006, 0.026), ko = seg(p, 0.064, 0.074, ease.in), ty = tall ? M + 150 * u : H * 0.3;
  if (ki > 0 && ko < 1) {
    lib.words(ctx, 'The Inca,', M, ty - 26 * u * ko, ki, { size: (tall ? 130 : 150) * u, family: 'sans', weight: 800, color: WHITE, alpha: 1 - ko, stagger: 0.3 });
    lib.words(ctx, 'in one minute', M + 4 * u, ty + 82 * u - 26 * u * ko, seg(p, 0.016, 0.036), { size: 62 * u, family: 'sans', weight: 600, color: '#FFD35C', alpha: 1 - ko });
  }
}
cap(0.078, 0.142, 'LEGEND', 'Manco Cápac, the first Inca, rose from Lake Titicaca');
cap(0.148, 0.2, 'c. 1200s', 'A small kingdom in the Cusco valley');
cap(0.214, 0.263, '1438', 'Pachacuti turns it into an empire');
cap(0.267, 0.31, 0, 'Tawantinsuyu: “the four parts together”');
cap(0.314, 0.36, 'c. 1500', 'The largest empire in the Americas');
cap(0.38, 0.44, 0, 'The Qhapaq Ñan: ~40,000 km of roads and rope bridges');
cap(0.448, 0.5, 'c. 1450', 'Machu Picchu, a royal estate in the clouds');
cap(0.512, 0.548, 0, 'No writing: records were knotted into quipu cords');
cap(0.552, 0.59, 0, 'Mit’a labour filled the qullqa storehouses');
cap(0.604, 0.646, '1520s', 'Smallpox arrives before the Spanish do');
cap(0.65, 0.69, 0, 'Emperor Huayna Cápac dies. His sons go to war');
cap(0.694, 0.74, '1532', 'Pizarro and ~170 men seize Atahualpa');
cap(0.75, 0.784, 'CAJAMARCA', 'A room filled with gold and silver for his ransom');
cap(0.788, 0.83, '1533', 'Atahualpa is executed anyway');
cap(0.842, 0.895, '1537–1572', 'Resistance holds out in Vilcabamba', { sub: 'until Túpac Amaru, the last Inca ruler, is captured' });
cap(0.9, 1.01, 0, 'Quechua is still spoken by millions today.', { size: 64 });
`,
};
