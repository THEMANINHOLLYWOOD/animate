// Check a text split against the original, by pixels, so a split film renders like the code did.
// At sampled frames (regular ones, plus the frames extraction saw art painted over text, however briefly)
// the original code layer and the split (the code skipping its text, plus the text layers) are rendered
// at full size the way export renders them, and compared inside each text layer's bounds. A layer that
// doesn't match (art the code paints later covers its text, an effect a layer can't replay, paint order
// among overlapping text…) goes back to the code with every layer sharing its copy, and the frames it
// touched are checked again, until nothing changes. Text the split's code leaves to its layers on a frame
// where none of them paints it (extraction saw it elsewhere, or not at all) fails the same way.

import { Renderer, type Assets } from "@/lib/engine";
import type { Kit } from "@/lib/kit";
import type { Doc, Layer } from "../doc/schema";
import { renderDoc, type Bounds } from "../render/renderDoc";
import { sceneClock, splitKey, unsplit } from "./codeHash";
import { dropper } from "./keep";
import type { Pace } from "./pace";
import { invisible, type TextDraw } from "./textTap";

// What extraction proposes: text layers (paint order), the copy each one draws, the frames it was drawn
// on (with its alpha there), the text that stays in code regardless, and frames to check besides the
// regular samples (where the code paints over its text: a split's text paints above all of the code).
export type Candidates = { layers: Layer[]; strs: Set<string>[]; frames: Map<number, number>[]; keep: Set<string>; check: number[] };

const STEP = 0.25; // seconds between sampled frames (plus each layer's first and last frame)
// Frames between the regular samples.
export const sampleEvery = (fps: number) => Math.max(1, Math.round(STEP * fps));
// The stretch of a code layer's scene (scene time) that a split of it now covers: its clip's.
export const splitSpanOf = (layer: Layer): [number, number] => {
  const { sceneIn } = sceneClock(layer.props, layer.start, layer.end);
  return [sceneIn, sceneIn + (layer.end - layer.start)];
};
const PASSES = 4;
const THRESH = 48; // summed RGBA difference for a pixel to count as changed
const SHARE = 0.01; // a layer fails when more of its region than this changed…
const MIN_BAD = 12; // …and at least this many pixels,
const MAX_OK = 1500; // or when this many changed, however big its region (anti-aliasing comes to under 100)

// Whether a layer's region of w × h pixels, `bad` of them changed, still matches.
export const matches = (bad: number, w: number, h: number) => bad <= MIN_BAD || (bad <= SHARE * w * h && bad <= MAX_OK);

// Pixels in a region of two same-sized RGBA buffers (stride × rows) that differ by more than `thr`,
// summed over channels. Anti-aliasing is forgiven: a pixel only counts when it also lies outside the
// range of the other image's 3×3 neighbourhood, so text off by under a pixel doesn't count.
export function changedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, stride: number, rows: number, x0: number, y0: number, w: number, h: number, thr = THRESH): number {
  const outside = (p: Uint8ClampedArray, q: Uint8ClampedArray, x: number, y: number) => {
    const o = (y * stride + x) * 4;
    let e = 0;
    for (let c = 0; c < 4; c++) {
      let lo = 255, hi = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(rows - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(stride - 1, x + 1); xx++) {
          const v = q[(yy * stride + xx) * 4 + c];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const v = p[o + c];
      e += v < lo ? lo - v : v > hi ? v - hi : 0;
    }
    return e;
  };
  let bad = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const o = (y * stride + x) * 4;
      const d = Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) + Math.abs(a[o + 3] - b[o + 3]);
      if (d > thr && (outside(b, a, x, y) > thr || outside(a, b, x, y) > thr)) bad++;
    }
  }
  return bad;
}

