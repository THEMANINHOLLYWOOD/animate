import { Doc, type Ease, type Layer, Layer as LayerSchema, type Value, newId } from "../../doc/schema";

// The Atlas launch film rebuilt as a native, fully editable document:
// every element is a layer, every motion is a keyframe on the timeline.

const W = 1920, H = 1080, T = 30;
const C = {
  ivory: "#FAF9F5", paper: "#F0EEE6", cloud: "#D1CFC5", stone: "#87867F", slate: "#3D3D3A", ink: "#141413", clay: "#D97757",
};
const OUT: Ease = { bezier: [0.22, 1, 0.36, 1] };
const IN_OUT: Ease = { bezier: [0.65, 0, 0.35, 1] };
const LIN: Ease = "linear";

type Spec = Partial<Layer> & Pick<Layer, "type" | "name"> & { x?: number; y?: number; anchor?: [number, number] };

function make(s: Spec): Layer {
  return LayerSchema.parse({
    id: newId(s.type),
    start: 0,
    end: T,
    ...s,
    transform: { x: s.x ?? 0, y: s.y ?? 0, scale: [1, 1], rotation: 0, anchor: s.anchor ?? [0, 0], opacity: 1 },
  });
}

// Keyframe helper: absolute doc times, converted to layer-local.
function key(l: Layer, path: string, pts: [number, Value, Ease?][]) {
  l.anim[path] = pts.map(([t, v, e]) => ({ id: newId("key"), t: t - l.start, v, ease: e ?? OUT }));
  return l;
}

// Fade in over [a, b], out over [c, d] (absolute seconds).
function fade(l: Layer, a: number, b: number, c?: number, d?: number) {
  const pts: [number, Value, Ease?][] = [[a, 0, OUT], [b, 1, LIN]];
  if (c !== undefined && d !== undefined) pts.push([c, 1, IN_OUT], [d, 0]);
  return key(l, "transform.opacity", pts);
}

function words(name: string, text: string, x: number, y: number, a: number, b: number, props: Record<string, unknown>, start: number, end: number) {
  const l = make({ type: "text", name, x, y, start, end, props: { text, revealMode: "words", ...props } });
  return key(l, "props.reveal", [[a, 0, LIN], [b, 1]]);
}

