// Split a code layer's text into native, editable text layers.
// The scene is played once, frame by frame, with its text draws recorded (textTap);
// each piece of text becomes a layer whose position, scale, rotation, opacity,
// reveal and copy are keyframed from what was drawn, thinned to the keys that matter.
// The scene runs by its own clock, as playback runs it (a trimmed or time-split code layer shows a
// stretch of its scene). The code layer is marked skipText (with a hash of its code, so the mark lapses
// when the code changes, and the stretch of the scene that was split, past which the code paints its own
// text), so it keeps painting everything else. The split is then checked against
// the original by pixels (verifySplit), and text that doesn't come out identical stays in code.
// It all runs in slices (pace) so the page stays responsive, reporting progress.
// Each layer is named by its words (props.autoName, so it's renamed when they change), belongs to its
// code layer (props.splitFrom), and copies of the same words drawn together share props.linkId.

import { compileScene, type Assets } from "@/lib/engine";
import type { Kit } from "@/lib/kit";
import type { Op } from "../doc/ops";
import { Doc, Layer, newId, type Doc as DocT, type Keyframe, type Layer as LayerT, type Value } from "../doc/schema";
import { evolves, textLabel } from "../doc/split";
import { codeHash, sceneClock, unsplit } from "./codeHash";
import { dropper, paintOrder } from "./keep";
import { pacer, type Pace } from "./pace";
import { invisible, tapText, type Box, type Paint, type TextDraw } from "./textTap";
import { sampleEvery, splitSpanOf, verifySplit, type Candidates } from "./verifySplit";

export { evolves };

type Sample = { i: number; d: TextDraw };

// Indices worth keeping so linear interpolation stays within tol of every sample (Ramer–Douglas–Peucker).
export function keepIndices(values: number[][], tol: number): number[] {
  const n = values.length;
  if (n <= 2) return [...Array(n).keys()];
  const keep = new Set([0, n - 1]);
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const k = (i - a) / (b - a);
      let err = 0;
      for (let c = 0; c < values[i].length; c++) err = Math.max(err, Math.abs(values[a][c] + (values[b][c] - values[a][c]) * k - values[i][c]));
      if (err > worst) [worst, at] = [err, i];
    }
    if (worst > tol) {
      keep.add(at);
      stack.push([a, at], [at, b]);
    }
  }
  return [...keep].sort((x, y) => x - y);
}

// One property's samples → a static value, or keyframes (linear for numbers, hold for anything else).
export function track(times: number[], values: Value[], tol: number): { value: Value } | { keys: Keyframe[] } {
  const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);
  const numeric = values.every((v) => typeof v === "number" || Array.isArray(v));
  if (numeric) {
    const vecs = values.map((v) => (Array.isArray(v) ? v : [v as number]));
    const idx = keepIndices(vecs, tol);
    const flat = idx.length === 2 && vecs.every((v) => v.every((x, c) => Math.abs(x - vecs[0][c]) <= tol));
    if (flat || values.length === 1) return { value: values[0] };
    return { keys: idx.map((i) => ({ id: newId("key"), t: times[i], v: values[i], ease: "linear" as const })) };
  }
  if (values.every((v) => same(v, values[0]))) return { value: values[0] };
  const keys: Keyframe[] = [];
  values.forEach((v, i) => {
    if (!i || !same(v, values[i - 1])) keys.push({ id: newId("key"), t: times[i], v, ease: "hold" });
  });
  return { keys };
}

// Thinning tolerance per property, tight enough that the thinned layer renders within a pixel.
const TOL: Record<string, number> = {
  "transform.x": 0.5,
  "transform.y": 0.5,
  "transform.rotation": 0.1,
  "transform.scale": 0.001,
  "transform.opacity": 0.01,
  "props.reveal": 0.002,
  "props.size": 0.02,
  "props.tracking": 0.0002,
  "props.blur": 0.05,
};
// Decimals kept of recorded numbers: more is noise that only makes the doc bigger.
const PLACES: Record<string, number> = { "transform.x": 2, "transform.y": 2, "transform.rotation": 3, "transform.opacity": 3, "props.tracking": 5 };

