/* eslint-disable @typescript-eslint/no-explicit-any */
// Objects in a code scene. A scene wraps each thing it draws in lib.layer(ctx, name, draw), and the
// editor shows each as a layer of its own (type "part", belonging to its code layer by props.partOf
// and named by props.part): one that can be picked on the canvas, moved, scaled, turned, faded,
// hidden and trimmed, while the code goes on drawing it.
// Playback still runs the scene once. At each lib.layer call the part's transform and opacity are
// applied in the space the scene is drawing in at that moment (so a part under a camera moves with
// it), or the block runs with painting switched off (hidden, outside its clip, deleted).

import { produce } from "immer";
import { controlsSet, declaredControls, withControls, type ControlDef } from "@/lib/controls";
import { compileScene, type Assets, type SceneFn } from "@/lib/engine";
import type { Kit } from "@/lib/kit";
import type { Op } from "../doc/ops";
import { Layer as LayerSchema, newId, type Doc, type Layer } from "../doc/schema";
import { codeHash, sceneClock } from "./codeHash";
import { pacer } from "./pace";

export type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };
// A box on the canvas: [x0, x1] × [y0, y1].
export type PartBox = { x0: number; y0: number; x1: number; y1: number };

// How a part is drawn on a frame: moved by (x, y), scaled and turned about its centre, faded.
export type PartState = { x: number; y: number; scale: [number, number]; rotation: number; opacity: number; blend?: string };
// What a part did on a frame: where it painted (null: nothing), and the space it was drawn in.
export type PartSeen = { box: PartBox | null; entry: Mat };

const matOf = (m: { a: number; b: number; c: number; d: number; e: number; f: number }): Mat => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
export function invert(m: Mat): Mat | null {
  const det = m.a * m.d - m.b * m.c;
  if (!(Math.abs(det) > 1e-12)) return null;
  const a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}