export function buildSampleDoc(): Doc {
  const layers: Layer[] = [];
  const push = (...ls: Layer[]) => layers.push(...ls);
  const cx = W / 2, cy = H / 2;
  const TX = W * 0.53, TW = W * 0.39, TY = cy - 210;

  // ── Globe: the hero object that carries the film ──
  const hero = [cx, cy - 60, 270], side = [W * 0.28, cy, 300], back = [cx, cy, 600], mark = [cx, cy - 175, 88];
  const stops: [number, number[], number][] = [
    [0, hero, 1], [4.05, hero, 1], [6, side, 1], [14.7, side, 1], [16.65, back, 0.1], [19.05, back, 0.1],
    [21, side, 1], [24.3, side, 1], [25.5, back, 0.07], [26.55, back, 0.07], [28.2, mark, 1], [30, mark, 1],
  ];
  const STORIES = [
    { cat: "Science", place: "Stockholm, Sweden", title: "Nobel Prize in Medicine awarded for optogenetics work", lat: 59.3, lon: 18.1 },
    { cat: "Politics", place: "Madrid, Spain", title: "Spain's prime minister calls snap election for Nov. 29", lat: 40.4, lon: -3.7 },
    { cat: "World", place: "Camp David, United States", title: "U.S. security aides hold talks on Iran and Yemen", lat: 39.6, lon: -77.4 },
    { cat: "Africa", place: "Addis Ababa, Ethiopia", title: "Ethiopian prime minister congratulated after re-election", lat: 9.0, lon: 38.7 },
  ];
  const S0 = 9.15, SD = 1.41;
  const sT = (i: number) => S0 + i * SD;
  const rot: [number, Value, Ease?][] = [[0, [70, 22], IN_OUT], [6, [30, 22], IN_OUT], [8.7, [24, 24], IN_OUT]];
  STORIES.forEach((s, i) => {
    rot.push([sT(i) + 0.12, [s.lon, s.lat * 0.55], IN_OUT], [sT(i) + SD * 0.75, [s.lon, s.lat * 0.55], IN_OUT]);
  });
  rot.push([19.2, [60, 12], IN_OUT], [21.75, [13.4, 30], IN_OUT], [24.6, [13.4, 30], IN_OUT], [30, [-40, 20]]);

  const markers: Record<string, unknown>[] = [{ lat: 24, lon: 45, size: 6.5, color: C.clay, pulse: true, from: 2.1, to: 8.7 }];
  STORIES.forEach((s, i) => {
    markers.push({ lat: s.lat, lon: s.lon, size: 7, color: C.clay, pulse: true, from: sT(i), to: sT(i) + SD });
    markers.push({ lat: s.lat, lon: s.lon, size: 4.5, color: C.ink, from: sT(i) + SD, to: 15.15 });
  });
  markers.push({ lat: 52.5, lon: 13.4, size: 8, color: C.clay, pulse: true, from: 21.75, to: 24.6 });
  markers.push({ lat: 30, lon: -20, size: 5, color: C.clay, pulse: true, from: 28.35, to: 30 });

  const globe = make({ type: "globe", name: "Globe", props: { R: 270, rot: 70, tilt: 22, draw: 1, color: C.ink, fill: C.paper, markers } });
  key(globe, "transform.x", stops.map(([t, v]) => [t, v[0], IN_OUT]));
  key(globe, "transform.y", stops.map(([t, v]) => [t, v[1], IN_OUT]));
  key(globe, "props.R", stops.map(([t, v]) => [t, v[2], IN_OUT]));
  key(globe, "transform.opacity", stops.map(([t, , o]) => [t, o, IN_OUT]));
  key(globe, "props.draw", [[0.15, 0, IN_OUT], [2.85, 1]]);
  const rotKeys = rot.map(([t, v, e]) => [t, (v as number[])[0], e] as [number, Value, Ease?]);
  const tiltKeys = rot.map(([t, v, e]) => [t, (v as number[])[1], e] as [number, Value, Ease?]);
  key(globe, "props.rot", rotKeys);
  key(globe, "props.tilt", tiltKeys);
  push(globe);

  // ── Chrome: wordmark + on-air tag ──
  const M = 140;
  push(
    fade(make({ type: "text", name: "Wordmark", x: M, y: M * 0.55 + 26, start: 4.5, end: 26.85, props: { text: "Atlas", size: 34, color: C.ink } }), 4.5, 5.4, 26.25, 26.85),
    fade(make({ type: "shape", name: "On-air dot", x: W - M - 118, y: M * 0.55 + 15, anchor: [0.5, 0.5], start: 4.5, end: 26.85, props: { kind: "ellipse", w: 10, h: 10, fill: C.clay, pulse: 1.6 } }), 4.5, 5.4, 26.25, 26.85),
    fade(make({ type: "text", name: "On-air label", x: W - M, y: M * 0.55 + 22, start: 4.5, end: 26.85, props: { text: "ON AIR", size: 18, family: "mono", color: C.stone, align: "right", tracking: 0.14 } }), 4.5, 5.4, 26.25, 26.85),
  );

  // ── 1 · Intro ──
  const iy = hero[1] + hero[2] + 118;
  push(
    fade(words("Intro · Atlas", "Atlas", cx, iy, 1.8, 3.3, { size: 92, align: "center", rise: 30 }, 0.9, 4.65), 0.9, 0.95, 3.75, 4.65),
    fade(words("Intro · tagline", "A live newsroom that never goes off the air", cx, iy + 62, 2.55, 3.9, { size: 26, family: "sans", color: C.stone, align: "center", stagger: 0.6 }, 0.9, 4.65), 0.9, 0.95, 3.75, 4.65),
  );

  // ── 2 · Hear the world ──
  const s2 = (l: Layer) => fade(l, 5.25, 5.85, 8.25, 9.0);
  const hs = 108;
  push(
    s2(make({ type: "shape", name: "Live pill", x: TX, y: TY - 26, start: 5.25, end: 9, props: { kind: "rect", w: 360, h: 52, radius: 26, stroke: C.cloud, lineWidth: 1.5 } })),
    s2(make({ type: "shape", name: "Live dot", x: TX + 30, y: TY, anchor: [0.5, 0.5], start: 5.25, end: 9, props: { kind: "ellipse", w: 12, h: 12, fill: C.clay, pulse: 1.4 } })),
    s2(make({ type: "text", name: "Live label", x: TX + 50, y: TY + 7, start: 5.25, end: 9, props: { text: "LIVE NOW", size: 18, family: "mono", color: C.slate, tracking: 0.14 } })),
    s2(make({ type: "waveform", name: "Anchor voice", x: TX + 168, y: TY, start: 5.25, end: 9, props: { w: 170, h: 26, bars: 18, color: C.clay, amp: 0.9 } })),
    s2(words("Headline · line 1", "Hear the world", TX, TY + 150, 5.7, 7.05, { size: hs, rise: 36 }, 5.25, 9)),
    s2(words("Headline · line 2", "as it happens", TX, TY + 150 + hs * 1.08, 6.15, 7.5, { size: hs, italic: true, color: C.clay, rise: 36 }, 5.25, 9)),
    s2(words("Headline · body", "An AI anchor voices the news around the clock — join in and ask anything, out loud.", TX, TY + 150 + hs * 1.08 + 92, 6.75, 8.25, { size: 30, family: "sans", color: C.slate, maxWidth: TW * 0.92, lineHeight: 1.45, stagger: 0.7, rise: 14 }, 5.25, 9)),
  );

  // ── 3 · Live feed ──
  const feedEnd = 15.15;
  push(
    fade(make({ type: "text", name: "Feed header", x: TX, y: TY - 10, start: 8.85, end: feedEnd, props: { text: "LIVE  ·  FROM A REAL-TIME WEB SEARCH", size: 18, family: "mono", color: C.stone, tracking: 0.14 } }), 8.94, 9.45, 14.4, feedEnd),
    key(fade(make({ type: "shape", name: "Feed rule", x: TX, y: TY + 18, start: 8.85, end: feedEnd, props: { kind: "line", points: [[0, 0], [TW, 0]], stroke: C.cloud, lineWidth: 1.5 } }), 8.85, 9, 14.4, feedEnd), "props.trim", [[9, 0, IN_OUT], [9.9, 1]]),
  );
  STORIES.forEach((s, i) => {
    const y = TY + 70 + i * 142;
    const t0 = sT(i);
    const dimAt = sT(i) + SD;
    const op = (l: Layer) => {
      const pts: [number, Value, Ease?][] = [[t0, 0, OUT], [t0 + 0.6, 1, LIN]];
      if (i < STORIES.length - 1) pts.push([dimAt, 1, OUT], [dimAt + 0.36, 0.42, LIN]);
      pts.push([14.4, i < STORIES.length - 1 ? 0.42 : 1, IN_OUT], [feedEnd, 0]);
      key(l, "transform.opacity", pts);
      key(l, "transform.y", [[t0, l.transform.y + 18, OUT], [t0 + 0.6, l.transform.y]]);
      return l;
    };
    push(
      op(make({ type: "shape", name: `Story ${i + 1} · dot`, x: TX + 5, y: y - 7, anchor: [0.5, 0.5], start: t0, end: feedEnd, props: { kind: "ellipse", w: 9, h: 9, fill: C.clay } })),
      op(make({ type: "text", name: `Story ${i + 1} · meta`, x: TX + 22, y, start: t0, end: feedEnd, props: { text: `${s.cat}  ·  ${s.place}`.toUpperCase(), size: 17, family: "sans", weight: 500, color: C.stone, tracking: 0.1 } })),
      op(words(`Story ${i + 1} · headline`, s.title, TX, y + 50, t0 + 0.12, t0 + 0.9, { size: 36, maxWidth: TW, lineHeight: 1.18, stagger: 0.5, rise: 12 }, t0, feedEnd)),
    );
  });

  // ── 4 · Features ──
  const fEnd = 19.95;
  const f = (l: Layer, a: number) => fade(l, a, a + 0.75, 19.2, fEnd);
  push(f(words("Features · title", "One place to follow, question, and explore the world", cx, cy - 230, 15.6, 16.8, { size: 58, align: "center", maxWidth: W * 0.7, lineHeight: 1.15, rise: 22 }, 15.45, fEnd), 15.45));
  const FEATS = [
    ["01", "Listen live", "An AI anchor voices the news around the clock."],
    ["02", "Join in", "Ask a question out loud. The anchor answers, then carries on."],
    ["03", "Make a podcast", "Name any topic and Atlas hosts a live episode on it."],
    ["04", "Explore the globe", "Every story has a place — now, or deep in the past."],
  ];
  const cw = (W - 2 * M - 3 * 56) / 4;
  FEATS.forEach(([n, title, desc], i) => {
    const x = M + i * (cw + 56), y = cy - 40, a = 16.35 + i * 0.6;
    push(
      key(f(make({ type: "shape", name: `Feature ${n} · rule`, x, y, start: a, end: fEnd, props: { kind: "line", points: [[0, 0], [cw, 0]], stroke: C.ink, lineWidth: 1.5 } }), a), "props.trim", [[a, 0, IN_OUT], [a + 1.2, 1]]),
      f(make({ type: "text", name: `Feature ${n} · number`, x, y: y + 52, start: a, end: fEnd, props: { text: n, size: 20, family: "mono", color: C.clay, tracking: 0.08 } }), a),
      f(make({ type: "text", name: `Feature ${n} · title`, x, y: y + 118, start: a, end: fEnd, props: { text: title, size: 42 } }), a),
      f(make({ type: "text", name: `Feature ${n} · body`, x, y: y + 172, start: a, end: fEnd, props: { text: desc, size: 25, family: "sans", color: C.slate, maxWidth: cw * 0.95, lineHeight: 1.45 } }), a),
    );
  });

  // ── 5 · Time travel ──
  const tEnd = 25.05;
  const tt = (l: Layer, a: number) => fade(l, a, a + 0.6, 24.3, tEnd);
  ["Now", "2004", "1989", "1969", "1911"].forEach((yr, i) => {
    push(tt(make({ type: "text", name: `Year rail · ${yr}`, x: TX + i * 108, y: TY, start: 20.25, end: tEnd, props: { text: yr, size: 22, family: "mono", color: i === 2 ? C.ink : C.stone } }), 20.4));
  });
  push(
    key(tt(make({ type: "shape", name: "Year rail · cursor", x: TX, y: TY + 16, start: 20.25, end: tEnd, props: { kind: "rect", w: 56, h: 3, radius: 1.5, fill: C.clay } }), 20.4), "transform.x", [[20.7, TX, IN_OUT], [22.05, TX + 2 * 108]]),
    key(tt(make({ type: "text", name: "Year counter", x: TX - 6, y: TY + 210, start: 20.25, end: tEnd, props: { number: 2026, size: 190, tracking: -0.02 } }), 20.4), "props.number", [[20.7, 2026, IN_OUT], [22.05, 1989]]),
    tt(make({ type: "text", name: "Date · place", x: TX, y: TY + 285, start: 22.05, end: tEnd, props: { text: "NOVEMBER 9, 1989  ·  BERLIN", size: 19, family: "mono", color: C.stone, tracking: 0.12 } }), 22.05),
    tt(words("Berlin headline", "The Berlin Wall falls", TX, TY + 370, 22.2, 23.1, { size: 66, rise: 22 }, 22.05, tEnd), 22.05),
    tt(words("Berlin body", "Fly to the spot on the globe, then listen to a deep dive on what happened that night.", TX, TY + 440, 22.65, 23.85, { size: 27, family: "sans", color: C.slate, maxWidth: TW * 0.9, lineHeight: 1.45, stagger: 0.7, rise: 12 }, 22.05, tEnd), 22.05),
  );

  // ── 6 · Facts, not sides ──
  const xEnd = 27.3;
  push(fade(words("Facts · headline", "Facts, not sides.", cx, cy - 10, 24.75, 25.65, { size: 128, align: "center", highlight: ["sides."], rise: 34 }, 24.6, xEnd), 24.6, 25.05, 26.55, xEnd));
  ["Evidence over opinion", "Primary sources first", "Every side, in its best terms", "Honest about limits"].forEach((txt, i) => {
    const a = 25.35 + i * 0.24;
    push(
      key(fade(make({ type: "text", name: `Principle ${i + 1}`, x: cx + (i - 1.5) * W * 0.19, y: cy + 120, start: a, end: xEnd, props: { text: txt, size: 25, family: "sans", color: C.slate, align: "center" } }), a, a + 0.45, 26.55, xEnd), "transform.y", [[a, cy + 132, OUT], [a + 0.45, cy + 120]]),
    );
  });

  // ── 7 · End card ──
  push(
    fade(words("End · Atlas", "Atlas", cx, cy + 70, 27.3, 28.35, { size: 150, align: "center", rise: 30 }, 27, T), 27, 27.9),
    fade(words("End · tagline", "Hear the world as it happens.", cx, cy + 150, 27.75, 28.95, { size: 44, italic: true, color: C.slate, align: "center", stagger: 0.6, rise: 14 }, 27, T), 27, 27.9),
    fade(make({ type: "text", name: "End · URL", x: cx, y: H - M - 46, start: 28.5, end: T, props: { text: "atlas.example", size: 30, family: "sans", weight: 500, align: "center" } }), 28.5, 29.25),
    fade(make({ type: "text", name: "End · award", x: cx, y: H - M + 2, start: 28.5, end: T, props: { text: "1ST PLACE OF 4,329 PROJECTS  ·  LOVABLE × ELEVENLABS HACKATHON", size: 17, family: "mono", color: C.stone, align: "center", tracking: 0.12 } }), 28.5, 29.25),
  );

  return Doc.parse({
    meta: { id: "sample", title: "Atlas — Hear the world", size: { w: W, h: H }, fps: 30, duration: T, background: C.ivory },
    layers,
    markers: [
      { id: newId("m"), t: 0, label: "Intro", kind: "cue" },
      { id: newId("m"), t: 5.25, label: "Hear the world", kind: "cue" },
      { id: newId("m"), t: 8.85, label: "Live feed", kind: "cue" },
      { id: newId("m"), t: 15.45, label: "Features", kind: "cue" },
      { id: newId("m"), t: 20.25, label: "Time travel", kind: "cue" },
      { id: newId("m"), t: 24.6, label: "Facts", kind: "cue" },
      { id: newId("m"), t: 27, label: "End card", kind: "cue" },
    ],
  });
}