export const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const roundValue = (v: Value, places: number): Value => (typeof v === "number" ? round(v, places) : Array.isArray(v) ? v.map((x) => round(x, places)) : v);

// A key time a little before its frame (never after, so a held change is in effect on its frame
// despite float noise in the layer-local time), at a sensible precision.
export const keyTime = (t: number) => Math.max(0, Math.floor(t * 1e4 - 0.5) / 1e4);

// Limits per code layer, so a split doc stays small enough to save, undo and send to the agent.
const MIN_FRAMES = 6; // text on screen for fewer frames stays in code
const GLYPHS = 6; // one code site drawing this many single characters in a frame is setting type by hand
const MAX_LAYERS = 160;
const MAX_KEYS = 5000;
const BUDGET_MS = 120_000;
const MIN_CHECKS = 30; // frames where art covers text checked by pixels: up to this or a sixth of the frames

function decompose(m: TextDraw["m"]) {
  const sx = Math.hypot(m.a, m.b) || 1e-9;
  return { x: m.e, y: m.f, rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI, scale: [sx, (m.a * m.d - m.b * m.c) / sx] };
}

const pxOf = (font: string) => Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 48);

function layerFrom(run: Sample[], fps: number, offset: number, end: number): LayerT {
  const first = run.find((s) => s.d.kind === "words" || s.d.kind === "typewriter")?.d ?? run[0].d;
  // Each frame owns the half frame either side of it, so frame-exact renders (export) never
  // land on a layer's in or out point.
  const f0 = run[0].i, f1 = run[run.length - 1].i;
  const lead = f0 === 0 ? 0 : 0.5 / fps;
  const times = run.map((s) => keyTime((s.i - f0) / fps + lead));
  const tr = run.map((s) => decompose(s.d.m));
  const anim: Record<string, Keyframe[]> = {};
  const transform: Record<string, unknown> = { anchor: [0, 0] };
  const props: Record<string, unknown> = {};

  const put = (path: string, values: Value[]) => {
    const places = PLACES[path] ?? 4;
    const r = track(times, values.map((v) => roundValue(v, places)), TOL[path] ?? 0.001);
    if ("keys" in r) anim[path] = r.keys;
    else if (path.startsWith("transform.")) transform[path.slice(10)] = r.value;
    else props[path.slice(6)] = r.value;
  };
  // Keep rotation continuous across ±180°.
  let prev = tr[0].rotation;
  const rot = tr.map((x) => {
    let r = x.rotation;
    while (r - prev > 180) r -= 360;
    while (r - prev < -180) r += 360;
    return (prev = r);
  });
  put("transform.x", tr.map((x) => x.x));
  put("transform.y", tr.map((x) => x.y));
  put("transform.rotation", rot);
  put("transform.scale", tr.map((x) => x.scale));
  put("transform.opacity", run.map((s) => Math.min(1, Math.max(0, s.d.alpha))));
  put("props.text", run.map((s) => s.d.str));

  if (first.kind === "raw") {
    props.raw = true;
    for (const key of ["font", "color", "align", "baseline", "letterSpacing"]) put(`props.${key}`, run.map((s) => String(s.d.o[key] ?? "")));
    put("props.size", run.map((s) => pxOf(String(s.d.o.font))));
  } else {
    props.revealMode = first.kind === "words" ? "words" : first.kind === "typewriter" ? "chars" : "none";
    // Plain-text frames of a reveal layer are the reveal finished.
    if (first.kind !== "text") put("props.reveal", run.map((s) => (s.d.kind === "text" ? 1 : s.d.k ?? 1)));
    const keys = new Set(run.flatMap((s) => Object.keys(s.d.o)));
    for (const key of keys) {
      const vals = run.map((s) => s.d.o[key]);
      if (vals.every((v) => typeof v === "number" || typeof v === "string")) put(`props.${key}`, vals as Value[]);
      else props[key] = vals.find((v) => v !== undefined);
    }
  }

  return Layer.parse({
    id: newId("text"),
    // Counters and typed text are named by what they end on.
    name: textLabel(run[run.length - 1].d.str),
    type: "text",
    start: offset + f0 / fps - lead,
    end: Math.min(end, offset + (f1 + 0.5) / fps),
    transform,
    props: { ...props, autoName: true },
    anim,
  });
}

