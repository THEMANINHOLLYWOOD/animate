// Four Seasons. Hand-built example film in the scene format Claude generates.
// Brief: A watercolour film of one procedural tree living through a full year: a seedling grows and blossoms pink in spring, fills lush green under a warm summer sun, turns amber and crimson and sheds spiralling leaves in autumn, gathers snow in winter, then puts out its first new bud, with a small serif season label in each corner in turn.
export const film = {
  id: "ex-seasons",
  title: "Four Seasons",
  aspect: "1:1" as const,
  duration: 18,
  prompt: "A watercolour film of one procedural tree living through a full year: a seedling grows and blossoms pink in spring, fills lush green under a warm summer sun, turns amber and crimson and sheds spiralling leaves in autumn, gathers snow in winter, then puts out its first new bud, with a small serif season label in each corner in turn.",
  code: String.raw`
const { ease, seg, keys, u, clamp, lerp, mix, noise, rand } = lib;
const TAU = Math.PI * 2;
const wide = W / H >= 1.2, tall = W / H < 0.8;
const MN = Math.min(W, H);
const PAPER = '#f4eee1';
lib.bg(ctx, W, H, PAPER);

// ── Season clock: 0 spring, 1 summer, 2 autumn, 3 winter, 4 spring again ──
const sI = keys(p, [[0, 0], [0.25, 0], [0.31, 1], [0.47, 1], [0.53, 2], [0.69, 2], [0.75, 3], [0.92, 3], [1, 3.4]], ease.inOutSine);
const pal = (arr) => { const i = Math.min(3, Math.floor(sI)); return mix(arr[i], arr[i + 1], sI - i); };
const wgt = (i) => clamp(1 - Math.abs(sI - i));
const SKY = pal(['#c9dde3', '#a6cbdc', '#ecc9a0', '#cfd6de', '#cfe0e2']);
const SKY2 = pal(['#f1cdd2', '#f6dc9e', '#e59f74', '#e3e6ea', '#eed3d6']);
const GRD = pal(['#cddba3', '#a9c47e', '#e2b27e', '#e9ecef', '#d3e0a6']);
const GRD2 = pal(['#b4cc8a', '#8fb067', '#e3b88e', '#d9dee5', '#bcd290']);
const BARK = pal(['#4d3b30', '#45362b', '#4a3226', '#3d3a40', '#4d3b30']);

// ── Watercolour wash: layered translucent blobs with noisy, darkened edges ──
function blob(cx, cy, rx, ry, col, a, seed, layers) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = col; ctx.strokeStyle = col;
  for (let l = 0; l < (layers || 3); l++) {
    ctx.beginPath();
    for (let i = 0; i <= 44; i++) {
      const th = (i / 44) * TAU, c = Math.cos(th), s = Math.sin(th);
      const r = 1 + noise(c * 1.4 + seed, s * 1.4 + seed * 0.7, l * 0.9 + t * 0.04) * 0.2 + noise(c * 5 + seed, s * 5, l) * 0.035;
      const sc = 1 - l * 0.13;
      const x = cx + c * rx * r * sc, y = cy + s * ry * r * sc;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.globalAlpha = a; ctx.fill();
    ctx.globalAlpha = a * 0.9; ctx.lineWidth = 2.2 * u; ctx.stroke();
  }
  ctx.restore();
}

// ── Layout ──
const groundY = H * (wide ? 0.8 : tall ? 0.74 : 0.79);
const S = Math.min(H * (wide ? 0.62 : 0.5), W * (tall ? 0.6 : 0.6));
const bx = W * (wide ? 0.5 : 0.5);

// ── Sky washes (screen space, slow bleed) ──
lib.layer(ctx, 'Sky', () => {
blob(W * 0.28, H * 0.16, W * 0.5, H * 0.22, SKY, 0.26, 1.3, 3);
blob(W * 0.9, H * 0.42, W * 0.3, H * 0.16, SKY, 0.16, 4.1, 2);
blob(W * 0.12, H * 0.5, W * 0.25, H * 0.12, SKY2, 0.14, 7.7, 2);
});
// sun: warm in summer, low and orange in autumn, pale in spring
const sunA = 0.25 * wgt(0) + wgt(1) + 0.7 * wgt(2) + 0.15 * wgt(3);
const sunX = W * lerp(0.74, 0.8, wgt(2)), sunY = H * lerp(0.2, 0.3, wgt(2)) - (wide ? 0 : 0);
const sunC = mix('#f3b443', '#e2733c', wgt(2));
lib.layer(ctx, 'Sun', () => { ctx.globalCompositeOperation = 'source-over';
const sunHalo = mix('#fbe6b0', '#f6c79a', wgt(2));
for (let i = 0; i < 3; i++) {
  ctx.beginPath();
  for (let j = 0; j <= 40; j++) {
    const th = (j / 40) * TAU, rr = MN * (0.2 - i * 0.055) * (1 + noise(Math.cos(th) * 1.5 + i, Math.sin(th) * 1.5, t * 0.05) * 0.12);
    const x = sunX + Math.cos(th) * rr, y = sunY + Math.sin(th) * rr;
    if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.globalAlpha = sunA * [0.3, 0.35, 0.7][i]; ctx.fillStyle = i === 2 ? sunC : sunHalo; ctx.fill();
  if (i === 2) { ctx.globalAlpha = sunA * 0.5; ctx.strokeStyle = sunC; ctx.lineWidth = 3 * u; ctx.stroke(); }
}
});

// ── Camera: open close on the seedling, pull out, end pushed in on the new bud ──
const zoomOut = seg(p, 0.0, 0.3, ease.inOutSine);
const g = 0.05 + 0.95 * seg(p, 0.0, 0.3, ease.inOutSine); // tree growth

// ── Procedural tree: recursive, deterministic, swayed by noise wind ──
const D = 7;
const wind = 0.022 + 0.03 * wgt(2) + 0.012 * wgt(3);
const segs = [];
let topTip = null;
function grow(x, y, ang, len, w, d, id) {
  const a0 = d * 0.105, k = ease.out(clamp((g - a0) / 0.24));
  if (k <= 0) return;
  const sway = noise(t * 0.35 + d * 0.2, id * 0.013) * wind * (d + 1) * 0.55 + Math.sin(t * 1.1 + d * 0.6) * wind * 0.25 * d;
  const A = ang + sway;
  const L = len * k;
  const ex = x + Math.cos(A) * L, ey = y + Math.sin(A) * L;
  const curv = (rand(id * 7 + 3) - 0.5) * 0.35 * L;
  const qx = (x + ex) / 2 - Math.sin(A) * curv, qy = (y + ey) / 2 + Math.cos(A) * curv;
  const ww = w * (0.35 + 0.65 * g);
  segs.push({ x, y, qx, qy, ex, ey, w: ww, d, id, A, k });
  if (d === D) { if (!topTip || ey < topTip.y) topTip = { x: ex, y: ey, A }; return; }
  const n = d < 1 ? 2 : (rand(id * 13 + 1) < 0.28 ? 3 : 2);
  for (let i = 0; i < n; i++) {
    const side = n === 2 ? (i ? 1 : -1) : (i - 1);
    const spread = 0.32 + rand(id * 31 + i) * 0.28;
    let ca = A + side * spread + (rand(id * 17 + i * 5) - 0.5) * 0.3;
    ca = lerp(ca, -Math.PI / 2, 0.12 + (d < 2 ? 0.1 : 0));
    const cl = len * (0.7 + rand(id * 19 + i) * 0.14) * (d === 0 ? 0.9 : 1);
    grow(ex, ey, ca, cl, w * 0.66, d + 1, id * 3 + i + 1);
  }
}
grow(bx, groundY, -Math.PI / 2 + 0.03, S * 0.25, S * 0.06, 0, 1);
const bud = topTip || { x: bx, y: groundY - S, A: -Math.PI / 2 };

const camK = seg(p, 0.86, 1, ease.inOutSine);
const fx = lerp(lerp(bx, W / 2, zoomOut), lerp(W / 2, bud.x, 0.6), camK);
const fy = lerp(lerp(groundY - S * 0.05, H / 2, zoomOut), lerp(H / 2, bud.y, 0.4), camK);
const zoom = lerp(lerp(2.6, 1, zoomOut), tall ? 1.12 : 1.3, camK) * (1 + 0.012 * Math.sin(t * 0.4));
ctx.save();
ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-fx, -fy);

// ── Ground: painted band with undulating edge, snow builds in winter ──
function band(y0, col, a, seed, amp) {
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = col;
  for (let l = 0; l < 2; l++) {
    ctx.beginPath(); ctx.moveTo(-W, H * 2);
    for (let i = 0; i <= 40; i++) {
      const x = -W * 0.5 + (i / 40) * W * 2;
      ctx.lineTo(x, y0 + noise(x / (MN * 0.35) + seed, l * 0.8 + t * 0.03) * amp - Math.exp(-Math.pow((x - bx) / (S * 0.5), 2)) * amp * 0.8);
    }
    ctx.lineTo(W * 2, H * 2); ctx.closePath();
    ctx.globalAlpha = a; ctx.fill();
  }
  ctx.restore();
}
lib.layer(ctx, 'Ground', () => {
band(groundY - 6 * u, GRD, 0.55, 2.1, 22 * u);
band(groundY + MN * 0.06, GRD2, 0.4, 5.4, 18 * u);
});
const snowAcc = seg(p, 0.76, 0.9, ease.inOutSine) * (1 - 0.35 * seg(p, 0.95, 1));
// ── Leaf helpers ──
function leafPath(x, y, ang, len, wid) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const tx = x + c * len, ty = y + s * len;
  const mx = x + c * len * 0.5, my = y + s * len * 0.5;
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx - s * wid, my + c * wid, tx, ty);
  ctx.quadraticCurveTo(mx + s * wid, my - c * wid, x, y);
}
const AUT = ['#e0a234', '#c2452e', '#d8702d', '#b8322a', '#e8b84a'];
const LS = S * 0.048;

// collect leaf/blossom anchors on outer branches
const anchors = [];
for (const s of segs) {
  if (s.d < 4) continue;
  const m = s.d === D ? 3 : 2;
  for (let j = 0; j < m; j++) {
    const f = 0.35 + j * (0.65 / m) + rand(s.id * 11 + j) * 0.2;
    const ff = Math.min(1, f);
    const ax = (1 - ff) * (1 - ff) * s.x + 2 * (1 - ff) * ff * s.qx + ff * ff * s.ex;
    const ay = (1 - ff) * (1 - ff) * s.y + 2 * (1 - ff) * ff * s.qy + ff * ff * s.ey;
    anchors.push({ x: ax, y: ay, A: s.A, id: s.id * 5 + j, d: s.d });
  }
}

// ── Landed litter (behind tree) and drifting leaves ──
const litterFade = 1 - seg(p, 0.78, 0.88);
const drifting = [], attached = [], litter = [];
for (const a of anchors) {
  const r1 = rand(a.id), r2 = rand(a.id + 77), r3 = rand(a.id + 191);
  const grow1 = ease.outBack(seg(p, 0.25 + r1 * 0.07, 0.33 + r1 * 0.07));
  if (grow1 <= 0) continue;
  const turn = seg(p, 0.47 + r2 * 0.09, 0.55 + r2 * 0.09, ease.inOut);
  const col = mix(['#4f8f3a', '#6ea545', '#8cbf55', '#5d9a40'][Math.floor(r3 * 4)], AUT[Math.floor(r1 * 5)], turn);
  const fs = 0.55 + r2 * 0.09 + r3 * 0.07, dur = 0.07 + r1 * 0.04;
  const fallS = seg(p, fs, fs + dur);
  const la = a.A + (r3 - 0.5) * 2.2 + noise(t * 0.6, a.id * 0.1) * 0.25 + (r1 < 0.5 ? -0.8 : 0.8);
  const L = LS * (0.8 + r2 * 0.5) * grow1;
  if (fallS <= 0) { attached.push([a.x, a.y, la, L, col]); continue; }
  const landY = groundY + (r1 - 0.4) * MN * 0.045;
  const y = lerp(a.y, landY, fallS * (0.6 + 0.4 * fallS));
  const sp = Math.sin(fallS * TAU * (1.2 + r3) + r1 * 6) * S * 0.07 * Math.sin(Math.PI * Math.min(1, fallS * 1.1));
  const x = a.x + sp + (r2 - 0.3) * S * 0.35 * fallS + 0.12 * S * fallS;
  if (fallS < 1) drifting.push({ x, y, ang: la + fallS * (6 + r1 * 6), L, col, flip: Math.cos(fallS * TAU * 2 + r2 * 5) });
  else litter.push([x, landY, r1 * 6, L, col]);
}
lib.layer(ctx, 'Fallen leaves', () => {
  for (const l of litter) { ctx.beginPath(); leafPath(l[0], l[1], l[2], l[3], l[3] * 0.2); ctx.globalAlpha = 0.7 * litterFade; ctx.fillStyle = l[4]; ctx.fill(); }
});

if (snowAcc > 0) {
  lib.layer(ctx, 'Snow on the ground', () => { ctx.globalAlpha = snowAcc * 0.92; ctx.fillStyle = '#fbfcfd';
  ctx.beginPath(); ctx.moveTo(-W, H * 2);
  for (let i = 0; i <= 40; i++) {
    const x = -W * 0.5 + (i / 40) * W * 2;
    ctx.lineTo(x, groundY - 10 * u * snowAcc + noise(x / (MN * 0.2), 9.1) * 8 * u - Math.exp(-Math.pow((x - bx) / (S * 0.5), 2)) * 14 * u);
  }
  ctx.lineTo(W * 2, H * 2); ctx.closePath(); ctx.fill(); });
}

// ── Branches: tapered strokes per depth, then a dry-brush highlight ──
lib.layer(ctx, 'Tree', () => { ctx.lineCap = 'round'; ctx.lineJoin = 'round';
for (let d = 0; d <= D; d++) {
  const list = segs.filter((s) => s.d === d);
  if (!list.length) continue;
  ctx.beginPath();
  for (const s of list) { ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(s.qx, s.qy, s.ex, s.ey); }
  ctx.strokeStyle = BARK; ctx.globalAlpha = 0.9; ctx.lineWidth = Math.max(1.2 * u, list[0].w); ctx.stroke();
  if (d < 5) {
    ctx.beginPath();
    for (const s of list) { const o = s.w * 0.22; ctx.moveTo(s.x - o, s.y); ctx.quadraticCurveTo(s.qx - o, s.qy, s.ex - o, s.ey); }
    ctx.strokeStyle = '#8a705c'; ctx.globalAlpha = 0.35; ctx.lineWidth = list[0].w * 0.3; ctx.stroke();
  }
  // snow settling on the upper side of branches
  if (snowAcc > 0 && d <= 6) {
    ctx.beginPath();
    for (const s of list) {
      const hz = Math.abs(Math.cos(s.A));
      if (hz < 0.25) continue;
      const o = s.w * 0.5 + 1 * u;
      ctx.moveTo(s.x, s.y - o); ctx.quadraticCurveTo(s.qx, s.qy - o, s.ex, s.ey - o * 0.6);
    }
    ctx.strokeStyle = '#fdfeff'; ctx.globalAlpha = 0.95 * snowAcc; ctx.lineWidth = (3.5 * u + list[0].w * 0.35) * snowAcc; ctx.stroke();
  }
}
});

// ── Canopy leaves, painted over the twigs ──
lib.layer(ctx, 'Leaves', () => {
for (const l of attached) { ctx.beginPath(); leafPath(l[0], l[1], l[2], l[3], l[3] * 0.38); ctx.globalAlpha = 0.74; ctx.fillStyle = l[4]; ctx.fill(); }
});

// ── Seed leaves on the sprout, shed as the tree branches ──
const cot = 1 - seg(p, 0.05, 0.11, ease.in);
if (cot > 0 && segs.length) {
  const s0 = segs[0], cl = S * 0.035 * cot, sw = noise(t * 0.5, 1.7) * 0.15;
  lib.layer(ctx, 'Seed leaves', () => { ctx.globalAlpha = 0.85;
  ctx.beginPath(); leafPath(s0.ex, s0.ey, -0.35 + sw, cl, cl * 0.42); ctx.fillStyle = '#7bb04a'; ctx.fill();
  ctx.beginPath(); leafPath(s0.ex, s0.ey, -Math.PI + 0.35 + sw, cl * 0.9, cl * 0.4); ctx.fillStyle = '#5f9a3e'; ctx.fill();
  });
}

// ── Blossoms: pop open in spring, petals drift away ──
lib.layer(ctx, 'Blossoms', () => { ctx.globalCompositeOperation = 'multiply';
const petalP = [[], []];
const centres = [];
for (const a of anchors) {
  if (a.d < 5 || rand(a.id + 5) < 0.35) continue;
  const r = rand(a.id + 3);
  const open = lib.spring(seg(p, 0.12 + r * 0.12, 0.2 + r * 0.12), { damping: 0.5, freq: 2.6 });
  const drop = seg(p, 0.28 + r * 0.06, 0.34 + r * 0.06, ease.in);
  const sc = open * (1 - drop) * LS * 0.42;
  if (sc > 0.3 * u) {
    for (let i = 0; i < 5; i++) {
      const th = r * 6 + (i / 5) * TAU + t * 0.05;
      const px = a.x + Math.cos(th) * sc * 0.9, py = a.y + Math.sin(th) * sc * 0.9;
      petalP[i % 2].push([px, py, sc * 0.62, sc * 0.62, 0]);
    }
    centres.push([a.x, a.y, sc * 0.3, sc * 0.3, 0]);
  }
  const fl = seg(p, 0.29 + r * 0.06, 0.4 + r * 0.06);
  if (fl > 0 && fl < 1 && r < 0.5) {
    const x = a.x + Math.sin(fl * 9 + r * 7) * S * 0.04 + fl * S * 0.25, y = lerp(a.y, groundY, fl);
    const pr = LS * 0.2 * (1 - fl * 0.4);
    petalP[1].push([x, y, pr, pr * 0.55, fl * 8 + r * 4]);
  }
}
const dots = (list, col, al) => {
  ctx.beginPath();
  for (const e of list) { ctx.moveTo(e[0] + Math.cos(e[4]) * e[2], e[1] + Math.sin(e[4]) * e[2]); ctx.ellipse(e[0], e[1], e[2], e[3], e[4], 0, TAU); }
  ctx.globalAlpha = al; ctx.fillStyle = col; ctx.fill();
};
dots(petalP[0], '#f4b3c2', 0.85); dots(petalP[1], '#ec97ab', 0.85); dots(centres, '#c4506c', 0.9);
});

// ── Drifting leaves (in front), spinning and flipping ──
lib.layer(ctx, 'Falling leaves', () => { ctx.globalCompositeOperation = 'multiply';
for (const l of drifting) {
  ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.ang); ctx.scale(1, 0.25 + 0.75 * Math.abs(l.flip));
  ctx.beginPath(); leafPath(-l.L * 0.5, 0, 0, l.L, l.L * 0.38);
  ctx.globalAlpha = 0.85; ctx.fillStyle = l.col; ctx.fill(); ctx.restore();
}
});

// ── The first bud returns ──
const budK = lib.spring(seg(p, 0.885, 0.965), { damping: 0.5, freq: 2.4 });
if (budK > 0) {
  lib.layer(ctx, 'New shoots', () => {
  for (const a of anchors) {
    if (a.d !== D || rand(a.id + 9) < 0.55) continue;
    const r = rand(a.id + 21), k = seg(p, 0.9 + r * 0.06, 0.97 + r * 0.03, ease.outBack);
    if (k <= 0) continue;
    ctx.beginPath(); leafPath(a.x, a.y, a.A - 0.5, LS * 0.35 * k, LS * 0.14 * k);
    ctx.globalAlpha = 0.85; ctx.fillStyle = '#7fb24f'; ctx.fill();
  }
  });
  lib.layer(ctx, 'First bud', () => {
  ctx.globalAlpha = 1;
  const bl = LS * 1.3 * budK, ba = bud.A + noise(t * 0.5, 3) * 0.08;
  ctx.globalCompositeOperation = 'multiply';
  blob(bud.x + Math.cos(ba) * bl * 0.4, bud.y + Math.sin(ba) * bl * 0.4, bl * 0.9, bl * 0.9, '#d9e8b5', 0.35 * budK, 2.2, 2);
  ctx.beginPath(); leafPath(bud.x, bud.y, ba - 0.35, bl, bl * 0.34); ctx.fillStyle = '#6aa443'; ctx.globalAlpha = 0.9; ctx.fill();
  ctx.beginPath(); leafPath(bud.x, bud.y, ba + 0.3, bl * 0.85, bl * 0.3); ctx.fillStyle = '#8cc25a'; ctx.globalAlpha = 0.85; ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  });
}
ctx.restore(); // camera

// ── Snowfall (screen space) ──
const snowA = seg(p, 0.71, 0.77) * (1 - seg(p, 0.9, 0.98));
if (snowA > 0) {
  lib.layer(ctx, 'Snowfall', () => { ctx.fillStyle = '#ffffff';
  for (let layer = 0; layer < 2; layer++) {
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const id = i + layer * 500, sp = 0.05 + rand(id) * 0.04 + layer * 0.03;
      const yy = ((rand(id + 1) + t * sp) % 1) * (H * 1.1) - H * 0.05;
      const xx = (rand(id + 2) * W * 1.2 - W * 0.1) + noise(t * 0.3, id * 0.17) * 40 * u + Math.sin(t * 0.8 + id) * 8 * u;
      const r = (1.6 + rand(id + 3) * 2.2 + layer * 1.6) * u;
      ctx.moveTo(xx + r, yy); ctx.arc(xx, yy, r, 0, TAU);
    }
    ctx.globalAlpha = snowA * (layer ? 0.95 : 0.75); ctx.fill();
    ctx.globalAlpha = snowA * 0.25; ctx.strokeStyle = '#9aa8b8'; ctx.lineWidth = 0.8 * u; ctx.stroke();
  }
  });
}

// ── Paper grain + soft vignette ──
lib.layer(ctx, 'Paper grain', () => {
for (let i = 0; i < 2; i++) {
  ctx.beginPath();
  for (let j = 0; j < 160; j++) {
    const id = j + i * 1000, x = rand(id) * W, y = rand(id + 9) * H, r = (0.6 + rand(id + 4) * 1.4) * u;
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fillStyle = i ? '#ffffff' : '#7a6650'; ctx.globalAlpha = i ? 0.35 : 0.06; ctx.fill();
}
});
lib.layer(ctx, 'Vignette', () => {
const vg = ctx.createRadialGradient(W / 2, H / 2, MN * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
vg.addColorStop(0, 'rgba(120,96,70,0)'); vg.addColorStop(1, 'rgba(120,96,70,0.16)');
ctx.globalAlpha = 1; ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
});

// ── Season labels, written into each corner in turn ──
const M = MN * 0.085;
const LABELS = [
  ['Spring', 0.03, 0.27, 0, 0, '#f1b6c3'],
  ['Summer', 0.29, 0.49, 1, 0, '#f2c766'],
  ['Autumn', 0.51, 0.71, 1, 1, '#f6dcb8'],
  ['Winter', 0.73, 0.9, 0, 1, '#b9c7d6'],
];
const fs = 46 * u;
for (let i = 0; i < 4; i++) {
  const [str, a, b, rx, ry, dab] = LABELS[i];
  const kin = seg(p, a, a + 0.05, ease.inOutSine), kout = seg(p, b - 0.03, b, ease.in);
  if (kin <= 0 || kout >= 1) continue;
  const x = rx ? W - M : M, y = ry ? H - M : M + fs * 0.8;
  ctx.save();
  const tw = lib.text(ctx, str, 0, -999, { size: fs, family: 'serif', italic: true, alpha: 0 }).width;
  const x0 = rx ? x - tw : x;
  ctx.restore();
  lib.layer(ctx, str + ' label', () => {
  if (kin > 0.12) blob(x0 + tw * 0.55, y - fs * 0.3, tw * 0.6 * ease.out(kin), fs * 0.5 * ease.out(kin), dab, 0.35 * (1 - kout), 3 + i * 2, 2);
  lib.mask(ctx, (c) => c.rect(x0 - 10 * u, y - fs * 1.4, (tw + 20 * u) * kin, fs * 2), () => {
    lib.text(ctx, str, x, y - kout * 10 * u, { size: fs, family: 'serif', italic: true, color: '#3b2f28', align: rx ? 'right' : 'left', alpha: 1 - kout });
  });
  lib.text(ctx, ['i', 'ii', 'iii', 'iv'][i], rx ? x - tw - 14 * u : x + tw + 14 * u, y, { size: 18 * u, family: 'serif', color: '#7a6555', align: rx ? 'right' : 'left', alpha: kin * (1 - kout) * 0.8 });
  });
}

// ── Closing line ──
const endK = seg(p, 0.925, 0.97, ease.out);
if (endK > 0) {
  lib.layer(ctx, 'Closing line', () => lib.words(ctx, 'and round again it goes', W / 2, M + 30 * u, endK, { size: 26 * u, family: 'serif', italic: true, color: '#4a3c33', baseline: 'alphabetic', maxWidth: W - 2 * M, align: 'center' }));
}
`,
};