const at = (m: Mat, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

const identity = (s: PartState) => !s.x && !s.y && s.scale[0] === 1 && s.scale[1] === 1 && !s.rotation;
// Whether a part's scale or turn needs its centre (a plain move doesn't).
export const pivoted = (s: PartState) => s.scale[0] !== 1 || s.scale[1] !== 1 || !!s.rotation;

const TRANSFORM_FNS = ["translate", "rotate", "scale", "transform", "setTransform", "resetTransform"] as const;

// Painting switched off for everything fn draws (its layout, loops and variables still run).
export function muted(ctx: CanvasRenderingContext2D, fn: () => void) {
  ctx.save();
  try {
    if (typeof Path2D !== "undefined") ctx.clip(new Path2D());
    else {
      ctx.beginPath();
      ctx.rect(0, 0, 0, 0);
      ctx.clip();
    }
    fn();
  } finally {
    ctx.restore();
  }
}

export type PartsOptions = {
  // The part's state on this frame; "mute" to run it without painting; null to draw it as the code does.
  state?: (name: string) => PartState | "mute" | null;
  // Record where each part paints (the editor's selection boxes; finding parts and their centres).
  track?: boolean;
  // Each part's centre on this frame as the code draws it (canvas space), for scaling and turning about it.
  pivots?: Map<string, [number, number]>;
};

// A layer's fade, held through whatever its code does to alpha: an alpha the code sets outright
// (ctx.globalAlpha = k, where `*=` would have kept the fade) is still multiplied by the layer's, and
// the code reads back the alpha it set. Returns what lets go of it (before the state is restored).
// On a canvas whose alpha can't be watched (or already is), the fade is applied once, on entry.
function holdAlpha(ctx: CanvasRenderingContext2D, k: number): () => void {
  let acc: PropertyDescriptor | undefined;
  for (let p = Object.getPrototypeOf(ctx); p && !acc?.set; p = Object.getPrototypeOf(p)) acc = Object.getOwnPropertyDescriptor(p, "globalAlpha");
  if (!acc?.get || !acc.set || Object.getOwnPropertyDescriptor(ctx, "globalAlpha")) {
    ctx.globalAlpha *= k;
    return () => {};
  }
  const get = () => acc!.get!.call(ctx) as number, set = (v: number) => acc!.set!.call(ctx, v);
  let inner = get();
  set(inner * k);
  Object.defineProperty(ctx, "globalAlpha", {
    configurable: true,
    enumerable: true,
    // (Read from the canvas, so an alpha the code's own save/restore brought back is the one it sees.)
    get: () => (k > 0 ? Math.min(1, get() / k) : inner),
    set: (v: unknown) => {
      if (typeof v !== "number" || !(v >= 0 && v <= 1)) return;
      inner = v;
      set(v * k);
    },
  });
  return () => void delete (ctx as { globalAlpha?: number }).globalAlpha;
}

// The kit with lib.layer acting on parts. Install where the scene starts; call `restored` after any
// ctx.restore() the scene makes when tracking (renderDoc's balanced() does), then `restore` at the end.
export function tapParts(ctx: CanvasRenderingContext2D, kit: Kit, opts: PartsOptions = {}) {
  const seen = new Map<string, PartSeen>();
  const order: string[] = [];
  const undo: (() => void)[] = [];
  // The parts being drawn right now (nested blocks: the outer one holds what the inner one paints too).
  const open: PartSeen[] = [];
  let M: Mat | null = null;
  const now = () => (M ??= matOf(ctx.getTransform()));
  let path: PartBox | undefined;

  const add = (b: PartBox | undefined, by = 0) => {
    if (!b || !open.length || !(ctx.globalAlpha > 0.004)) return;
    for (const s of open) {
      const o = s.box;
      s.box = o
        ? { x0: Math.min(o.x0, b.x0 - by), y0: Math.min(o.y0, b.y0 - by), x1: Math.max(o.x1, b.x1 + by), y1: Math.max(o.y1, b.y1 + by) }
        : { x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by };
    }
  };
  const boxOf = (pts: number[]): PartBox => {
    const m = now();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = at(m, pts[i], pts[i + 1]);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  };
  const join = (a: PartBox | undefined, b: PartBox): PartBox => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b);
  const rectPts = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x, y + h, x + w, y + h];
  const strokeGrow = () => {
    const m = now();
    return (ctx.lineWidth / 2) * (Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1);
  };

  if (opts.track) {
    const wrap = (name: string, before: (...a: any[]) => void) => {
      const had = Object.getOwnPropertyDescriptor(ctx, name);
      const prev = (ctx as any)[name];
      if (typeof prev !== "function") return;
      Object.defineProperty(ctx, name, {
        configurable: true,
        writable: true,
        value(...a: any[]) {
          before(...a);
          return prev.apply(ctx, a);
        },
      });
      undo.push(() => {
        if (had) Object.defineProperty(ctx, name, had);
        else delete (ctx as any)[name];
      });
    };
    // The transform is read once per change, not once per point.
    for (const name of TRANSFORM_FNS) wrap(name, () => (M = null));
    const pt = (pts: number[]) => {
      if (open.length) path = join(path, boxOf(pts));
    };
    wrap("beginPath", () => (path = undefined));
    wrap("moveTo", (x, y) => pt([x, y]));
    wrap("lineTo", (x, y) => pt([x, y]));
    wrap("rect", (x, y, w, h) => pt(rectPts(x, y, w, h)));
    wrap("roundRect", (x, y, w, h) => pt(rectPts(x, y, w, h)));
    wrap("arc", (x, y, r) => pt(rectPts(x - r, y - r, 2 * r, 2 * r)));
    wrap("arcTo", (x1, y1, x2, y2) => pt([x1, y1, x2, y2]));
    wrap("ellipse", (x, y, rx, ry) => {
      const r = Math.max(Math.abs(rx), Math.abs(ry));
      pt(rectPts(x - r, y - r, 2 * r, 2 * r));
    });
    wrap("quadraticCurveTo", (cx, cy, x, y) => pt([cx, cy, x, y]));
    wrap("bezierCurveTo", (c1x, c1y, c2x, c2y, x, y) => pt([c1x, c1y, c2x, c2y, x, y]));
    wrap("fillRect", (x, y, w, h) => open.length && add(boxOf(rectPts(x, y, w, h))));
    wrap("strokeRect", (x, y, w, h) => open.length && add(boxOf(rectPts(x, y, w, h)), strokeGrow()));
    // A Path2D's extent isn't known.
    wrap("fill", (p) => !(p && typeof p === "object") && add(path));
    wrap("stroke", (p) => !(p && typeof p === "object") && open.length && add(path, strokeGrow()));
    // Text: its box from the font size and measured width, placed by alignment and baseline.
    const textBox = (str: unknown, x: number, y: number, maxWidth?: number) => {
      const size = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
      const w = Math.min(ctx.measureText(String(str)).width, maxWidth ?? Infinity);
      const al = ctx.textAlign, bl = ctx.textBaseline;
      const ax = al === "center" ? -w / 2 : al === "right" || al === "end" ? -w : 0;
      const top = (bl === "top" ? 0 : bl === "hanging" ? -0.1 : bl === "middle" ? -0.5 : bl === "bottom" || bl === "ideographic" ? -1 : -0.8) * size;
      return boxOf(rectPts(x + ax, y + top, w, size));
    };
    wrap("fillText", (str, x, y, mw) => open.length && add(textBox(str, x, y, mw)));
    wrap("strokeText", (str, x, y, mw) => open.length && add(textBox(str, x, y, mw), strokeGrow()));
    wrap("drawImage", (img, ...n: number[]) => {
      if (!open.length) return;
      const iw = Number(img?.videoWidth || img?.naturalWidth || img?.width) || 0, ih = Number(img?.videoHeight || img?.naturalHeight || img?.height) || 0;
      const [x, y, w, h] = n.length >= 8 ? n.slice(4, 8) : n.length >= 4 ? n : [n[0], n[1], iw, ih];
      add(boxOf(rectPts(x, y, w, h)));
    });
  }

  const lib: any = { ...kit };
  lib.layer = (c: CanvasRenderingContext2D, name: string, draw: () => void) => {
    if (c !== ctx || typeof draw !== "function") return (kit as any).layer(c, name, draw);
    const key = String(name);
    const st = opts.state?.(key) ?? null;
    if (st === "mute") return muted(ctx, draw);
    let s = seen.get(key);
    if (!s) {
      seen.set(key, (s = { box: null, entry: matOf(ctx.getTransform()) }));
      order.push(key);
    }
    ctx.save();
    let release: (() => void) | null = null;
    try {
      if (st) {
        if (!identity(st)) {
          // In the space the scene is drawing in: moved by (x, y), then scaled and turned about where
          // the code draws the part's centre.
          const inv = pivoted(st) ? invert(matOf(ctx.getTransform())) : null;
          const c0 = inv && opts.pivots?.get(key);
          ctx.translate(st.x, st.y);
          if (inv && c0) {
            const [px, py] = at(inv, c0[0], c0[1]);
            ctx.translate(px, py);
            ctx.rotate((st.rotation * Math.PI) / 180);
            ctx.scale(st.scale[0], st.scale[1]);
            ctx.translate(-px, -py);
          }
          M = null;
        }
        if (st.opacity !== 1) release = holdAlpha(ctx, Math.min(1, Math.max(0, st.opacity)));
        if (st.blend && st.blend !== "normal") ctx.globalCompositeOperation = (st.blend === "add" ? "lighter" : st.blend) as GlobalCompositeOperation;
      }
      const outerPath = path;
      path = undefined;
      open.push(s);
      try {
        draw();
      } finally {
        open.pop();
        path = outerPath;
      }
    } finally {
      release?.();
      ctx.restore();
      M = null;
    }
  };

  return {
    lib: lib as Kit,
    seen,
    order,
    // The scene restored the canvas state: its transform may have changed.
    restored: () => void (M = null),
    restore: () => {
      for (const u of undo.reverse()) u();
    },
  };
}

