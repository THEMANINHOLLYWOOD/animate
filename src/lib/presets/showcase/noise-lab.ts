// Noise Lab. Hand-built example film in the scene format Claude generates, and the animator's
// reference for high-energy films: cut on a beat grid, one composition per shot, type as the hero,
// hits answered with flash, shake and colour split, then a held end card.
// Brief: A 12-second hype reel for a fictional sound studio, Noise Lab: black, acid lime and electric blue, giant kinetic type cut hard on a 150 BPM beat, a 3-2-1 into a drop where the wordmark slams in with sparks, ending on the name and 'turn it up'.
export const film = {
  id: "ex-noise-lab",
  title: "Noise Lab — hype reel",
  aspect: "16:9" as const,
  duration: 12,
  prompt: "A 12-second hype reel for a fictional sound studio, Noise Lab: black, acid lime and electric blue, giant kinetic type cut hard on a 150 BPM beat, a 3-2-1 into a drop where the wordmark slams in with sparks, ending on the name and 'turn it up'.",
  code: String.raw`
const L = lib, E = L.ease, U = L.u, S = Math.min(W, H), wide = W / H >= 1.2, cx = W / 2, cy = H / 2;
const INK = '#08080b', ACID = '#c8ff2e', BLUE = '#2b5cff', BONE = '#f4f3ee';
// ---------- the edit: 30 beats (12 s at 150 BPM), cut in beats; shots shorten into the drop at 16 ----------
const B = L.beats(p, 30);
const CUTS = [0, 2, 4, 6, 7, 8, 10, 12, 13, 14, 15, 16, 23, 30];
const C = L.shot(B.x, CUTS);
const cutHit = L.hit(C.since, 0, 0.45);            // 1 at each cut, gone half a beat later
const D = 'display', big = wide ? H * 0.74 : W * 0.5;
// one giant word, cropped by the frame if it has to be
function word(str, k, o) {
  L.slam(ctx, str, cx + (o.dx || 0), cy + big * 0.36 * (o.scale || 1), k, { family: D, size: big * (o.scale || 1), align: 'center', color: o.color, tracking: -0.01, from: o.from || 2.6 });
}
const SHOTS = [
  ['Open: MAKE', () => {                              // a blade of light opens the frame on a cropped word
    L.bg(ctx, W, H, INK);
    L.wipe(ctx, E.outExpo(C.k * 1.6), 'slash', () => { L.bg(ctx, W, H, BONE); word('MAKE', 1, { color: INK, scale: 1.25, dx: -W * 0.04 * C.k }); });
  }],
  ['NOISE, letter by letter', () => {
    L.bg(ctx, W, H, ACID);
    L.letters(ctx, 'NOISE.', cx, cy + big * 0.36, C.k * 2.2, { family: D, size: big, align: 'center', color: INK, mode: 'drop', spread: 0.6 });
  }],
  ['Marquee bands', () => {
    L.bg(ctx, W, H, INK);
    const g = H * 0.27;
    L.marquee(ctx, 'LOUDER', cy - g, t, { family: D, size: g * 0.8, speed: 900, angle: -7, color: ACID, band: BLUE });
    L.marquee(ctx, 'FASTER', cy, t, { family: D, size: g * 0.8, speed: -1200, angle: -7, color: BONE, outline: true, lineWidth: 4 });
    L.marquee(ctx, 'LOUDER', cy + g, t, { family: D, size: g * 0.8, speed: 700, angle: -7, color: INK, band: ACID });
  }],
  ['Video wall', () => {                              // one mark, then the frame tiled 3 x 3
    L.bg(ctx, W, H, BLUE);
    L.circle(ctx, cx, cy, S * 0.3 * E.outBack(Math.min(1, C.k * 3)), { fill: ACID });
    L.ring(ctx, cx, cy, S * 0.42, 1, { color: BONE, width: 18 * U, start: t * 400 });
    L.tiles(ctx, 3);
  }],
  ['Hollow stack', () => {
    L.bg(ctx, W, H, INK);
    L.outline(ctx, 'FASTER', cx, cy + big * 0.2, { family: D, size: big * 0.8, align: 'center', color: ACID, lineWidth: 5, echo: 5, dy: big * 0.11 * E.out(C.k) });
  }],
  ['NOW, rushing in', () => {
    L.bg(ctx, W, H, BONE);
    L.speedLines(ctx, cx, cy, t, { color: INK, inner: 0.42, alpha: 0.85 });
    word('NOW', Math.min(1, C.k * 3), { color: BLUE, from: 0.2, scale: 0.6 + 0.5 * E.in(C.k) });
    L.zoomBlur(ctx, 0.5 * E.in(C.k));
  }],
  ['Split screen', () => {
    L.bg(ctx, W, H, BLUE);
    ctx.fillStyle = ACID; ctx.fillRect(cx, 0, W / 2, H);
    L.text(ctx, 'N', W * 0.25, cy + big * 0.4, { family: D, size: big * 1.1, align: 'center', color: BONE });
    L.text(ctx, L.scramble('NOISE LAB', C.k * 1.5, t), W * 0.75, cy + 22 * U, { family: 'mono', weight: 700, size: 58 * U, align: 'center', color: INK, tracking: 0.08 });
  }],
  ['Count 3', () => { L.bg(ctx, W, H, INK); word('3', 1, { color: BONE, scale: 1 + 0.12 * B.hit }); }],
  ['Count 2', () => { L.bg(ctx, W, H, BONE); word('2', 1, { color: INK, scale: 1 + 0.12 * B.hit }); }],
  ['Count 1', () => { L.bg(ctx, W, H, ACID); word('1', 1, { color: INK, scale: 1 + 0.12 * B.hit }); }],
  ['Hold your breath', () => {                         // one beat of near-black before the drop
    L.bg(ctx, W, H, INK);
    L.circle(ctx, cx, cy, 10 * U * (1 + 2 * B.hit), { fill: ACID });
  }],
  ['The drop', () => {
    L.bg(ctx, W, H, INK);
    const k = Math.min(1, C.since / 1.2);
    L.shockwave(ctx, cx, cy, C.since / 2.5, { color: ACID, width: 40 });
    L.sparks(ctx, cx, cy, C.since / 3, { n: 70, color: ACID, len: 900, gravity: 120 });
    L.marquee(ctx, 'TURN IT UP', H * 0.86, t, { family: D, size: H * 0.1, speed: 500, color: INK, band: ACID });
    L.slam(ctx, 'NOISE LAB', cx, cy + H * 0.11, k, { family: D, size: (wide ? H * 0.34 : W * 0.2) * (1 + 0.03 * B.hit), align: 'center', color: BONE, from: 5 });
  }],
];
// each shot is a layer of its own in the editor, like clips on an edit timeline
L.shake(ctx, t, 30 * cutHit * (C.i === 11 ? 1.6 : 0.5), () => {
  if (C.i < 12) L.layer(ctx, SHOTS[C.i][0], SHOTS[C.i][1]);
});
// ---------- hits: every cut flashes; the drop also crushes to an impact frame and pulls the colours apart ----------
if (C.i < 12) {
  L.flash(ctx, cutHit * (C.i === 11 ? 1 : 0.5), C.i % 2 ? BONE : ACID, { add: true });
  if (C.i === 11 && C.since < 0.18) L.impact(ctx, 1, { invert: true });
  L.rgbSplit(ctx, 3 + 22 * cutHit * (C.i === 11 ? 1 : 0.4), 20);
  if (C.i === 10) L.glitch(ctx, t, 0.35);
}
// ---------- end card: the name holds, pulsing on the beat ----------
if (C.i === 12) {
  L.bg(ctx, W, H, INK);
  L.layer(ctx, 'Beat ring', () => L.ring(ctx, cx, cy - H * 0.03, S * (0.36 + 0.015 * B.hit), E.outExpo(Math.min(1, C.since / 2)), { color: BLUE, width: 6 * U, start: -90 }));
  L.text(ctx, 'NOISE LAB', cx, cy + H * 0.05, { family: D, size: wide ? H * 0.24 : W * 0.16, align: 'center', color: BONE });
  L.typewriter(ctx, 'turn it up.', cx, cy + H * 0.19, Math.min(1, (C.since - 0.5) / 2), { family: 'mono', weight: 700, size: 46 * U, align: 'center', color: ACID, tracking: 0.12, t: t });
  L.flash(ctx, cutHit * 0.6, ACID, { add: true });
}
// ---------- finish: glow (on the dark shots), grit, corners ----------
if (C.i >= 10) L.bloom(ctx, 0.45);
L.grain(ctx, t, 0.16);
L.vignette(ctx, 0.45);
`,
};