// A text draw on one frame: where in the code it came from (`key`), and whether it shows at all.
type Draw = Sample & { key: string; vis: boolean };

const LINK_SHARE = 0.8;

// Copies of the same words drawn together: layers (by the words they draw on each frame) that are on
// screen together for most of each one's life, saying the same thing on every frame they share (a
// shadow under its word, an outline, stacked strobe copies). Returns the groups of two or more.
export function linkGroups(texts: Map<number, string>[]): number[][] {
  const parent = texts.map((_, k) => k);
  const root = (k: number): number => (parent[k] === k ? k : (parent[k] = root(parent[k])));
  const buckets = new Map<string, number[]>();
  texts.forEach((m, k) => {
    const id = [...new Set(m.values())].sort().join("\u0000");
    buckets.set(id, [...(buckets.get(id) ?? []), k]);
  });
  for (const ks of buckets.values()) {
    for (let x = 0; x < ks.length; x++) {
      for (let y = x + 1; y < ks.length; y++) {
        const a = texts[ks[x]], b = texts[ks[y]];
        let shared = 0, same = true;
        for (const [i, s] of a) {
          const o = b.get(i);
          if (o === undefined) continue;
          if (o !== s) {
            same = false;
            break;
          }
          shared++;
        }
        if (same && shared >= LINK_SHARE * a.size && shared >= LINK_SHARE * b.size) parent[root(ks[y])] = root(ks[x]);
      }
    }
  }
  const groups = new Map<number, number[]>();
  texts.forEach((_, k) => groups.set(root(k), [...(groups.get(root(k)) ?? []), k]));
  return [...groups.values()].filter((g) => g.length > 1);
}

// A link left with one layer (its copies stayed in code) links nothing.
export function pruneLinks(layers: LayerT[]): LayerT[] {
  const count = new Map<unknown, number>();
  for (const l of layers) if (typeof l.props.linkId === "string") count.set(l.props.linkId, (count.get(l.props.linkId) ?? 0) + 1);
  return layers.map((l) => {
    if (typeof l.props.linkId !== "string" || count.get(l.props.linkId)! > 1) return l;
    const props = { ...l.props };
    delete props.linkId;
    return { ...l, props };
  });
}

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const meet = (a: Box, b: Box): Box => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

// A paint, told from others across frames by its call, colour and size (in steps of about 9%), not its
// place: a card is the same card wherever it slides, a full-frame grain the same grain however it shakes.
const step = (x: number) => Math.round(Math.log2(Math.max(1, x)) * 8);
export const paintKey = (box: Box | null, p: Paint) => `${p.kind}|${p.style}|${box ? `${step(box.x1 - box.x0)}x${step(box.y1 - box.y0)}` : "*"}`;

