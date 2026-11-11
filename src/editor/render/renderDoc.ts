/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Assets, SceneFn } from "@/lib/engine";
import { compileScene } from "@/lib/engine";
import type { Kit } from "@/lib/kit";
import { controlsSet, withControls } from "@/lib/controls";
import { propAt } from "../doc/interpolate";
import type { Doc, Layer } from "../doc/schema";
import { sceneClock, splitCovers, splitLive } from "../extract/codeHash";
import { clipIsFound, droppedParts, isPart, muted, pivoted, tapParts, type PartSeen, type PartState } from "../extract/parts";
import { skipRule, tapText, type TextDraw } from "../extract/textTap";

export type Bounds = { x: number; y: number; w: number; h: number };

// Resolve every prop (static or keyframed) of a layer at doc time t.
function resolved(layer: Layer, t: number) {
  const tr = {
    x: propAt(layer, "transform.x", t) as number,
    y: propAt(layer, "transform.y", t) as number,
    scale: propAt(layer, "transform.scale", t) as number[],
    rotation: propAt(layer, "transform.rotation", t) as number,
    opacity: propAt(layer, "transform.opacity", t) as number,
  };
  const props: Record<string, any> = { ...layer.props };
  for (const path of Object.keys(layer.anim)) {
    if (path.startsWith("props.")) props[path.slice(6)] = propAt(layer, path, t);
  }
  return { tr, props };
}

// Text-layer props that aren't kit text options.
const TEXT_OWN = new Set(["text", "number", "reveal", "revealMode", "raw", "font", "letterSpacing", "ease", "splitFrom", "linkId", "autoName"]);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// Where the first line's top sits for a canvas text baseline, as a share of the size (from the origin).
const TOP: Record<string, number> = { top: 0, hanging: -0.1, middle: -0.5, bottom: -1, ideographic: -1 };

// Run a code scene with its save/restore depth counted: a scene that throws mid-way is unwound to
// where it started (its saves restored), and a restore it never saved for can't pop the renderer's
// own state. Installed over whatever save/restore the canvas has (the text tap's), then put back.
function balanced(ctx: CanvasRenderingContext2D, fn: () => void, onRestore?: () => void) {
  const before = { save: Object.getOwnPropertyDescriptor(ctx, "save"), restore: Object.getOwnPropertyDescriptor(ctx, "restore") };
  const save = ctx.save, restore = ctx.restore;
  let depth = 0;
  const own = (name: "save" | "restore", value: () => void) => Object.defineProperty(ctx, name, { value, configurable: true, writable: true });
  own("save", () => {
    depth++;
    save.call(ctx);
  });
  own("restore", () => {
    if (depth === 0) return;
    depth--;
    restore.call(ctx);
    onRestore?.();
  });
  try {
    fn();
  } finally {
    for (; depth > 0; depth--) restore.call(ctx);
    for (const name of ["save", "restore"] as const) {
      const d = before[name];
      if (d) Object.defineProperty(ctx, name, d);
      else delete (ctx as any)[name];
    }
  }
}

const codeCache = new Map<string, SceneFn | Error>();
function codeFn(code: string) {
  let f = codeCache.get(code);
  if (!f) {
    try {
      f = compileScene(code);
    } catch (e) {
      f = e as Error;
    }
    // Typing in a code field compiles every keystroke's version: keep the recent ones.
    if (codeCache.size >= 24) codeCache.delete(codeCache.keys().next().value!);
    codeCache.set(code, f);
  }
  return f;
}

