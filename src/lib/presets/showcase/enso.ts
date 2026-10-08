// Ensō. Hand-built example film in the scene format Claude generates.
// Brief: A zen sumi-e ink film at minimum energy: on warm rice paper, a single ensō circle is brushed in one slow stroke with ink bleed and dry-brush streaks, a drop of ink ripples in its centre while mist drifts, a short three-line poem appears word by word in italic serif, and a tiny vermilion seal presses in beside the circle.
export const film = {
  id: "ex-enso",
  title: "Ensō",
  aspect: "1:1" as const,
  duration: 16,
  prompt: "A zen sumi-e ink film at minimum energy: on warm rice paper, a single ensō circle is brushed in one slow stroke with ink bleed and dry-brush streaks, a drop of ink ripples in its centre while mist drifts, a short three-line poem appears word by word in italic serif, and a tiny vermilion seal presses in beside the circle.",
  code: String.raw`
const { ease, seg, keys, u, clamp, lerp, rand, noise } = lib;
const S = ease.inOutSine;
const oSine = (k) => Math.sin(clamp(k) * Math.PI / 2);
const PAPER = '#eee4cf', INK = '#15130f', WASH = '#6f6a60', VERM = '#c2412b';
lib.bg(ctx, W, H, PAPER);

const wide = W / H >= 1.2, tall = W / H < 0.8;
const sm = Math.min(W, H);

// ── Layout ──────────────────────────────────────────────────────
const L = wide
  ? { cx: W * 0.355, cy: H * 0.5, R: H * 0.27, px: W * 0.6, py: H * 0.43, ps: 38 * u, pw: W * 0.32 }
  : tall
  ? { cx: W * 0.5, cy: H * 0.37, R: W * 0.31, px: W * 0.15, py: H * 0.69, ps: 36 * u, pw: W * 0.7 }
  : { cx: W * 0.5, cy: H * 0.405, R: sm * 0.235, px: W * 0.15, py: H * 0.8, ps: 33 * u, pw: W * 0.6 };
const { cx, cy, R } = L;
const W0 = R * 0.2; // brush body width

// ── Paper: fibres + speckle (static, deterministic) ────────────
ctx.save();
const vg = ctx.createRadialGradient(W / 2, H / 2, sm * 0.45, W / 2, H / 2, Math.max(W, H) * 0.85);
vg.addColorStop(0, 'rgba(255,250,238,0)');
vg.addColorStop(1, 'rgba(150,120,80,0.13)');
ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
ctx.fillStyle = 'rgba(110,85,50,0.13)';
ctx.beginPath();
for (let i = 0; i < 900; i++) {
  const s = (0.6 + rand(i * 3 + 2) * 1.8) * u;
  ctx.rect(rand(i * 3) * W, rand(i * 3 + 1) * H, s, s);
}
ctx.fill();
ctx.lineWidth = 0.8 * u; ctx.lineCap = 'round';
for (let pass = 0; pass < 2; pass++) {
  ctx.strokeStyle = pass ? 'rgba(255,252,242,0.42)' : 'rgba(120,95,60,0.09)';
  ctx.beginPath();
  for (let i = 0; i < 90; i++) {
    const j = i + pass * 500;
    const x = rand(j * 7 + 11) * W, y = rand(j * 7 + 12) * H, a = rand(j * 7 + 13) * 6.28, l = (8 + rand(j * 7 + 14) * 26) * u;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + Math.sin(a) * l * 0.25, y + Math.sin(a) * l * 0.5 - Math.cos(a) * l * 0.25, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  ctx.stroke();
}
ctx.restore();

// ── Camera: an almost imperceptible breath ─────────────────────
const zoom = 1 + 0.03 * S(p) + 0.004 * Math.sin(t * 0.5);
lib.camera(ctx, { zoom, y: -6 * u * S(p), cx, cy }, () => {
  // ── The ensō: one stroke ──────────────────────────────────────
  const N = 160;
  const A0 = 2.1, SWEEP = Math.PI * 1.8; // starts lower-left, clockwise, leaves a gap
  const head = S(seg(p, 0.07, 0.4));
  const pts = [];
  for (let j = 0; j <= N; j++) {
    const s = j / N, a = A0 + s * SWEEP;
    const r = R * (1 + 0.035 * noise(s * 2.6, 3.1) - 0.05 * s * s);
    const w = W0 * keys(s, [[0, 1.1], [0.04, 1.2], [0.12, 0.95], [0.45, 1.05], [0.7, 0.85], [0.92, 0.5], [1, 0.22]], S) * (1 + 0.08 * noise(s * 9, 1.3));
    pts.push({ s, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a), w });
  }
  const hi = Math.floor(head * N);

  if (hi > 1) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'miter';
    // wet grey wash halo (only the wet first part of the stroke)
    ctx.strokeStyle = WASH;
    for (let k = 0; k < 2; k++) {
      ctx.globalAlpha = 0.07; ctx.lineWidth = W0 * (1.18 + 0.2 * k);
      ctx.beginPath();
      for (let j = 0; j <= Math.min(hi, N * (0.5 - 0.15 * k)); j++) {
        const q = pts[j], off = noise(q.s * 7, k * 5) * W0 * 0.12;
        j ? ctx.lineTo(q.x + q.nx * off, q.y + q.ny * off) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    }

    // bristles: many thin offset strokes that run dry near the end
    const NB = 40;
    for (let i = 0; i < NB; i++) {
      const o = (i / (NB - 1)) * 2 - 1 + (rand(i + 7) - 0.5) * 0.04;
      const start = 0.5 + 0.38 * rand(i + 90) - 0.2 * Math.abs(o);
      const tone = rand(i + 40), fq = 9 + 22 * Math.abs(o) * rand(i + 70), ph = rand(i + 80) * 6.28;
      ctx.strokeStyle = tone < 0.25 ? '#2b2823' : INK;
      ctx.globalAlpha = 0.72 + 0.28 * rand(i + 60);
      ctx.lineWidth = (W0 / NB) * (1.7 + 1.3 * rand(i + 20) * rand(i + 21));
      ctx.beginPath();
      let pen = false;
      const j0 = Math.floor(rand(i + 33) * 4);
      for (let j = j0; j <= hi; j++) {
        const q = pts[j];
        const dry = clamp((q.s - start) / 0.33);
        const gap = noise(q.s * 48 + i * 13.7, i * 0.61) * 0.35 + (rand(i * 977 + j) - 0.5) * 0.28 + 0.5;
        const vis = gap > dry * 0.95 + 0.04 * Math.abs(o) * (q.s > 0.3 ? 1 : 0);
        const splay = 1 + 0.35 * clamp((q.s - 0.75) / 0.25);
        const tip = 0.55 + 0.45 * S(clamp((head - q.s) / 0.03 + (head > 0.999 ? 1 : 0)));
        const off = o * q.w * 0.5 * splay * tip + (Math.sin(q.s * fq + ph) * 0.6 + Math.sin(q.s * fq * 2.3 + ph * 1.7) * 0.4) * (0.6 + 1.6 * o * o) * u;
        const x = q.x + q.nx * off, y = q.y + q.ny * off;
        if (vis) { pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; } else pen = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ink bleed / feathering where the brush first touched
  const kb = S(seg(p, 0.075, 0.3));
  if (kb > 0) {
    const b = pts[3];
    ctx.save();
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, W0 * 1.25 * kb + 1);
    g.addColorStop(0, 'rgba(40,36,30,0.35)'); g.addColorStop(0.6, 'rgba(70,66,58,0.16)'); g.addColorStop(1, 'rgba(90,86,78,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, W0 * 1.25 * kb + 1, 0, 6.29); ctx.fill();
    const b2 = pts[3];
    ctx.fillStyle = INK; ctx.globalAlpha = 0.86;
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * 6.283, rr = W0 * (0.44 + 0.04 * noise(i * 0.9, 4)) * (0.9 + 0.1 * kb);
      const ca = Math.cos(a) * rr * 0.8, sa = Math.sin(a) * rr * 1.05;
      const x = b2.x + ca * b2.nx - sa * b2.ny, y = b2.y + ca * b2.ny + sa * b2.nx;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2a2721'; ctx.lineWidth = 0.75 * u; ctx.globalAlpha = 0.38;
    ctx.beginPath();
    for (let i = 0; i < 120; i++) {
      const a = rand(i + 300) * 6.283, r0 = W0 * (0.42 + 0.12 * rand(i + 400));
      const len = W0 * (0.06 + 0.4 * rand(i + 500) * rand(i + 550)) * kb;
      let x = b.x + Math.cos(a) * r0, y = b.y + Math.sin(a) * r0;
      ctx.moveTo(x, y);
      for (let k = 1; k <= 4; k++) {
        const aa = a + noise(i * 1.3, k * 0.7) * 0.9;
        x += Math.cos(aa) * len / 4; y += Math.sin(aa) * len / 4;
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 0.85; ctx.fillStyle = INK;
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = rand(i + 700) * 6.283, d = W0 * (0.7 + 0.7 * rand(i + 710)) * kb;
      ctx.moveTo(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d);
      ctx.arc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, (0.8 + 2.2 * rand(i + 720)) * u * kb, 0, 6.29);
    }
    ctx.fill();
    ctx.restore();
  }

  // ── A single drop of ink, then rings ──────────────────────────
  const fall = seg(p, 0.425, 0.465);
  if (fall > 0 && fall < 1) {
    const dy = lerp(-H * 0.12 - cy, 0, ease.in(fall));
    ctx.save(); ctx.fillStyle = INK; ctx.globalAlpha = 0.92;
    ctx.beginPath(); ctx.ellipse(cx, cy + dy, 5 * u, (7 + 9 * fall) * u, 0, 0, 6.29); ctx.fill();
    ctx.restore();
  }
  const imp = seg(p, 0.465, 0.62);
  if (imp > 0) {
    ctx.save();
    const dr = 8.5 * u * oSine(imp * 2.5);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, dr * 2.4);
    g.addColorStop(0, 'rgba(21,19,15,0.95)'); g.addColorStop(0.38, 'rgba(21,19,15,0.9)');
    g.addColorStop(0.45, 'rgba(70,66,58,0.3)'); g.addColorStop(1, 'rgba(90,86,78,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, dr * 2.4, 0, 6.29); ctx.fill();
    ctx.strokeStyle = '#3b3730'; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const k = seg(p, 0.465 + i * 0.03, 0.465 + i * 0.03 + 0.2);
      if (k <= 0 || k >= 1) continue;
      ctx.globalAlpha = 0.42 * Math.sin(k * Math.PI) * (1 - i * 0.14);
      ctx.lineWidth = (2.2 - k * 1.4) * u;
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.08 + 0.62 * oSine(k)), 0, 6.29); ctx.stroke();
    }
    ctx.restore();
  }

  // ── Mist, drifting low and slow ───────────────────────────────
  const mA = 0.35 + 0.65 * S(seg(p, 0.3, 0.55)) - 0.35 * S(seg(p, 0.85, 1));
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const span = W * 1.6;
    const x = ((rand(i + 900) * span + t * (10 + 7 * i) * u) % span) - W * 0.3;
    const y = cy + R * (0.35 + 0.35 * rand(i + 910)) + 20 * u * Math.sin(t * 0.2 + i);
    const rx = R * (1.3 + 0.8 * rand(i + 920));
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.28);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(250,246,236,' + (0.26 * mA).toFixed(3) + ')'); g.addColorStop(1, 'rgba(250,246,236,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.29); ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // ── The seal: pressed in, beside the circle ───────────────────
  const sk = seg(p, 0.86, 0.905);
  if (sk > 0) {
    const ss = (wide ? 58 : 52) * u;
    const sx = cx + R * 1.02 + W0 * 0.6, sy = cy + R * 0.86;
    const down = S(clamp(sk / 0.55));
    const press = seg(sk, 0.5, 1);
    const sq = Math.sin(press * Math.PI) * (1 - press * 0.4);
    const sc = lerp(1.22, 1, down);
    ctx.save();
    ctx.translate(sx, sy);
    // shadow of the lifted stamp, shrinking as it descends
    if (down < 1) {
      ctx.fillStyle = 'rgba(60,40,20,' + (0.14 * down * (1 - press)).toFixed(3) + ')';
      ctx.filter = 'blur(' + (8 * (1 - down) * u + 2).toFixed(1) + 'px)';
      ctx.fillRect(-ss * 0.55 + 6 * u * (1 - down), -ss * 0.55 + 8 * u * (1 - down), ss * 1.1, ss * 1.1);
      ctx.filter = 'none';
    }
    ctx.scale(sc * (1 + 0.07 * sq), sc * (1 - 0.1 * sq));
    ctx.globalAlpha = lerp(0, 1, S(clamp(sk / 0.5)));
    ctx.fillStyle = VERM;
    lib.rrect(ctx, -ss / 2, -ss / 2, ss, ss, 3 * u, { fill: VERM });
    // carved marks (paper colour): a tiny ensō and two strokes
    ctx.strokeStyle = PAPER; ctx.fillStyle = PAPER; ctx.lineCap = 'round';
    ctx.lineWidth = ss * 0.075;
    ctx.beginPath(); ctx.arc(0, -ss * 0.1, ss * 0.19, 2.2, 2.2 + 5.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-ss * 0.24, ss * 0.2); ctx.lineTo(ss * 0.24, ss * 0.2); ctx.moveTo(-ss * 0.14, ss * 0.31); ctx.lineTo(ss * 0.14, ss * 0.31); ctx.stroke();
    ctx.lineWidth = ss * 0.05;
    ctx.strokeRect(-ss * 0.43, -ss * 0.43, ss * 0.86, ss * 0.86);
    // uneven ink take-up: paper grain showing through
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const r = (0.4 + 1.6 * rand(i + 1200)) * u;
      const x = (rand(i + 1100) - 0.5) * ss, y = (rand(i + 1150) - 0.5) * ss;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.29);
    }
    ctx.globalAlpha *= 0.75; ctx.fill();
    ctx.restore();
  }
});

// ── The poem: word by word, very slowly ────────────────────────
const POEM = ['one breath of ink', 'the circle does not close', 'and lets the morning in'];
const lh = L.ps * 1.75;
POEM.forEach((line, i) => {
  const k = seg(p, 0.5 + i * 0.105, 0.5 + i * 0.105 + 0.13);
  if (k <= 0) return;
  lib.words(ctx, line, L.px + i * L.ps * 0.9, L.py + i * lh, k, {
    size: L.ps, family: 'serif', italic: true, weight: 400, color: '#2c2823', alpha: 0.88,
    stagger: 0.7, rise: 3 * u, ease: S, blur: 4 * u, tracking: 0.01, maxWidth: L.pw,
  });
});
`,
};