export async function verifySplit(
  doc: Doc,
  layer: Layer,
  cand: Candidates,
  kit: Kit,
  assets: Assets,
  opts: { pace: Pace; onProgress?: (k: number) => void },
): Promise<{ layers: Layer[]; keep: Set<string> }> {
  const { w: W, h: H } = doc.meta.size;
  const fps = doc.meta.fps;
  const n = Math.max(1, Math.round((layer.end - layer.start) * fps));
  const keep = new Set(cand.keep);
  const { dropped, drop } = dropper(cand.strs, keep);
  const giveUp = () => {
    cand.strs.forEach((set) => set.forEach((s) => keep.add(s)));
    return { layers: [], keep };
  };

  // The code layer on its own, at the origin: split layers follow its transform, opacity, blend and
  // visibility when rendered, so this is the composition that has to match.
  const base: Layer = {
    ...layer,
    parentId: null,
    hidden: false,
    blend: "normal",
    transform: { ...layer.transform, x: 0, y: 0, rotation: 0, scale: [1, 1], opacity: 1 },
    anim: Object.fromEntries(Object.entries(layer.anim).filter(([path]) => !path.startsWith("transform."))),
    props: unsplit(layer.props),
  };
  const docA: Doc = { ...doc, layers: [base] };

  const canvas = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c.getContext("2d")!;
  };
  const ca = canvas(), cb = canvas();
  const ra = new Renderer(ca, W, H, kit.F), rb = new Renderer(cb, W, H, kit.F);
  const T = doc.meta.duration;

  // Frames to look at: every STEP seconds, each layer's first and last frame, and where art covers text.
  const range = cand.frames.map((f) => {
    let a = Infinity, b = -Infinity;
    for (const i of f.keys()) [a, b] = [Math.min(a, i), Math.max(b, i)];
    return [a, b] as const;
  });
  const sampled = new Set<number>([n - 1]);
  for (let i = 0; i < n; i += sampleEvery(fps)) sampled.add(i);
  range.forEach(([a, b]) => sampled.add(a).add(b));
  for (const i of cand.check) if (i >= 0 && i < n) sampled.add(i);
  const all = [...sampled].sort((x, y) => x - y);
  let todo = all;
  const planned = all.length * 1.2;
  let checked = 0;
  // Text the code skipped that no layer was found for: kept in code, once. Should it happen again (text
  // that differs from one run of the scene to the next), the split can't hold and all of it stays in code.
  let strayed = false;

  for (let pass = 0; pass < PASSES; pass++) {
    const live = cand.layers.map((_, k) => k).filter((k) => !dropped.has(k));
    if (!live.length) return { layers: [], keep };
    const docB: Doc = {
      ...doc,
      layers: [{ ...base, props: { ...base.props, skipText: true, keepText: [...keep], splitHash: splitKey(base.props), splitSpan: splitSpanOf(layer) } }, ...live.map((k) => cand.layers[k])],
    };
    const failed = new Set<number>();
    let stray = false;
    for (const i of todo) {
      const on = live.filter((k) => range[k][0] <= i && i <= range[k][1]);
      const t = layer.start + i / fps;
      let bounds: Record<string, Bounds> = {};
      const skipped = new Map<string, number>();
      const onTextSkipped = (_l: Layer, d: TextDraw) => {
        if (!invisible(d)) skipped.set(d.str, (skipped.get(d.str) ?? 0) + 1);
      };
      rb.draw((ctx, _W, _H, tt, _T, _p, lib, as) => void (bounds = renderDoc(ctx, docB, tt, lib, as, { onTextSkipped })), t, T, assets);
      await opts.pace();
      // Every copy of the words the code skipped here needs a layer of them on this frame.
      for (const [s, copies] of skipped) {
        const by = live.filter((k) => cand.strs[k].has(s));
        if (by.filter((k) => (cand.frames[k].get(i) ?? 0) > 0.002).length >= copies) continue;
        if (by.length) by.forEach((k) => failed.add(k));
        else {
          keep.add(s);
          stray = true;
        }
      }
      if (!on.length) {
        opts.onProgress?.(Math.min(1, ++checked / planned));
        continue;
      }
      ra.draw((ctx, _W, _H, tt, _T, _p, lib, as) => void renderDoc(ctx, docA, tt, lib, as), t, T, assets);
      await opts.pace();

      const regions: { k: number; x: number; y: number; w: number; h: number }[] = [];
      for (const k of on) {
        const b = bounds[cand.layers[k].id];
        if (!b) {
          // The code drew this text here, but its layer doesn't show.
          if ((cand.frames[k].get(i) ?? 0) > 0.002) failed.add(k);
          continue;
        }
        const pad = Math.ceil(4 + 0.2 * Math.min(b.h, 200));
        const x = Math.max(0, Math.floor(b.x - pad)), y = Math.max(0, Math.floor(b.y - pad));
        const x1 = Math.min(W, Math.ceil(b.x + b.w + pad)), y1 = Math.min(H, Math.ceil(b.y + b.h + pad));
        if (x1 > x && y1 > y) regions.push({ k, x, y, w: x1 - x, h: y1 - y });
      }
      if (regions.length) {
        const ux = Math.min(...regions.map((r) => r.x)), uy = Math.min(...regions.map((r) => r.y));
        const uw = Math.max(...regions.map((r) => r.x + r.w)) - ux, uh = Math.max(...regions.map((r) => r.y + r.h)) - uy;
        const a = ca.getImageData(ux, uy, uw, uh).data, b = cb.getImageData(ux, uy, uw, uh).data;
        for (const r of regions) {
          if (failed.has(r.k)) continue;
          const bad = changedPixels(a, b, uw, uh, r.x - ux, r.y - uy, r.w, r.h);
          if (!matches(bad, r.w, r.h)) failed.add(r.k);
        }
      }
      opts.onProgress?.(Math.min(1, ++checked / planned));
      await opts.pace();
    }
    if (stray && strayed) return giveUp();
    strayed ||= stray;
    if (!failed.size && !stray) return { layers: live.map((k) => cand.layers[k]), keep };
    if (pass === PASSES - 1) break;
    // Next pass: the frames where a layer just dropped was on screen, since the code paints its text
    // there now (every frame, when the code paints text no layer was found for).
    const gone = [...failed].flatMap((k) => drop(k));
    todo = stray ? all : all.filter((i) => gone.some((k) => range[k][0] <= i && i <= range[k][1]));
    if (!todo.length) return { layers: cand.layers.filter((_, k) => !dropped.has(k)), keep };
  }
  // Still changing after the last pass: all of this layer's text stays in code.
  return giveUp();
}