// ── Parts as layers ──────────────────────────────────────────────────────

export const isPart = (l: Layer) => l.type === "part" && typeof l.props.partOf === "string" && typeof l.props.part === "string";
// The part layers of a code layer.
export const partsOf = (doc: Doc, codeId: string) => doc.layers.filter((l) => isPart(l) && l.props.partOf === codeId);
// Names of parts deleted from a code layer: its code still has them, and they're never painted.
export const droppedParts = (props: Record<string, unknown>): string[] => (Array.isArray(props.dropParts) ? props.dropParts.filter((x): x is string => typeof x === "string") : []);

export type FoundPart = { name: string; start: number; end: number };
// How parts are found. Raised when finding changes, so films are looked at again.
const PARTS_VERSION = 2;
// What a code layer's scene declares: its objects, and its own controls (lib.controls).
export type Found = { parts: FoundPart[]; controls: ControlDef[] };

// Which parts a code layer's scene draws, in paint order, and when each is on screen (doc time),
// and the controls it declares, from running the scene across its clip with painting off. Throws
// what the scene throws.
export async function findParts(
  layer: Layer,
  doc: Doc,
  kit: Kit,
  assets: Assets,
  scene: SceneFn,
  ctx: CanvasRenderingContext2D,
  opts: { signal?: AbortSignal; onProgress?: (k: number) => void } = {},
): Promise<Found> {
  const { w: W, h: H } = doc.meta.size;
  const { sceneIn, sceneT: T } = sceneClock(layer.props, layer.start, layer.end);
  const len = Math.max(0.05, layer.end - layer.start);
  // Often enough that nothing shown for a few frames goes unseen.
  const n = Math.max(2, Math.min(480, Math.ceil(len * 10)));
  const step = len / n;
  const pace = pacer(opts.signal);
  const order: string[] = [];
  const first = new Map<string, number>(), last = new Map<string, number>();
  const controls = new Map<string, ControlDef>();
  const set = controlsSet(layer.props);
  for (let i = 0; i <= n; i++) {
    await pace();
    const local = Math.min(len - 1e-4, i * step);
    const lt = local + sceneIn;
    const tap = tapParts(ctx, kit, { track: true });
    try {
      const lib = withControls(tap.lib, set, (defs) => defs.forEach((d) => controls.has(d.name) || controls.set(d.name, d)));
      muted(ctx, () => scene(ctx, W, H, lt, T, T > 0 ? Math.min(1, Math.max(0, lt / T)) : 0, lib, assets));
    } finally {
      tap.restore();
    }
    let prev = -1;
    for (const name of tap.order) {
      let at_ = order.indexOf(name);
      if (at_ < 0) {
        at_ = prev + 1;
        order.splice(at_, 0, name);
      }
      prev = at_;
      const b = tap.seen.get(name)!.box;
      if (!b || b.x1 <= 0 || b.y1 <= 0 || b.x0 >= W || b.y0 >= H || !(b.x1 - b.x0 > 0.5 || b.y1 - b.y0 > 0.5)) continue;
      if (!first.has(name)) first.set(name, i);
      last.set(name, i);
    }
    opts.onProgress?.(i / n);
  }
  const parts = order.map((name) => {
    const a = first.get(name), b = last.get(name);
    // Never seen painting (or only off the frame): the whole clip, so nothing it might do is cut.
    if (a === undefined || b === undefined) return { name, start: layer.start, end: layer.end };
    return { name, start: a === 0 ? layer.start : layer.start + (a - 1) * step, end: b === n ? layer.end : Math.min(layer.end, layer.start + (b + 1) * step) };
  });
  return { parts, controls: [...controls.values()] };
}

