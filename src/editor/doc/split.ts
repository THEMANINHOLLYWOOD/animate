// How text split out of a code layer relates to the rest of the doc.
// - A split text layer belongs to its code layer (props.splitFrom): it follows that layer's transform,
//   opacity, blend, visibility and time, and stands down (the code paints its text again) once the
//   code no longer matches the split.
// - Copies of the same words drawn together (a shadow under a word, a word drawn twice) share
//   props.linkId: their words, size and face change together.
// - Layers named by their words (props.autoName) are renamed when their words change.

import { splitLive } from "../extract/codeHash";
import type { Doc, Layer } from "./schema";

// A layer named after its words: “Like this”, cut short past 28 characters.
export const textLabel = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return `“${t.length > 28 ? t.slice(0, 27) + "…" : t}”`;
};

// Text that changes but is still the same thing on screen: being typed, or a number counting.
export const evolves = (a: string, b: string) => a.startsWith(b) || b.startsWith(a) || a.replace(/[\d.,\s]/g, "") === b.replace(/[\d.,\s]/g, "");

// The code layer a split text layer belongs to, if it's still there.
export function splitOwner(doc: Doc, layer: Layer): Layer | undefined {
  const id = layer.props.splitFrom;
  if (typeof id !== "string") return undefined;
  const o = doc.layers.find((l) => l.id === id);
  return o?.type === "code" ? o : undefined;
}

// The text layers split out of a code layer.
export const splitChildren = (doc: Doc, codeId: string) => doc.layers.filter((l) => l.id !== codeId && l.props.splitFrom === codeId);

// The layers linked with this one (itself included, first); just itself when it has no link.
export function linkedLayers(doc: Doc, id: string): Layer[] {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return [];
  const link = l.props.linkId;
  if (typeof link !== "string") return [l];
  return [l, ...doc.layers.filter((x) => x !== l && x.props.linkId === link)];
}

// Properties shared by linked copies: what they say and the face they say it in, not where or in
// what colour (a shadow sits offset from its word, in another colour).
export const LINKED_PATHS = new Set(["props.text", "props.size", "props.family", "props.weight", "props.italic", "props.tracking", "props.font"]);

// Where a split text layer stands at doc time t:
// - "live": it paints its text (when its own time and visibility allow);
// - "code-changed": its code layer's code changed since the split, so the code paints that text
//   again and this layer stands down until the text is split again;
// - "owner-hidden" / "outside-owner": its code layer is hidden, or not on screen at t, so neither paints.
// null for a layer that isn't split text.
export type SplitStatus = "live" | "code-changed" | "owner-hidden" | "outside-owner";

export function splitStatus(doc: Doc, layer: Layer, t?: number): SplitStatus | null {
  const o = splitOwner(doc, layer);
  if (!o) return null;
  if (!splitLive(codeProps(o, t ?? o.start))) return "code-changed";
  if (o.hidden) return "owner-hidden";
  if (t !== undefined && (t < o.start || t >= o.end + 1e-9)) return "outside-owner";
  return "live";
}

// Whether a split text layer has stood down: its code changed since the split, so the code draws
// this text itself and edits to the layer don't show until the text is split again.
export const isStoodDown = (doc: Doc, layer: Layer) => splitStatus(doc, layer) === "code-changed";

// A code layer's props at doc time t (code and split state are static in practice, but may be keyed).
function codeProps(o: Layer, t: number): Record<string, unknown> {
  const props: Record<string, unknown> = { ...o.props };
  for (const [path, keys] of Object.entries(o.anim)) {
    if (!path.startsWith("props.") || !keys.length) continue;
    const local = t - o.start;
    let k = keys[0];
    for (const x of keys) if (x.t <= local) k = x;
    props[path.slice(6)] = k.v;
  }
  return props;
}
