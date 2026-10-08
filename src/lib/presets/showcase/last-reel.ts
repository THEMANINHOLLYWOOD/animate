// The Last Reel. Hand-built example film in the scene format Claude generates.
// Brief: A 1920s silent-film short in flickering sepia: academy countdown leader, an art-deco intertitle, a top-hatted gentleman hopping across moonlit rooftops in jerky undercranked motion to greet a man-in-the-moon, iris wipes between shots, and a deco THE END card, with grain, scratches, dust and gate weave throughout.
export const film = {
  id: "ex-last-reel",
  title: "The Last Reel",
  aspect: "16:9" as const,
  duration: 14,
  prompt: "A 1920s silent-film short in flickering sepia: academy countdown leader, an art-deco intertitle, a top-hatted gentleman hopping across moonlit rooftops in jerky undercranked motion to greet a man-in-the-moon, iris wipes between shots, and a deco THE END card, with grain, scratches, dust and gate weave throughout.",
  code: String.raw`
const E = lib.ease, R = lib.rand, u = lib.u, seg = lib.seg, clamp = lib.clamp, lerp = lib.lerp;
const wide = W / H >= 1.2, tall = W / H < 0.8;
const cx = W / 2, cy = H / 2, S = Math.min(W, H), PI = Math.PI;
const fi = Math.floor(t * 24);                       // projector frame index
const fq = Math.floor(p * T * 12) / (T * 12);        // undercranked 12 fps clock (as p)
const C = { black: '#0c0906', ink: '#18120c', dark: '#2b2218', umber: '#4a3d2c', mid: '#76654b', stone: '#a8936f', paper: '#d6c39d', light: '#ece0c2', white: '#fbf3df' };

lib.bg(ctx, W, H, C.black);

// ── Shot list (fractions of the film) ──────────────────────────────
const SH = [
  { a: 0.000, b: 0.19, d: leader, open: false },
  { a: 0.2, b: 0.37, d: titleCard },
  { a: 0.38, b: 0.6, d: scene1, f: (k) => { const f = figAt(seg(fq, SH[2].a, SH[2].b)); return [f.x, f.y - figS * 0.5]; } },
  { a: 0.61, b: 0.73, d: dialogue },
  { a: 0.74, b: 0.845, d: scene2, f: () => [lerp(moon.x, xStop, 0.35), lerp(moon.y, H * 0.6, 0.35)] },
  { a: 0.855, b: 0.985, d: theEnd, last: true }
];
const IR = 0.032; // iris duration

// ── Shared geometry: town, moon, gentleman ────────────────────────
const moon = wide ? { x: W * 0.74, y: H * 0.3, r: S * 0.2 } : tall ? { x: W * 0.64, y: H * 0.3, r: S * 0.2 } : { x: W * 0.68, y: H * 0.27, r: S * 0.16 };
const roofs = [[-0.2, 0.19, 0.3], [0.23, 0.43, 0.36], [0.47, 0.71, 0.28], [0.75, 1.2, 0.34]];
const roofScale = tall ? 0.75 : 1;
const roofY = (i) => H - H * roofs[i][2] * roofScale;
const figS = S * (tall ? 0.2 : 0.21);
const xStop = W * (wide ? 0.55 : tall ? 0.36 : 0.5);
function groundAt(x) {
  for (let i = 0; i < roofs.length - 1; i++) {
    const g0 = roofs[i][1] * W, g1 = roofs[i + 1][0] * W, m = figS * 0.35;
    if (x > g0 - m && x < g1 + m) {
      const k = (x - (g0 - m)) / (g1 - g0 + 2 * m);
      return { y: lerp(roofY(i), roofY(i + 1), E.inOut(k)) - Math.sin(k * PI) * figS * 0.35, hop: true };
    }
  }
  for (let i = 0; i < roofs.length; i++) if (x <= roofs[i][1] * W) return { y: roofY(i), hop: false };
  return { y: roofY(roofs.length - 1), hop: false };
}

function sky(dy) {
  const g = ctx.createLinearGradient(0, -(dy || 0), 0, H - (dy || 0));
  g.addColorStop(0, C.ink); g.addColorStop(0.45, C.umber); g.addColorStop(0.8, C.stone); g.addColorStop(1, C.paper);
  return g;
}

function stars(k) {
  // painted cut-out stars dangling from the fly loft on threads
  const n = wide ? 7 : 5;
  for (let i = 0; i < n; i++) {
    const x = W * (0.06 + (i + 0.5) / n * 0.88) + (R(i * 7) - 0.5) * W * 0.05;
    if (Math.abs(x - moon.x) < moon.r * 1.35) continue;
    const len = H * (0.08 + R(i * 3 + 1) * 0.22), sw = Math.sin(t * (1.1 + R(i) * 0.6) + i) * 0.06;
    const sx = x + Math.sin(sw) * len, sy = Math.cos(sw) * len, r = S * (0.018 + R(i * 5) * 0.012);
    ctx.strokeStyle = C.stone; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2 * u;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(sx, sy - r); ctx.stroke();
    ctx.globalAlpha = 0.75 + 0.25 * R(fi * 3 + i);
    ctx.fillStyle = C.light; ctx.beginPath();
    for (let j = 0; j < 10; j++) { const a = -PI / 2 + j * PI / 5 + sw, rr = j % 2 ? r * 0.42 : r; ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
    ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.fillStyle = C.paper; ctx.beginPath();
  for (let i = 0; i < 46; i++) {
    if (R(fi * 50 + i) < 0.15) continue; // twinkle
    const x = R(i * 11 + 3) * W, y = R(i * 13 + 9) * H * 0.55, r = (0.8 + R(i) * 1.6) * u;
    ctx.rect(x, y, r, r);
  }
  ctx.fill();
}

function drawMoon(open, wink, smile) {
  const { x, y, r } = moon, rot = Math.sin(t * 0.7) * 0.05;
  ctx.strokeStyle = C.stone; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.4 * u;
  ctx.beginPath(); ctx.moveTo(x + r * 0.3, 0); ctx.lineTo(x + r * 0.3 + Math.sin(rot) * r, y - r * 0.92); ctx.stroke(); ctx.globalAlpha = 1;
  const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
  halo.addColorStop(0, 'rgba(236,224,194,0.22)'); halo.addColorStop(1, 'rgba(236,224,194,0)');
  ctx.fillStyle = halo; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  const ix = -r * 0.46, iy = -r * 0.08, ir = r * 0.86;
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, PI * 2); ctx.clip();
  ctx.fillStyle = C.light; ctx.fill();
  ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(r * 0.35, r * 0.35, r * 0.13, 0, PI * 2); ctx.arc(r * 0.6, -r * 0.5, r * 0.07, 0, PI * 2); ctx.fill();
  ctx.fillStyle = sky(y); ctx.beginPath(); ctx.arc(ix, iy, ir, 0, PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(236,224,194,0.13)'; ctx.fill();
  ctx.restore();
  const edge = (a, d) => [ix + Math.cos(a) * (ir + d), iy + Math.sin(a) * (ir + d)];
  const q = r * 1.35; // nose
  const n0 = edge(0.02, 0), na = edge(-0.12, 0), nb = edge(0.14, 0);
  ctx.fillStyle = C.light; ctx.beginPath(); ctx.moveTo(na[0], na[1]); ctx.quadraticCurveTo(n0[0] - q * 0.2, n0[1] + q * 0.05, nb[0], nb[1]); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = q * 0.035; ctx.lineCap = 'round';
  // eye: closed arc → open almond; wink squeezes shut
  const e = edge(-0.42, q * 0.13), op = open * (1 - wink);
  ctx.beginPath(); ctx.ellipse(e[0], e[1], q * 0.075, q * 0.06 * Math.max(0.08, op), 0, 0, PI * 2);
  if (op > 0.15) { ctx.stroke(); ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(e[0] - q * 0.03, e[1], q * 0.03 * op, 0, PI * 2); ctx.fill(); }
  else if (wink > 0.5) { ctx.beginPath(); ctx.arc(e[0], e[1] + q * 0.04, q * 0.07, PI + 0.3, -0.3); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(e[0], e[1] - q * 0.03, q * 0.07, 0.2, PI - 0.2); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(e[0] - q * 0.09, e[1] - q * 0.11); ctx.quadraticCurveTo(e[0], e[1] - q * 0.15 - wink * q * 0.04, e[0] + q * 0.09, e[1] - q * 0.1); ctx.stroke();
  // mouth
  const m = edge(0.42, q * 0.1);
  ctx.beginPath(); ctx.moveTo(m[0] - q * 0.06, m[1] - q * 0.02); ctx.quadraticCurveTo(m[0], m[1] + q * (0.03 + smile * 0.09), m[0] + q * 0.1, m[1] - q * 0.04 - smile * q * 0.03); ctx.stroke();
  ctx.fillStyle = C.stone; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(m[0] + q * 0.16, m[1] - q * 0.1, q * 0.06, 0, PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
}

function town() {
  // far skyline (painted flat, lighter)
  ctx.fillStyle = C.mid; ctx.beginPath();
  let x = -W * 0.02, i = 0;
  while (x < W) { const w = W * (0.04 + R(i * 3) * 0.06), h = H * (0.2 + R(i * 3 + 1) * 0.16) * roofScale; ctx.rect(x, H - h, w, h); if (R(i * 9) > 0.6) ctx.rect(x + w * 0.4, H - h - H * 0.05, w * 0.2, H * 0.05); x += w * 0.92; i++; }
  ctx.fill();
  ctx.fillStyle = C.stone; ctx.beginPath(); x = -W * 0.02; i = 0;
  while (x < W) { const w = W * (0.04 + R(i * 3) * 0.06), h = H * (0.2 + R(i * 3 + 1) * 0.16) * roofScale;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) if (R(i * 100 + r * 7 + c) > 0.72) ctx.rect(x + w * (0.18 + c * 0.25), H - h + H * 0.03 + r * H * 0.04, w * 0.1, H * 0.018);
    x += w * 0.92; i++; }
  ctx.fill();
  // near rooftops (black cut-outs)
  ctx.fillStyle = C.black; ctx.beginPath();
  roofs.forEach((b, j) => {
    const x0 = b[0] * W, x1 = b[1] * W, y = roofY(j);
    ctx.rect(x0, y, x1 - x0, H - y);
    ctx.rect(x0 - 4 * u, y - 6 * u, x1 - x0 + 8 * u, 10 * u); // cornice
    const cxm = lerp(x0, x1, 0.25 + R(j) * 0.5);
    if (j !== 2) { ctx.rect(cxm, y - S * 0.07, S * 0.03, S * 0.07); ctx.rect(cxm - 3 * u, y - S * 0.075, S * 0.03 + 6 * u, 8 * u); }
  });
  ctx.fill();
  // water tower on the third roof
  const wx = lerp(roofs[2][0] * W, roofs[2][1] * W, 0.82), wy = roofY(2), ts = S * 0.06;
  ctx.beginPath(); ctx.rect(wx - ts * 0.5, wy - ts * 1.9, ts, ts * 1.1); ctx.moveTo(wx - ts * 0.6, wy - ts * 1.9); ctx.lineTo(wx, wy - ts * 2.4); ctx.lineTo(wx + ts * 0.6, wy - ts * 1.9); ctx.fill();
  ctx.strokeStyle = C.black; ctx.lineWidth = 3 * u; ctx.beginPath();
  ctx.moveTo(wx - ts * 0.4, wy); ctx.lineTo(wx - ts * 0.4, wy - ts * 0.8); ctx.moveTo(wx + ts * 0.4, wy); ctx.lineTo(wx + ts * 0.4, wy - ts * 0.8);
  ctx.moveTo(wx - ts * 0.4, wy); ctx.lineTo(wx + ts * 0.4, wy - ts * 0.8); ctx.stroke();
  // lit windows on the near rooftops, a few switch on over time
  ctx.fillStyle = C.paper; ctx.beginPath();
  roofs.forEach((b, j) => {
    for (let k = 0; k < 7; k++) {
      if (R(j * 40 + k) < 0.45 || R(j * 40 + k + 9) * 3 > t) continue;
      const x0 = lerp(b[0] * W, b[1] * W, 0.08 + R(j * 977 + k * 31 + 5) * 0.84), y0 = roofY(j) + H * (0.06 + R(j * 613 + k * 57 + 2) * 0.16);
      ctx.rect(x0, y0, S * 0.022, S * 0.03);
    }
  });
  ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
}

function gent(x, y, s, ph, walk, hop, hat, look) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = ctx.strokeStyle = C.black; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const sw = walk ? Math.sin(ph * PI * 2) : 0, bob = walk ? Math.abs(Math.cos(ph * PI * 2)) * s * 0.03 : 0;
  ctx.translate(0, -bob);
  const hy = -s * 0.45;
  ctx.lineWidth = s * 0.065; ctx.beginPath();
  [1, -1].forEach((g) => {
    const a = hop ? g * 0.5 : sw * 0.5 * g, kn = hop ? 0.9 : Math.max(0, -sw * g) * 0.6;
    const kx = Math.sin(a) * s * 0.22, ky = hy + Math.cos(a) * s * 0.22;
    const fx = kx + Math.sin(a - kn) * s * 0.23, fy = ky + Math.cos(a - kn) * s * 0.23;
    ctx.moveTo(0, hy); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.lineTo(fx + s * 0.07, fy);
  });
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s * 0.08, -s * 0.8); ctx.lineTo(s * 0.09, -s * 0.8); ctx.lineTo(s * 0.08, -s * 0.47);
  ctx.lineTo(-s * 0.03, -s * 0.47); ctx.lineTo(-s * (0.15 + Math.abs(sw) * 0.03), -s * 0.32); ctx.lineTo(-s * 0.1, -s * 0.55); ctx.closePath(); ctx.fill();
  // arm + cane (or arm raising the hat)
  ctx.lineWidth = s * 0.055; ctx.beginPath(); ctx.moveTo(s * 0.04, -s * 0.76);
  const hatX = s * 0.03 + hat * s * 0.1, hatY = -s * 0.95 - hat * s * 0.16;
  if (hat > 0.02) { ctx.lineTo(s * 0.14, -s * 0.8 - hat * s * 0.08); ctx.lineTo(hatX + s * 0.02, hatY + s * 0.02); }
  else ctx.lineTo(s * 0.15 + sw * s * 0.05, -s * 0.52);
  ctx.stroke();
  const caneTop = hat > 0.02 ? [s * 0.1, -s * 0.5] : [s * 0.15 + sw * s * 0.05, -s * 0.52];
  ctx.lineWidth = s * 0.022; ctx.beginPath(); ctx.moveTo(caneTop[0], caneTop[1]); ctx.lineTo(caneTop[0] + s * 0.06 + sw * s * 0.08, hop ? caneTop[1] + s * 0.4 : 0); ctx.stroke();
  // head (tilts up to look at the moon)
  ctx.save(); ctx.translate(s * 0.02, -s * 0.86); ctx.rotate(-look * 0.35);
  ctx.beginPath(); ctx.arc(0, 0, s * 0.072, 0, PI * 2); ctx.moveTo(s * 0.06, -s * 0.01); ctx.lineTo(s * 0.11, s * 0.015); ctx.lineTo(s * 0.06, s * 0.03); ctx.fill();
  if (hat <= 0.02) { ctx.fillRect(-s * 0.1, -s * 0.07, s * 0.2, s * 0.025); ctx.fillRect(-s * 0.06, -s * 0.23, s * 0.12, s * 0.17); }
  ctx.restore();
  if (hat > 0.02) { ctx.save(); ctx.translate(hatX, hatY); ctx.rotate(-hat * 0.5); ctx.fillRect(-s * 0.1, 0, s * 0.2, s * 0.025); ctx.fillRect(-s * 0.06, -s * 0.16, s * 0.12, s * 0.17); ctx.restore(); }
  ctx.restore();
}

function figAt(kq) {
  const x = lerp(-W * 0.06, xStop, E.out(clamp(kq / 0.8)) * 0.15 + clamp(kq / 0.8) * 0.85);
  const g = groundAt(x);
  return { x, y: g.y - 4 * u, hop: g.hop, ph: x / (figS * 0.8), walking: kq < 0.8 };
}

function stage(k, zoom, body) {
  lib.camera(ctx, { zoom, cx: W / 2, cy: H * 0.6 }, () => { ctx.fillStyle = sky(); ctx.fillRect(-W, -H, W * 3, H * 3); stars(k); body(); });
}

// ── Shots ─────────────────────────────────────────────────────────
function scene1(k) {
  const kq = seg(fq, SH[2].a, SH[2].b), f = figAt(kq);
  const open = seg(k, 0.84, 0.9, E.out), look = seg(kq, 0.8, 0.88, E.out);
  stage(k, 1 + 0.03 * k, () => { drawMoon(open, 0, 0.2); town(); gent(f.x, f.y, figS, f.ph, f.walking, f.hop, 0, look); });
}

function scene2(k) {
  const kq = seg(fq, SH[4].a, SH[4].b), f = figAt(1);
  const hat = Math.min(seg(kq, 0.12, 0.3, E.out), 1 - seg(kq, 0.62, 0.78, E.inOut));
  const wink = Math.min(seg(k, 0.4, 0.48), 1 - seg(k, 0.6, 0.68));
  stage(k, 1.03 + 0.03 * k, () => { drawMoon(1, wink, seg(k, 0.25, 0.5, E.out) + 0.2); town(); gent(f.x, f.y, figS, 0, false, false, hat, 1 - hat * 0.4); });
}

function leader(k) {
  const n = Math.min(2, Math.floor(k * 3)), kk = k * 3 - n, big = Math.hypot(W, H);
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.stone; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, big, -PI / 2, -PI / 2 + kk * PI * 2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 3 * u; ctx.beginPath();
  ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
  const a = -PI / 2 + kk * PI * 2; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * big, cy + Math.sin(a) * big); ctx.stroke();
  [[0.4, 7], [0.33, 3]].forEach((c) => { ctx.lineWidth = c[1] * u; ctx.strokeStyle = c[1] > 5 ? C.white : C.ink; ctx.beginPath(); ctx.arc(cx, cy, S * c[0], 0, PI * 2); ctx.stroke(); });
  ctx.strokeStyle = C.ink; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(cx, cy, S * 0.4 + 6 * u, 0, PI * 2); ctx.stroke();
  ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(cx, cy, S * 0.25, 0, PI * 2); ctx.fill();
  lib.text(ctx, String(3 - n), cx, cy + S * 0.02, { size: S * 0.4, weight: 700, family: 'serif', color: C.ink, align: 'center', baseline: 'middle' });
  [-1, 1].forEach((g) => lib.text(ctx, 'PICTURE • ' + (3 - n), wide ? cx + g * S * 0.71 : cx + g * W * 0.27, wide ? cy - S * 0.42 : H - S * 0.1, { size: (wide ? 22 : 18) * u, family: 'mono', color: C.ink, align: 'center', tracking: 0.25, alpha: 0.7 }));
}

function frame(k) {
  // art-deco double-line intertitle border with stepped fan corners
  ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.9);
  glow.addColorStop(0, 'rgba(118,101,75,0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  const m = S * 0.085, x0 = m, y0 = m, x1 = W - m, y1 = H - m, dk = seg(k, 0, 0.35, E.inOut);
  const box = (i) => [[x0 + i, y0 + i], [x1 - i, y0 + i], [x1 - i, y1 - i], [x0 + i, y1 - i], [x0 + i, y0 + i]];
  lib.line(ctx, box(0), dk, { color: C.light, width: 4 * u });
  lib.line(ctx, box(14 * u), dk, { color: C.light, width: 1.5 * u });
  ctx.save(); ctx.globalAlpha = seg(k, 0.15, 0.4); ctx.strokeStyle = C.light; ctx.fillStyle = C.light; ctx.lineWidth = 1.8 * u;
  [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]].forEach((c) => {
    ctx.save(); ctx.translate(c[0] + c[2] * 14 * u, c[1] + c[3] * 14 * u); ctx.scale(c[2] * u * 1.5, c[3] * u * 1.5);
    ctx.beginPath();
    [34, 48, 62].forEach((r) => { ctx.moveTo(r, 0); ctx.arc(0, 0, r, 0, PI / 2); });
    for (let j = 1; j < 4; j++) { const a = j * PI / 8; ctx.moveTo(Math.cos(a) * 34, Math.sin(a) * 34); ctx.lineTo(Math.cos(a) * 62, Math.sin(a) * 62); }
    ctx.moveTo(80, 0); ctx.lineTo(80, 10); ctx.lineTo(96, 10); ctx.lineTo(96, 20); ctx.lineTo(130, 20);
    ctx.moveTo(0, 80); ctx.lineTo(10, 80); ctx.lineTo(10, 96); ctx.lineTo(20, 96); ctx.lineTo(20, 130);
    ctx.stroke(); ctx.beginPath(); ctx.moveTo(18, 6); ctx.lineTo(26, 16); ctx.lineTo(16, 26); ctx.lineTo(6, 18); ctx.fill(); ctx.restore();
  });
  [y0 + 14 * u, y1 - 14 * u].forEach((y) => { ctx.beginPath(); ctx.moveTo(cx, y - 10 * u); ctx.lineTo(cx + 12 * u, y); ctx.lineTo(cx, y + 10 * u); ctx.lineTo(cx - 12 * u, y); ctx.fill(); });
  ctx.restore();
}

function rule(y, w, a) {
  ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = C.light; ctx.fillStyle = C.light; ctx.lineWidth = 1.5 * u; ctx.beginPath();
  ctx.moveTo(cx - w, y - 3 * u); ctx.lineTo(cx - 18 * u, y - 3 * u); ctx.moveTo(cx - w, y + 3 * u); ctx.lineTo(cx - 18 * u, y + 3 * u);
  ctx.moveTo(cx + w, y - 3 * u); ctx.lineTo(cx + 18 * u, y - 3 * u); ctx.moveTo(cx + w, y + 3 * u); ctx.lineTo(cx + 18 * u, y + 3 * u); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, y - 9 * u); ctx.lineTo(cx + 9 * u, y); ctx.lineTo(cx, y + 9 * u); ctx.lineTo(cx - 9 * u, y); ctx.fill(); ctx.restore();
}

function titleCard(k) {
  frame(k);
  const mw = W - S * 0.36, a1 = seg(k, 0.02, 0.14, E.out), a2 = seg(k, 0.08, 0.2, E.out), a3 = seg(k, 0.12, 0.28, E.out);
  const big = wide ? 150 * u : 112 * u, y = tall ? cy - 250 * u : cy - 150 * u;
  const T1 = { family: 'serif', color: C.light, align: 'center', baseline: 'middle' };
  lib.text(ctx, 'AN EVENING', cx, y, Object.assign({}, T1, { size: 46 * u, tracking: 0.42, alpha: a1, maxWidth: mw }));
  rule(y + 58 * u, Math.min(mw * 0.5, 300 * u), a1);
  lib.text(ctx, 'at the', cx, y + 112 * u, Object.assign({}, T1, { size: 40 * u, italic: true, alpha: a2 }));
  const ph = wide ? 'PICTURE HOUSE' : 'PICTURE\nHOUSE';
  ctx.save(); ctx.translate(cx, y + (wide ? 240 : tall ? 320 : 300) * u); ctx.scale(0.86, 1.18);
  lib.text(ctx, ph, 0, 0, Object.assign({}, T1, { size: big, weight: 700, tracking: 0.06, alpha: a3, maxWidth: mw / 0.86, lineHeight: 0.95 }));
  ctx.restore();
}

function dialogue(k) {
  frame(k);
  const a = seg(k, 0.03, 0.16, E.out), sz = wide ? 92 * u : 74 * u;
  lib.text(ctx, '“Good evening,\nMister Moon!”', cx, cy - 20 * u, { family: 'serif', italic: true, size: sz, color: C.light, align: 'center', baseline: 'middle', lineHeight: 1.25, alpha: a, maxWidth: W - S * 0.36 });
  rule(cy + sz * 1.6, Math.min(W * 0.2, 220 * u), seg(k, 0.1, 0.3));
}

function theEnd(k) {
  frame(k);
  // deco sunburst rising behind the type
  const fan = seg(k, 0.05, 0.45, E.out), by = cy + S * 0.32;
  ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = C.umber; ctx.beginPath();
  for (let i = 0; i < 13; i++) { const a0 = PI + (i / 13) * PI, a1 = a0 + PI / 26, rr = S * 0.62 * fan; ctx.moveTo(cx, by); ctx.lineTo(cx + Math.cos(a0) * rr, by + Math.sin(a0) * rr); ctx.lineTo(cx + Math.cos(a1) * rr, by + Math.sin(a1) * rr); }
  ctx.fill(); ctx.restore();
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(cx, by, S * 0.12 * fan, PI, 0); ctx.fill();
  const a = seg(k, 0.12, 0.35, E.out), sz = (wide ? 190 : 150) * u;
  ctx.save(); ctx.translate(cx, cy - 10 * u); ctx.scale(0.82, 1.3);
  const o = { family: 'serif', weight: 700, size: sz, align: 'center', baseline: 'middle', tracking: 0.18, maxWidth: (W - S * 0.4) / 0.82 };
  ctx.globalAlpha = a;
  const te = wide ? 'THE END' : 'THE\nEND';
  lib.text(ctx, te, 8 * u, 6 * u, Object.assign({}, o, { color: C.black }));
  lib.text(ctx, te, 0, 0, Object.assign({}, o, { color: C.light }));
  ctx.restore();
  rule(cy - sz * (wide ? 0.95 : 1.75), Math.min(W * 0.3, 360 * u), seg(k, 0.25, 0.45));
  rule(cy + sz * (wide ? 0.8 : 1.6), Math.min(W * 0.3, 360 * u), seg(k, 0.3, 0.5));
}

// ── Projector: gate weave, iris, current shot ─────────────────────
const jump = R(fi * 17 + 3) > 0.97 ? (R(fi) - 0.5) * 22 * u : 0;
ctx.save();
ctx.translate((R(fi * 13 + 1) - 0.5) * 3 * u + lib.noise(t * 2) * 2 * u, (R(fi * 7 + 2) - 0.5) * 4 * u + lib.noise(t * 1.3, 5) * 3 * u + jump);
let splices = [];
SH.forEach((s, i) => {
  splices.push(s.a);
  if (p < s.a || p > s.b) return;
  const k = (p - s.a) / (s.b - s.a), Rm = Math.hypot(W, H) * 0.55;
  const ri = s.open === false ? 1 : E.inOut(seg(p, s.a, s.a + IR));
  const ro = s.last ? 1 - E.inOut(seg(p, s.b - IR * 1.6, s.b)) : 1 - E.inOut(seg(p, s.b - IR, s.b));
  const r = Rm * Math.min(ri, ro);
  if (s.open === false) { s.d(k); return; }
  // the closing iris homes in on the shot's subject; opening iris from centre
  let ox = cx, oy = cy;
  if (ro < 1 && s.f) { const c = s.f(k); ox = lerp(c[0], cx, ro); oy = lerp(c[1], cy, ro); }
  if (r > 0.5) lib.mask(ctx, (c) => c.arc(ox, oy, r, 0, PI * 2), () => s.d(k));
});
ctx.restore();

// ── Film artefacts ───────────────────────────────────────────────
// brightness flicker
ctx.fillStyle = C.black; ctx.globalAlpha = 0.03 + R(fi * 3 + 7) * 0.16; ctx.fillRect(0, 0, W, H);
ctx.fillStyle = C.light; ctx.globalAlpha = R(fi * 5 + 1) * 0.05; ctx.fillRect(0, 0, W, H);
// grain
[[C.black, 0], [C.white, 1]].forEach((g) => {
  ctx.fillStyle = g[0]; ctx.globalAlpha = g[1] ? 0.28 : 0.36; ctx.beginPath();
  for (let i = 0; i < 600; i++) { const sd = fi * 4096 + i * 2 + g[1] * 2048, s = (0.8 + R(sd + 9) * 2.4) * u; ctx.rect(R(sd) * W, R(sd + 1) * H, s, s); }
  ctx.fill();
});
// scratches: persist a few frames, jitter sideways
ctx.lineWidth = 1.6 * u;
for (let j = 0; j < 3; j++) {
  const id = Math.floor((fi + j * 5) / 9) * 7 + j * 131;
  if (R(id * 3 + 1) < 0.4) continue;
  const x = R(id) * W + (R(fi * 11 + j) - 0.5) * 6 * u, y0 = R(id + 5) * H * 0.4, y1 = H - R(id + 6) * H * 0.3;
  ctx.strokeStyle = j === 2 ? C.black : C.white; ctx.globalAlpha = 0.25 + R(fi * 19 + j) * 0.35;
  ctx.beginPath(); for (let y = y0; y <= y1; y += H / 12) ctx.lineTo(x + lib.noise(y * 0.004, id) * 5 * u, y); ctx.stroke();
}
// dust and hairs: a different handful every frame
ctx.fillStyle = ctx.strokeStyle = C.black; ctx.lineWidth = 1.8 * u;
for (let j = 0; j < 6; j++) {
  const sd = fi * 97 + j * 13;
  if (R(sd) < 0.55) continue;
  const x = R(sd + 1) * W, y = R(sd + 2) * H, s = (3 + R(sd + 3) * 9) * u;
  ctx.globalAlpha = 0.5 + R(sd + 4) * 0.4;
  if (R(sd + 5) > 0.75) { ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + s * 4, y - s * 3, x - s * 2, y + s * 5, x + s * 3, y + s * 6); ctx.stroke(); }
  else { ctx.beginPath(); ctx.ellipse(x, y, s, s * (0.5 + R(sd + 6) * 0.5), R(sd + 7) * PI, 0, PI * 2); ctx.fill(); }
}
ctx.globalAlpha = 1;
// splice flash on cuts, plus the odd stray flash
const near = splices.some((sp) => Math.floor(sp * T * 24) === fi && sp > 0) ? 1 : splices.some((sp) => Math.floor(sp * T * 24) + 1 === fi && sp > 0) ? 0.35 : 0;
const stray = R(fi * 91 + 4) > 0.985 ? 0.3 : 0;
if (near + stray > 0) {
  ctx.fillStyle = C.white; ctx.globalAlpha = Math.min(0.85, (near + stray) * 0.8); ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.black; ctx.globalAlpha = 0.6; ctx.fillRect(0, R(fi) * H, W, 5 * u); ctx.globalAlpha = 1;
}
// heavy vignette + rounded projector gate
ctx.save(); ctx.translate(cx, cy); ctx.scale(W / S, H / S);
const vg = ctx.createRadialGradient(0, 0, S * 0.22, 0, 0, S * 0.75);
vg.addColorStop(0, 'rgba(12,9,6,0)'); vg.addColorStop(0.6, 'rgba(12,9,6,0.45)'); vg.addColorStop(1, 'rgba(12,9,6,0.95)');
ctx.fillStyle = vg; ctx.fillRect(-S, -S, S * 2, S * 2); ctx.restore();
ctx.fillStyle = C.black; ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.roundRect(6 * u, 6 * u, W - 12 * u, H - 12 * u, 48 * u); ctx.fill('evenodd');
`,
};