// The controls a code layer's scene declares, as last found (see syncParts).
export const controlsOf = (l: Layer): ControlDef[] => declaredControls(l.props);

// When the code itself shows a part, as last found: [start, end] in doc time (props.found). While
// a part's clip still equals it, the clip is only a picture of that on the timeline and the code's
// own timing decides when the part shows; a clip that was trimmed or moved is a window on it.
export const foundSpan = (l: Layer): [number, number] | null => {
  const f = l.props.found;
  return Array.isArray(f) && f.length === 2 && typeof f[0] === "number" && typeof f[1] === "number" ? [f[0], f[1]] : null;
};
export const clipIsFound = (l: Layer) => {
  const f = foundSpan(l);
  return !!f && f[0] === l.start && f[1] === l.end;
};

// What a code layer's parts were found for: its code and its clip.
export const partsKey = (l: Layer) => `v${PARTS_VERSION}|${codeHash(String(l.props.code ?? ""))}|${l.start}|${l.end}|${l.props.sceneIn ?? 0}|${l.props.sceneT ?? ""}`;
export const partsStale = (l: Layer) => l.type === "code" && l.props.partsKey !== partsKey(l);

// Bring a code layer's part layers in line with what its code draws now: new parts get a layer
// (just above the code layer, in paint order), parts the code no longer has lose theirs, and the
// rest keep every edit made to them. A part whose clip nobody trimmed follows when its code shows it.
export const syncParts =
  (codeId: string, key: string, found: FoundPart[], controls: ControlDef[] = []): Op =>
  (doc) => {
    const owner = doc.layers.find((l) => l.id === codeId);
    if (!owner || owner.type !== "code" || partsKey(owner) !== key) return;
    const dropped = new Set(droppedParts(owner.props));
    const names = new Set(found.map((f) => f.name));
    const old = new Map(doc.layers.filter((l) => isPart(l) && l.props.partOf === codeId).map((l) => [String(l.props.part), l]));
    const next: Layer[] = [];
    for (const f of found) {
      if (dropped.has(f.name)) continue;
      const have = old.get(f.name);
      const span: [number, number] = [Math.max(0, f.start), Math.max(f.start + 0.05, f.end)];
      if (have) {
        if (!foundSpan(have) || clipIsFound(have)) [have.start, have.end] = span;
        have.props.found = span;
        next.push(have);
      } else next.push(LayerSchema.parse({ id: newId("part"), name: f.name, type: "part", start: span[0], end: span[1], props: { partOf: codeId, part: f.name, found: span } }));
    }
    const kept = [...dropped].filter((n) => names.has(n));
    owner.props = { ...owner.props, partsKey: key, ...(kept.length ? { dropParts: kept } : {}) };
    if (!kept.length) delete owner.props.dropParts;
    if (controls.length) owner.props.controlDefs = controls;
    else delete owner.props.controlDefs;
    doc.layers = doc.layers.filter((l) => !(isPart(l) && l.props.partOf === codeId));
    doc.layers.splice(doc.layers.findIndex((l) => l.id === codeId) + 1, 0, ...next);
  };

