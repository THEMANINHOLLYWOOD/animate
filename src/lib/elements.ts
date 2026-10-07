// "Strip a video into elements": the contract Claude fills from a shot-by-shot
// breakdown + frames. Each element becomes an editable layer in the editor;
// everything that isn't an element (textures, generative motion) is left to
// one code layer drawn underneath.

export type ElementKey = { t: number; v: number | number[] | string; ease: "linear" | "hold" | "ease_in" | "ease_out" | "ease_in_out" | "spring" };

export type Element = {
  id: string;
  name: string;
  type: "text" | "rect" | "ellipse" | "line" | "image";
  start: number; // seconds
  end: number;
  x: number; // pixels in the film's frame
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  color: string; // text colour / fill
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  text: string | null;
  font: "serif" | "sans" | "mono" | null;
  weight: number | null;
  italic: boolean;
  size: number | null; // text size px
  align: "left" | "center" | "right" | null;
  revealMode: "none" | "words" | "chars" | null;
  asset: string | null; // image asset name
  keys: { path: "x" | "y" | "opacity" | "scale" | "rotation" | "reveal" | "w" | "h"; keys: ElementKey[] }[];
};

export type ElementsPlan = { elements: Element[]; background: string; leftover: string };

const key = {
  type: "object",
  additionalProperties: false,
  required: ["t", "v", "ease"],
  properties: {
    t: { type: "number", description: "Film time in seconds" },
    v: { anyOf: [{ type: "number" }, { type: "string" }, { type: "array", items: { type: "number" } }] },
    ease: { type: "string", enum: ["linear", "hold", "ease_in", "ease_out", "ease_in_out", "spring"] },
  },
};

export const ELEMENTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["elements", "background", "leftover"],
  properties: {
    background: { type: "string", description: "Frame background colour as hex" },
    leftover: {
      type: "string",
      description: "What is NOT captured as elements and must be drawn by code underneath (gradients, photos as blurred shapes, particle fields, line-art objects, charts). Empty string if nothing.",
    },
    elements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "type", "start", "end", "x", "y", "w", "h", "rotation", "opacity", "color", "stroke", "strokeWidth", "radius", "text", "font", "weight", "italic", "size", "align", "revealMode", "asset", "keys"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["text", "rect", "ellipse", "line", "image"] },
          start: { type: "number" },
          end: { type: "number" },
          x: { type: "number", description: "Left edge for rect/ellipse/image/line; the alignment point for text" },
          y: { type: "number", description: "Top edge for shapes; the baseline for text" },
          w: { type: "number" },
          h: { type: "number" },
          rotation: { type: "number" },
          opacity: { type: "number" },
          color: { type: "string" },
          stroke: { anyOf: [{ type: "string" }, { type: "null" }] },
          strokeWidth: { type: "number" },
          radius: { type: "number" },
          text: { anyOf: [{ type: "string" }, { type: "null" }] },
          font: { anyOf: [{ type: "string", enum: ["serif", "sans", "mono"] }, { type: "null" }] },
          weight: { anyOf: [{ type: "number" }, { type: "null" }] },
          italic: { type: "boolean" },
          size: { anyOf: [{ type: "number" }, { type: "null" }] },
          align: { anyOf: [{ type: "string", enum: ["left", "center", "right"] }, { type: "null" }] },
          revealMode: { anyOf: [{ type: "string", enum: ["none", "words", "chars"] }, { type: "null" }] },
          asset: { anyOf: [{ type: "string" }, { type: "null" }] },
          keys: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "keys"],
              properties: {
                path: { type: "string", enum: ["x", "y", "opacity", "scale", "rotation", "reveal", "w", "h"] },
                keys: { type: "array", items: key },
              },
            },
          },
        },
      },
    },
  },
};

export const ELEMENTS_SYSTEM = `You convert a shot-by-shot breakdown of a video (plus its sampled frames) into a list of editable ELEMENTS: every piece of text, every flat shape (rectangles, rounded pills, rules, dots, circles, lines) and every logo/image. Each element gets exact pixel geometry in the film's frame, its colours as hex, and keyframes for how it moves.

Rules:
- Coordinates are pixels in the given frame size. For text, x is the alignment point (left edge, centre or right edge per align) and y is the BASELINE; size is the font size in px. For shapes, x/y is the top-left corner and w/h the box; a 'line' runs from (x, y) to (x + w, y + h) with strokeWidth.
- start/end are when the element exists (seconds). Use keyframes (film seconds) on opacity for fades, on x/y for moves, on scale ([sx, sy] or a number) for grows, on reveal (0..1, text only, with revealMode words/chars) for word-by-word or typed text, on w/h for growing rules.
- Ease: ease_out for entrances, ease_in for exits, ease_in_out for moves, spring for lively settles, hold for cuts.
- One element per distinct visible item; keep names short and human ("Headline", "Live dot", "Rule under feed"). Group nothing.
- Anything that is not flat text/shapes/images (gradients, photos, 3D, particle systems, line-art globes, charts, hand-drawn strokes) is NOT an element: describe it precisely in 'leftover' so code can draw it underneath, including where and when.
- Preserve the original copy verbatim.`;

