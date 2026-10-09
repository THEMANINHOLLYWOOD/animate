/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Assets, SceneFn } from "@/lib/engine";
import { compileScene } from "@/lib/engine";
import type { Kit } from "@/lib/kit";
import { propAt } from "../doc/interpolate";
import type { Doc, Layer } from "../doc/schema";
import { tapText } from "../extract/textTap";
import { skipRule } from "../extract/splitText";

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
const TEXT_OWN = new Set(["text", "number", "reveal", "revealMode", "raw", "font", "letterSpacing", "ease"]);

const codeCache = new Map<string, SceneFn | Error>();
function codeFn(code: string) {
  let f = codeCache.get(code);
  if (!f) {
    try {
      f = compileScene(code);
    } catch (e) {
      f = e as Error;
    }
    codeCache.set(code, f);
  }
  return f;
}

// Draw one layer's content at its local origin; returns its local bounding box.
function drawContent(ctx: CanvasRenderingContext2D, layer: Layer, p: Record<string, any>, t: number, doc: Doc, kit: Kit, assets: Assets): Bounds | null {
  const u = kit.u;
  switch (layer.type) {
    case "text": {
      const size = p.size ?? 48;
      const str0 = typeof p.number === "number" ? String(Math.round(p.number)) : String(p.text ?? "");
      if (p.raw) {
        // Text split out of a code scene that set the canvas font directly.
        ctx.font = String(p.font ?? "48px sans-serif").replace(/\d+(?:\.\d+)?px/, `${size}px`);
        ctx.fillStyle = p.color ?? kit.C.ink;
        ctx.textAlign = p.align || "left";
        ctx.textBaseline = p.baseline || "alphabetic";
        if ("letterSpacing" in ctx) (ctx as any).letterSpacing = p.letterSpacing || "0px";
        ctx.fillText(str0, 0, 0);
        const w = ctx.measureText(str0).width;
        const x = ctx.textAlign === "center" ? -w / 2 : ctx.textAlign === "right" || ctx.textAlign === "end" ? -w : 0;
        return { x, y: -size * 0.8, w, h: size };
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
      const top = o.baseline === "middle" ? -((r.lines - 1) * lh) / 2 - size / 2 : -size * 0.8;
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
      const T = layer.end - layer.start;
      const lt = t - layer.start;
      // Once its text is split into layers, the code paints everything except that text.
      const tap = p.skipText ? tapText(ctx, kit, skipRule(Array.isArray(p.keepText) ? p.keepText : [])) : null;
      try {
        f(ctx, doc.meta.size.w, doc.meta.size.h, lt, T, Math.min(1, Math.max(0, lt / T)), tap ? tap.lib : kit, assets);
      } finally {
        tap?.restore();
      }
      return { x: 0, y: 0, w: doc.meta.size.w, h: doc.meta.size.h };
    }
    default:
      return null;
  }
}

// Paint the whole doc at time t. Returns canvas-space bounds per drawn layer
// (used for hit-testing and selection outlines in the editor).
export function renderDoc(ctx: CanvasRenderingContext2D, doc: Doc, t: number, kit: Kit, assets: Assets) {
  const bounds: Record<string, Bounds> = {};
  kit.bg(ctx, doc.meta.size.w, doc.meta.size.h, doc.meta.background);
  const byId = new Map(doc.layers.map((l) => [l.id, l]));

  const visible = (l: Layer): boolean => {
    if (l.hidden || t < l.start || t >= l.end + 1e-9) return false;
    return l.parentId ? visible(byId.get(l.parentId)!) : true;
  };

  // Group transforms apply to children: walk the parent chain.
  const applyTransform = (l: Layer) => {
    if (l.parentId) applyTransform(byId.get(l.parentId)!);
    const { tr } = resolved(l, t);
    ctx.translate(tr.x ?? 0, tr.y ?? 0);
    ctx.rotate(((tr.rotation ?? 0) * Math.PI) / 180);
    const s = tr.scale ?? [1, 1];
    ctx.scale(s[0], s[1]);
    ctx.globalAlpha *= tr.opacity ?? 1;
  };

  for (const layer of doc.layers) {
    if (layer.type === "group" || !visible(layer)) continue;
    ctx.save();
    applyTransform(layer);
    if (ctx.globalAlpha > 0.001) {
      ctx.globalCompositeOperation = layer.blend === "add" ? "lighter" : layer.blend === "normal" ? "source-over" : layer.blend;
      const { props } = resolved(layer, t);
      const b = drawContent(ctx, layer, props, t, doc, kit, assets);
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
    ctx.restore();
  }
  return bounds;
}

// Wrap a doc as a scene function so the existing player/exporter can run it.
export const docScene =
  (doc: Doc): SceneFn =>
  (ctx, _W, _H, t, _T, _p, lib, assets) => {
    renderDoc(ctx, doc, t, lib, assets);
  };