// A code layer looked at with nothing found (its scene throws): its part layers stay as they are,
// and it isn't run again until it changes.
export const markParts =
  (codeId: string, key: string): Op =>
  (doc) => {
    const owner = doc.layers.find((l) => l.id === codeId);
    if (owner?.type === "code" && partsKey(owner) === key) owner.props = { ...owner.props, partsKey: key };
  };

// The op that brings one code layer's part layers up to date (see syncParts).
export async function partsOp(layer: Layer, doc: Doc, kit: Kit, assets: Assets, signal?: AbortSignal): Promise<Op> {
  const key = partsKey(layer);
  try {
    const c = document.createElement("canvas");
    c.width = doc.meta.size.w;
    c.height = doc.meta.size.h;
    const found = await findParts(layer, doc, kit, assets, compileScene(String(layer.props.code ?? "")), c.getContext("2d")!, { signal });
    return syncParts(layer.id, key, found.parts, found.controls);
  } catch (e) {
    if (signal?.aborted) throw e;
    return markParts(layer.id, key);
  }
}

// A doc with every code layer's objects as part layers.
export async function withParts(doc: Doc, kit: Kit, assets: Assets, signal?: AbortSignal): Promise<Doc> {
  let out = doc;
  for (const l of doc.layers.filter(partsStale)) out = produce(out, await partsOp(l, out, kit, assets, signal));
  return out;
}
