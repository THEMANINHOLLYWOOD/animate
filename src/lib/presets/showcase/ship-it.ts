// Ship it — product demo. Hand-built example film in the scene format Claude generates.
// Brief: A crisp, Linear-keynote-style product demo for a fictional dev tool called Relay: a floating light app window, a cursor that opens a command palette, types "deploy to production" and hits Enter, a build/test/deploy pipeline that checks off, a success toast, and a latency chart that drops, with the headline "Every deploy. One keystroke." and an indigo Relay wordmark at the end.
export const film = {
  id: "ex-ship-it",
  title: "Ship it — product demo",
  aspect: "16:9" as const,
  duration: 15,
  prompt: "A crisp, Linear-keynote-style product demo for a fictional dev tool called Relay: a floating light app window, a cursor that opens a command palette, types \"deploy to production\" and hits Enter, a build/test/deploy pipeline that checks off, a success toast, and a latency chart that drops, with the headline \"Every deploy. One keystroke.\" and an indigo Relay wordmark at the end.",
  code: String.raw`
const { ease, seg, keys, u, clamp, lerp } = lib;
const BG = '#F6F7F9', CARD = '#FFFFFF', LINE = '#E3E6EA', INK = '#0E1116', SUB = '#5B6470', FAINT = '#9AA3AE';
const IND = '#5B5BF7', IND_SOFT = '#EEEEFE', OK = '#16A34A', OK_SOFT = '#E7F6EC';
lib.bg(ctx, W, H, BG);

const wide = W / H >= 1.2, tall = W / H < 0.8;
const cx = W / 2, cy = H / 2;
const tt = p * T, at = (q) => q * T;           // spring tracks run in seconds, keyed by p
const D = Math.min(W * 0.9 / 1440, H * (wide ? 0.82 : 0.8) / 880);
const ZM = wide ? 1 : tall ? 1.5 : 1.32;                   // non-wide frames push in harder

// ── helpers (all in design px inside the window transform) ─────────
const R = (x, y, w, h, r, o) => lib.rrect(ctx, x, y, w, h, r, o);
const Tx = (s, x, y, size, color, o) => lib.text(ctx, s, x, y, Object.assign({ size: size, color: color, family: 'sans', weight: 400 }, o || {}));
const Mo = (s, x, y, size, color, o) => Tx(s, x, y, size, color, Object.assign({ family: 'mono' }, o || {}));
function soft(x, y, w, h, r, spread, oy, a, rgb) {   // layered soft shadow (cheap, no blur filter)
  const n = 14;
  for (let i = n; i >= 1; i--) { const f = i / n, e = spread * f; R(x - e * 0.8, y + oy * (0.3 + 0.7 * f) - e * 0.5, w + 1.6 * e, h + 1.6 * e, r + e, { fill: 'rgba(' + (rgb || '16,24,40') + ',' + (a * 2.2 / n * (1 - f) * (1 - f)).toFixed(4) + ')' }); }
}
function noShadow() { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
function check(x, y, r, k, o) {
  if (k <= 0) return;
  lib.circle(ctx, x, y, r * lib.spring(clamp(k * 1.6), { damping: 0.5, freq: 2.4 }), { fill: OK, alpha: (o || 1) * clamp(k * 3) });
  lib.line(ctx, [[x - r * 0.42, y + r * 0.02], [x - r * 0.1, y + r * 0.34], [x + r * 0.45, y - r * 0.3]], seg(k, 0.3, 1, ease.out), { color: '#fff', width: r * 0.22, cap: 'round', alpha: o || 1 });
}
function spinner(x, y, r) {
  lib.circle(ctx, x, y, r, { stroke: IND_SOFT, lineWidth: 3 });
  lib.ring(ctx, x, y, r, 0.28, { color: IND, width: 3, start: (t * 400) % 360 });
}
function mark(x, y, s, a) {
  R(x - s / 2, y - s / 2, s, s, s * 0.26, { fill: IND, alpha: a });
  lib.line(ctx, [[x - s * 0.24, y - s * 0.17], [x - s * 0.04, y], [x - s * 0.24, y + s * 0.17]], 1, { color: '#fff', width: s * 0.09, cap: 'round', alpha: a });
  lib.line(ctx, [[x + s * 0.03, y + s * 0.19], [x + s * 0.25, y + s * 0.19]], 1, { color: '#fff', width: s * 0.09, cap: 'round', alpha: a });
}
function cmdG(x, y, sz, color, lw, a) {   // the command-key glyph, drawn (fonts may lack it)
  const q = sz * 0.17, r = sz * 0.13, d = q + r * 0.85;
  ctx.save(); ctx.globalAlpha *= a == null ? 1 : a; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  ctx.rect(x - q, y - q, 2 * q, 2 * q);
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((s2) => { ctx.moveTo(x + s2[0] * d + r, y + s2[1] * d); ctx.arc(x + s2[0] * d, y + s2[1] * d, r, 0, Math.PI * 2); });
  ctx.stroke(); ctx.restore();
}
function arrowG(pts, head, color, lw, a) {
  lib.line(ctx, pts, 1, { color: color, width: lw, cap: 'round', alpha: a });
  const e1 = pts[pts.length - 1], e0 = pts[pts.length - 2], an = Math.atan2(e1[1] - e0[1], e1[0] - e0[0]);
  lib.line(ctx, [[e1[0] - head * Math.cos(an - 0.7), e1[1] - head * Math.sin(an - 0.7)], e1, [e1[0] - head * Math.cos(an + 0.7), e1[1] - head * Math.sin(an + 0.7)]], 1, { color: color, width: lw, cap: 'round', alpha: a });
}
function cursor(x, y, press, a) {
  if (a <= 0) return;
  ctx.save(); ctx.translate(x, y); const s = 1.15 * (1 - 0.14 * press); ctx.scale(s, s); ctx.globalAlpha *= a;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 23); ctx.lineTo(5.6, 17.6); ctx.lineTo(9.6, 26.6); ctx.lineTo(13.4, 25); ctx.lineTo(9.5, 16.2); ctx.lineTo(16.8, 16.2); ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 6 * D * u; ctx.shadowOffsetY = 2 * D * u;
  ctx.fillStyle = INK; ctx.fill(); noShadow(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}
function ripple(x, y, k) {
  if (k <= 0 || k >= 1) return;
  lib.circle(ctx, x, y, 10 + 34 * ease.out(k), { stroke: IND, lineWidth: 2.5 * (1 - k), alpha: 1 - k });
  lib.circle(ctx, x, y, 14 * ease.out(k), { fill: IND, alpha: 0.18 * (1 - k) });
}

// ── timeline (fractions of the film) ───────────────────────────────
const P = { winIn: 0.085, keyIn: 0.165, keyPress: 0.21, palOpen: 0.27, type0: 0.297, type1: 0.395, hover: 0.41, click: 0.448,
  palClose: 0.462, row: 0.47, steps: [0.49, 0.55, 0.61], stepsEnd: 0.665, toast: 0.655, chart0: 0.715, chart1: 0.8, out: 0.845, mark: 0.875 };
const QUERY = 'deploy to production';
const typed = clamp((p - P.type0) / (P.type1 - P.type0));
let nChars = 0;                                 // slightly human typing rhythm, still pure in p
for (let i = 0; i < QUERY.length; i++) { const ti = (i + 0.35 * (lib.rand(i + 7) - 0.5)) / QUERY.length; if (typed > ti) nChars = i + 1; }
const charTime = (i) => at(lerp(P.type0, P.type1, (i + 0.35 * (lib.rand(i + 7) - 0.5)) / QUERY.length));

// ── camera: subtle pushes to the active area ───────────────────────
const cam = keys(p, [
  [0.0, [720, 470, 0.94]], [P.winIn + 0.07, [720, 450, 1]], [0.2, [720, 440, 1]],
  [0.29, [720, 330, 1.12 * ZM]], [0.47, [720, 340, 1.17 * ZM]],
  [0.535, [560, 620, 1.4 * ZM]], [0.625, [560, 630, 1.46 * ZM]],
  [0.672, [720, 440, wide ? 0.98 : 1.06]], [0.69, [720, 440, wide ? 0.98 : 1.06]], [0.72, [1122, 640, 1.48 * ZM]], [0.83, [1122, 650, 1.56 * ZM]],
  [0.9, [720, 440, 0.9]], [1, [720, 440, 0.88]]], ease.inOut);
const winA = seg(p, P.winIn, P.winIn + 0.06, ease.out) * (1 - seg(p, P.out, P.out + 0.05, ease.in));
const winRise = (1 - lib.spring(seg(p, P.winIn, P.winIn + 0.14), { damping: 0.75, freq: 2.2 })) * 220 + seg(p, P.out, P.out + 0.06, ease.in) * 60;
const winS = lerp(0.92, 1, lib.spring(seg(p, P.winIn, P.winIn + 0.14), { damping: 0.75, freq: 2.2 })) * lerp(1, 0.94, seg(p, P.out, P.out + 0.06, ease.in));

// soft indigo atmosphere behind the window
const glow = ctx.createRadialGradient(cx, cy + 80 * u, 0, cx, cy + 80 * u, Math.max(W, H) * 0.6);
glow.addColorStop(0, 'rgba(91,91,247,0.10)'); glow.addColorStop(1, 'rgba(91,91,247,0)');
lib.layer(ctx, 'Backdrop glow', () => { ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H); });

// ── data ───────────────────────────────────────────────────────────
const ROWS = [
  ['a41f9c2', 'main', 'Production', '2h ago'], ['7be03d1', 'fix/cache-ttl', 'Staging', '5h ago'],
  ['c9120ae', 'main', 'Production', 'Yesterday'], ['e55b7f0', 'feat/edge-auth', 'Preview', 'Yesterday']];
const STEPS = [['Build', 'relay build --prod', '12.4'], ['Test', '1,284 tests passed', '18.9'], ['Deploy', '3 regions · 0 errors', '9.7']];
const CMDS = ['Create preview environment', 'Rollback production', 'Deploy to staging', 'Deploy to production · canary 10%', 'Deploy to production', 'Open pipeline logs', 'Invite teammate'];
const HINT = ['', 'R', '', '', 'ret', 'L', ''];
const PTS = 44, DROP = 27;
const lat = (i) => i < DROP ? 236 + 14 * lib.noise(i * 0.55, 3) + 6 * lib.noise(i * 1.9, 8)
  : lerp(236, 86, ease.outExpo(clamp((i - DROP + 1) / 6))) + 4 * lib.noise(i * 0.8, 5);

// palette filtering: per item, a spring-tracked slot index and visibility
const matchAt = (n) => { const q = QUERY.slice(0, n); return CMDS.map((c) => c.toLowerCase().indexOf(q) >= 0); };
const slotKeys = CMDS.map((c, i) => [[0, i]]), visKeys = CMDS.map((c, i) => [[0, i < 6 ? 1 : 0]]), cntKeys = [[0, 6]];
for (let n = 1; n <= QUERY.length; n++) {
  const m = matchAt(n), mp = matchAt(n - 1);
  if (m.join() === mp.join()) continue;
  let s = 0; const ct = charTime(n - 1);
  CMDS.forEach((c, i) => { visKeys[i].push([ct, m[i] ? 1 : 0]); if (m[i]) { slotKeys[i].push([ct, s]); s++; } });
  cntKeys.push([ct, s]);
}
const hiKeys = [[0, 0], [at(P.hover + 0.012), 1]];

// ── draw the product window ────────────────────────────────────────
const WX = 0, WY = 0, WW = 1440, WH = 880;
function drawWindow() {
  ctx.save();
  lib.layer(ctx, 'Window', () => {
  soft(WX, WY, WW, WH, 18, 80, 40, 0.18); R(WX, WY, WW, WH, 18, { fill: CARD });
  R(WX, WY, WW, WH, 18, { stroke: LINE, lineWidth: 1.2 });
  // title bar
  lib.line(ctx, [[0, 48], [WW, 48]], 1, { color: LINE, width: 1 });
  [0, 1, 2].forEach((i) => lib.circle(ctx, 26 + i * 22, 24, 6.5, { fill: '#E1E4E8' }));
  Mo('relay  /  orbit-web', WW / 2, 30, 14, FAINT, { align: 'center' });
  });
  // sidebar
  lib.layer(ctx, 'Sidebar', () => {
  R(1, 49, 239, WH - 50, 0, { fill: '#FAFBFC' });
  lib.line(ctx, [[240, 48], [240, WH]], 1, { color: LINE, width: 1 });
  mark(44, 88, 30, 1); Tx('Relay', 70, 95, 19, INK, { weight: 600, tracking: -0.01 });
  ['Overview', 'Deploys', 'Pipelines', 'Environments', 'Metrics', 'Settings'].forEach((s, i) => {
    const y = 150 + i * 44, on = i === 1;
    if (on) R(16, y - 16, 208, 36, 9, { fill: IND_SOFT });
    R(34, y - 6, 14, 14, 4, { stroke: on ? IND : FAINT, lineWidth: 1.8 });
    Tx(s, 62, y + 6, 15, on ? IND : SUB, { weight: on ? 600 : 500 });
  });
  R(16, WH - 74, 208, 54, 12, { fill: CARD, stroke: LINE, lineWidth: 1 });
  lib.circle(ctx, 42, WH - 47, 13, { fill: '#DADDFD' }); Tx('Orbit Labs', 64, WH - 42, 14, INK, { weight: 600 });
  });
  // header
  lib.layer(ctx, 'Page header', () => {
  Tx('Deploys', 280, 116, 30, INK, { weight: 600, tracking: -0.02 });
  Tx('orbit-web  ·  4 environments  ·  last deploy 2h ago', 280, 146, 15, SUB);
  });
  lib.layer(ctx, 'New deploy button', () => {
  const hov = seg(p, 0.15, 0.17) * (1 - seg(p, 0.25, 0.27));
  ctx.save(); if (hov > 0) soft(1196, 88, 204, 44, 11, 14, 8, 0.4 * hov, '70,70,224');
  R(1196, 88, 204, 44, 11, { fill: lib.mix(IND, '#4646E0', hov) }); ctx.restore();
  Tx('New deploy', 1216, 116, 15, '#fff', { weight: 600 });
  R(1336, 98, 48, 24, 6, { fill: 'rgba(255,255,255,0.18)' }); cmdG(1352, 110, 16, '#fff', 1.5); Tx('K', 1368, 115.5, 13, '#fff', { weight: 600, align: 'center' });
  });
  // deploys table
  lib.layer(ctx, 'Deploys table', () => {
  R(280, 176, 1120, 268, 14, { stroke: LINE, lineWidth: 1, fill: CARD });
  ['Commit', 'Branch', 'Environment', 'Status', 'When'].forEach((h, i) => Tx(h.toUpperCase(), [304, 470, 700, 920, 1260][i], 206, 11.5, FAINT, { weight: 600, tracking: 0.08 }));
  lib.line(ctx, [[280, 222], [1400, 222]], 1, { color: LINE, width: 1 });
  const ins = ease.inOut(seg(p, P.row, P.row + 0.04));
  lib.mask(ctx, (c) => c.rect(280, 223, 1120, 220), () => {
    const live = seg(p, P.stepsEnd - 0.005, P.stepsEnd + 0.02);
    const all = [['f30c8b4', 'main', 'Production', 'Just now', true]].concat(ROWS);
    all.forEach((r, i) => {
      const y = 223 + (i - 1 + ins) * 54;
      if (i === 0 && ins <= 0) return;
      const ra = i === 0 ? ins : 1;
      if (i === 0) R(281, y, 1118, 54, 0, { fill: IND_SOFT, alpha: 0.6 * (1 - seg(p, 0.6, 0.7)) * ra });
      if (i > 0) lib.line(ctx, [[300, y], [1380, y]], 1, { color: '#EEF0F3', width: 1 });
      Mo(r[0], 304, y + 33, 14, INK, { alpha: ra }); Tx(r[1], 470, y + 33, 15, SUB, { alpha: ra });
      const prod = r[2] === 'Production';
      R(700, y + 15, prod ? 102 : 82, 25, 12.5, { fill: prod ? IND_SOFT : '#F1F3F5', alpha: ra });
      Tx(r[2], 712, y + 32, 13, prod ? IND : SUB, { weight: 600, alpha: ra });
      const run = r[4] && live < 1;
      const st = r[4] ? (live < 1 ? ['Building', 'Testing', 'Deploying'][p < P.steps[1] ? 0 : p < P.steps[2] ? 1 : 2] : 'Live') : 'Live';
      lib.circle(ctx, 928, y + 27, 4.5, { fill: run ? IND : OK, alpha: ra * (run ? 0.55 + 0.45 * Math.cos(t * 7) : 1) });
      Tx(st, 944, y + 32, 15, INK, { weight: 500, alpha: ra }); Tx(r[3], 1260, y + 33, 15, SUB, { alpha: ra });
    });
  });
  });
  // pipeline card
  lib.layer(ctx, 'Pipeline card', () => {
  R(280, 470, 540, 380, 14, { stroke: LINE, lineWidth: 1, fill: CARD });
  const running = p >= P.steps[0];
  Tx('Pipeline', 304, 508, 18, INK, { weight: 600 }); Mo(running ? 'run #1842  ·  main@f30c8b4' : 'idle', 304, 532, 13, FAINT);
  const tot = clamp((p - P.steps[0]) / (P.stepsEnd - P.steps[0]));
  STEPS.forEach((s, i) => {
    const y = 586 + i * 76, a = P.steps[i], b = i < 2 ? P.steps[i + 1] : P.stepsEnd;
    const k = clamp((p - a) / (b - a - 0.012)), done = seg(p, b - 0.012, b + 0.01);
    if (k <= 0) lib.circle(ctx, 318, y, 13, { stroke: LINE, lineWidth: 2.5 });
    else if (done <= 0) spinner(318, y, 13);
    check(318, y, 14, done);
    Tx(s[0], 346, y - 3, 16, k > 0 ? INK : FAINT, { weight: 600 });
    Mo(s[1], 346, y + 19, 12.5, FAINT, { alpha: 0.4 + 0.6 * clamp(k * 2) });
    if (k > 0) Mo(lib.count(ease.out(k), 0, +s[2], 1) + 's', 796, y + 2, 13, done > 0 ? OK : SUB, { align: 'right' });
    R(600, y + 18, 196, 4, 2, { fill: '#EEF0F3' });
    if (k > 0) R(600, y + 18, 196 * ease.inOut(k), 4, 2, { fill: lib.mix(IND, OK, done) });
    if (i < 2) lib.line(ctx, [[318, y + 20], [318, y + 56]], 1, { color: LINE, width: 2 });
  });
  R(304, 812, 492, 6, 3, { fill: '#EEF0F3' });
  if (tot > 0) R(304, 812, 492 * tot, 6, 3, { fill: tot >= 1 ? OK : IND });
  R(684, 488, 112, 26, 13, { fill: tot >= 1 ? OK_SOFT : running ? IND_SOFT : '#F1F3F5' });
  Tx(tot >= 1 ? 'Succeeded' : running ? 'Running' : 'Idle', 740, 506, 12.5, tot >= 1 ? OK : running ? IND : SUB, { weight: 600, align: 'center' });
  });
  // latency chart card
  lib.layer(ctx, 'Latency chart', () => {
  R(844, 470, 556, 380, 14, { stroke: LINE, lineWidth: 1, fill: CARD });
  Tx('p95 latency', 868, 508, 18, INK, { weight: 600 }); Mo('production · last 6h', 868, 532, 13, FAINT);
  const ck = seg(p, P.chart0, P.chart1, ease.inOut);
  const shown = lerp(DROP - 1, PTS - 1, ck);
  const fi = Math.floor(shown), cur = lerp(lat(fi), lat(Math.min(PTS - 1, fi + 1)), shown - fi);
  const nw = Tx(Math.round(cur) + '', 868, 600, 46, INK, { weight: 600, tracking: -0.03 }).width;
  Tx('ms', 868 + nw + 8, 600, 18, SUB, { weight: 500 });
  const dk = seg(p, P.chart1 - 0.02, P.chart1 + 0.015, ease.out);
  R(1290, 572, 86, 30, 15, { fill: OK_SOFT, alpha: dk }); arrowG([[1311, 579], [1311, 595]], 5, OK, 2, dk); Tx(lib.count(dk, 0, 64) + '%', 1340, 593, 14, OK, { weight: 600, align: 'center', alpha: dk });
  const X0 = 868, X1 = 1376, Y0 = 640, Y1 = 820, yv = (v) => lerp(Y1, Y0, (v - 40) / 240), xv = (i) => lerp(X0, X1, i / (PTS - 1));
  ctx.beginPath(); for (let g = 0; g < 4; g++) { ctx.moveTo(X0, Y0 + g * 60); ctx.lineTo(X1, Y0 + g * 60); }
  ctx.strokeStyle = '#F0F2F5'; ctx.lineWidth = 1; ctx.stroke();
  const pts = []; for (let i = 0; i <= Math.floor(shown); i++) pts.push([xv(i), yv(lat(i))]);
  const fr = shown - Math.floor(shown), nI = Math.min(PTS - 1, Math.floor(shown) + 1);
  pts.push([lerp(xv(nI - 1), xv(nI), fr), lerp(yv(lat(nI - 1)), yv(lat(nI)), fr)]);
  const fill = ctx.createLinearGradient(0, Y0, 0, Y1); fill.addColorStop(0, 'rgba(91,91,247,0.16)'); fill.addColorStop(1, 'rgba(91,91,247,0)');
  ctx.beginPath(); ctx.moveTo(pts[0][0], Y1); pts.forEach((q) => ctx.lineTo(q[0], q[1])); ctx.lineTo(pts[pts.length - 1][0], Y1); ctx.fillStyle = fill; ctx.fill();
  lib.line(ctx, pts, 1, { color: IND, width: 2.6, cap: 'round' });
  const dm = seg(p, P.chart0 - 0.01, P.chart0 + 0.02, ease.out);
  if (dm > 0) {
    ctx.save(); ctx.setLineDash([4, 5]); lib.line(ctx, [[xv(DROP - 0.5), Y1], [xv(DROP - 0.5), lerp(Y1, Y0 - 18, dm)]], 1, { color: FAINT, width: 1.2 }); ctx.restore();
    R(xv(DROP - 0.5) - 34, Y0 - 34, 68, 22, 6, { fill: INK, alpha: dm }); Mo('v2.14', xv(DROP - 0.5), Y0 - 18, 12, '#fff', { align: 'center', alpha: dm });
  }
  const head = pts[pts.length - 1];
  lib.circle(ctx, head[0], head[1], 5.5, { fill: '#fff', stroke: IND, lineWidth: 2.6 });
  });
  ctx.restore();
}

// palette (opens over the window with a spring scale)
function drawPalette() {
  const o = seg(p, P.palOpen, P.palOpen + 0.05), c = seg(p, P.palClose, P.palClose + 0.025, ease.in);
  const a = clamp(o * 2.5) * (1 - c); if (a <= 0) return;
  const s = lerp(0.86, 1, lib.spring(o, { damping: 0.5, freq: 2.6 })) * lerp(1, 0.97, c);
  lib.layer(ctx, 'Palette scrim', () => R(0, 0, WW, WH, 18, { fill: 'rgba(14,17,22,0.18)', alpha: a }));
  lib.layer(ctx, 'Command palette', () => {
  const PX = 400, PY = 150, PW = 640;
  const listH = lib.track(tt, cntKeys, 260, 30) * 50;
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(720, PY + 40); ctx.scale(s, s); ctx.translate(-720, -PY - 40);
  soft(PX, PY, PW, 104 + listH, 16, 60, 28, 0.24); R(PX, PY, PW, 104 + listH, 16, { fill: CARD });
  R(PX, PY, PW, 104 + listH, 16, { stroke: LINE, lineWidth: 1 });
  lib.line(ctx, [[PX + 30, PY + 36], [PX + 36, PY + 42]], 1, { color: FAINT, width: 2.2, cap: 'round' });
  lib.circle(ctx, PX + 25, PY + 31, 7.5, { stroke: FAINT, lineWidth: 2.2 });
  if (nChars === 0) Tx('Type a command or search…', PX + 52, PY + 39, 19, FAINT);
  lib.typewriter(ctx, QUERY.slice(0, nChars), PX + 52, PY + 39, 1, { size: 19, family: 'sans', color: INK, caretColor: IND, t: p < P.type1 ? 0 : t, caret: p < P.click });
  R(PX + PW - 58, PY + 20, 40, 24, 6, { fill: '#F1F3F5' }); Mo('esc', PX + PW - 38, PY + 37, 12, FAINT, { align: 'center' });
  lib.line(ctx, [[PX, PY + 64], [PX + PW, PY + 64]], 1, { color: LINE, width: 1 });
  Tx('COMMANDS', PX + 20, PY + 90, 11.5, FAINT, { weight: 600, tracking: 0.1 });
  const L0 = PY + 100;
  lib.mask(ctx, (cc) => cc.rect(PX, L0, PW, listH + 2), () => {
    const hy = lib.track(tt, hiKeys, 320, 30);
    R(PX + 8, L0 + hy * 50, PW - 16, 46, 10, { fill: IND_SOFT });
    R(PX + 8, L0 + hy * 50 + 12, 3, 22, 1.5, { fill: IND });
    const flash = seg(p, P.click, P.click + 0.012) * (1 - seg(p, P.click + 0.012, P.click + 0.03));
    if (flash > 0) R(PX + 8, L0 + 50, PW - 16, 46, 10, { fill: IND, alpha: 0.18 * flash });
    CMDS.forEach((cmd, i) => {
      const va = clamp(lib.track(tt, visKeys[i], 300, 32)); if (va < 0.02) return;
      const y = L0 + lib.track(tt, slotKeys[i], 220, 28) * 50;
      R(PX + 24, y + 13, 20, 20, 6, { stroke: cmd.indexOf('Deploy') === 0 ? IND : FAINT, lineWidth: 1.8, alpha: va });
      Tx(cmd, PX + 58, y + 29, 16, INK, { weight: 500, alpha: va });
      if (HINT[i] === 'ret') { R(PX + PW - 62, y + 11, 38, 24, 6, { fill: '#F1F3F5', alpha: va }); arrowG([[PX + PW - 35, y + 17], [PX + PW - 35, y + 27], [PX + PW - 51, y + 27]], 4.5, SUB, 1.6, va); }
      else if (HINT[i]) { cmdG(PX + PW - 50, y + 23, 15, FAINT, 1.4, va); Tx(HINT[i], PX + PW - 30, y + 28.5, 13, FAINT, { weight: 600, align: 'center', alpha: va }); }
    });
  });
  ctx.restore();
  });
}

// toast
function drawToast() {
  const k = seg(p, P.toast, P.toast + 0.04), x = seg(p, 0.82, 0.85, ease.in);
  if (k <= 0 || x >= 1) return;
  const dy = -(1 - lib.spring(k, { damping: 0.6, freq: 2 })) * 90 - x * 30;
  lib.layer(ctx, 'Toast', () => {
  ctx.save(); ctx.globalAlpha *= clamp(k * 3) * (1 - x); ctx.translate(0, dy);
  soft(740, 66, 360, 76, 14, 30, 14, 0.2); R(740, 66, 360, 76, 14, { fill: CARD });
  R(740, 66, 360, 76, 14, { stroke: LINE, lineWidth: 1 });
  check(774, 104, 15, seg(p, P.toast + 0.01, P.toast + 0.05));
  Tx('Deployed to production', 800, 98, 16, INK, { weight: 600 }); Mo('v2.14 · 41.0s · 3 regions', 800, 121, 12.5, SUB);
  ctx.restore();
  });
}

// ── compose: window space → camera → screen ────────────────────────
lib.camera(ctx, { zoom: cam[2] }, () => {
  if (winA <= 0) return;
  ctx.save(); ctx.globalAlpha = winA;
  ctx.translate(cx, cy + winRise * D); ctx.scale(D * winS, D * winS); ctx.translate(-cam[0], -cam[1]);
  drawWindow(); drawPalette(); drawToast();
  // cursor
  const cxk = [[0, 1560], [at(0.125), 1560], [at(0.15), 1300], [at(0.25), 1300], [at(0.29), 1150], [at(P.hover), 900], [at(P.palClose + 0.02), 1040], [at(0.66), 1500]];
  const cyk = [[0, 980], [at(0.125), 980], [at(0.15), 112], [at(0.25), 112], [at(0.29), 210], [at(P.hover), 274], [at(P.palClose + 0.02), 400], [at(0.66), 1000]];
  const mx = lib.track(tt, cxk, 120, 22), my = lib.track(tt, cyk, 120, 22);
  const press = seg(p, P.click - 0.008, P.click) * (1 - seg(p, P.click + 0.004, P.click + 0.014));
  const rk = seg(p, P.click, P.click + 0.04), ca = seg(p, 0.125, 0.14) * (1 - seg(p, 0.6, 0.64));
  if (rk > 0 && rk < 1) lib.layer(ctx, 'Click ripple', () => ripple(mx, my, rk));
  if (ca > 0) lib.layer(ctx, 'Cursor', () => cursor(mx, my, press, ca));
  ctx.restore();
});

// ── keycaps: "One keystroke." ──────────────────────────────────────
const kin = seg(p, P.keyIn, P.keyIn + 0.035), kout = seg(p, P.palOpen - 0.018, P.palOpen + 0.008, ease.in);
if (kin > 0 && kout < 1) {
  const ks = 150 * u * (wide ? 1 : 0.85), gap = 26 * u;
  const press = seg(p, P.keyPress - 0.008, P.keyPress) * (1 - seg(p, P.keyPress + 0.012, P.keyPress + 0.03));
  ctx.save(); ctx.globalAlpha = clamp(kin * 2) * (1 - kout);
  lib.layer(ctx, 'Keycap scrim', () => { ctx.fillStyle = 'rgba(246,247,249,0.78)'; ctx.fillRect(0, 0, W, H); });
  ctx.translate(cx, cy - 40 * u); const sc = lerp(0.8, 1, lib.spring(kin, { damping: 0.55 })) * lerp(1, 0.55, kout); ctx.scale(sc, sc);
  ['⌘', 'K'].forEach((g, i) => lib.layer(ctx, i === 0 ? 'Command key' : 'K key', () => {
    const x = (i - 0.5) * (ks + gap) - ks / 2, dn = (i === 1 ? press : press * 0.6) * 10 * u;
    soft(x, -ks / 2 + dn, ks, ks, 30 * u, 36 * u - dn, 20 * u - dn * 1.5, 0.2);
    lib.rrect(ctx, x, -ks / 2 + dn, ks, ks, 30 * u, { fill: '#fff' });
    lib.rrect(ctx, x, -ks / 2 + dn, ks, ks, 30 * u, { stroke: LINE, lineWidth: 2 * u });
    lib.rrect(ctx, x + 10 * u, -ks / 2 + dn + 8 * u, ks - 20 * u, ks - 26 * u, 22 * u, { fill: '#FAFBFC' });
    const gc = i === 1 && press > 0.3 ? IND : INK;
    if (i === 0) cmdG(x + ks / 2, dn - 4 * u, 78 * u, gc, 5 * u);
    else lib.text(ctx, g, x + ks / 2, dn - 2 * u, { size: 64 * u, family: 'sans', weight: 500, color: gc, align: 'center', baseline: 'middle' });
  }));
  lib.layer(ctx, 'One keystroke', () => lib.words(ctx, 'One keystroke.', 0, ks / 2 + 110 * u, seg(p, P.keyIn + 0.006, P.keyIn + 0.032), { size: (wide ? 72 : 60) * u, family: 'sans', weight: 600, color: INK, align: 'center', tracking: -0.03, maxWidth: W * 0.84 / sc }));
  ctx.restore();
}

// ── opening line ───────────────────────────────────────────────────
const h1 = seg(p, 0.005, 0.06), h1o = seg(p, P.winIn - 0.02, P.winIn + 0.025, ease.in);
if (h1 > 0 && h1o < 1) {
  ctx.save(); ctx.globalAlpha = 1 - h1o; ctx.translate(0, -h1o * 80 * u);
  lib.layer(ctx, 'Opening headline', () => lib.words(ctx, 'Every deploy.', cx, cy + 30 * u, h1, { size: (wide ? 120 : 96) * u, family: 'sans', weight: 600, color: INK, align: 'center', tracking: -0.035, maxWidth: W * 0.84, blur: 8 * u }));
  lib.layer(ctx, 'Opening tagline', () => lib.text(ctx, 'Relay  ·  continuous delivery', cx, cy - 90 * u, { size: 22 * u, family: 'mono', color: IND, align: 'center', alpha: seg(p, 0.03, 0.07) }));
  ctx.restore();
}

// ── end card: wordmark ─────────────────────────────────────────────
const e = seg(p, P.mark, P.mark + 0.06);
if (e > 0) {
  const sp = lib.spring(e, { damping: 0.55, freq: 2.2 });
  const ms = (wide ? 120 : 104) * u, fs = (wide ? 150 : 120) * u;
  const tw = lib.text(ctx, 'Relay', 0, -9999, { size: fs, family: 'sans', weight: 700, tracking: -0.045, alpha: 0 }).width;
  const gx = cx - (ms + 36 * u + tw) / 2, ey = cy - 40 * u;
  lib.layer(ctx, 'Logo mark', () => {
  ctx.save(); ctx.globalAlpha = clamp(e * 2.5); ctx.translate(gx + ms / 2, ey); ctx.scale(lerp(0.6, 1, sp), lerp(0.6, 1, sp));
  soft(-ms / 2, -ms / 2, ms, ms, ms * 0.26, 44 * u, 22 * u, 0.4, '91,91,247');
  lib.rrect(ctx, -ms / 2, -ms / 2, ms, ms, ms * 0.26, { fill: IND }); ctx.restore();
  ctx.save(); ctx.globalAlpha = clamp(e * 2.5); ctx.translate(gx + ms / 2, ey); ctx.scale(lerp(0.6, 1, sp), lerp(0.6, 1, sp));
  lib.line(ctx, [[-ms * 0.24, -ms * 0.17], [-ms * 0.04, 0], [-ms * 0.24, ms * 0.17]], seg(e, 0.2, 0.6, ease.out), { color: '#fff', width: ms * 0.09, cap: 'round' });
  lib.line(ctx, [[ms * 0.03, ms * 0.19], [ms * 0.25, ms * 0.19]], seg(e, 0.45, 0.8, ease.out), { color: '#fff', width: ms * 0.09, cap: 'round' });
  ctx.restore();
  });
  lib.layer(ctx, 'Wordmark', () => lib.mask(ctx, (c) => c.rect(gx + ms + 20 * u, ey - fs, tw + 60 * u, fs * 1.6), () => {
    const sl = ease.outExpo(seg(e, 0.15, 0.85));
    lib.text(ctx, 'Relay', gx + ms + 36 * u - (1 - sl) * 120 * u, ey + fs * 0.36, { size: fs, family: 'sans', weight: 700, color: INK, tracking: -0.045, alpha: sl });
  }));
  lib.layer(ctx, 'End tagline', () => lib.words(ctx, 'Every deploy. One keystroke.', cx, ey + ms / 2 + 110 * u, seg(p, P.mark + 0.02, P.mark + 0.06), { size: (wide ? 40 : 38) * u, family: 'sans', weight: 500, color: SUB, align: 'center', tracking: -0.01, maxWidth: W * 0.84 }));
  lib.layer(ctx, 'Press K pill', () => {
  const kb = seg(p, P.mark + 0.06, P.mark + 0.1, ease.out);
  const po = { size: 19 * u, family: 'mono', color: SUB, alpha: 0 };
  const w1 = lib.text(ctx, 'Press', 0, -9999, po).width, w2 = lib.text(ctx, 'K to ship', 0, -9999, po).width;
  const pw = w1 + w2 + 40 * u, px0 = cx - pw / 2, py = ey + ms / 2 + 192 * u + (1 - kb) * 20 * u;
  lib.rrect(ctx, px0 - 26 * u, py - 32 * u, pw + 52 * u, 50 * u, 25 * u, { fill: '#fff', stroke: LINE, lineWidth: 1.5 * u, alpha: kb });
  lib.text(ctx, 'Press', px0, py, Object.assign({}, po, { alpha: kb }));
  cmdG(px0 + w1 + 20 * u, py - 7 * u, 22 * u, IND, 2 * u, kb);
  lib.text(ctx, 'K to ship', px0 + w1 + 34 * u, py, Object.assign({}, po, { color: IND, alpha: kb }));
  });
}
`,
};
