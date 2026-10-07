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