// Draw one layer's content at its local origin; returns its local bounding box.
function drawContent(ctx: CanvasRenderingContext2D, layer: Layer, p: Record<string, any>, t: number, doc: Doc, kit: Kit, assets: Assets, opts: RenderOptions, bounds: Record<string, Bounds>): Bounds | null {
  const u = kit.u;
  switch (layer.type) {
    case "text": {
      const size = p.size ?? 48;
      const str0 = typeof p.number === "number" ? String(Math.round(p.number)) : String(p.text ?? "");
      if (p.raw) {
        // Text split out of a code scene that set the canvas font directly. A character reveal
        // shows the first floor(reveal × length) characters, as the kit's typewriter does.
        const shown = p.revealMode === "chars" ? str0.slice(0, Math.floor(clamp01(Number(p.reveal ?? 1)) * str0.length)) : str0;
        ctx.font = String(p.font ?? "48px sans-serif").replace(/\d+(?:\.\d+)?px/, `${size}px`);
        ctx.fillStyle = p.color ?? kit.C.ink;
        ctx.textAlign = p.align || "left";
        ctx.textBaseline = p.baseline || "alphabetic";
        if ("letterSpacing" in ctx) (ctx as any).letterSpacing = p.letterSpacing || "0px";
        ctx.fillText(shown, 0, 0);
        const w = ctx.measureText(shown).width;
        const x = ctx.textAlign === "center" ? -w / 2 : ctx.textAlign === "right" || ctx.textAlign === "end" ? -w : 0;
        return { x, y: (TOP[ctx.textBaseline] ?? -0.8) * size, w, h: size };
      }
      const o = {
        // Options recorded from a code scene (blur, ease…) replay as they were drawn.
        ...Object.fromEntries(Object.entries(p).filter(([k]) => !TEXT_OWN.has(k))),
        ease: typeof p.ease === "string" ? (kit.ease as any)[p.ease] : undefined,
        size,
        family: p.family ?? "serif",
        weight: p.weight,
        italic: p.italic,
        color: p.color ?? kit.C.ink,
        align: p.align ?? "left",
        baseline: p.baseline,
        tracking: p.tracking,
        maxWidth: p.maxWidth,
        lineHeight: p.lineHeight,
        highlight: p.highlight,
        highlightColor: p.highlightColor,
        stagger: p.stagger,
        rise: p.rise,
      };
      const str = str0;
      const reveal = p.reveal ?? 1;
      const mode = p.revealMode ?? "none";
      const r =
        mode === "words" ? kit.words(ctx, str, 0, 0, reveal, o) : mode === "chars" ? kit.typewriter(ctx, str, 0, 0, reveal, { ...o, caret: false }) : kit.text(ctx, str, 0, 0, o);
      const w = r.width;
      const x = o.align === "center" ? -w / 2 : o.align === "right" ? -w : 0;
      const lh = (o.lineHeight ?? 1.2) * size;
      const top = o.baseline === "middle" ? -((r.lines - 1) * lh) / 2 - size / 2 : (TOP[o.baseline] ?? -0.8) * size;
      return { x, y: top, w, h: r.height };
    }
    case "shape": {
      const w = p.w ?? 100, h = p.h ?? 100;
      const [ax, ay] = layer.transform.anchor;
      const pulse = p.pulse ? 0.55 + 0.45 * Math.cos(kit.pulse(t, p.pulse) * Math.PI * 2) : 1;
      const style = { fill: p.fill, stroke: p.stroke, lineWidth: p.lineWidth, alpha: pulse };
      if (p.kind === "line") {
        const pts: [number, number][] = p.points ?? [[0, 0], [w, 0]];
        kit.line(ctx, pts, p.trim ?? 1, { color: p.stroke ?? kit.C.ink, width: p.lineWidth ?? 2, alpha: pulse });
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        return { x: Math.min(...xs), y: Math.min(...ys) - 4, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + 8 };
      }
      if (p.kind === "ellipse") {
        ctx.save();
        ctx.translate(-ax * w + w / 2, -ay * h + h / 2);
        ctx.scale(1, h / w || 1);
        kit.circle(ctx, 0, 0, w / 2, style);
        ctx.restore();
      } else kit.rrect(ctx, -ax * w, -ay * h, w, h, p.radius ?? 0, style);
      return { x: -ax * w, y: -ay * h, w, h };
    }
    case "globe": {
      const R = p.R ?? 300;
      const markers = (p.markers ?? [])
        .filter((m: any) => t >= layer.start + (m.from ?? 0) && t < layer.start + (m.to ?? Infinity))
        .map((m: any) => {
          const age = t - layer.start - (m.from ?? 0);
          return { ...m, alpha: Math.min(1, age / 0.35), pulse: m.pulse ? kit.pulse(t, 1.4) : null };
        });
      kit.globe(ctx, 0, 0, R, { rot: p.rot ?? 0, tilt: p.tilt ?? 18, k: p.draw ?? 1, color: p.color ?? kit.C.ink, fill: p.fill, markers });
      return { x: -R, y: -R, w: 2 * R, h: 2 * R };
    }
    case "waveform": {
      const w = p.w ?? 200, h = p.h ?? 30;
      kit.wave(ctx, 0, 0, w, h, t, { bars: p.bars, color: p.color, amp: p.amp });
      return { x: 0, y: -h / 2, w, h };
    }
    case "image": {
      const img = (p.asset && assets.byName[p.asset]) || null;
      const w = p.w ?? 400, h = p.h ?? 300;
      const [ax, ay] = layer.transform.anchor;
      if (img) kit.image(ctx, img, -ax * w, -ay * h, w, h, { fit: p.fit, radius: p.radius });
      else kit.rrect(ctx, -ax * w, -ay * h, w, h, 8, { stroke: kit.C.cloud, lineWidth: 2 * u });
      return { x: -ax * w, y: -ay * h, w, h };
    }
    case "code": {
      const f = codeFn(String(p.code ?? ""));
      if (f instanceof Error) throw f;
      // The scene's own clock: scene time sceneIn at the clip's start, over a scene sceneT long
      // (until a trim pins them, the clip is the scene: 0 and end - start).
      const { sceneIn, sceneT: T } = sceneClock(p, layer.start, layer.end);
      const lt = t - layer.start + sceneIn;
      // Once its text is split into layers, the code paints everything except that text. The split
      // only holds for the code it was made from (edited code paints all its own text again), and over
      // the stretch of the scene it was made from (lengthened past it, the code paints its text there).
      let tap: ReturnType<typeof tapText> | null = null;
      const { w: W, h: H } = doc.meta.size;
      // The film's own controls answer with what's set on this layer (static or keyed).
      // (Untouched, the kit's own lib.controls answers with the defaults.)
      const set = controlsSet(p);
      const bound = Object.keys(set).length > 0;
      const run = (lib: Kit, after?: () => void) => balanced(ctx, () => f(ctx, W, H, lt, T, T > 0 ? clamp01(lt / T) : 0, bound ? withControls(lib, set) : lib, assets), after);
      // The objects its code draws (lib.layer) that are layers of their own: each is drawn as its
      // part layer says (moved, scaled, faded), or not at all (hidden, outside its clip, deleted).
      const mine = new Map(doc.layers.filter((l) => isPart(l) && l.props.partOf === layer.id).map((l) => [String(l.props.part), l]));
      const dropped = new Set(droppedParts(p));
      let parts: ReturnType<typeof tapParts> | null = null;
      if (mine.size || dropped.size) {
        const state = (name: string): PartState | "mute" | null => {
          if (dropped.has(name)) return "mute";
          const pl = mine.get(name);
          if (!pl) return null;
          if (pl.hidden || pl.id === opts.mutePart || (!clipIsFound(pl) && (t < pl.start || t >= pl.end + 1e-9))) return "mute";
          const { tr } = resolved(pl, t);
          const s = Array.isArray(tr.scale) ? tr.scale : [1, 1];
          return { x: tr.x ?? 0, y: tr.y ?? 0, scale: [s[0] ?? 1, s[1] ?? s[0] ?? 1], rotation: tr.rotation ?? 0, opacity: tr.opacity ?? 1, blend: pl.blend };
        };
        // Scaling or turning a part happens about its centre, where the code draws it on this frame:
        // found by running the scene once more with painting off.
        let pivots: Map<string, [number, number]> | undefined;
        if ([...mine.keys()].some((name) => {
          const st = state(name);
          return st && st !== "mute" && pivoted(st);
        })) {
          const dry = tapParts(ctx, kit, { track: true });
          try {
            muted(ctx, () => run(dry.lib, dry.restored));
          } finally {
            dry.restore();
          }
          pivots = new Map();
          for (const [name, s] of dry.seen) if (s.box) pivots.set(name, [(s.box.x0 + s.box.x1) / 2, (s.box.y0 + s.box.y1) / 2]);
        }
        parts = tapParts(ctx, kit, { state, track: !!opts.partBounds, pivots });
      }
      const base = parts ? parts.lib : kit;
      if (splitLive(p) && splitCovers(p, lt)) {
        const rule = skipRule(Array.isArray(p.keepText) ? p.keepText : []);
        tap = tapText(ctx, base, (d, movable) => {
          const v = rule(d, movable);
          if (v === "skip") opts.onTextSkipped?.(layer, d);
          return v;
        });
      }
      try {
        run(tap ? tap.lib : base, parts?.restored);
      } finally {
        tap?.restore();
        parts?.restore();
      }
      if (parts && opts.partBounds) {
        for (const [name, s] of parts.seen) {
          const pl = mine.get(name);
          if (!pl) continue;
          opts.onPart?.(pl, s);
          const b = s.box;
          if (!b) continue;
          const x0 = Math.max(0, b.x0), y0 = Math.max(0, b.y0), x1 = Math.min(W, b.x1), y1 = Math.min(H, b.y1);
          if (x1 > x0 && y1 > y0) bounds[pl.id] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
      }
      return { x: 0, y: 0, w: W, h: H };
    }
    default:
      return null;
  }
}

export type RenderOptions = {
  // A layer that threw while painting (a code layer whose code has an error, say). The rest of the
  // frame still paints. Without a handler, renderDoc throws the first such error once it's done.
  onError?: (layer: Layer, error: unknown) => void;
  // Text a split code layer left to its text layers (didn't paint) on this frame.
  onTextSkipped?: (layer: Layer, d: TextDraw) => void;
  // Work out where each part of a code layer paints (the editor's selection boxes), and report the
  // space each was drawn in.
  partBounds?: boolean;
  onPart?: (part: Layer, seen: PartSeen) => void;
  // Leave one part out of the frame (the editor finds what's under the pointer by what changes without it).
  mutePart?: string;
};

// Paint the whole doc at time t. Returns canvas-space bounds per drawn layer
// (used for hit-testing and selection outlines in the editor). Each layer paints in its own canvas
// state: one that throws is skipped (and reported), and the layers above it still paint.
export function renderDoc(ctx: CanvasRenderingContext2D, doc: Doc, t: number, kit: Kit, assets: Assets, opts: RenderOptions = {}) {
  const bounds: Record<string, Bounds> = {};
  kit.bg(ctx, doc.meta.size.w, doc.meta.size.h, doc.meta.background);
  const byId = new Map(doc.layers.map((l) => [l.id, l]));

  // Text split out of a code layer belongs to it: it follows the code layer's transform, opacity,
  // blend and visibility, and stands down while the code no longer matches the split (the code
  // then paints that text itself).
  const ownerOf = (l: Layer) => {
    const o = typeof l.props.splitFrom === "string" ? byId.get(l.props.splitFrom) : undefined;
    return o?.type === "code" ? o : undefined;
  };
  const live = new Map<string, boolean>();
  const splitOn = (o: Layer) => {
    let v = live.get(o.id);
    if (v === undefined) live.set(o.id, (v = splitLive(resolved(o, t).props)));
    return v;
  };

  // A layer and every group above it.
  const lineage = (l: Layer) => {
    const ids = new Set<string>();
    for (let x: Layer | undefined = l; x && !ids.has(x.id); x = x.parentId ? byId.get(x.parentId) : undefined) ids.add(x.id);
    return ids;
  };

  const visible = (l: Layer): boolean => {
    if (l.hidden || t < l.start || t >= l.end + 1e-9) return false;
    const owner = ownerOf(l);
    if (owner && !(splitOn(owner) && visible(owner))) return false;
    return l.parentId ? visible(byId.get(l.parentId)!) : true;
  };

  // Group transforms apply to children: walk the parent chain, stopping at a group already applied.
  const applyTransform = (l: Layer, applied?: Set<string>) => {
    if (l.parentId && !applied?.has(l.parentId)) applyTransform(byId.get(l.parentId)!, applied);
    const { tr } = resolved(l, t);
    ctx.translate(tr.x ?? 0, tr.y ?? 0);
    ctx.rotate(((tr.rotation ?? 0) * Math.PI) / 180);
    const s = tr.scale ?? [1, 1];
    ctx.scale(s[0], s[1]);
    ctx.globalAlpha *= tr.opacity ?? 1;
  };

  let failed: { error: unknown } | null = null;
  for (const layer of doc.layers) {
    // A part is painted by its code layer.
    if (layer.type === "group" || layer.type === "part" || !visible(layer)) continue;
    ctx.save();
    try {
      // Split text is drawn in its code layer's space, then moved by its own transform and groups,
      // short of any group the two share: that one is already in the code layer's (applied once).
      const owner = ownerOf(layer);
      if (owner) applyTransform(owner);
      applyTransform(layer, owner ? lineage(owner) : undefined);
      if (ctx.globalAlpha > 0.001) {
        const blend = layer.blend === "normal" && owner ? owner.blend : layer.blend;
        ctx.globalCompositeOperation = blend === "add" ? "lighter" : blend === "normal" ? "source-over" : blend;
        const { props } = resolved(layer, t);
        const b = drawContent(ctx, layer, props, t, doc, kit, assets, opts, bounds);
        if (b) {
          const m = ctx.getTransform();
          const pts = [
            [b.x, b.y],
            [b.x + b.w, b.y],
            [b.x, b.y + b.h],
            [b.x + b.w, b.y + b.h],
          ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
          const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          bounds[layer.id] = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        }
      }
    } catch (error) {
      failed ??= { error };
      opts.onError?.(layer, error);
    } finally {
      ctx.restore();
    }
  }
  if (failed && !opts.onError) throw failed.error;
  return bounds;
}

// Wrap a doc as a scene function so the existing player/exporter can run it.
export const docScene =
  (doc: Doc): SceneFn =>
  (ctx, _W, _H, t, _T, _p, lib, assets) => {
    renderDoc(ctx, doc, t, lib, assets);
  };