// Frames to pixel-check where the code paints over its text. `cover`: frame → paint (paintKey) → how much
// text it may cover there, weighted by how opaque it paints. Each paint is followed through each stretch
// of frames it covers text on: a stretch shorter than `brief` frames (the spacing of the regular samples,
// which can miss it) has every frame checked; a longer one its first frame and the one it covers most (the
// samples see the rest). Past `cap` frames, brief stretches go first, then the frames covered most, so a
// faint overlay painted on every frame (grain, a vignette) doesn't crowd out a card shown for two.
export function coveredFrames(cover: Map<number, Map<string, number>>, cap: number, brief: number): number[] {
  type Stretch = { from: number; last: number; peak: number; most: number; seen: [number, number][] };
  const done: Stretch[] = [];
  const open = new Map<string, Stretch>();
  for (const i of [...cover.keys()].sort((a, b) => a - b)) {
    for (const [key, st] of open) {
      if (st.last >= i - 1) continue;
      done.push(st);
      open.delete(key);
    }
    for (const [key, a] of cover.get(i)!) {
      if (!(a > 0)) continue;
      let st = open.get(key);
      if (!st) open.set(key, (st = { from: i, last: i, peak: i, most: a, seen: [] }));
      st.last = i;
      st.seen.push([i, a]);
      if (a > st.most) [st.peak, st.most] = [i, a];
    }
  }
  done.push(...open.values());
  // [frame, tier, weight]: brief stretches' frames first, then the most covered.
  const picks: [number, number, number][] = [];
  for (const st of done) {
    if (st.last - st.from + 1 < brief) for (const [i, a] of st.seen) picks.push([i, 0, a]);
    else picks.push([st.peak, 1, st.most], [st.from, 1, st.most]);
  }
  picks.sort((x, y) => x[1] - y[1] || y[2] - x[2] || x[0] - y[0]);
  const out = new Set<number>();
  for (const [i] of picks) {
    if (out.size >= cap) break;
    out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

// Most paints over one piece of text in one frame told apart (grain can be hundreds of specks).
const MAX_PAINTS = 64;

// Record a code layer's text over its whole span and propose the layers it becomes (paint order),
// plus the strings that must stay in the code. Text that is ever drawn with an effect a layer
// can't reproduce (gradient, glow, clip, blend, shadow, skew) stays in code entirely, every copy of
// it: stacked copies (extrusions, chromatic ghosts) only look right in their original paint order.
// So does text set glyph by glyph, text on screen for only a few frames, and, past the size caps,
// the text with the most keys. Draws that leave no pixel (text measured at alpha 0) make no layer of
// their own, but carry a layer on through the moments its text is off (a blink, a strobe).
// The scene runs by its own clock, as playback runs it: scene time sceneIn at the clip's start (offset),
// over a scene sceneT long (by default 0 and T, the clip's length).
// It also notes the frames where the code paints over text after drawing it, for verifySplit to check.
export async function extractText(
  code: string,
  W: number,
  H: number,
  T: number,
  fps: number,
  kit: Kit,
  assets: Assets,
  offset = 0,
  opts: { pace?: Pace; onProgress?: (k: number) => void; sceneIn?: number; sceneT?: number } = {},
): Promise<Candidates> {
  const pace = opts.pace ?? (async () => {});
  const scene = compileScene(code);
  const sceneIn = opts.sceneIn ?? 0;
  const sceneT = opts.sceneT && opts.sceneT > 0 ? opts.sceneT : T;
  // Only the canvas state matters here (transforms, alpha, fonts), so a small canvas keeps the
  // painting cheap; the scene still lays out for the full W × H.
  const c = document.createElement("canvas");
  c.width = c.height = 200;
  const ctx = c.getContext("2d")!;
  const frames: Draw[][] = []; // per frame, the movable text that shows, in paint order
  const offs: Draw[][] = []; // per frame, the movable text drawn that leaves no pixel
  const keep = new Set<string>();
  // Per frame, the text the code painted over afterwards, with what painted over it and how much.
  const covers = new Map<number, Map<Draw, Map<string, number>>>();
  const n = Math.max(1, Math.round(T * fps));
  for (let i = 0; i < n; i++) {
    const t = sceneIn + i / fps;
    const seen = new Map<string, number>();
    const glyphs = new Map<string, number>();
    const drawn: Draw[] = [];
    const off: Draw[] = [];
    frames.push(drawn);
    offs.push(off);
    const of = new Map<TextDraw, Draw>();
    const boxes: { s: Draw; box: Box }[] = [];
    const covered = new Map<Draw, Map<string, number>>();
    // The scene starts at the origin, as it does on its own; the tap goes on there.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, c.width, c.height);
    const tap = tapText(
      ctx,
      kit,
      (d, movable) => {
        const vis = !invisible(d);
        if (!movable) {
          if (vis) keep.add(d.str);
          return "draw";
        }
        // Which copy from its place in the code this is, counting only text that shows.
        const occ = seen.get(d.site) ?? 0;
        const s: Draw = { i, d, key: `${d.site}#${occ}`, vis };
        if (!vis) {
          off.push(s);
          return "draw";
        }
        seen.set(d.site, occ + 1);
        if (d.str.trim().length <= 1) glyphs.set(d.site, (glyphs.get(d.site) ?? 0) + 1);
        drawn.push(s);
        of.set(d, s);
        return "draw";
      },
      {
        drawn: (d, box) => {
          const s = of.get(d);
          if (s) boxes.push({ s, box });
        },
        armed: () => boxes.length > 0,
        paint: (box, what) => {
          const alpha = Math.min(1, Math.max(0, what.alpha));
          if (!(alpha > 0)) return;
          const key = paintKey(box, what);
          for (const b of boxes) {
            const a = area(box ? meet(b.box, box) : b.box) * alpha;
            if (!(a > 0)) continue;
            let m = covered.get(b.s);
            if (!m) covered.set(b.s, (m = new Map()));
            if (a > (m.get(key) ?? 0) && (m.size < MAX_PAINTS || m.has(key))) m.set(key, a);
          }
        },
      },
    );
    try {
      scene(ctx, W, H, t, sceneT, sceneT > 0 ? Math.min(1, Math.max(0, t / sceneT)) : 0, tap.lib, assets);
    } finally {
      tap.restore();
      ctx.restore();
    }
    for (const s of drawn) if (s.d.str.trim().length <= 1 && (glyphs.get(s.d.site) ?? 0) >= GLYPHS) keep.add(s.d.str);
    if (covered.size) covers.set(i, covered);
    opts.onProgress?.((0.8 * (i + 1)) / n);
    await pace();
  }
  // Follow each piece of text from frame to frame: it continues its layer when it comes from the
  // same place in the code, or is the same words near the same spot (a word reveal that settles
  // into plain text stays one layer). Text that disappears and comes back starts a new layer; text
  // drawn where it leaves no pixel only carries a layer on (a blink's off frames, a fade from nothing).
  const kindOk = (a: TextDraw["kind"], b: TextDraw["kind"]) => a === b || (a !== "raw" && b !== "raw" && (a === "text" || b === "text"));
  let runs: Draw[][] = [];
  const index = new Map<Draw[], number>();
  const runOf = new Map<Draw, number>();
  const order: number[][] = []; // per frame, the runs in the order their text was painted
  let active: Draw[][] = [];
  for (let f = 0; f < frames.length; f++) {
    const next: typeof active = [];
    const free = new Set(active);
    const painted: number[] = [];
    // Text that shows first, so a measuring draw at alpha 0 doesn't take the run of the words it measures.
    for (const s of [...frames[f], ...offs[f]]) {
      if (keep.has(s.d.str)) continue;
      // Best match: same words from the same code, then same words nearby, then the same code
      // with words that evolve (typing, a counter's digits).
      let best: (typeof active)[number] | null = null;
      let rank = 4;
      for (const run of free) {
        const last = run[run.length - 1];
        if (!kindOk(last.d.kind, s.d.kind)) continue;
        const same = last.d.str === s.d.str;
        const r =
          same && last.key === s.key ? 1
          : same && Math.hypot(last.d.m.e - s.d.m.e, last.d.m.f - s.d.m.f) < 0.25 * Math.max(W, H) ? 2
          : last.key === s.key && evolves(last.d.str, s.d.str) ? 3
          : 4;
        if (r < rank) [best, rank] = [run, r];
      }
      let run = best;
      if (run) {
        free.delete(run);
        run.push(s);
      } else {
        run = [s];
        index.set(run, runs.length);
        runs.push(run);
      }
      next.push(run);
      if (s.vis) {
        painted.push(index.get(run)!);
        runOf.set(s, index.get(run)!);
      }
    }
    order.push(painted);
    active = next;
    await pace();
  }
  // A layer lasts from the first frame its text shows to the last (text that never shows makes none).
  // While it's off in between, it holds its look at opacity 0.
  runs = runs.map((run) => {
    const a = run.findIndex((s) => s.vis);
    if (a < 0) return [];
    let b = run.length - 1;
    while (!run[b].vis) b--;
    const out = run.slice(a, b + 1);
    let shown = out[0];
    return out.map((s) => (s.vis ? (shown = s) : { ...s, d: { ...s.d, alpha: 0, o: shown.d.o } }));
  });

  const strs = runs.map((run) => new Set(run.filter((s) => s.vis).map((s) => s.d.str)));
  const { dropped, drop } = dropper(strs, keep);
  runs.forEach((run, k) => {
    if (run.length < MIN_FRAMES) drop(k);
  });
  const built = new Map<number, LayerT>();
  for (let k = 0; k < runs.length; k++) {
    if (dropped.has(k)) continue;
    built.set(k, layerFrom(runs[k], fps, offset, offset + T));
    opts.onProgress?.(0.8 + (0.2 * (k + 1)) / runs.length);
    await pace();
  }
  // Size caps: past MAX_KEYS the text with the most keys stays in code, past MAX_LAYERS the shortest-lived.
  const keys = new Map([...built].map(([k, l]) => [k, 1 + Object.values(l.anim).reduce((m, ks) => m + ks.length, 0)]));
  const alive = () => [...built.keys()].filter((k) => !dropped.has(k));
  let total = alive().reduce((m, k) => m + keys.get(k)!, 0);
  for (const k of alive().sort((a, b) => keys.get(b)! - keys.get(a)!)) {
    if (total <= MAX_KEYS) break;
    if (!dropped.has(k)) for (const j of drop(k)) total -= keys.get(j) ?? 0;
  }
  let count = alive().length;
  for (const k of alive().sort((a, b) => runs[a].length - runs[b].length)) {
    if (count <= MAX_LAYERS) break;
    if (!dropped.has(k)) count -= drop(k).length;
  }

  const ids = paintOrder(alive(), order);
  const layers = ids.map((k) => built.get(k)!);
  const shows = (k: number) => new Map(runs[k].filter((s) => s.vis).map((s) => [s.i, s.d.str]));
  for (const g of linkGroups(ids.map(shows))) {
    const link = newId("link");
    for (const j of g) layers[j].props.linkId = link;
  }
  // Where art covers a layer's text, however briefly: worth a pixel check besides the regular samples.
  const on = new Set(ids);
  const cover = new Map<number, Map<string, number>>();
  for (const [i, covered] of covers) {
    const most = new Map<string, number>();
    for (const [s, paints] of covered) {
      if (!on.has(runOf.get(s) ?? -1)) continue;
      for (const [key, a] of paints) if (a > (most.get(key) ?? 0)) most.set(key, a);
    }
    if (most.size) cover.set(i, most);
  }
  return {
    layers,
    strs: ids.map((k) => strs[k]),
    frames: ids.map((k) => new Map(runs[k].map((s) => [s.i, s.d.alpha]))),
    keep,
    check: coveredFrames(cover, Math.max(MIN_CHECKS, Math.ceil(n / 6)), sampleEvery(fps)),
  };
}

export type SplitOptions = { onProgress?: (k: number) => void; signal?: AbortSignal };
// What splitting one code layer comes to: the code layer's new name and split state, and its text layers.
export type SplitResult = { name: string; props: Record<string, unknown>; layers: LayerT[] };

// Split one code layer's text into layers. Throws if the scene throws, it takes too long, or it's aborted.
// The scene is recorded by its own clock (a trimmed or time-split code layer shows a stretch of its scene),
// and the split notes the stretch it covers (props.splitSpan): past it, the code paints its own text.
export async function splitCodeLayer(doc: DocT, layer: LayerT, kit: Kit, assets: Assets, opts: SplitOptions = {}): Promise<SplitResult> {
  const slice = pacer(opts.signal);
  const started = performance.now();
  const pace: Pace = async () => {
    await slice();
    if (performance.now() - started > BUDGET_MS) throw new Error("Splitting this film's text took too long.");
  };
  const code = String(layer.props.code ?? "");
  const { w: W, h: H } = doc.meta.size;
  const T = layer.end - layer.start;
  const { sceneIn, sceneT } = sceneClock(layer.props, layer.start, layer.end);
  const cand = await extractText(code, W, H, T, doc.meta.fps, kit, assets, layer.start, {
    pace,
    onProgress: (k) => opts.onProgress?.(0.35 * k),
    sceneIn,
    sceneT,
  });
  // Split text belongs to its code layer (it follows the layer's transform, visibility and code).
  cand.layers = cand.layers.map((l) => ({ ...l, props: { ...l.props, splitFrom: layer.id } }));
  const v = await verifySplit(doc, layer, cand, kit, assets, { pace, onProgress: (k) => opts.onProgress?.(0.35 + 0.65 * k) });
  opts.onProgress?.(1);
  if (!v.layers.length) return { name: layer.name, props: { textSplit: false }, layers: [] };
  return {
    name: "Artwork (code)",
    props: { skipText: true, keepText: [...v.keep], splitHash: codeHash(code), splitSpan: splitSpanOf(layer) },
    layers: pruneLinks(v.layers),
  };
}

// Every code layer not yet split gets its text pulled out into layers painted just above it.
// A layer whose split fails (the scene throws, or it takes too long) is marked textSplit: false,
// so it opens as plain code from then on instead of being retried on every load.
export async function splitDocText(doc: DocT, kit: Kit, assets: Assets, opts: SplitOptions = {}): Promise<DocT> {
  const todo = doc.layers.filter((l) => l.type === "code" && !l.props.skipText && l.props.textSplit !== false);
  if (!todo.length) return doc;
  const weight = (l: LayerT) => Math.max(0.1, l.end - l.start);
  const total = todo.reduce((m, l) => m + weight(l), 0);
  let done = 0;
  const out: LayerT[] = [];
  for (const l of doc.layers) {
    if (!todo.includes(l)) {
      out.push(l);
      continue;
    }
    const w = weight(l) / total;
    try {
      const r = await splitCodeLayer(doc, l, kit, assets, { signal: opts.signal, onProgress: (k) => opts.onProgress?.(done + k * w) });
      out.push({ ...l, name: r.name, props: { ...unsplit(l.props), ...r.props } }, ...r.layers);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      out.push({ ...l, props: { ...unsplit(l.props), textSplit: false } });
    }
    done += w;
  }
  return Doc.parse({ ...doc, layers: out });
}

// Put a fresh split of a code layer in place of its old one (an undoable edit): its old text layers
// go, the new ones go just above it. Does nothing if the code changed again while it was being split.
export const applySplit =
  (layerId: string, code: string, r: SplitResult): Op =>
  (doc) => {
    const l = doc.layers.find((x) => x.id === layerId);
    if (!l || String(l.props.code ?? "") !== code) return;
    l.name = r.name;
    l.props = { ...unsplit(l.props), ...r.props };
    doc.layers = doc.layers.filter((x) => x.props.splitFrom !== layerId);
    doc.layers.splice(doc.layers.findIndex((x) => x.id === layerId) + 1, 0, ...r.layers);
  };
