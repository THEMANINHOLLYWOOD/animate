// How a heart beats. Hand-built example film in the scene format Claude generates.
// Brief: A calm, rigorous Swiss-editorial science explainer on how the heart beats: a hairline four-chamber diagram drawn on, blood flowing as blue and red dots through both loops, valves opening and shutting, an ECG trace labelled P, QRS and T in sync with the contractions, and conservative facts counting up.
export const film = {
  id: "ex-heartbeat",
  title: "How a heart beats",
  aspect: "16:9" as const,
  duration: 20,
  prompt: "A calm, rigorous Swiss-editorial science explainer on how the heart beats: a hairline four-chamber diagram drawn on, blood flowing as blue and red dots through both loops, valves opening and shutting, an ECG trace labelled P, QRS and T in sync with the contractions, and conservative facts counting up.",
  code: String.raw`
const { ease, seg, win, u, clamp, lerp, mix } = lib;
const PAPER = '#F3F0E8', INK = '#16161A', BLUE = '#2B4C9B', RED = '#D8402F';
lib.bg(ctx, W, H, PAPER);
const wide = W / H >= 1.2, tall = W / H < 0.8;
const M = Math.min(W, H) * 0.08;

// ── Layout slots (diagram local units: x ±560, y -470..470) ─────
let s, hx, hy, TX, TW, TY, HS, EY;
if (wide) { s = 0.85 * u; hx = W - M - 610 * s; hy = H * 0.5 + 6 * u; TX = M + 40 * u; TW = W * 0.31; TY = H * 0.2; HS = 58 * u; EY = H * 0.66; }
else if (tall) { s = (W - 2 * M) / 1250; hx = W / 2; hy = H * 0.64; TX = M; TW = W - 2 * M; TY = H * 0.12; HS = 64 * u; EY = H * 0.35; }
else { s = 0.54 * u; hx = W / 2; hy = H * 0.44 + 470 * s; TX = M; TW = W - 2 * M; TY = H * 0.13; HS = 46 * u; EY = H * 0.345; }
const EW = wide ? TW : W - 2 * M, EH = (wide ? 150 : tall ? 170 : 92) * u;
const P = (x, y) => [hx + x * s, hy + y * s];

// ── Cardiac cycle (ambient, from t) ─────────────────────────────
const per = 0.9;
const A = seg(p, 0.14, 0.24, ease.inOut);
const bump = (ph, a, b) => { const k = clamp((ph - a) / (b - a)); return k > 0 && k < 1 ? Math.sin(Math.PI * k) ** 2 : 0; };
const g = (x, m, w) => Math.exp(-((x - m) * (x - m)) / (2 * w * w));
const ecg = (ph) => 0.16 * g(ph, 0.1, 0.022) - 0.1 * g(ph, 0.215, 0.007) + g(ph, 0.24, 0.009) - 0.26 * g(ph, 0.265, 0.009) + 0.3 * g(ph, 0.47, 0.04);
const phase = (tt) => ((tt % per) + per) % per / per;
const ph = phase(t);
const AS = bump(ph, 0.11, 0.27) * A, VS = bump(ph, 0.25, 0.6) * A;
const avOpen = 1 - clamp(VS * 2.2), slOpen = clamp(VS * 2.2);

// ── Beats ───────────────────────────────────────────────────────
const B = [
  { a: 0.0, b: 0.22, kick: '01  Anatomy', head: 'Four chambers, two pumps.', body: 'The right side pumps blood to the lungs. The left side pumps it out to the body.' },
  { a: 0.2, b: 0.42, kick: '02  Circulation', head: 'One route, two loops.', body: 'Body, right atrium, right ventricle, lungs, left atrium, left ventricle, body again.' },
  { a: 0.4, b: 0.62, kick: '03  Rhythm', head: 'Atria first, then ventricles.', body: 'Valves open and shut on each beat, so blood only moves one way.' },
  { a: 0.6, b: 0.81, kick: '04  Electricity', head: 'Each beat writes a trace.', body: 'P: the atria fire. QRS: the ventricles fire. T: the ventricles reset.' },
  { a: 0.79, b: 1.0, kick: '05  In numbers', head: 'Two pumps. One rhythm. For life.', body: '' },
];
const W_ = B.map((b, i) => win(p, b.a, b.b, i ? 0.03 : 0.0001, i < 4 ? 0.03 : 0));
const focus = (i) => W_[i].a;

// ── Grid + folio ────────────────────────────────────────────────
ctx.save();
ctx.strokeStyle = INK; ctx.lineWidth = 1 * u;
ctx.globalAlpha = 0.05 * seg(p, 0, 0.05);
ctx.beginPath();
for (let i = 0; i <= 12; i++) { const x = M + (W - 2 * M) * i / 12; ctx.moveTo(x, M); ctx.lineTo(x, H - M); }
ctx.stroke();
ctx.globalAlpha = 0.5 * seg(p, 0, 0.04);
ctx.beginPath(); ctx.moveTo(M, M); ctx.lineTo(M + (W - 2 * M) * seg(p, 0, 0.08, ease.inOut), M); ctx.stroke();
ctx.restore();
const fa = seg(p, 0.02, 0.07);
const bi = B.reduce((n, b, i) => (p >= b.a + 0.01 ? i : n), 0);
lib.text(ctx, 'HOW A HEART BEATS', M, M + 26 * u, { family: 'mono', size: 14 * u, tracking: 0.16, alpha: 0.7 * fa });
lib.text(ctx, 'FIG. ' + (bi + 1) + ' / 5', W - M, M + 26 * u, { family: 'mono', size: 14 * u, tracking: 0.16, align: 'right', alpha: 0.7 * fa });

// ── Diagram geometry ────────────────────────────────────────────
const blob = (cx, cy, hw, hh, taper, sq, sh) => {
  const pts = [];
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a), si = Math.sin(a);
    let x = Math.sign(c) * Math.abs(c) ** 0.6 * hw, y = Math.sign(si) * Math.abs(si) ** 0.6 * hh;
    if (y > 0) x = x * (1 - taper * (y / hh) ** 1.6) + sh * (y / hh) ** 2;
    pts.push(P(cx + x * (1 - sq), cy + y * (1 - sq)));
  }
  return pts;
};
const ch = [
  { n: 'RIGHT ATRIUM', c: [-170, -135], hw: 90, hh: 95, tp: 0, sh: 0, k: AS, L: [-400, -150] },
  { n: 'RIGHT VENTRICLE', c: [-135, 135], hw: 120, hh: 135, tp: 0.35, sh: 50, k: VS, L: [-400, 150] },
  { n: 'LEFT ATRIUM', c: [170, -135], hw: 90, hh: 95, tp: 0, sh: 0, k: AS, L: [400, -150] },
  { n: 'LEFT VENTRICLE', c: [135, 150], hw: 120, hh: 150, tp: 0.45, sh: -45, k: VS, L: [400, 160] },
];
const circuit = [[360, 420], [-340, 420], [-340, -120], [-200, -120], [-150, -20], [-150, 150], [-70, 170], [-40, 60], [-40, -60], [-40, -330], [-200, -330], [-200, -420], [200, -420], [200, -150], [150, -20], [150, 150], [70, 175], [40, 60], [40, -60], [40, -300], [360, -300], [360, 420]];
const cl = [0];
for (let i = 1; i < circuit.length; i++) cl.push(cl[i - 1] + Math.hypot(circuit[i][0] - circuit[i - 1][0], circuit[i][1] - circuit[i - 1][1]));
const LT = cl[cl.length - 1];
const at = (d) => { d = ((d % LT) + LT) % LT; let i = 1; while (cl[i] < d) i++; const f = (d - cl[i - 1]) / (cl[i] - cl[i - 1]); return [lerp(circuit[i - 1][0], circuit[i][0], f), lerp(circuit[i - 1][1], circuit[i][1], f)]; };
const oxy = (d) => d < cl[1] ? 1 - d / cl[1] : d < cl[11] ? 0 : d < cl[12] ? (d - cl[11]) / (cl[12] - cl[11]) : 1;
const mp = (pts) => pts.map((q) => P(q[0], q[1]));

const dimAll = 1 - 0.45 * focus(3);
const kHeart = seg(p, 0.01, 0.12, ease.inOut);
const kVes = seg(p, 0.2, 0.3, ease.inOut);
const hl = 1.6 * u;

lib.camera(ctx, { zoom: 1 + 0.025 * p, cx: hx, cy: hy }, () => {
  ctx.save();
  ctx.globalAlpha = dimAll;
  // outer contour of the ventricular mass
  const sc = 1 - 0.035 * VS;
  ctx.save();
  ctx.translate(...P(0, 140)); ctx.scale(sc, sc); ctx.translate(-hx, -hy - 140 * s);
  const bz = (a, b, c, d, k) => a * (1 - k) ** 3 + 3 * b * k * (1 - k) ** 2 + 3 * c * k * k * (1 - k) + d * k ** 3;
  const contour = [];
  [[[-286, -8], [-300, 210], [-110, 330], [55, 345]], [[55, 345], [190, 350], [305, 210], [286, -8]]].forEach((q) => {
    for (let i = 0; i <= 24; i++) { const k = i / 24; contour.push(P(bz(q[0][0], q[1][0], q[2][0], q[3][0], k), bz(q[0][1], q[1][1], q[2][1], q[3][1], k))); }
  });
  lib.line(ctx, contour, kHeart, { color: INK, width: hl, alpha: 0.45 });
  ctx.restore();

  // vessels (drawn on in beat 2), colour = oxygen state
  const ves = [
    [BLUE, [[-340, 420], [-340, -120], [-262, -120]]],
    [BLUE, [[-40, 0], [-40, -330], [-200, -330], [-200, -400]]],
    [RED, [[200, -400], [200, -232]]],
    [RED, [[40, 0], [40, -300], [360, -300], [360, 400]]],
  ];
  ves.forEach(([c, pts], i) => {
    const kk = seg(kVes, i * 0.12, 0.64 + i * 0.12);
    if (i === 3 && kk > 0) lib.line(ctx, mp([[178, -300], [222, -300]]), clamp(kk * 3 - 0.6), { color: PAPER, width: 12 * s });
    lib.line(ctx, mp(pts), kk, { color: c, width: 2.4 * u, alpha: 0.75 });
  });
  // capillary beds
  [['LUNGS', -200, -420, 400, BLUE, RED], ['BODY', -340, 420, 700, RED, BLUE]].forEach(([nm, x0, y0, len, c0, c1], j) => {
    const kb = seg(kVes, 0.2 + j * 0.2, 0.75 + j * 0.2);
    if (kb <= 0) return;
    ctx.save(); ctx.lineWidth = 1.2 * u;
    const n = Math.round(len / 14);
    for (let i = 0; i <= n * kb; i++) {
      const f = j ? 1 - i / n : i / n;
      const [x, y] = P(x0 + (len * i) / n, y0);
      ctx.strokeStyle = mix(c0, c1, f); ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(x, y - 16 * s); ctx.lineTo(x, y + 16 * s); ctx.stroke();
    }
    ctx.restore();
    const [lx, ly] = P(x0 + len / 2, y0 + (j ? 62 : -40));
    lib.text(ctx, nm, lx, ly, { family: 'mono', size: 14 * u, tracking: 0.3, align: 'center', alpha: 0.8 * kb });
  });

  // chambers
  ch.forEach((c, i) => {
    const kk = seg(kHeart, 0.15 + i * 0.12, 0.6 + i * 0.12);
    if (kk <= 0) return;
    const pts = blob(c.c[0], c.c[1], c.hw, c.hh, c.tp, 0.09 * c.k, c.sh * (i % 2 ? 1 : 0));
    const fire = focus(3) * (i % 2 ? g(ph, 0.25, 0.04) : g(ph, 0.11, 0.04)) * A;
    if (kk >= 1) {
      ctx.save(); ctx.beginPath(); pts.forEach((q, j) => (j ? ctx.lineTo(...q) : ctx.moveTo(...q)));
      ctx.fillStyle = i < 2 ? BLUE : RED; ctx.globalAlpha = 0.05 + 0.12 * c.k + 0.35 * fire; ctx.fill(); ctx.restore();
    }
    lib.line(ctx, pts, kk, { color: INK, width: (i === 3 ? 3.2 : 2) * u });
  });

  // valves: two leaflets each; AV valves open downward, semilunar upward
  const valves = [['TRICUSPID', -150, -20, 1, avOpen, [-400, -20]], ['MITRAL', 150, -20, 1, avOpen, [400, -20]], ['PULMONARY', -40, -60, -1, slOpen, [-70, -262]], ['AORTIC', 40, -60, -1, slOpen, [70, -262]]];
  const kv = seg(p, 0.08, 0.16);
  const vf = focus(2);
  valves.forEach(([nm, x, y, dir, o]) => {
    const hw = Math.abs(x) > 100 ? 34 : 22;
    ctx.save(); ctx.strokeStyle = vf > 0.01 ? mix(INK, RED, vf) : INK; ctx.lineWidth = (2.2 + 1.2 * vf) * u; ctx.lineCap = 'round';
    ctx.globalAlpha = kv;
    ctx.beginPath();
    [-1, 1].forEach((sd) => {
      const ang = o * 1.25, hxp = x + sd * hw;
      const [a0, a1] = P(hxp, y), len = hw * 0.98;
      ctx.moveTo(a0, a1);
      ctx.lineTo(...P(hxp - sd * Math.cos(ang) * len, y + dir * Math.sin(ang) * len));
    });
    ctx.stroke(); ctx.restore();
  });

  // blood: dots riding the circuit, pulsatile (surges with each ventricular beat)
  const da = seg(p, 0.25, 0.31);
  if (da > 0) {
    const nb = Math.floor(t / per), gp = nb + ease.inOut(clamp((ph - 0.26) / 0.3));
    const flow = (0.045 * t + 0.07 * gp) * LT;
    const N = 120;
    for (let i = 0; i < N; i++) {
      const d = ((i / N) * LT + flow) % LT;
      const [x, y] = P(...at(d));
      lib.circle(ctx, x, y, 4.6 * u * (0.85 + 0.3 * lib.rand(i)), { fill: mix(BLUE, RED, oxy(d)), alpha: da });
      if (i === 7) { const tr = focus(1) * seg(p, 0.29, 0.33); if (tr > 0) { lib.circle(ctx, x, y, 15 * u, { stroke: mix(BLUE, RED, oxy(d)), lineWidth: 1.6 * u, alpha: tr }); lib.circle(ctx, x, y, 7 * u, { fill: mix(BLUE, RED, oxy(d)), alpha: tr }); } }
    }
  }
  ctx.restore();

  // labels with leader lines (chambers in beats 1, 5; valves in beat 3)
  const lab = (str, ax, ay, lx, ly, a) => {
    if (a <= 0.01) return;
    const [x0, y0] = P(ax, ay), [x1, y1] = P(lx, ly), right = lx > ax;
    lib.line(ctx, [[x1 + (right ? -8 : 8) * u, y1], [lerp(x1, x0, 0.25), y1], [x0, y0]], a, { color: INK, width: 1 * u, alpha: 0.7 });
    lib.circle(ctx, x0, y0, 3 * u, { fill: INK, alpha: a });
    lib.text(ctx, str, x1, y1, { family: 'mono', size: 13.5 * u, tracking: 0.12, align: right ? 'left' : 'right', baseline: 'middle', alpha: a });
  };
  const chA = Math.max(seg(p, 0.06, 0.12) * (1 - seg(p, 0.2, 0.24)), 0.0, seg(p, 0.86, 0.92));
  ch.forEach((c, i) => lab(c.n, c.c[0] + (c.c[0] < 0 ? -c.hw * 0.55 : c.hw * 0.55), c.c[1] + (i % 2 ? 10 : 0), c.L[0], c.L[1], chA));
  const vA = focus(2) * seg(p, 0.43, 0.46);
  valves.forEach(([nm, x, y, d, o, L]) => lab(nm, x + (x < 0 ? -10 : 10), y, L[0], L[1], vA));
});

// ── Left column: kicker, headline, body ────────────────────────
let headBot = 0;
B.forEach((b, i) => {
  const w = W_[i];
  if (w.a <= 0) return;
  const kin = seg(p, b.a + (i ? 0.012 : 0.02), b.a + 0.09);
  const out = w.out;
  ctx.save(); ctx.globalAlpha = out;
  const ox = (1 - out) * -20 * u;
  lib.line(ctx, [[TX + ox, TY], [TX + ox + 36 * u, TY]], kin, { color: RED, width: 3 * u, cap: 'butt' });
  lib.text(ctx, b.kick.toUpperCase(), TX + ox + 52 * u, TY + 5 * u, { family: 'mono', size: 14 * u, tracking: 0.18, alpha: kin });
  const hr = lib.words(ctx, b.head, TX + ox, TY + HS * 1.25, kin, { size: HS, family: 'serif', maxWidth: TW, lineHeight: 1.08, stagger: 0.5 });
  if (i === 4) headBot = TY + HS * 1.25 + hr.height;
  if (b.body) lib.words(ctx, b.body, TX + ox, TY + HS * 1.25 + hr.height + 22 * u, seg(p, b.a + 0.03, b.a + 0.11), { size: (wide ? 23 : tall ? 27 : 22) * u, family: 'sans', maxWidth: TW * (wide ? 0.95 : 1), lineHeight: 1.4, color: '#3A3A40', stagger: 0.4 });
  ctx.restore();
});

// beat 2: legend
const lg = focus(1) * seg(p, 0.27, 0.32);
if (lg > 0) [['OXYGEN-POOR', BLUE], ['OXYGEN-RICH', RED]].forEach(([nm, c], i) => {
  const x = TX + i * 190 * u, y = EY + 20 * u;
  lib.circle(ctx, x + 6 * u, y, 6 * u, { fill: c, alpha: lg });
  lib.text(ctx, nm, x + 22 * u, y, { family: 'mono', size: 13.5 * u, tracking: 0.12, baseline: 'middle', alpha: lg });
});

// beat 3: contraction meters
const mt = focus(2) * seg(p, 0.44, 0.48);
if (mt > 0) [['ATRIA', AS], ['VENTRICLES', VS]].forEach(([nm, v], i) => {
  const y = EY + 20 * u + i * 44 * u, x0 = TX + 150 * u, mw = Math.min(EW - 150 * u, 380 * u);
  lib.text(ctx, nm, TX, y, { family: 'mono', size: 13.5 * u, tracking: 0.12, baseline: 'middle', alpha: mt });
  lib.rrect(ctx, x0, y - 7 * u, mw, 14 * u, 0, { stroke: INK, lineWidth: 1 * u, alpha: mt * 0.5 });
  lib.rrect(ctx, x0, y - 7 * u, mw * v, 14 * u, 0, { fill: i ? RED : BLUE, alpha: mt });
  lib.text(ctx, v > 0.3 ? 'CONTRACT' : 'RELAX', x0 + mw + 14 * u, y, { family: 'mono', size: 12 * u, tracking: 0.12, baseline: 'middle', alpha: mt * (v > 0.3 ? 1 : 0.45), color: v > 0.3 ? (i ? RED : BLUE) : INK });
});

// beats 4-5: ECG strip, a pen writing from the right, paper scrolling left
const ea = Math.max(focus(3), focus(4)) * seg(p, 0.62, 0.66);
if (ea > 0) {
  const Ts = 3.2, t0 = 0.6 * T, ex = TX, ey = wide ? EY : EY - 6 * u, base = ey + EH * 0.72;
  const yOf = (tt) => base - ecg(phase(tt)) * EH * 0.62 * A;
  ctx.save(); ctx.globalAlpha = ea * 0.12; ctx.strokeStyle = INK; ctx.lineWidth = 1 * u; ctx.beginPath();
  for (let i = 0; i <= 16; i++) { const x = ex + EW * i / 16; ctx.moveTo(x, ey); ctx.lineTo(x, ey + EH); }
  for (let j = 0; j <= 4; j++) { const y = ey + EH * j / 4; ctx.moveTo(ex, y); ctx.lineTo(ex + EW, y); }
  ctx.stroke(); ctx.restore();
  const xOf = (tt) => ex + EW - ((t - tt) / Ts) * EW;
  ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 2.2 * u; ctx.lineJoin = 'round'; ctx.globalAlpha = ea;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 360; i++) {
    const tt = t - Ts + (Ts * i) / 360;
    if (tt < t0) continue;
    const x = xOf(tt), y = yOf(tt);
    started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true;
  }
  ctx.stroke(); ctx.restore();
  lib.circle(ctx, xOf(t), yOf(t), 5 * u, { fill: RED, alpha: ea });
  // fade left edge
  const gr = ctx.createLinearGradient(ex, 0, ex + 60 * u, 0);
  gr.addColorStop(0, PAPER); gr.addColorStop(1, 'rgba(243,240,232,0)');
  ctx.fillStyle = gr; ctx.fillRect(ex - 4 * u, ey - 40 * u, 64 * u, EH + 50 * u);
  // P / QRS / T labels ride with each complex
  const la = focus(3) * seg(p, 0.64, 0.68) + focus(4) * 0.5;
  for (let n = Math.floor((t - Ts) / per); n <= Math.floor(t / per); n++) {
    [['P', 0.1, 0.16], ['QRS', 0.24, 1], ['T', 0.47, 0.3]].forEach(([nm, f, hgt]) => {
      const tt = n * per + f * per;
      if (tt > t || tt < t0) return;
      const x = xOf(tt), edge = clamp((x - ex - 40 * u) / (60 * u));
      const y = base - hgt * EH * 0.62 * A - 18 * u;
      lib.text(ctx, nm, x, y, { family: 'mono', size: 13 * u, tracking: 0.1, align: 'center', alpha: la * edge * clamp((t - tt) / 0.15), color: nm === 'QRS' ? RED : INK });
    });
  }
}

// beat 5: facts counting up
const fk = focus(4);
if (fk > 0) {
  const facts = [['60–100', 'PER MINUTE, AT REST', 0], ['~100,000', 'BEATS IN A DAY', 100000], ['~7,000', 'LITRES PUMPED A DAY', 7000]];
  const fy = wide ? H * 0.47 : headBot + 6 * u, cw = (wide ? TW : W - 2 * M) / 3;
  facts.forEach(([v, l, n], i) => {
    const k = seg(p, 0.82 + i * 0.025, 0.9 + i * 0.025, ease.outQuint);
    if (k <= 0) return;
    const x = TX + i * cw;
    const str = i === 0 ? lib.count(k, 0, 60) + '–' + lib.count(k, 0, 100) : '~' + lib.count(k, 0, n);
    lib.line(ctx, [[x, fy], [x + cw - 18 * u, fy]], k, { color: INK, width: 1 * u, alpha: fk * 0.6 });
    lib.text(ctx, str, x, fy + (wide ? 50 : 44) * u, { size: (wide ? 40 : 36) * u, family: 'serif', alpha: fk * clamp(k * 3), color: i === 0 ? RED : INK });
    lib.text(ctx, l, x, fy + (wide ? 76 : 68) * u, { family: 'mono', size: 11.5 * u, tracking: 0.08, maxWidth: cw - 22 * u, lineHeight: 1.35, alpha: fk * clamp(k * 3 - 0.5) * 0.85 });
  });
}

// figure caption
const capA = seg(p, 0.1, 0.16);
if (wide) lib.text(ctx, 'SCHEMATIC, FRONT VIEW: THE HEART\u2019S RIGHT SIDE IS ON THE VIEWER\u2019S LEFT.', TX, H - M - 4 * u, { family: 'mono', size: 11.5 * u, tracking: 0.06, maxWidth: TW, lineHeight: 1.45, alpha: 0.55 * capA });
`,
};