// ── Elements → editor document ───────────────────────────────────────────

import { Doc, Layer as LayerSchema, newId, type Doc as DocT, type Keyframe } from "@/editor/doc/schema";
import { EASES } from "@/editor/ai/tools";

const PATHS: Record<string, string> = { x: "transform.x", y: "transform.y", opacity: "transform.opacity", scale: "transform.scale", rotation: "transform.rotation", reveal: "props.reveal", w: "props.w", h: "props.h" };

export function elementsToDoc(plan: ElementsPlan, opts: { id: string; title: string; w: number; h: number; duration: number; fps?: number; code?: string }): DocT {
  const layers = [];
  if (opts.code) {
    layers.push(
      LayerSchema.parse({ id: "scene", name: "Scene (code)", type: "code", start: 0, end: opts.duration, locked: true, props: { code: opts.code } }),
    );
  }
  for (const e of plan.elements) {
    const start = Math.max(0, Math.min(opts.duration, e.start));
    const end = Math.max(start + 0.05, Math.min(opts.duration, e.end));
    const anim: Record<string, Keyframe[]> = {};
    for (const k of e.keys ?? []) {
      const path = PATHS[k.path];
      if (!path || !k.keys?.length) continue;
      anim[path] = k.keys
        .map((kf) => ({
          id: newId("key"),
          t: kf.t - start,
          v: path === "transform.scale" && typeof kf.v === "number" ? [kf.v, kf.v] : kf.v,
          ease: EASES[kf.ease] ?? "linear",
        }))
        .sort((a, b) => a.t - b.t);
    }
    const base = {
      id: newId(e.type),
      name: e.name || e.type,
      start,
      end,
      anim,
      transform: { x: e.x, y: e.y, scale: [1, 1], rotation: e.rotation ?? 0, anchor: [0, 0], opacity: e.opacity ?? 1 },
    };
    if (e.type === "text") {
      layers.push(
        LayerSchema.parse({
          ...base,
          type: "text",
          props: {
            text: e.text ?? "",
            size: e.size ?? 48,
            family: e.font ?? "serif",
            weight: e.weight ?? undefined,
            italic: !!e.italic,
            color: e.color,
            align: e.align ?? "left",
            revealMode: e.revealMode ?? "none",
            reveal: anim["props.reveal"] ? undefined : 1,
          },
        }),
      );
    } else if (e.type === "image") {
      layers.push(LayerSchema.parse({ ...base, type: "image", props: { asset: e.asset, w: e.w, h: e.h, fit: "contain", radius: e.radius } }));
    } else {
      const kind = e.type === "line" ? "line" : e.type === "ellipse" ? "ellipse" : "rect";
      const props: Record<string, unknown> =
        kind === "line"
          ? { kind, points: [[0, 0], [e.w, e.h]], stroke: e.stroke ?? e.color, lineWidth: e.strokeWidth || 2, trim: 1 }
          : { kind, w: e.w, h: e.h, radius: e.radius, fill: e.color, stroke: e.stroke ?? undefined, lineWidth: e.strokeWidth || undefined };
      layers.push(LayerSchema.parse({ ...base, type: "shape", props }));
    }
  }
  return Doc.parse({
    meta: { id: opts.id, title: opts.title, size: { w: opts.w, h: opts.h }, fps: opts.fps ?? 30, duration: opts.duration, background: plan.background || "#FAF9F5" },
    layers,
  });
}

// What the code animator must leave alone when elements are layered on top.
export function elementsSummary(plan: ElementsPlan) {
  const lines = plan.elements.map((e) => `- ${e.name} (${e.type}${e.text ? `: "${e.text.slice(0, 60)}"` : ""}) ${e.start.toFixed(2)}–${e.end.toFixed(2)}s`);
  return `These elements are rendered as separate editable layers ON TOP of your scene. Do NOT draw them (no text, no shapes, no logos that duplicate them):\n${lines.join("\n")}\n\nDraw ONLY what is left over, described here: ${plan.leftover || "nothing: paint just the background"}. If nothing is left over, paint the background and return.`;
}
