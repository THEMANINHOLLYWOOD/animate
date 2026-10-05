// Gaia launch film. Hand-built in the same scene format Claude generates,
// so it doubles as the house-style reference in the system prompt.
// (Plain string — no template-literal interpolation inside the scene body.)

export const GAIA_SCENE = String.raw`
const { C, ease, seg, win, keys, u, clamp } = lib;
lib.bg(ctx, W, H, C.ivory);

const wide = W / H >= 1.2;
const cx = W / 2, cy = H / 2;
const M = (wide ? 140 : 84) * u;

// ── Layout slots ────────────────────────────────────────────────
const G = wide
  ? { hero: [cx, cy - 60 * u, 270 * u], side: [W * 0.28, cy, 300 * u], back: [cx, cy, 600 * u], mark: [cx, cy - 175 * u, 88 * u] }
  : { hero: [cx, cy - 120 * u, W * 0.32], side: [cx, H * 0.27, Math.min(W * 0.3, H * 0.17)], back: [cx, cy, W * 0.7], mark: [cx, cy - 200 * u, 88 * u] };
const TX = wide ? W * 0.53 : M;           // text column x
const TW = wide ? W * 0.39 : W - 2 * M;   // text column width
const TY = wide ? cy - 210 * u : H * 0.52; // text column top

// ── Stories ────────────────────────────────────────────────────
const STORIES = [
  { cat: 'Science', place: 'Stockholm, Sweden', title: 'Nobel Prize in Medicine awarded for optogenetics work', lat: 59.3, lon: 18.1 },
  { cat: 'Politics', place: 'Madrid, Spain', title: "Spain's prime minister calls snap election for Nov. 29", lat: 40.4, lon: -3.7 },
  { cat: 'World', place: 'Camp David, United States', title: 'U.S. security aides hold talks on Iran and Yemen', lat: 39.6, lon: -77.4 },
  { cat: 'Africa', place: 'Addis Ababa, Ethiopia', title: 'Ethiopian prime minister congratulated after re-election', lat: 9.0, lon: 38.7 },
];
const S0 = 0.305, SD = 0.047;
const sT = (i) => S0 + i * SD;
const activeStory = STORIES.findIndex((s, i) => p >= sT(i) && p < (i < STORIES.length - 1 ? sT(i + 1) : 0.505));

// ── Globe choreography ─────────────────────────────────────────
const gk = keys(p, [
  [0.00, [...G.hero, 1]],
  [0.135, [...G.hero, 1]],
  [0.20, [...G.side, 1]],
  [0.49, [...G.side, 1]],
  [0.555, [...G.back, 0.1]],
  [0.635, [...G.back, 0.1]],
  [0.70, [...G.side, 1]],
  [0.81, [...G.side, 1]],
  [0.85, [...G.back, 0.07]],
  [0.885, [...G.back, 0.07]],
  [0.94, [...G.mark, 1]],
  [1.00, [...G.mark, 1]],
], ease.inOut);

const rotKeys = [[0, [70, 22]], [0.2, [30, 22]], [0.29, [24, 24]]];
STORIES.forEach((s, i) => {
  rotKeys.push([sT(i) + 0.004, [s.lon, s.lat * 0.55]]);
  rotKeys.push([sT(i) + SD * 0.75, [s.lon, s.lat * 0.55]]);
});
rotKeys.push([0.64, [60, 12]], [0.725, [13.4, 30]], [0.82, [13.4, 30]], [1, [-40, 20]]);
const rk = keys(p, rotKeys, ease.inOut);

const markers = [];
if (p < 0.3) markers.push({ lat: 24, lon: 45, size: 6.5, pulse: lib.pulse(t, 1.5), alpha: seg(p, 0.07, 0.09) * (1 - seg(p, 0.27, 0.29)) });
STORIES.forEach((s, i) => {
  const a = seg(p, sT(i), sT(i) + 0.012) * (1 - seg(p, 0.49, 0.51));
  if (a <= 0) return;
  const on = i === activeStory;
  markers.push({ lat: s.lat, lon: s.lon, color: on ? C.clay : C.ink, size: on ? 7 : 4.5, pulse: on ? lib.pulse(t, 1.4) : null, alpha: a });
});
const bA = seg(p, 0.725, 0.74) * (1 - seg(p, 0.81, 0.83));
if (bA > 0) markers.push({ lat: 52.5, lon: 13.4, size: 8, pulse: lib.pulse(t, 1.4), alpha: bA });
const eA = seg(p, 0.945, 0.96);
if (eA > 0) markers.push({ lat: 30, lon: -20 + 0, size: 5, pulse: lib.pulse(t, 1.6), alpha: eA });

lib.globe(ctx, gk[0], gk[1], gk[2], {
  rot: rk[0] + 3 * Math.sin(t * 0.35), tilt: rk[1],
  k: seg(p, 0.005, 0.095), alpha: gk[3], color: C.ink, fill: C.paper, markers,
});

// ── Chrome: quiet wordmark + on-air tag ────────────────────────
const chrome = seg(p, 0.15, 0.18) * (1 - seg(p, 0.875, 0.895));
if (chrome > 0) {
  lib.text(ctx, 'Gaia', M, M * 0.55 + 26 * u, { size: 34 * u, color: C.ink, alpha: chrome });
  const live = 0.55 + 0.45 * Math.cos(lib.pulse(t, 1.6) * Math.PI * 2);
  lib.circle(ctx, W - M - 118 * u, M * 0.55 + 15 * u, 5 * u, { fill: C.clay, alpha: chrome * live });
  lib.text(ctx, 'ON AIR', W - M, M * 0.55 + 22 * u, { size: 18 * u, family: 'mono', color: C.stone, align: 'right', tracking: 0.14, alpha: chrome });
}

// ── 1 · Intro: the globe draws itself, the name arrives ────────
{
  const w = win(p, 0.03, 0.155, 0.02, 0.03);
  if (w.a > 0) {
    const y = G.hero[1] + G.hero[2] + (wide ? 118 : 150) * u;
    lib.words(ctx, 'Gaia', cx, y, seg(p, 0.06, 0.11), { size: (wide ? 92 : 120) * u, align: 'center', alpha: w.out, rise: 30 * u });
    lib.words(ctx, 'A live newsroom that never goes off the air', cx, y + (wide ? 62 : 80) * u, seg(p, 0.085, 0.13),
      { size: (wide ? 26 : 34) * u, family: 'sans', color: C.stone, align: 'center', alpha: w.out, stagger: 0.6 });
  }
}

// ── 2 · Hear the world, as it happens ──────────────────────────
{
  const w = win(p, 0.175, 0.30, 0.02, 0.025);
  if (w.a > 0) {
    const hs = (wide ? 108 : 104) * u;
    const pill = seg(p, 0.18, 0.205, ease.out);
    lib.rrect(ctx, TX, TY - 26 * u, 360 * u, 52 * u, 26 * u, { stroke: C.cloud, lineWidth: 1.5 * u, alpha: pill * w.out });
    const live = 0.55 + 0.45 * Math.cos(lib.pulse(t, 1.4) * Math.PI * 2);
    lib.circle(ctx, TX + 30 * u, TY, 6 * u, { fill: C.clay, alpha: pill * w.out * live });
    lib.text(ctx, 'LIVE NOW', TX + 50 * u, TY + 7 * u, { size: 18 * u, family: 'mono', color: C.slate, tracking: 0.14, alpha: pill * w.out });
    lib.wave(ctx, TX + 168 * u, TY, 170 * u, 26 * u, t, { bars: 18, color: C.clay, alpha: pill * w.out, amp: 0.9 });

    lib.words(ctx, 'Hear the world', TX, TY + 150 * u, seg(p, 0.19, 0.235), { size: hs, alpha: w.out, rise: 36 * u });
    lib.words(ctx, 'as it happens', TX, TY + 150 * u + hs * 1.08, seg(p, 0.205, 0.25), { size: hs, italic: true, color: C.clay, alpha: w.out, rise: 36 * u });
    lib.words(ctx, 'An AI anchor voices the news around the clock — join in and ask anything, out loud.',
      TX, TY + 150 * u + hs * 1.08 + 92 * u, seg(p, 0.225, 0.275),
      { size: (wide ? 30 : 34) * u, family: 'sans', color: C.slate, maxWidth: TW * 0.92, lineHeight: 1.45, alpha: w.out, stagger: 0.7, rise: 14 * u });
  }
}

// ── 3 · The live feed ──────────────────────────────────────────
{
  const w = win(p, 0.295, 0.505, 0.015, 0.025);
  if (w.a > 0) {
    const head = seg(p, 0.298, 0.315, ease.out) * w.out;
    lib.text(ctx, 'LIVE  ·  FROM A REAL-TIME WEB SEARCH', TX, TY - 10 * u, { size: 18 * u, family: 'mono', color: C.stone, tracking: 0.14, alpha: head });
    lib.line(ctx, [[TX, TY + 18 * u], [TX + TW, TY + 18 * u]], seg(p, 0.3, 0.33, ease.inOut), { color: C.cloud, width: 1.5 * u, alpha: w.out });

    if (wide) {
      const rowH = 142 * u;
      STORIES.forEach((s, i) => {
        const a = seg(p, sT(i), sT(i) + 0.02, ease.out);
        if (a <= 0) return;
        const on = i === activeStory;
        const dim = on ? 1 : 0.42 + 0.58 * (1 - seg(p, sT(i) + SD, sT(i) + SD + 0.012));
        const y = TY + 70 * u + i * rowH + (1 - a) * 18 * u;
        const al = a * w.out * (activeStory === -1 && p > 0.5 ? 1 : dim);
        lib.circle(ctx, TX + 5 * u, y - 7 * u, 4.5 * u, { fill: on ? C.clay : C.cloud, alpha: al });
        lib.text(ctx, (s.cat + '  ·  ' + s.place).toUpperCase(), TX + 22 * u, y, { size: 17 * u, family: 'sans', weight: 500, color: C.stone, tracking: 0.1, alpha: al });
        lib.words(ctx, s.title, TX, y + 50 * u, seg(p, sT(i) + 0.004, sT(i) + 0.03), { size: 36 * u, maxWidth: TW, lineHeight: 1.18, alpha: al, stagger: 0.5, rise: 12 * u });
      });
    } else {
      STORIES.forEach((s, i) => {
        const sw = win(p, sT(i), i < STORIES.length - 1 ? sT(i + 1) + 0.008 : 0.505, 0.012, 0.01);
        if (sw.a <= 0) return;
        const y = TY + 90 * u;
        lib.circle(ctx, TX + 5 * u, y - 7 * u, 5 * u, { fill: C.clay, alpha: sw.a * w.out });
        lib.text(ctx, (s.cat + '  ·  ' + s.place).toUpperCase(), TX + 22 * u, y, { size: 22 * u, family: 'sans', weight: 500, color: C.stone, tracking: 0.1, alpha: sw.a * w.out });
        lib.words(ctx, s.title, TX, y + 90 * u, seg(p, sT(i) + 0.002, sT(i) + 0.03), { size: 64 * u, maxWidth: TW, lineHeight: 1.12, alpha: sw.out * w.out, rise: 20 * u });
      });
    }
  }
}

// ── 4 · One place to follow, question, and explore ────────────
{
  const w = win(p, 0.515, 0.665, 0.02, 0.025);
  if (w.a > 0) {
    const F = [
      ['01', 'Listen live', 'An AI anchor voices the news around the clock.'],
      ['02', 'Join in', 'Ask a question out loud. The anchor answers, then carries on.'],
      ['03', 'Make a podcast', 'Name any topic and Gaia hosts a live episode on it.'],
      ['04', 'Explore the globe', 'Every story has a place — now, or deep in the past.'],
    ];
    const titleY = wide ? cy - 230 * u : H * 0.2;
    lib.words(ctx, 'One place to follow, question, and explore the world', cx, titleY, seg(p, 0.52, 0.56),
      { size: (wide ? 58 : 66) * u, align: 'center', maxWidth: wide ? W * 0.7 : W - 2 * M, lineHeight: 1.15, alpha: w.out, rise: 22 * u });
    const cols = wide ? 4 : 2;
    const gap = (wide ? 56 : 48) * u;
    const cw = (W - 2 * M - (cols - 1) * gap) / cols;
    const top = wide ? cy - 40 * u : H * 0.38;
    const rowH = wide ? 0 : 420 * u;
    F.forEach((f, i) => {
      const s0 = 0.545 + i * 0.02;
      const a = seg(p, s0, s0 + 0.025, ease.out) * w.out;
      if (a <= 0) return;
      const x = M + (i % cols) * (cw + gap);
      const y = top + Math.floor(i / cols) * rowH + (1 - a) * 20 * u;
      lib.line(ctx, [[x, y], [x + cw, y]], seg(p, s0, s0 + 0.04, ease.inOut), { color: C.ink, width: 1.5 * u, alpha: w.out * 0.9 });
      lib.text(ctx, f[0], x, y + 52 * u, { size: 20 * u, family: 'mono', color: C.clay, tracking: 0.08, alpha: a });
      lib.text(ctx, f[1], x, y + (wide ? 118 : 130) * u, { size: (wide ? 42 : 52) * u, color: C.ink, alpha: a });
      lib.text(ctx, f[2], x, y + (wide ? 172 : 194) * u, { size: (wide ? 25 : 30) * u, family: 'sans', color: C.slate, maxWidth: cw * 0.95, lineHeight: 1.45, alpha: a });
    });
  }
}

// ── 5 · Travel back in time ────────────────────────────────────
{
  const w = win(p, 0.675, 0.835, 0.02, 0.025);
  if (w.a > 0) {
    const YEARS = ['Now', '2004', '1989', '1969', '1911'];
    const rail = seg(p, 0.68, 0.70, ease.out) * w.out;
    const step = (wide ? 108 : 150) * u;
    const sel = keys(p, [[0.69, 0], [0.735, 2]], ease.inOut);
    YEARS.forEach((y, i) => {
      const near = 1 - clamp(Math.abs(sel - i));
      lib.text(ctx, y, TX + i * step, TY, { size: 22 * u, family: 'mono', color: lib.mix(C.stone, C.ink, near), alpha: rail });
    });
    lib.rrect(ctx, TX + sel * step, TY + 16 * u, 56 * u, 3 * u, 1.5 * u, { fill: C.clay, alpha: rail });

    const yr = Math.round(keys(p, [[0.69, 2026], [0.735, 1989]], ease.inOut));
    lib.text(ctx, String(yr), TX - 6 * u, TY + 210 * u, { size: (wide ? 190 : 210) * u, color: C.ink, alpha: rail, tracking: -0.02 });
    lib.text(ctx, 'NOVEMBER 9, 1989  ·  BERLIN', TX, TY + 285 * u, { size: 19 * u, family: 'mono', color: C.stone, tracking: 0.12, alpha: seg(p, 0.735, 0.75) * w.out });
    lib.words(ctx, 'The Berlin Wall falls', TX, TY + 370 * u, seg(p, 0.74, 0.77), { size: (wide ? 66 : 76) * u, alpha: w.out, rise: 22 * u });
    lib.words(ctx, 'Fly to the spot on the globe, then listen to a deep dive on what happened that night.', TX, TY + 440 * u, seg(p, 0.755, 0.795),
      { size: (wide ? 27 : 32) * u, family: 'sans', color: C.slate, maxWidth: TW * 0.9, lineHeight: 1.45, alpha: w.out, stagger: 0.7, rise: 12 * u });
  }
}

// ── 6 · Facts, not sides ───────────────────────────────────────
{
  const w = win(p, 0.82, 0.91, 0.015, 0.025);
  if (w.a > 0) {
    lib.words(ctx, 'Facts, not sides.', cx, cy - 10 * u, seg(p, 0.825, 0.855), { size: (wide ? 128 : 116) * u, align: 'center', highlight: ['sides.'], alpha: w.out, rise: 34 * u });
    const P = ['Evidence over opinion', 'Primary sources first', 'Every side, in its best terms', 'Honest about limits'];
    P.forEach((s, i) => {
      const a = seg(p, 0.845 + i * 0.008, 0.86 + i * 0.008, ease.out) * w.out;
      const y = wide ? cy + 120 * u : cy + 140 * u + i * 56 * u;
      const x = wide ? cx + (i - 1.5) * W * 0.19 : cx;
      lib.text(ctx, s, x, y + (1 - a) * 12 * u, { size: (wide ? 25 : 32) * u, family: 'sans', color: C.slate, align: 'center', alpha: a });
    });
  }
}

// ── 7 · End card ───────────────────────────────────────────────
{
  const w = win(p, 0.9, 1, 0.03, 0);
  if (w.a > 0) {
    lib.words(ctx, 'Gaia', cx, cy + 70 * u, seg(p, 0.91, 0.945), { size: 150 * u, align: 'center', rise: 30 * u });
    lib.words(ctx, 'Hear the world as it happens.', cx, cy + 150 * u, seg(p, 0.925, 0.965),
      { size: 44 * u, italic: true, color: C.slate, align: 'center', stagger: 0.6, rise: 14 * u });
    const f = seg(p, 0.95, 0.975, ease.out);
    lib.text(ctx, 'civgaia.com', cx, H - M - 46 * u, { size: 30 * u, family: 'sans', weight: 500, color: C.ink, align: 'center', alpha: f });
    lib.text(ctx, '1ST PLACE OF 4,329 PROJECTS  ·  LOVABLE × ELEVENLABS HACKATHON', cx, H - M + 2 * u,
      { size: (wide ? 17 : 18) * u, family: 'mono', color: C.stone, align: 'center', tracking: 0.12, alpha: f, maxWidth: W - 2 * M });
  }
}
`;
