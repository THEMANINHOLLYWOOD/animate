// Night Drive. Hand-built example film in the scene format Claude generates.
// Brief: An 80s synthwave title sequence: a striped neon sun rises over a rushing magenta grid, palms whip past as a wireframe sports car weaves down the road and bolts for the horizon, then a chrome NIGHT DRIVE logo opens out of a laser line with a cyan neon 'after midnight' script flickering on beneath it.
export const film = {
  id: "ex-night-drive",
  title: "Night Drive",
  aspect: "16:9" as const,
  duration: 14,
  prompt: "An 80s synthwave title sequence: a striped neon sun rises over a rushing magenta grid, palms whip past as a wireframe sports car weaves down the road and bolts for the horizon, then a chrome NIGHT DRIVE logo opens out of a laser line with a cyan neon 'after midnight' script flickering on beneath it.",
  code: String.raw`
// NIGHT DRIVE: an outrun title sequence. Sun rises, the grid rushes in, palms whip past,
// a wireframe coupe weaves then bolts for the horizon, the camera rises, chrome title opens on a laser.
const L = lib, U = L.u, E = L.ease;
const wide = W / H >= 1.2, tall = W / H < 0.8;
const S = Math.min(W, H), cx = W / 2;
L.bg(ctx, W, H, '#07010f');
// ---------- timeline ----------
const kSun = L.seg(p, 0.0, 0.2, E.outQuint);
const kSky = L.seg(p, 0.0, 0.1, E.out);
const kGrid = L.seg(p, 0.02, 0.17, E.inOut);
const rise = L.seg(p, 0.38, 0.6, E.inOut);
const kCarIn = L.seg(p, 0.14, 0.28, E.outQuint);
const kCarOut = L.seg(p, 0.4, 0.58, E.in);
const kLaser = L.seg(p, 0.5, 0.55, E.outExpo);
const kOpen = L.spring(L.seg(p, 0.53, 0.66), { damping: 0.5, freq: 2.2 });
const kShine = L.seg(p, 0.64, 0.74, E.inOut);
const kShine2 = L.seg(p, 0.88, 0.97, E.inOut);
const kSub = L.seg(p, 0.68, 0.78);
// ---------- camera / projection ----------
const hy = H * L.lerp(tall ? 0.5 : 0.6, tall ? 0.54 : 0.64, rise);
const f = wide ? H * 1.0 : tall ? H * 0.72 : W * 0.95;
const ch = L.lerp(0.42, 1.05, rise) * (tall ? 1.5 : 1);
const zpos = 7 * t + 14 * E.inOut(L.seg(p, 0.4, 0.6)) - 4 * E.inOut(L.seg(p, 0.6, 0.8));
const proj = (X, Z) => [cx + (X * f) / Z, hy + (ch * f) / Z];
const weave = L.seg(p, 0.2, 0.27, E.inOut) * (1 - L.seg(p, 0.4, 0.48));
const bank = 1.8 * Math.sin(t * 1.3 + 0.6) * weave - 3.2 * Math.sin(Math.PI * rise);
const R = S * (wide ? 0.36 : 0.38);
// cheap neon: stacked strokes instead of shadowBlur on big paths
function glow(color, lw, a) {
  ctx.strokeStyle = color;
  [[5, 0.1], [2.4, 0.28], [1, 1]].forEach((g) => { ctx.globalAlpha = a * g[1]; ctx.lineWidth = lw * g[0]; ctx.stroke(); });
  ctx.globalAlpha = a;
}
const skyG = ctx.createLinearGradient(0, hy - H * 0.75, 0, hy);
skyG.addColorStop(0, '#05010f');
skyG.addColorStop(0.35, '#1c0638');
skyG.addColorStop(0.62, '#4a0d6b');
skyG.addColorStop(0.84, '#a3127e');
skyG.addColorStop(1, '#ff4fa3');
function sky() {
  ctx.save(); ctx.globalAlpha = kSky;
  ctx.fillStyle = skyG;
  ctx.fillRect(-W, -H, W * 3, hy + H + 2); ctx.restore();
  // stars
  ctx.save(); ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 170; i++) {
    const sx = (L.rand(i * 3.1) * 1.3 - 0.15) * W - ((t * 4 * U * (1 + L.rand(i))) % (W * 1.3));
    const x = ((sx % (W * 1.3)) + W * 1.3) % (W * 1.3) - W * 0.15;
    const y = (L.rand(i * 7.7) * 1.2 - 0.2) * hy * 0.92;
    const tw = 0.55 + 0.45 * Math.sin(t * (1.5 + L.rand(i * 2.3) * 4) + i);
    const fade = L.clamp(1 - y / (hy * 0.9));
    ctx.globalAlpha = tw * fade * kSky * (0.4 + 0.6 * L.rand(i * 5.3));
    const s = (L.rand(i * 9.1) > 0.92 ? 3.2 : 1.6) * U;
    ctx.fillRect(x, y, s, s);
  } ctx.restore();
  // a shooting star during the hold
  const ks = L.seg(p, 0.8, 0.86, E.out);
  if (ks > 0 && ks < 1) {
    const x1 = L.lerp(W * 0.88, W * 0.55, ks), y1 = L.lerp(H * 0.06, H * 0.2, ks);
    const sg = ctx.createLinearGradient(x1, y1, x1 + W * 0.12, y1 - H * 0.05);
    sg.addColorStop(0, 'rgba(255,255,255,' + (1 - ks) + ')');
    sg.addColorStop(1, 'rgba(120,240,255,0)');
    ctx.save(); ctx.strokeStyle = sg; ctx.lineWidth = 2.5 * U; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + W * 0.12, y1 - H * 0.05); ctx.stroke(); ctx.restore();
  }
}
function sun() {
  const cy = hy - R * 0.14 + (1 - kSun) * R * 1.4;
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R * 0.4);
  g.addColorStop(0, '#fff36b');
  g.addColorStop(0.35, '#ffb347');
  g.addColorStop(0.62, '#ff4f8b');
  g.addColorStop(1, '#d4148f');
  const hg = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.6);
  hg.addColorStop(0, 'rgba(255,70,170,0.5)');
  hg.addColorStop(1, 'rgba(255,70,170,0)');
  L.circle(ctx, cx, cy, R * 1.6, { fill: hg });
  L.circle(ctx, cx, cy, R, { fill: g });
  // scrolling slits, thickening as they fall
  const gap = R * 0.13, ph = (t * 0.45) % 1;
  ctx.save(); ctx.fillStyle = skyG;
  ctx.beginPath();
  for (let j = -1; j < 12; j++) {
    const y = cy - R * 0.08 + (j + ph) * gap;
    const d = (y - (cy - R * 0.08)) / R;
    if (d < 0) continue;
    const th = gap * L.clamp(0.06 + d * 0.9, 0, 0.85);
    ctx.rect(cx - R - 4, y, R * 2 + 8, th);
  }
  ctx.fill(); ctx.restore();
}
function mountains(scroll, base, amp, step, seed, fill, stroke, a) {
  const g0 = Math.floor(scroll / step) - 2;
  const pts = [];
  for (let g = g0; g < g0 + Math.ceil((W * 1.6) / step) + 4; g++) {
    const x = g * step - scroll - W * 0.3;
    const hgt = g % 2 === 0 ? amp * (0.35 + 0.65 * L.rand(g * 13.7 + seed)) : amp * 0.15 * L.rand(g * 3.3 + seed);
    pts.push([x, base - hgt]);
  }
  ctx.save(); ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], base);
  pts.forEach((q) => ctx.lineTo(q[0], q[1]));
  ctx.lineTo(pts[pts.length - 1][0], base);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  glow(stroke, 2 * U, a);
  // wireframe facets
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const q = pts[i];
    ctx.moveTo(q[0], q[1]);
    ctx.lineTo(q[0] + step * 0.35, base);
    ctx.moveTo(q[0], q[1]);
    ctx.lineTo(q[0] - step * 0.45, base);
  }
  ctx.globalAlpha = a * 0.55;
  ctx.lineWidth = 1.2 * U;
  ctx.stroke(); ctx.restore();
}
function ground() {
  const gg = ctx.createLinearGradient(0, hy, 0, H * 1.2);
  gg.addColorStop(0, '#2a0440');
  gg.addColorStop(1, '#05000c');
  ctx.fillStyle = gg;
  ctx.fillRect(-W, hy, W * 3, H * 2);
  const Zf = 60, Zn = 0.2;
  const Zmin = Math.max(Zn, Zf * Math.pow(Zn / Zf, kGrid));
  const pass = (color, lw, blur, alpha) => {
    ctx.save(); ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let X = -24; X <= 24; X++) {
      const a = proj(X, Zmin), b = proj(X, Zf);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    const fr = zpos % 1;
    for (let k = 1; k <= Zf; k++) {
      const Z = k - fr;
      if (Z < Zmin || Z < Zn) continue;
      const y = hy + (ch * f) / Z;
      ctx.moveTo(-W, y);
      ctx.lineTo(W * 2, y);
    }
    if (blur) glow(color, lw, alpha); else ctx.stroke(); ctx.restore();
  };
  pass('#ff2bd6', 3 * U, 1, 0.9);
  pass('#ffc2f4', 1 * U, 0, 0.9);
  if (kGrid <= 0) return;
  // road: dark strip, cyan rails, streaking centre line
  const RW = tall ? 0.9 : 1.55, Zr = Math.max(Zmin, 0.3);
  const q = [proj(-RW, Zr), proj(RW, Zr), proj(RW, Zf), proj(-RW, Zf)];
  ctx.save(); ctx.fillStyle = '#0c0120';
  ctx.beginPath();
  q.forEach((v, i) => (i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1])));
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[3][0], q[3][1]);
  ctx.moveTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]);
  glow('#3ff7ff', 4 * U, 1);
  ctx.fillStyle = '#e9fdff';
  ctx.beginPath();
  const dm = zpos % 3;
  for (let k = 0; k < 20; k++) {
    const z0 = Math.max(Zr, k * 3 - dm), z1 = k * 3 - dm + 1.6;
    if (z1 <= z0) continue;
    const a = proj(-0.05, z0), b = proj(0.05, z0), c = proj(0.05, z1), d = proj(-0.05, z1);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
  }
  ctx.fill(); ctx.restore();
}
function haze() {
  const hz = ctx.createLinearGradient(0, hy - H * 0.04, 0, hy + H * 0.14);
  hz.addColorStop(0, 'rgba(255,80,190,0)');
  hz.addColorStop(0.22, 'rgba(255,90,200,0.85)');
  hz.addColorStop(0.3, 'rgba(120,10,120,0.7)');
  hz.addColorStop(1, 'rgba(40,0,60,0)');
  ctx.fillStyle = hz;
  ctx.fillRect(-W, hy - H * 0.04, W * 3, H * 0.18);
  const hl = ctx.createLinearGradient(0, hy - 14 * U, 0, hy + 14 * U);
  hl.addColorStop(0, 'rgba(255,80,210,0)');
  hl.addColorStop(0.45, 'rgba(255,120,220,0.8)');
  hl.addColorStop(0.5, '#fff0fa');
  hl.addColorStop(0.55, 'rgba(255,120,220,0.8)');
  hl.addColorStop(1, 'rgba(255,80,210,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(-W, hy - 14 * U, W * 3, 28 * U);
}
function palm(x, y, h, side, a) {
  ctx.save(); ctx.globalAlpha = a;
  ctx.translate(x, y);
  ctx.fillStyle = '#0a0114';
  ctx.strokeStyle = '#0a0114';
  const lean = -side * h * 0.16;
  const tx = lean, ty = -h;
  ctx.beginPath();
  ctx.moveTo(-h * 0.035, 0);
  ctx.quadraticCurveTo(lean * 0.1 - h * 0.02, -h * 0.55, tx - h * 0.012, ty);
  ctx.lineTo(tx + h * 0.012, ty);
  ctx.quadraticCurveTo(lean * 0.1 + h * 0.03, -h * 0.55, h * 0.035, 0);
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = -Math.PI / 2 + (i - 3.5) * 0.42 + Math.sin(t * 2 + i + x * 0.01) * 0.05;
    const len = h * (0.42 + 0.12 * ((i * 37) % 3) / 2);
    const ex = tx + Math.cos(ang) * len, ey = ty + Math.sin(ang) * len * 0.5 + len * 0.45;
    const mx = tx + Math.cos(ang) * len * 0.55, my = ty + Math.sin(ang) * len * 0.75 - len * 0.12;
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(mx, my - h * 0.08, ex, ey);
    ctx.quadraticCurveTo(mx, my + h * 0.06, tx, ty + h * 0.025);
  }
  ctx.fill(); ctx.restore();
}
function palms() {
  const t0 = 0.05 * T, gapZ = 6, sp = 7, Zf = 34;
  const list = [];
  for (let i = 0; i < 60; i++) {
    for (let s = -1; s <= 1; s += 2) {
      const ts = t0 + (i * gapZ + (s > 0 ? gapZ / 2 : 0)) / sp;
      const Z = Zf - (zpos - ts * sp);
      if (Z > 0.35 && Z <= Zf && t >= ts && ts <= 0.32 * T) list.push([Z, s]);
    }
  }
  list.sort((a, b) => b[0] - a[0]);
  list.forEach((it) => {
    const Z = it[0], s = it[1];
    const pt = proj(s * (tall ? 2.2 : 3.4), Z);
    palm(pt[0], pt[1], (3.4 * f) / Z, s, L.clamp((Zf - Z) / 8));
  });
}
function car() {
  if (p < 0.14 || kCarOut >= 1) return;
  const Zc = L.lerp(0.62, 2.5, kCarIn) + 55 * kCarOut * kCarOut;
  const X = (wide ? 0.7 : 0.38) * Math.sin((t - 0.2 * T) * 1.6) * weave;
  const g = proj(X, Zc), sc = (f / Zc) * (tall ? 0.72 : 1);
  const a = L.clamp((52 - Zc) / 20);
  const lw = (2.6 * U) / sc;
  ctx.save(); ctx.globalAlpha = a;
  ctx.translate(g[0], g[1]);
  ctx.scale(sc, sc);
  ctx.rotate(-X * 0.05 * Math.cos(t * 1.3) * weave);
  const path = (pts) => { ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]))); ctx.closePath(); };
  // ground glow
  ctx.fillStyle = 'rgba(255,40,140,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 0, 0.66, 0.06, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#04000a';
  ctx.fillRect(-0.5, -0.14, 0.17, 0.14); ctx.fillRect(0.33, -0.14, 0.17, 0.14);
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#3ff7ff';
  path([[-0.55, -0.11], [0.55, -0.11], [0.57, -0.3], [0.5, -0.35], [-0.5, -0.35], [-0.57, -0.3]]);
  ctx.fillStyle = '#16052c'; ctx.fill(); glow('#3ff7ff', lw, a);
  path([[-0.42, -0.35], [0.42, -0.35], [0.3, -0.52], [-0.3, -0.52]]);
  ctx.fillStyle = '#0b0219'; ctx.fill(); glow('#3ff7ff', lw, a);
  const wg = ctx.createLinearGradient(0, -0.5, 0, -0.37);
  wg.addColorStop(0, '#ff9a4d'); wg.addColorStop(1, '#7a1a8a');
  path([[-0.34, -0.37], [0.34, -0.37], [0.26, -0.49], [-0.26, -0.49]]);
  ctx.globalAlpha = a * 0.7; ctx.fillStyle = wg; ctx.fill(); ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.moveTo(-0.55, -0.15); ctx.lineTo(0.55, -0.15);
  ctx.moveTo(-0.56, -0.385); ctx.lineTo(0.56, -0.385);
  ctx.rect(-0.09, -0.21, 0.18, 0.055);
  glow('#3ff7ff', lw * 0.8, a);
  // tail-light bar with louvres
  ctx.fillStyle = '#ff1f4f';
  [[0.09, 0.12], [0.045, 0.25], [0.018, 0.5]].forEach((e) => { ctx.globalAlpha = a * e[1]; ctx.fillRect(-0.51 - e[0], -0.29 - e[0], 1.02 + e[0] * 2, 0.07 + e[0] * 2); });
  ctx.globalAlpha = a;
  ctx.fillStyle = '#ff2a5a';
  ctx.fillRect(-0.51, -0.29, 1.02, 0.07);
  ctx.fillStyle = 'rgba(255,220,230,0.8)';
  ctx.fillRect(-0.49, -0.282, 0.2, 0.01); ctx.fillRect(0.29, -0.282, 0.2, 0.01);
  ctx.fillStyle = '#3a0010';
  ctx.fillRect(-0.51, -0.268, 1.02, 0.008); ctx.fillRect(-0.51, -0.25, 1.02, 0.008);
  // tail-light reflection streaks on the road
  const rg = ctx.createLinearGradient(0, 0, 0, 0.3);
  rg.addColorStop(0, 'rgba(255,40,90,0.28)'); rg.addColorStop(1, 'rgba(255,40,90,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(-0.46, 0.01, 0.12, 0.3); ctx.fillRect(0.34, 0.01, 0.12, 0.3); ctx.restore();
}
// ---------- world ----------
L.camera(ctx, { rot: bank, zoom: 1.06 + 0.04 * rise + 0.05 * L.seg(p, 0.62, 1, E.inOutSine), y: -H * 0.02 * rise }, () => {
  // each thing in the world is a layer of its own in the editor
  L.layer(ctx, 'Sky', sky);
  L.layer(ctx, 'Sun', () => { ctx.globalAlpha = kSky; sun(); });
  const mA = L.seg(p, 0.03, 0.16, E.out);
  L.layer(ctx, 'Far mountains', () => mountains(t * 6 * U, hy, H * 0.1, W * 0.07, 1, '#1a0533', '#8a4dff', mA));
  L.layer(ctx, 'Near mountains', () => mountains(t * 14 * U + W * 0.2, hy, H * 0.065, W * 0.05, 7, '#120228', '#3ff7ff', mA));
  L.layer(ctx, 'Road and grid', ground);
  L.layer(ctx, 'Horizon haze', haze);
  L.layer(ctx, 'Palms', palms);
  L.layer(ctx, 'Car', car);
});
// ---------- title ----------
const titleOn = kLaser > 0;
if (titleOn) {
  const lines = tall ? ['NIGHT', 'DRIVE'] : ['NIGHT DRIVE'];
  const to = { family: 'sans', weight: 800, tracking: 0.04, align: 'center', size: 100 };
  const mw = Math.max.apply(null, lines.map((s) => L.text(ctx, s, 0, 0, Object.assign({}, to, { alpha: 0 })).width));
  const size = Math.min(((tall ? W * 0.8 : W * 0.76) / mw) * 100, S * 0.24);
  const lh = size * 0.98, cap = size * 0.72;
  const tw = (mw * size) / 100;
  const sunCy = hy - R * 0.14;
  const ty0 = (tall ? sunCy - R * 0.55 : sunCy - R * 0.38) - ((lines.length - 1) * lh) / 2;
  const mid = ty0 + ((lines.length - 1) * lh) / 2 - cap / 2;
  const o = Object.assign({}, to, { size });
  // laser line that the chrome opens out of
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1 - L.seg(p, 0.58, 0.66);
  const lw2 = tw * 1.2 * kLaser;
  [[26, 0.12, '#3ff7ff'], [10, 0.3, '#3ff7ff'], [2.5, 1, '#ffffff']].forEach((g) => {
    ctx.fillStyle = g[2];
    ctx.globalAlpha = g[1] * (1 - L.seg(p, 0.58, 0.66));
    ctx.fillRect(cx - lw2 / 2 - g[0] * U, mid - g[0] * U, lw2 + g[0] * 2 * U, g[0] * 2 * U);
  }); ctx.restore();
  if (kOpen > 0) {
    ctx.save(); ctx.translate(cx, mid);
    ctx.scale(1 + 0.04 * (1 - kOpen), Math.max(0.001, kOpen));
    ctx.translate(-cx, -mid);
    const ab = 3 * U * (1 + 3 * (1 - L.seg(p, 0.53, 0.64)));
    lines.forEach((s, i) => {
      const y = ty0 + i * lh;
      ctx.save(); ctx.translate(cx, y);
      ctx.transform(1, 0, -0.2, 1, 0, 0);
      // extrusion
      const ow = size * 0.028;
      for (let d = 0; d < 8; d++) {
        const an = (d * Math.PI) / 4;
        L.text(ctx, s, Math.cos(an) * ow, Math.sin(an) * ow + size * 0.03, Object.assign({}, o, { color: '#14002a' }));
      }
      for (let d = 6; d >= 1; d--) {
        L.text(ctx, s, 0, d * size * 0.016, Object.assign({}, o, { color: L.mix('#ff2bd6', '#2a0045', d / 6) }));
      }
      // chromatic aberration ghosts
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      L.text(ctx, s, -ab, 0, Object.assign({}, o, { color: '#00f0ff', alpha: 0.75 }));
      L.text(ctx, s, ab, 0, Object.assign({}, o, { color: '#ff00c8', alpha: 0.75 })); ctx.restore();
      // chrome body
      const cg = ctx.createLinearGradient(0, -cap, 0, 0);
      cg.addColorStop(0, '#20307a');
      cg.addColorStop(0.18, '#5aa8ff');
      cg.addColorStop(0.44, '#e8fbff');
      cg.addColorStop(0.5, '#ffffff');
      cg.addColorStop(0.52, '#3b0f4f');
      cg.addColorStop(0.62, '#8c2a8f');
      cg.addColorStop(0.84, '#ff9ad8');
      cg.addColorStop(1, '#fff1fb');
      L.text(ctx, s, 0, 0, Object.assign({}, o, { color: cg }));
      // shine sweeps
      [kShine, kShine2].forEach((k) => {
        if (k <= 0 || k >= 1) return;
        const sx = L.lerp(-tw * 0.75, tw * 0.75, k);
        const sg = ctx.createLinearGradient(sx - size * 0.5, 0, sx + size * 0.5, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)');
        sg.addColorStop(0.5, 'rgba(255,255,255,0.95)');
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        L.text(ctx, s, 0, 0, Object.assign({}, o, { color: sg })); ctx.restore();
      }); ctx.restore();
    }); ctx.restore();
    // glint star at the end of each sweep
    [[kShine, 0.85], [kShine2, 0.85]].forEach((g) => {
      const k = L.clamp((g[0] - g[1]) / 0.15) * (1 - L.clamp((g[0] - 0.97) / 0.03));
      if (k <= 0) return;
      const gx = cx + tw * 0.5 - size * 0.02, gy = ty0 - cap * 0.95;
      const r = size * 0.45 * Math.sin(Math.PI * Math.min(1, k));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4 + t;
        const rr = i % 2 ? r * 0.12 : r;
        ctx.lineTo(gx + Math.cos(ang) * rr, gy + Math.sin(ang) * rr);
      }
      ctx.fill(); ctx.restore();
    });
  }
  // neon subtitle: flickers on like a tube striking
  if (kSub > 0) {
    const bucket = Math.floor(t * 22);
    const lit = kSub >= 1 ? 0.9 + 0.1 * L.noise(t * 8, 3) : (L.rand(bucket * 1.7 + 11) < 0.25 + kSub * 0.8 ? 1 : 0.12);
    const ss = size * (tall ? 0.46 : 0.42);
    const sy = ty0 + (lines.length - 1) * lh + size * 0.68;
    const sxp = tall ? cx : cx + tw * 0.16;
    ctx.save(); ctx.translate(sxp, sy);
    ctx.rotate(-0.12);
    const so = { family: 'serif', italic: true, weight: 700, size: ss, align: 'center', tracking: 0.01, maxWidth: W * 0.8 };
    const sub = 'after midnight', ow2 = ss * 0.045;
    for (let d = 0; d < 4; d++) {
      const an = (d * Math.PI) / 2 + Math.PI / 4;
      L.text(ctx, sub, Math.cos(an) * ow2, Math.sin(an) * ow2, Object.assign({}, so, { color: '#1a0030', alpha: 0.85 }));
    }
    L.text(ctx, sub, 0, 0, Object.assign({}, so, { color: L.mix('#0a3a55', '#22f2ff', lit) }));
    ctx.globalCompositeOperation = 'lighter';
    for (let d = 0; d < 6; d++) {
      const an = (d * Math.PI) / 3, r = ss * 0.07;
      L.text(ctx, sub, Math.cos(an) * r, Math.sin(an) * r, Object.assign({}, so, { color: '#00c8ff', alpha: 0.16 * lit }));
    }
    ctx.save(); ctx.scale(1, 0.22);
    const hg2 = ctx.createRadialGradient(0, -ss * 1.4, 0, 0, -ss * 1.4, ss * 4.5);
    hg2.addColorStop(0, 'rgba(0,200,255,' + 0.22 * lit + ')'); hg2.addColorStop(1, 'rgba(0,200,255,0)');
    ctx.fillStyle = hg2; ctx.fillRect(-ss * 4.5, -ss * 6, ss * 9, ss * 9); ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    L.text(ctx, sub, 0, -ss * 0.015, Object.assign({}, so, { color: L.mix('#103040', '#e6feff', lit), size: ss * 0.98 })); ctx.restore();
  }
}
// ---------- CRT: scanlines + vignette ----------
L.layer(ctx, 'Scanlines and vignette', () => {
ctx.fillStyle = 'rgba(0,0,0,0.22)';
ctx.beginPath();
const sl = Math.max(2, 3 * U);
for (let y = 0; y < H; y += sl * 1.5) ctx.rect(0, y, W, sl * 0.5);
ctx.fill();
const vg = ctx.createRadialGradient(cx, H / 2, S * 0.35, cx, H / 2, Math.max(W, H) * 0.75);
vg.addColorStop(0, 'rgba(0,0,0,0)');
vg.addColorStop(1, 'rgba(5,0,15,0.7)');
ctx.fillStyle = vg;
ctx.fillRect(0, 0, W, H);
});
`,
};
