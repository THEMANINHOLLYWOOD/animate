// Introducing animate. Hand-built example film in the scene format Claude generates.
// Brief: A keynote-polished launch film for animate itself, in its own ivory, ink and clay look: a brief types itself into the prompt box, the box becomes a film frame that builds from wireframes and keyframes into a finished shot, then quick demos of reading a brand from a link, rebuilding a video shot for shot, Claude marking and fixing its own frames, and voice, music and effects lanes, ending on the animate wordmark, 'Describe it. Drop in your files. Get a film.' and the URL.
export const film = {
  id: "ex-launch",
  title: "Introducing animate",
  aspect: "16:9" as const,
  duration: 30,
  prompt: "A keynote-polished launch film for animate itself, in its own ivory, ink and clay look: a brief types itself into the prompt box, the box becomes a film frame that builds from wireframes and keyframes into a finished shot, then quick demos of reading a brand from a link, rebuilding a video shot for shot, Claude marking and fixing its own frames, and voice, music and effects lanes, ending on the animate wordmark, 'Describe it. Drop in your files. Get a film.' and the URL.",
  code: String.raw`
const { ease, seg, u, clamp, lerp, mix } = lib;
// animate house palette, plus the two palettes the film's own demos bring in
const IV = '#FAF9F5', PAPER = '#F0EEE6', LINE = '#E6E3D9', LS = '#D1CFC5', ST = '#87867F', SL = '#3D3D3A', INK = '#141413', CLAY = '#D97757', CLAYD = '#C6613F', WH = '#FFFFFF';
const RED = '#C7432C', OLIVE = '#6B8150';
const NAVY = '#17214B', BLUE = '#3653C9', SUN = '#FFC54A', MIST = '#E3E8FF';          // the pasted brand
const TEAL = '#17505D', PEACH = '#F2A65A', CREAM = '#F4ECDD', ROSE = '#DE664E';       // the dropped video
lib.bg(ctx, W, H, IV);
const wide = W / H >= 1.2, tall = W / H < 0.8;
const s = p * 30, ts = (x) => (x * T) / 30;          // choreography clock: 30 units across the film, re-times with T
const S = (a, b, e) => seg(s, a, b, e || ease.out);
const SPR = (k, d, f) => lib.spring(k, { damping: d || 0.62, freq: f || 1.8 });
const M = Math.min(W, H) * 0.08;
const F = (size, family, color, o) => Object.assign({ size, family, color, tracking: family === 'mono' ? 0.12 : family === 'serif' ? -0.012 : 0 }, o || {});
const TX = (str, x, y, o) => lib.text(ctx, str, x, y, o);
const R = (x, y, w, h, r, o) => lib.rrect(ctx, x, y, w, h, r, o);
function mw(str, o) { ctx.save(); ctx.font = lib.font(o); if ('letterSpacing' in ctx) ctx.letterSpacing = (o.tracking || 0) * o.size + 'px'; const w = ctx.measureText(str).width; ctx.restore(); return w; }
function shadow(x, y, w, h, r, a) { for (let i = 1; i <= 4; i++) R(x - i * 3, y + i * 5, w + i * 6, h + i * 2, r + i * 3, { fill: INK, alpha: a * 0.02 * (5 - i) }); }

// ── layout: a 960-unit stage on the right (wide) or below the copy (tall / square) ──
let SS, SX, SY, S0, HX, HY, HS, HW, BS;
if (wide) { SS = 0.92 * u; SX = W - 160 * u - 480 * SS; SY = H / 2; S0 = u; HX = 150 * u; HW = SX - 480 * SS - 80 * u - HX; HY = H / 2; HS = 72 * u; BS = 33 * u; }
else if (tall) { SS = (W - 2 * M) / 960; SX = W / 2; SY = H * 0.62; S0 = SS; HX = M; HW = W - 2 * M; HY = H * 0.27; HS = 80 * u; BS = 34 * u; }
else { SS = 0.78 * u; SX = W / 2; SY = H * 0.6; S0 = 0.92 * u; HX = M; HW = W - 2 * M; HY = H * 0.165; HS = 54 * u; BS = 24 * u; }
const stX = lib.track(t, [[0, W / 2], [ts(4.15), SX]], 110, 21), stY = lib.track(t, [[0, H / 2], [ts(4.15), SY]], 110, 21), stS = lib.track(t, [[0, S0], [ts(4.15), SS]], 110, 21);
const L0 = (x, y) => [W / 2 + x * S0, H / 2 + y * S0], L1 = (x, y) => [SX + x * SS, SY + y * SS];
const SCR = [[0, 0], [ts(14.35), 1]], scrAt = (tt) => lib.track(tt, SCR, 95, 19.5);
const dyA = -scrAt(t) * H * 1.05, dyB = (1 - scrAt(t)) * H * 1.05;   // station A (prompt, build, brand) scrolls up; station B rises
const STATUS_Y = HY + HS + 54 * u;

// ── cursor: one hand, sprung between targets ──
const CK = [[0, [W + 90 * u, H * 0.92]], [ts(2.6), L0(-264, -6)], [ts(3.5), L0(200, 168)], [ts(4.3), L0(330, 330)],
  [ts(9.35), L1(470, 330)], [ts(9.6), L1(-372, 236)], [ts(10.6), L1(-150, 440)],
  [ts(14.2), [W + 90 * u, SY + 220 * u]], [ts(14.65), L1(150, 70)], [ts(15.75), L1(330, 300)],
  [ts(22.4), L1(560, 430)], [ts(22.75), L1(385, 262)], [ts(23.7), L1(470, 380)]];
const KX = CK.map((k) => [k[0], k[1][0]]), KY = CK.map((k) => [k[0], k[1][1]]);
const curAt = (x) => [lib.track(ts(x), KX, 150, 25), lib.track(ts(x), KY, 150, 25)];
const cur = curAt(s);
const curA = S(2.6, 2.85) * (1 - S(4.25, 4.5)) + S(9.6, 9.85) * (1 - S(10.7, 11)) + S(14.55, 14.75) * (1 - S(15.8, 16.1)) + S(22.55, 22.75) * (1 - S(23.55, 23.8));
const press = (a) => S(a - 0.08, a, ease.linear) * (1 - S(a + 0.04, a + 0.16, ease.linear));
const curP = press(4.0) + press(10.1) + press(23.3);
const toLocal = (q, dy) => [(q[0] - stX) / stS, (q[1] - stY - dy) / stS];
function cursor(x, y, pr, a) {
  if (a <= 0) return;
  const path = () => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 23); ctx.lineTo(5.6, 17.6); ctx.lineTo(9.6, 26.6); ctx.lineTo(13.4, 25); ctx.lineTo(9.5, 16.2); ctx.lineTo(16.8, 16.2); ctx.closePath(); };
  ctx.save(); ctx.translate(x, y); const k = 1.3 * u * (1 - 0.14 * pr); ctx.scale(k, k); ctx.globalAlpha *= a;
  ctx.save(); ctx.translate(1.5, 2.5); path(); ctx.fillStyle = 'rgba(20,20,19,0.16)'; ctx.fill(); ctx.restore();
  path(); ctx.fillStyle = INK; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = WH; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
}
function ripple(x, y, k, r) { if (k > 0 && k < 1) lib.circle(ctx, x, y, r * (0.3 + ease.out(k)), { stroke: CLAY, lineWidth: 2.5 * u * (1 - k), alpha: 1 - k }); }

// ── the film being made: "Hello, world." in frame units (960 × 540) ──
const it = 4 * ease.inOutSine(S(6.9, 9.3, ease.linear));                    // playhead time inside that film
const wk = [S(5.0, 5.6, ease.inOut), S(5.25, 5.85, ease.inOut), S(5.5, 6.3, ease.inOut), S(5.85, 6.7, ease.inOut)];
const rs = [seg(it, 0, 0.5), seg(it, 0.4, 1.1), seg(it, 0.9, 2.1), seg(it, 1.9, 2.8)];  // backdrop, horizon, sun, title
const bk = [0, 1, 2].map((i) => S(12.92 + 0.12 * i, 13.47 + 0.12 * i)), SWT = [[190, 130], [480, 320], [770, 470]];                // brand recolour per swatch
const sel = SPR(S(10.1, 10.45, ease.linear), 0.6, 2) * (1 - S(10.95, 11.2, ease.in));
const TTL = F(96, 'serif', IV, { align: 'center', tracking: -0.02 }), HZ = 392, SR = 136;
function film(X, Y, f) {
  const sky = mix(INK, NAVY, bk[0]), gw = 960 * ease.inOut(rs[1]);
  ctx.save(); ctx.translate(X, Y); ctx.scale(f, f);
  lib.mask(ctx, (c) => c.roundRect(0, 0, 960, 540, 10), () => {
    if (rs[0] > 0) { R(0, 0, 960 * ease.inOut(rs[0]), 540, 0, { fill: INK }); if (bk[0] > 0) lib.circle(ctx, 190, 130, 1150 * ease.inOut(bk[0]), { fill: NAVY }); }
    if (rs[2] > 0) {
      const cy = HZ + (1 - SPR(rs[2], 0.55, 1.5)) * 230;
      lib.mask(ctx, (c) => { c.rect(0, 0, 960, HZ); }, () => lib.mask(ctx, (c) => c.arc(480, cy, SR, 0, Math.PI * 2), () => {
        R(300, cy - SR, 360, 2 * SR, 0, { fill: mix(CLAY, SUN, bk[1]) });
        [[20, 10], [44, 7], [66, 4]].forEach((b) => R(300, HZ - b[0], 360, b[1], 0, { fill: sky }));   // fixed blinds: the sun rises through them
      }));
      if (bk[1] > 0 && bk[1] < 1) lib.ring(ctx, 480, HZ, SR + 140 * bk[1], 1, { color: SUN, width: 3, alpha: 1 - bk[1] });
    }
    if (rs[1] > 0) {
      R(480 - gw / 2, HZ, gw, 540 - HZ, 0, { fill: '#26241F', alpha: rs[1] });
      if (bk[2] > 0) lib.mask(ctx, (c) => c.rect(0, HZ, 960, 540 - HZ), () => lib.circle(ctx, 770, 470, 900 * ease.inOut(bk[2]), { fill: BLUE }));
      lib.line(ctx, [[480 - gw / 2, HZ], [480 + gw / 2, HZ]], 1, { color: IV, width: 1.5, alpha: 0.35 });
    }
  });
  // wireframe: construction that resolves away as the playhead reaches each layer
  const g = wk[0] * (1 - seg(it, 2.6, 3.6)) * 0.8;
  if (g > 0) {
    ctx.save(); ctx.setLineDash([5, 7]);
    [[[320, 0], [320, 540]], [[640, 0], [640, 540]], [[0, 180], [960, 180]], [[0, 360], [960, 360]]].forEach((l, i) => lib.line(ctx, l, lib.stagger(wk[0], i, 4, 0.4), { color: rs[0] > 0.5 ? LS : ST, width: 1.2, alpha: g * 0.6 }));
    ctx.restore();
  }
  const hw = wk[1] * (1 - rs[1]);
  if (hw > 0) {
    ctx.save(); ctx.setLineDash([10, 8]); lib.line(ctx, [[0, HZ], [960, HZ]], wk[1], { color: CLAY, width: 2, alpha: hw }); ctx.restore();
    [[6, HZ], [954, HZ]].forEach((q) => R(q[0] - 6, q[1] - 6, 12, 12, 2, { fill: WH, stroke: CLAY, lineWidth: 2, alpha: hw * seg(wk[1], 0.6, 1) }));
  }
  const sw = wk[2] * (1 - rs[2]);
  if (sw > 0) {
    lib.ring(ctx, 480, HZ, SR, wk[2], { color: CLAY, width: 2, alpha: sw, start: 180 });
    const ha = sw * seg(wk[2], 0.55, 1), hl = SR * 0.552;
    [[480, HZ - SR, 1, 0], [480 + SR, HZ, 0, 1], [480 - SR, HZ, 0, 1]].forEach((q) => {
      lib.line(ctx, [[q[0] - hl * q[2], q[1] - hl * q[3]], [q[0] + hl * q[2], q[1] + hl * q[3]]], 1, { color: ST, width: 1.4, alpha: ha });
      lib.circle(ctx, q[0] - hl * q[2], q[1] - hl * q[3], 4.5, { fill: WH, stroke: ST, lineWidth: 1.4, alpha: ha });
      lib.circle(ctx, q[0] + hl * q[2], q[1] + hl * q[3], 4.5, { fill: WH, stroke: ST, lineWidth: 1.4, alpha: ha });
      R(q[0] - 6, q[1] - 6, 12, 12, 2, { fill: WH, stroke: CLAY, lineWidth: 2, alpha: ha });
    });
    TX('R 136', 632, 272, F(14, 'mono', CLAY, { alpha: ha }));
  }
  const tw = mw('Hello, world.', TTL), bx = 480 - tw / 2 - 22, ta = wk[3] * (1 - rs[3]);
  if (ta > 0) {
    ctx.save(); ctx.setLineDash([6, 6]);
    lib.line(ctx, [[bx, 112], [bx + tw + 44, 112], [bx + tw + 44, 228], [bx, 228], [bx, 112]], wk[3], { color: CLAY, width: 1.6, alpha: ta, cap: 'butt' }); ctx.restore();
    ctx.save(); ctx.globalAlpha *= ta * seg(wk[3], 0.3, 1); ctx.font = lib.font(TTL); if ('letterSpacing' in ctx) ctx.letterSpacing = -0.02 * 96 + 'px';
    ctx.textAlign = 'center'; ctx.strokeStyle = rs[0] > 0.5 ? LS : ST; ctx.lineWidth = 1.2; ctx.strokeText('Hello, world.', 480, 196); ctx.restore();
    TX('SERIF 96', bx, 100, F(14, 'mono', CLAY, { alpha: ta * seg(wk[3], 0.5, 1) }));
  }
  if (rs[3] > 0) TX('Hello, world.', 480, 196 + (1 - ease.out(rs[3])) * 26, Object.assign({}, TTL, { color: mix(IV, MIST, bk[0]), alpha: rs[3] }));
  if (sel > 0) {
    const sx = bx + 6, sy = 118, w2 = tw + 32, h2 = 104, k = lerp(0.9, 1, sel);
    ctx.save(); ctx.globalAlpha *= clamp(sel * 2); ctx.translate(480, 170); ctx.scale(k, k); ctx.translate(-480, -170);
    R(sx, sy, w2, h2, 2, { stroke: CLAY, lineWidth: 2 });
    [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]].forEach((q) => R(sx + q[0] * w2 - 6, sy + q[1] * h2 - 6, 12, 12, 2, { fill: WH, stroke: CLAY, lineWidth: 2 }));
    ctx.restore();
  }
  ctx.restore();
}

// ── the editor timeline under the frame: layers, keyframes, playhead ──
function diamond(x, y, hit, a) {
  const k = 1 + 0.4 * Math.sin(Math.PI * hit) * (hit < 1 ? 1 : 0);
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.scale(k, k);
  R(-7, -7, 14, 14, 2, { fill: hit > 0 ? CLAY : WH, stroke: hit > 0 ? CLAY : INK, lineWidth: 1.8 }); ctx.restore();
}
function panel() {
  const pin = S(4.7, 5.3, ease.linear), pout = S(10.9, 11.3, ease.in);
  if (pin <= 0 || pout >= 1) return;
  ctx.save(); ctx.globalAlpha *= clamp(pin * 2.5) * (1 - pout); ctx.translate(0, (1 - SPR(pin, 0.7, 1.4)) * 70 + pout * 90);
  shadow(-480, 160, 960, 260, 16, 0.8);
  R(-480, 160, 960, 260, 16, { fill: WH, stroke: LINE, lineWidth: 1.5 });
  const X0 = -250, X1 = 450, xt = (v) => lerp(X0, X1, v / 4);
  TX('LAYERS', -452, 192, F(14, 'mono', ST));
  for (let k = 0; k <= 4; k++) TX(k + 's', xt(k) + (k ? 0 : 8), 192, F(14, 'mono', ST, { align: k === 4 ? 'right' : 'center' }));
  lib.line(ctx, [[-480, 206], [480, 206]], 1, { color: LINE, width: 1.5 });
  const NAMES = ['Title', 'Sun', 'Horizon', 'Backdrop'], KF = [[1.9, 2.8], [0.9, 2.1], [0.4, 1.1], [0, 0.5]];
  for (let i = 0; i < 4; i++) {
    const y = 236 + i * 48, e = 3 - i;
    if (i === 0 && sel > 0) R(-472, y - 21, 944, 42, 10, { fill: CLAY, alpha: 0.13 * sel });
    ctx.save(); ctx.strokeStyle = SL; ctx.lineWidth = 1.8; ctx.beginPath();
    if (e === 3) { ctx.moveTo(-453, y - 7); ctx.lineTo(-439, y - 7); ctx.moveTo(-446, y - 7); ctx.lineTo(-446, y + 8); }
    else if (e === 2) ctx.arc(-446, y, 7.5, 0, Math.PI * 2);
    else if (e === 1) { ctx.moveTo(-454, y + 2); ctx.lineTo(-438, y + 2); }
    else ctx.roundRect(-453, y - 7, 14, 14, 3);
    ctx.stroke(); ctx.restore();
    TX(NAMES[i], -422, y + 7, F(21, 'sans', INK, { weight: i === 0 && sel > 0.5 ? 600 : 400 }));
    R(X0, y - 1, X1 - X0, 2, 1, { fill: PAPER });
    const kin = S(5.35 + e * 0.3, 5.85 + e * 0.3, ease.linear);
    if (kin > 0) {
      const dy = (1 - SPR(kin, 0.5, 2)) * -18, ka = clamp(kin * 3), xa = xt(KF[i][0]), xb = xt(KF[i][1]);
      R(xa, y - 4 + dy, xb - xa, 8, 4, { fill: CLAY, alpha: 0.2 * ka });
      diamond(xa, y + dy, seg(it, KF[i][0] - 0.001, KF[i][0] + 0.25), ka);
      diamond(xb, y + dy, seg(it, KF[i][1] - 0.001, KF[i][1] + 0.25), ka);
    }
  }
  const px = xt(it);
  lib.line(ctx, [[px, 178], [px, 404]], 1, { color: CLAY, width: 2.2 });
  ctx.save(); ctx.translate(px, 176); ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(8, -10); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fillStyle = CLAY; ctx.fill(); ctx.restore();
  ctx.restore();
}

// ── the dropped video and its shots (shot space 160 × 90) ──
function shapesOf(i, d) {
  if (i === 0) return [['r', TEAL, 0, 0, 160, 90, 0], ['c', PEACH, 52, 50, 22], ['r', CREAM, 92, 36, 46, 7, 3.5], ['r', CREAM, 92, 49, 30, 7, 3.5]];
  if (i === 1) return [['r', CREAM, 0, 0, 160, 90, 0], ['r', ROSE, 58, 22, 46, 46, 8], ['c', TEAL, lerp(128, 100, d), lerp(24, 30, d), 11]];
  if (i === 2) return [['r', TEAL, 0, 0, 80, 90, 0], ['r', PEACH, 80, 0, 80, 90, 0], ['c', CREAM, 80, 45, 16]];
  if (i === 3) return [['r', PEACH, 0, 0, 160, 90, 0], ['r', TEAL, 38, 52, 14, 26, 2], ['r', TEAL, 62, 38, 14, 40, 2], ['r', TEAL, 86, 24, 14, 54, 2], ['r', CREAM, lerp(16, 104, d), 12, 70, 9, 4.5]];
  if (i === 4) return [['r', TEAL, 0, 0, 160, 90, 0], ['c', ROSE, 38, 45, 5], ['r', mix(CREAM, '#2A6D7C', d), 50, 39, 76, 12, 6]];
  return [['r', ROSE, 0, 0, 160, 90, 0], ['o', TEAL, 80, 45, 30, 3], ['c', CREAM, 80, 45, 21]];
}
function shot(i, x, y, w, h, foot, k, d) {
  const X = x - w / 2, Y = y - h / 2, L = shapesOf(i, d), fa = foot ? 1 : seg(k, 0.35, 0.9), la = foot ? 0 : seg(k, 0, 0.25) * (1 - seg(k, 0.75, 1));
  if (fa > 0) lib.mask(ctx, (c) => c.roundRect(X, Y, w, h, h * 0.06), () => {
    ctx.save(); ctx.globalAlpha *= fa; ctx.translate(X, Y); ctx.scale(w / 160, h / 90);
    for (const q of L) {
      ctx.beginPath(); if (q[0] === 'r') ctx.roundRect(q[2], q[3], q[4], q[5], q[6]); else ctx.arc(q[2], q[3], q[4], 0, Math.PI * 2);
      if (q[0] === 'o') { ctx.strokeStyle = q[1]; ctx.lineWidth = q[5]; ctx.stroke(); } else { ctx.fillStyle = q[1]; ctx.fill(); }
    }
    if (foot) {   // camera footage: soft light, vignette, grain
      const g = ctx.createRadialGradient(60, 30, 4, 80, 45, 110); g.addColorStop(0, 'rgba(255,240,220,0.28)'); g.addColorStop(0.55, 'rgba(255,240,220,0)'); g.addColorStop(1, 'rgba(10,10,20,0.45)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 160, 90);
      const fr = Math.floor(t * 12);
      for (let j = 0; j < 26; j++) lib.circle(ctx, lib.rand(j * 7 + fr * 131 + i) * 160, lib.rand(j * 13 + fr * 71 + i) * 90, 0.7, { fill: j % 2 ? '#fff' : '#000', alpha: 0.35 });
    }
    ctx.restore();
  });
  if (la > 0) {
    ctx.save(); ctx.globalAlpha *= la; ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(X, Y, w, h, h * 0.06);
    for (const q of L.slice(1)) { if (q[0] === 'r') ctx.rect(X + q[2] * w / 160, Y + q[3] * h / 90, q[4] * w / 160, q[5] * h / 90); else { ctx.moveTo(X + (q[2] + q[4]) * w / 160, Y + q[3] * h / 90); ctx.arc(X + q[2] * w / 160, Y + q[3] * h / 90, q[4] * w / 160, 0, Math.PI * 2); } }
    ctx.stroke(); ctx.restore();
  }
}
const CUTF = [0.21, 0.42, 0.6, 0.8], XS = [-384, -192, 0, 192, 384], GX = [-314, 0, 314], GY = [-96, 96];
const PROB0 = 0, PROB = { 1: [100, 32, 26, 21, 'OVERLAP', 19.6, 18.75], 3: [146, 17, 22, 13, 'CLIPPED', 19.85, 18.95], 4: [88, 45, 50, 17, 'CONTRAST', 20.1, 19.05] };
const fixK = (i) => (PROB[i] ? SPR(S(PROB[i][5], PROB[i][5] + 0.5, ease.linear), 0.6, 1.6) : 1);
const CUTX = [-320, -160, 0, 160, 320], NB = 118;
function amp(l, i) {
  if (l === 0) return clamp((lib.noise(i * 0.08, 2) + 0.2) * 5) * (0.25 + 0.75 * Math.abs(lib.noise(i * 0.6, 5)));
  if (l === 1) return 0.3 + 0.3 * Math.pow(Math.sin(i * 0.42), 2) + 0.12 * lib.noise(i * 0.2, 9);
  let a = 0.05; const x = -472 + i * 8;
  for (const c of CUTX) { const dx = x - c; if (dx >= -5) a = Math.max(a, Math.exp(-Math.max(0, dx) / 20)); }
  return a;
}
function lane(l, y, k, a) {
  if (a <= 0 || k <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = [CLAY, INK, SL][l]; ctx.beginPath();
  const n = Math.floor(NB * k);
  for (let i = 0; i < n; i++) { const h = Math.max(3, 68 * amp(l, i)); ctx.roundRect(-474 + i * 8, y - h / 2, 4, h, 2); }
  ctx.fill(); ctx.restore();
}

// ── copy helpers ──
function head(str, a, b, c, d, dy) {
  const ki = S(a, b, ease.linear), ko = S(c, d, ease.in);
  if (ki <= 0 || ko >= 1) return;
  ctx.save(); ctx.globalAlpha *= 1 - ko; ctx.translate(0, (dy || 0) - ko * 36 * u);
  lib.words(ctx, str, HX, HY, ki, { size: HS, family: 'serif', color: INK, tracking: -0.018, lineHeight: 1.08, maxWidth: HW, baseline: 'middle', stagger: 0.45, rise: HS * 0.45 });
  ctx.restore();
}
function status(str, a, b, c, d, y0) {
  const Y = y0 || STATUS_Y;
  const ki = S(a, b), ko = S(c, d, ease.in);
  if (ki <= 0 || ko >= 1) return;
  ctx.save(); ctx.globalAlpha *= ki * (1 - ko); ctx.translate(0, (1 - ki) * 14 * u - ko * 14 * u);
  lib.circle(ctx, HX + 6 * u, Y - 6 * u, 5 * u * (0.8 + 0.2 * Math.sin(t * 2.6)), { fill: CLAY });
  TX(str, HX + 24 * u, Y, F(19 * u, 'mono', SL));
  ctx.restore();
}

const zIn = S(2.3, 3.7, ease.inOut), ZI = Math.min(1.7, (0.94 * W) / (880 * S0));
lib.camera(ctx, { zoom: lerp(ZI, 1, zIn) * lerp(1, 1.03, p), y: 40 * S0 * (1 - zIn) }, () => {
  // ════ STATION A: prompt → build → brand ════
  ctx.save(); ctx.translate(stX, stY + dyA); ctx.scale(stS, stS);
  if (dyA > -H) {
    const k0 = S(0, 0.8, ease.linear), cs = lerp(0.97, 1, SPR(k0, 0.7, 1.4)), ca = 1;
    const mk = S(4.15, 5.05, ease.linear), m = SPR(mk, 0.68, 1.5);
    const fcy = lib.track(t, [[0, -48], [ts(4.15), -150], [ts(10.95), 40]], 120, 22);
    const fw = lerp(860, 960, m), fh = lerp(296, 540, m), drag = S(2.95, 3.15) * (1 - S(3.25, 3.5));
    ctx.save(); ctx.globalAlpha *= ca; ctx.translate(0, fcy); ctx.scale(cs, cs); ctx.translate(0, -fcy);
    shadow(-fw / 2, fcy - fh / 2, fw, fh, lerp(30, 10, m), 1);
    R(-fw / 2, fcy - fh / 2, fw, fh, lerp(30, 10, m), { fill: WH, stroke: mix(LS, CLAY, drag), lineWidth: 1.5 + drag });
    if (drag > 0) R(-fw / 2 - 7, fcy - fh / 2 - 7, fw + 14, fh + 14, 36, { stroke: CLAY, lineWidth: 6, alpha: 0.14 * drag });
    if (s > 4.9) film(-fw / 2, fcy - fh / 2, fw / 960);
    // composer chrome: attached file, add-files bar, Animate button
    const cOut = S(4.1, 4.3, ease.in);
    if (cOut < 1) {
      ctx.save(); ctx.globalAlpha *= 1 - cOut;
      ctx.strokeStyle = SL; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-398, 66); ctx.lineTo(-378, 66); ctx.moveTo(-388, 56); ctx.lineTo(-388, 76); ctx.stroke();
      TX('Add, drop or paste files', -362, 75, F(26, 'sans', SL));
      const bp = press(4.0), bo = S(4.2, 4.5, ease.in);
      ctx.save(); ctx.globalAlpha *= 1 - bo; ctx.translate(0, 164 + bo * 40); ctx.scale(1 - 0.015 * bp, 1 - 0.015 * bp);
      R(-430, -42, 860, 84, 22, { fill: mix(INK, '#2A2A28', bp) }); TX('Animate', 0, 10, F(30, 'sans', IV, { align: 'center', weight: 500 }));
      ctx.restore();
      // the file chip: dragged in by the cursor, then settles into the composer
      if (s > 2.6) {
        const rel = 3.25, slot = [-394, -38];
        let q, rot = -4;
        if (s < rel) { const c = toLocal(cur, 0); q = [c[0] - 130, c[1] - 32]; }
        else { const c = toLocal(curAt(rel), 0), k = SPR(S(rel, rel + 0.45, ease.linear), 0.6, 1.8); q = [lerp(c[0] - 130, slot[0], k), lerp(c[1] - 32, slot[1], k)]; rot = -4 * (1 - k); }
        ctx.save(); ctx.translate(q[0] + 165, q[1] + 30); ctx.rotate(rot * Math.PI / 180); ctx.translate(-165, -30);
        if (rot < -0.5) shadow(0, 0, 330, 60, 13, 2);
        R(0, 0, 330, 60, 13, { fill: IV, stroke: LINE, lineWidth: 1.5 });
        R(8, 8, 44, 44, 9, { fill: PAPER }); lib.circle(ctx, 30, 30, 12, { stroke: INK, lineWidth: 2.2 }); lib.circle(ctx, 30, 30, 5, { fill: CLAY });
        TX('logo.png', 66, 39, F(24, 'sans', INK));
        R(184, 15, 132, 30, 8, { fill: CLAY, alpha: 0.16 }); TX('IN VIDEO', 250, 36, F(15, 'mono', CLAYD, { align: 'center', tracking: 0.06 }));
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
    panel();
    // brand: paste a link, read its colours, pour them into the frame
    const pk = S(11.2, 11.6, ease.linear);
    if (pk > 0) {
      const py = -372 + (1 - SPR(pk, 0.65, 1.6)) * 40, paste = S(11.62, 11.68, ease.linear), fl = 1 - S(11.72, 12.2, ease.linear);
      ctx.save(); ctx.globalAlpha *= clamp(pk * 2.5);
      shadow(-330, py, 660, 80, 40, 1); R(-330, py, 660, 80, 40, { fill: WH, stroke: LS, lineWidth: 1.5 });
      ctx.save(); ctx.strokeStyle = ST; ctx.lineWidth = 2.4; ctx.translate(-288, py + 40); ctx.rotate(-Math.PI / 4); ctx.beginPath(); ctx.roundRect(-13, -6, 15, 12, 6); ctx.roundRect(-2, -6, 15, 12, 6); ctx.stroke(); ctx.restore();
      const uw = mw('yourcompany.com', F(31, 'sans', INK));
      if (paste > 0) { R(-258, py + 18, uw + 8, 44, 6, { fill: CLAY, alpha: 0.28 * fl }); TX('yourcompany.com', -254, py + 51, F(31, 'sans', INK, { alpha: paste })); }
      const rd = S(11.75, 11.95) * (1 - S(12.1, 12.25, ease.in));
      if (rd > 0) { lib.circle(ctx, 160, py + 41, 5.5 * (0.8 + 0.2 * Math.sin(t * 9)), { fill: CLAY, alpha: rd }); TX('Reading', 176, py + 49, F(23, 'sans', ST, { alpha: rd })); }
      const SW = [NAVY, SUN, BLUE, MIST], sw = (x, y, r, c) => { if (r < 4) return; lib.circle(ctx, x, y, r + 1.5, { fill: LINE }); lib.circle(ctx, x, y, r, { fill: c, stroke: IV, lineWidth: 3 }); };
      for (let i = 3; i >= 0; i--) {   // the palette it read stays in the field
        const pop = SPR(S(12.2 + 0.06 * i, 12.5 + 0.06 * i, ease.linear), 0.55, 2);
        if (pop > 0) sw(182 + i * 30, py + 40, 21 * pop, SW[i]);
      }
      ctx.restore();
      for (let i = 0; i < 3; i++) {    // and a copy of each colour flies into the layer it belongs to
        const fk = S(12.55 + 0.12 * i, 13.05 + 0.12 * i, ease.inOut);
        if (fk <= 0 || fk >= 1) continue;
        const x0 = 182 + i * 30, y0 = py + 40, tg = [SWT[i][0] - 480, SWT[i][1] - 230];
        const x = lerp(x0, tg[0], fk) + Math.sin(Math.PI * fk) * 70, y = lerp(y0, tg[1], fk) - Math.sin(Math.PI * fk) * 80;
        sw(x, y, 21 * (1 + 0.9 * Math.sin(Math.PI * fk)) * (1 - seg(fk, 0.93, 1)), SW[i]);
      }
    }
  }
  ctx.restore();

  // ════ STATION B: video → review → sound → export ════
  if (s > 14.3) {
    const col = S(23.4, 23.85, ease.in);
    ctx.save(); ctx.translate(stX, stY + dyB); ctx.scale(stS, stS);
    ctx.save(); ctx.globalAlpha *= 1 - col; ctx.translate(385, 260); ctx.scale(1 - 0.85 * col, 1 - 0.85 * col); ctx.translate(-385, -260);
    const hover = S(14.95, 15.15) * (1 - S(15.3, 15.45));
    const dz = 1 - S(15.3, 15.6, ease.in);
    if (dz > 0) {
      ctx.save(); ctx.setLineDash([10, 9]); R(-320, -200, 640, 360, 18, { stroke: mix(LS, CLAY, hover), lineWidth: 2 + hover, alpha: dz }); ctx.restore();
      lib.line(ctx, [[0, -46], [0, 6], [-16, -10], [0, 6], [16, -10]], 1, { color: ST, width: 2.4, alpha: dz * (1 - hover) });
      lib.line(ctx, [[-30, 0], [-30, 22], [30, 22], [30, 0]], 1, { color: ST, width: 2.4, alpha: dz * (1 - hover) });
    }
    // the reference video, carried in by the cursor
    const rel = 15.3, ce = S(15.85, 16.2, ease.inOut);
    let vc;
    if (s < rel) { const c = toLocal(cur, dyB); vc = [c[0] - 150, c[1] - 90, 0.9, -3]; }
    else { const c = toLocal(curAt(rel), (1 - scrAt(ts(rel))) * H * 1.05), k = SPR(S(rel, rel + 0.45, ease.linear), 0.6, 1.8); vc = [lerp(c[0] - 150, 0, k), lerp(c[1] - 90, -20, k), lerp(0.9, 1, k), -3 * (1 - k)]; }
    const sk = S(15.45, 15.85, ease.inOut);
    if (ce < 1 && s > 14.55) {
      ctx.save(); ctx.globalAlpha *= 1 - ce * ce; ctx.translate(vc[0], vc[1]); ctx.rotate(vc[3] * Math.PI / 180); ctx.scale(vc[2], vc[2]);
      ctx.translate(0, 147); ctx.scale(1, 1 - 0.96 * ce); ctx.translate(0, -147);
      shadow(-320, -180, 640, 360, 20, s < rel ? 2.2 : 1.2);
      shot(0, 0, 0, 640, 360, true, 1, 0);
      lib.circle(ctx, 0, -14, 40, { fill: WH, alpha: 0.92 });
      ctx.beginPath(); ctx.moveTo(-11, -32); ctx.lineTo(19, -14); ctx.lineTo(-11, 4); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
      R(-294, -162, 214, 38, 10, { fill: INK, alpha: 0.5 }); TX('reference.mp4', -280, -136, F(18, 'mono', WH, { tracking: 0.02 }));
      R(-290, 144, 580, 6, 3, { fill: WH, alpha: 0.35 }); if (sk > 0) R(-290, 144, 580 * sk, 6, 3, { fill: WH });
      CUTF.forEach((f, i) => { const tk = SPR(seg(sk, f, f + 0.15), 0.5, 2); if (tk > 0) R(-292 + 580 * f, 147 - 14 * tk, 4, 28 * tk, 2, { fill: CLAY }); });
      ctx.restore();
    }
    // its shots: pulled out of the scrubber (top), rebuilt beneath (bottom)
    const topOut = (i) => S(17.55 + 0.03 * i, 17.85 + 0.03 * i, ease.in);
    for (let i = 0; i < 5; i++) {
      const q = SPR(S(15.9 + 0.06 * i, 16.45 + 0.06 * i, ease.linear), 0.65, 1.6), to = topOut(i);
      if (q <= 0 || to >= 1) continue;
      const f0 = i ? CUTF[i - 1] : 0, f1 = i < 4 ? CUTF[i] : 1, cf = (f0 + f1) / 2;
      const x = lerp(vc[0] + lerp(-290, 290, cf), XS[i], q), y = lerp(vc[1] + 147, -110, q) - to * 24;
      ctx.save(); ctx.globalAlpha *= clamp(q * 3) * (1 - to);
      shot(i, x, y, lerp(580 * (f1 - f0), 172, q) * (1 - 0.25 * to), lerp(8, 97, q) * (1 - 0.25 * to), true, 1, 0);
      const la = S(16.3 + 0.05 * i, 16.6 + 0.05 * i);
      TX('0' + (i + 1), XS[i] - 86, y - 60, F(14, 'mono', SL, { alpha: la }));
      TX(['0:00', '0:04', '0:08', '0:11', '0:14'][i], XS[i] + 86, y - 60, F(14, 'mono', ST, { align: 'right', alpha: la }));
      lib.line(ctx, [[XS[i] - 8, -16], [XS[i], -8], [XS[i] + 8, -16]], 1, { color: ST, width: 2, alpha: S(16.3 + 0.1 * i, 16.55 + 0.1 * i) });
      ctx.restore();
    }
    for (let i = 0; i < 6; i++) {
      const kb = i < 5 ? S(16.3 + 0.1 * i, 16.75 + 0.1 * i, ease.linear) : 1;
      const g = i < 5 ? SPR(S(17.8 + 0.04 * i, 18.4 + 0.04 * i, ease.linear), 0.7, 1.5) : 1, ga = i < 5 ? 1 : SPR(S(18.2, 18.6, ease.linear), 0.6, 1.8);
      const q = SPR(S(21.0 + 0.04 * i, 21.6 + 0.04 * i, ease.linear), 0.7, 1.5);
      if (kb <= 0 || ga <= 0) continue;
      const gx = GX[i % 3], gy = GY[Math.floor(i / 3)];
      let x = i < 5 ? lerp(XS[i], gx, g) : gx, y = i < 5 ? lerp(92, gy, g) : gy, w = i < 5 ? lerp(172, 290, g) : 290 * ga;
      x = lerp(x, -400 + 160 * i, q); y = lerp(y, -300, q); w = lerp(w, 150, q);
      const h = w * 9 / 16, d = 1 - fixK(i), ph = s > 22.2 ? clamp(1 - Math.abs(lerp(-475, 300, S(22.2, 23.3, ease.linear)) - x) / 80) : 0;
      ctx.save(); ctx.globalAlpha *= i < 5 ? 1 : clamp(ga);
      if (q > 0.5) shadow(x - w / 2, y - h / 2, w, h, 8, 0.6);
      shot(i, x, y, w, h, false, kb, d);
      if (ph > 0) R(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, h * 0.08, { stroke: CLAY, lineWidth: 3, alpha: ph });
      const P = PROB[i];
      if (P) {   // review marks: a red ring and tag, then a check once fixed
        const mk = S(P[6], P[6] + 0.35, ease.linear), fx = S(P[5], P[5] + 0.4, ease.in), sc = w / 160, X = x - w / 2, Y = y - h / 2;
        const ex = X + P[0] * sc, ey = Y + P[1] * sc, out = 1 - S(20.9, 21.1, ease.in);
        if (mk > 0 && fx < 1) {
          const pts = [];
          for (let j = 0; j <= 44; j++) { const a = (j / 40) * Math.PI * 2 - 2.2, rr = 1 + 0.07 * lib.noise(j * 0.45, i * 3); pts.push([ex + Math.cos(a) * P[2] * sc * rr, ey + Math.sin(a) * P[3] * sc * rr]); }
          lib.line(ctx, pts, mk, { color: RED, width: 3, alpha: 1 - fx });
          const tw2 = mw(P[4], F(16, 'mono', WH)) + 22, ta = seg(mk, 0.5, 1) * (1 - fx);
          R(X + 10, Y - 15, tw2, 30, 7, { fill: RED, alpha: ta }); TX(P[4], X + 21, Y + 6, F(16, 'mono', WH, { alpha: ta }));
        }
        const bd = SPR(S(P[5] + 0.25, P[5] + 0.6, ease.linear), 0.55, 2) * out;
        if (bd > 0) { lib.circle(ctx, X + w - 20, Y + 20, 13 * bd, { fill: OLIVE }); lib.line(ctx, [[X + w - 26, Y + 20], [X + w - 21, Y + 25], [X + w - 13, Y + 15]], seg(bd, 0.4, 1), { color: WH, width: 2.6 }); }
      }
      ctx.restore();
    }
    const scan = S(18.55, 19.05, ease.inOut);
    if (scan > 0 && scan < 1) lib.line(ctx, [[-475, lerp(-190, 190, scan)], [475, lerp(-190, 190, scan)]], 1, { color: CLAY, width: 2, alpha: Math.sin(Math.PI * scan) });
    // sound: one mix that splits into its three generated lanes
    const wd = S(21.4, 21.95, ease.linear), sp = SPR(S(21.95, 22.55, ease.linear), 0.65, 1.6), LY = [-160, -40, 80];
    if (wd > 0) {
      [0, 1, 2].forEach((l) => {
        const y = lerp(-40, LY[l], sp);
        lib.line(ctx, [[-475, y], [475, y]], 1, { color: LINE, width: 1.5, alpha: sp });
        lane(l, y, wd, l === 1 ? 0.72 : 1);
        TX(['VOICE', 'MUSIC', 'EFFECTS'][l], -475, y - 46, F(16, 'mono', SL, { alpha: sp }));
      });
      ctx.save(); ctx.setLineDash([4, 6]);
      CUTX.forEach((c, j) => lib.line(ctx, [[c, -254], [c, 46]], S(22.4 + 0.05 * j, 22.75 + 0.05 * j, ease.inOut), { color: ST, width: 1.4, alpha: 0.7 }));
      ctx.restore();
      const phk = S(22.2, 23.3, ease.linear);
      if (phk > 0) { const x = lerp(-475, 300, phk); lib.line(ctx, [[x, -352], [x, 120]], 1, { color: CLAY, width: 2.4, alpha: clamp(phk * 8) }); }
    }
    ctx.restore();
    ctx.restore();
  }

  // ════ copy (screen space) ════
  const BRIEF = 'A launch film for our app.\nSunrise, then a big hello.';
  let nC = 0;
  for (let i = 0; i < BRIEF.length; i++) if (s > 1.0 + ((i + 0.45 * (lib.rand(i + 3) - 0.5)) / BRIEF.length) * 1.75) nC = i + 1;
  const bm = S(4.1, 4.95, ease.out), bOut = S(9.2, 9.45, ease.in), bsz = 36 * S0;
  if (bOut < 1) {
    const bp0 = L0(-386, -130), bY = HY - (wide || tall ? 80 : 40) * u, bp1 = [HX + 26 * u, bY], sc = lerp(1, BS / bsz, bm);
    const lh = bsz * 1.4, bo = F(bsz, 'sans', mix(INK, SL, bm), { lineHeight: 1.4 });
    if (bm > 0) R(HX, bY - BS * 0.9, 3 * u, BS * 2.55 * S(4.7, 5.2, ease.inOut), 1.5 * u, { fill: CLAY, alpha: bm * (1 - bOut) });
    ctx.save(); ctx.globalAlpha *= 1 - bOut; ctx.translate(lerp(bp0[0], bp1[0], bm), lerp(bp0[1], bp1[1], bm) - bOut * 30 * u); ctx.scale(sc, sc);
    lib.typewriter(ctx, BRIEF, 0, 0, Math.min(1, (nC + 0.5) / BRIEF.length), Object.assign({ caret: false }, bo));
    const typing = s > 1.0 && s < 2.8, lines = BRIEF.slice(0, nC).split('\n');
    if (s < 4.2 && (typing || (s % 0.9) < 0.5)) R(mw(lines[lines.length - 1], bo) + 3 * S0, (lines.length - 1) * lh - bsz * 0.82, 3 * S0, bsz * 1.0, 1, { fill: CLAY });
    ctx.restore();
  }
  status('ANIMATING THE SCENE', 4.9, 5.3, 9.2, 9.45, HY - (wide || tall ? 80 : 40) * u + BS * 1.4 + 70 * u);
  head('Edit every layer.', 9.35, 9.75, 10.95, 11.2);
  head('Paste a link.\nIt reads your brand.', 11.2, 11.7, 99, 99, dyA);
  head('Any video, rebuilt\nshot for shot.', 14.55, 15.05, 17.7, 17.95, dyB);
  head('Claude checks\nits own work.', 17.95, 18.45, 20.95, 21.2);
  status('LOOKING AT ITS OWN FRAMES', 18.35, 18.65, 19.35, 19.5);
  status('FIXING THE 3 WORST PROBLEMS', 19.5, 19.8, 20.9, 21.1);
  head('Sound, made for\nevery film.', 21.2, 21.6, 23.65, 23.9);

  // ════ export → the animate mark → end card ════
  const E = [SX + 385 * SS, SY + dyB + 260 * SS], bin = SPR(S(22.3, 22.7, ease.linear), 0.6, 1.8);
  const WS = (wide ? 180 : tall ? 156 : 140) * u, D = 0.56 * WS, wmw = mw('animate', F(WS, 'serif', INK, { tracking: -0.01 })), gap = 0.45 * D;
  const lx = W / 2 - (D + gap + wmw) / 2, ly = H * (tall ? 0.45 : 0.43), MK = [lx + D / 2, ly - D / 2];
  if (bin > 0) {
    const bm2 = S(23.4, 23.75, ease.inOut), tv = S(23.72, 24.5, ease.inOut), mm = S(24.4, 24.85, ease.inOut), rk = S(23.55, 24.35, ease.inOut);
    const r0 = 30 * SS, Rr = lerp(r0, D / 2, tv) * (1 + 0.45 * Math.sin(Math.PI * tv)), x = lerp(E[0], MK[0], tv), y = lerp(E[1], MK[1], tv) - Math.sin(Math.PI * tv) * (wide ? 420 : -200) * u;   // arcs clear of the word into its place
    const bw = lerp(190 * SS, 2 * r0, bm2), br = 0.88 + 0.12 * Math.sin((t * Math.PI * 2) / 2.4);
    ctx.save(); ctx.globalAlpha *= clamp(bin * 2);
    if (tv <= 0) { R(x - bw / 2, y - r0 * bin, bw, 2 * r0 * bin, r0 * lerp(0.47, 1, bm2), { fill: mix(INK, '#2A2A28', press(23.3)) }); TX('Export MP4', x, y + 8 * SS, F(22 * SS, 'sans', IV, { align: 'center', weight: 500, alpha: 1 - S(23.4, 23.55) })); }
    else lib.circle(ctx, x, y, Rr, { fill: INK });
    if (mm > 0) lib.circle(ctx, x, y, (Rr - 0.068 * D) * mm, { fill: IV });          // the disc hollows into the animate mark
    if (rk > 0 && mm < 1) lib.ring(ctx, x, y, lerp(Rr + 12 * u, 0.1 * D, mm), rk, { color: CLAY, width: 4 * u, alpha: 1 - mm });
    if (mm > 0) lib.circle(ctx, x, y, 0.18 * D * lerp(1, br, mm) * SPR(mm, 0.5, 2), { fill: CLAY });   // ...and the progress ring collapses into its clay dot
    ctx.restore();
    const wk2 = S(24.15, 24.9, ease.outQuint);
    if (wk2 > 0) TX('animate', lx + D + gap, ly + (1 - wk2) * 40 * u, F(WS, 'serif', INK, { alpha: clamp(wk2 * 1.4), tracking: -0.01 }));
    const tg = S(25.0, 25.9, ease.linear), TS = (wide ? 50 : 46) * u;
    if (tg > 0) lib.words(ctx, 'Describe it. Drop in your files. Get a film.', W / 2, ly + (wide ? 150 : 170) * u, tg, { size: TS, family: 'serif', color: SL, align: 'center', highlight: ['Get', 'a', 'film.'], highlightColor: CLAYD, maxWidth: W - 2 * M, lineHeight: 1.25, stagger: 0.6 });
    const sm = S(25.7, 26.2), uy = ly + (wide ? 262 : tall ? 360 : 330) * u;
    if (sm > 0) {
      const url = 'animate-navy.vercel.app', uo = F(24 * u, 'mono', INK, { align: 'center', tracking: 0.02 }), w2 = mw(url, uo);
      ctx.save(); ctx.globalAlpha *= sm; ctx.translate(0, (1 - sm) * 16 * u);
      R(W / 2 - w2 / 2 - 26 * u, uy - 36 * u, w2 + 52 * u, 54 * u, 27 * u, { fill: WH, stroke: LS, lineWidth: 1.5 * u });
      TX(url, W / 2, uy, uo);
      TX('No sign-in needed to start.', W / 2, uy + 74 * u, F(24 * u, 'sans', ST, { align: 'center' }));
      ctx.restore();
    }
  }
  cursor(cur[0], cur[1], curP, curA);
  ripple(cur[0], cur[1], S(4.0, 4.4, ease.linear), 34 * u);
  ripple(cur[0], cur[1], S(10.1, 10.5, ease.linear), 30 * u);
  ripple(cur[0], cur[1], S(23.3, 23.7, ease.linear), 34 * u);
});
`,
};
