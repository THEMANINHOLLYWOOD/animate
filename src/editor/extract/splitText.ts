// Split a code layer's text into native, editable text layers.
// The scene is played once, frame by frame, with its text draws recorded (textTap);
// each piece of text becomes a layer whose position, scale, rotation, opacity,
// reveal and copy are keyframed from what was drawn, thinned to the keys that matter.
// The code layer is marked skipText, so it keeps painting everything else.

import { compileScene, type Assets } from "@/lib/engine";
import type { Kit } from "@/lib/kit";
import { Doc, Layer, newId, type Doc as DocT, type Keyframe, type Layer as LayerT, type Value } from "../doc/schema";
import { tapText, type TextDraw } from "./textTap";

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

const TOL: Record<string, number> = {
  "transform.x": 0.5,
  "transform.y": 0.5,
  "transform.rotation": 0.1,
  "transform.scale": 0.002,
  "transform.opacity": 0.01,
  "props.reveal": 0.004,
};

function decompose(m: TextDraw["m"]) {
  const sx = Math.hypot(m.a, m.b) || 1e-9;
  return { x: m.e, y: m.f, rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI, scale: [sx, (m.a * m.d - m.b * m.c) / sx] };
}

const pxOf = (font: string) => Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 48);
const label = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return `“${t.length > 28 ? t.slice(0, 27) + "…" : t}”`;
};

function layerFrom(run: Sample[], fps: number, offset: number, end: number): LayerT {
  const first = run.find((s) => s.d.kind === "words" || s.d.kind === "typewriter")?.d ?? run[0].d;
  const t0 = run[0].i / fps;
  const times = run.map((s) => s.i / fps - t0);
  const tr = run.map((s) => decompose(s.d.m));
  const anim: Record<string, Keyframe[]> = {};
  const transform: Record<string, unknown> = { anchor: [0, 0] };
  const props: Record<string, unknown> = {};

  const put = (path: string, values: Value[]) => {
    const r = track(times, values, TOL[path] ?? 0);
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

  const start = offset + t0;
  return Layer.parse({
    id: newId("text"),
    // Counters and typed text are named by what they end on.
    name: label(run[run.length - 1].d.str),
    type: "text",
    start,
    end: Math.min(end, offset + run[run.length - 1].i / fps + 1 / fps),
    transform,
    props,
    anim,
  });
}

// Text that changes but is still the same thing on screen: being typed, or a number counting.
export const evolves = (a: string, b: string) => a.startsWith(b) || b.startsWith(a) || a.replace(/[\d.,\s]/g, "") === b.replace(/[\d.,\s]/g, "");

// Record a code layer's text over its whole span and return the layers it becomes (paint order kept),
// plus the strings that must stay in the code. Text that is ever drawn with an effect a layer
// can't reproduce (gradient, glow, clip, blend) stays in code entirely, every copy of it:
// stacked copies (extrusions, chromatic ghosts) only look right in their original paint order.
export function extractText(code: string, W: number, H: number, T: number, fps: number, kit: Kit, assets: Assets, offset = 0): { layers: LayerT[]; keep: string[] } {
  const scene = compileScene(code);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const frames: (Sample & { key: string })[][] = [];
  const keep = new Set<string>();
  const n = Math.max(1, Math.round(T * fps));
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const seen = new Map<string, number>();
    const drawn: (Sample & { key: string })[] = [];
    frames.push(drawn);
    const tap = tapText(ctx, kit, (d, movable) => {
      if (!movable) {
        keep.add(d.str);
        return "draw";
      }
      const occ = seen.get(d.site) ?? 0;
      seen.set(d.site, occ + 1);
      drawn.push({ i, d, key: `${d.site}#${occ}` });
      return "draw";
    });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    try {
      scene(ctx, W, H, t, T, Math.min(1, t / T), tap.lib, assets);
    } finally {
      ctx.restore();
      tap.restore();
    }
  }
  // Follow each piece of text from frame to frame: it continues its layer when it comes from the
  // same place in the code, or is the same words near the same spot (a word reveal that settles
  // into plain text stays one layer). Text that disappears and comes back starts a new layer.
  const kindOk = (a: TextDraw["kind"], b: TextDraw["kind"]) => a === b || (a !== "raw" && b !== "raw" && (a === "text" || b === "text"));
  const runs: (Sample & { key: string })[][] = [];
  let active: (Sample & { key: string })[][] = [];
  for (const drawn of frames) {
    const next: typeof active = [];
    const free = new Set(active);
    for (const s of drawn) {
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
      if (best) {
        free.delete(best);
        best.push(s);
        next.push(best);
      } else {
        const run = [s];
        runs.push(run);
        next.push(run);
      }
    }
    active = next;
  }
  return { layers: runs.map((run) => layerFrom(run, fps, offset, offset + T)), keep: [...keep] };
}

// The playback rule matching extraction: skip a movable draw unless its text stays in code.
export const skipRule = (keep: string[]) => {
  const set = new Set(keep);
  return (d: TextDraw, movable: boolean): "skip" | "draw" => (movable && !set.has(d.str) ? "skip" : "draw");
};

// Every code layer not yet split gets its text pulled out into layers painted just above it.
export function splitDocText(doc: DocT, kit: Kit, assets: Assets): DocT {
  const out: LayerT[] = [];
  let changed = false;
  for (const l of doc.layers) {
    if (l.type !== "code" || l.props.skipText || l.props.textSplit === false) {
      out.push(l);
      continue;
    }
    let split: ReturnType<typeof extractText>;
    try {
      split = extractText(String(l.props.code ?? ""), doc.meta.size.w, doc.meta.size.h, l.end - l.start, doc.meta.fps, kit, assets, l.start);
    } catch {
      out.push(l);
      continue;
    }
    changed = true;
    out.push({ ...l, name: split.layers.length ? "Artwork (code)" : l.name, props: { ...l.props, skipText: true, keepText: split.keep } }, ...split.layers);
  }
  return changed ? Doc.parse({ ...doc, layers: out }) : doc;
}
