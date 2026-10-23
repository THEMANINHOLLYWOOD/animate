// Docs an earlier editor kept in localStorage, from before splits were checked by pixels. Their code
// layers skip text by that first, unchecked split, with no hash of the code it was made from, and
// their text layers aren't tied to the code. There's no telling the edits in one from its split, so
// on open it's set aside (kept, and offered) and the film is split afresh; `fromUnchecked` brings
// one back when asked.

import type { Doc, Layer } from "../doc/schema";
import { textLabel } from "../doc/split";
import { codeHash } from "./codeHash";

const unchecked = (props: Record<string, unknown>) => !!props.skipText && typeof props.splitHash !== "string";

// Whether a doc's text was split the first, unchecked way.
export const uncheckedSplit = (doc: Doc) => doc.layers.some((l) => l.type === "code" && unchecked(l.props));

// That split put the layers it made ("text_…", each named by its words in curly quotes) just above
// the code layer. Layers made in the editor afterwards are "layer_…" (added, or the copy a time split
// makes, named "… (split)") or "group_…", and can sit among them. A recreation's own layers come
// after them: its text is "text_…" too, but named by what it is ("Headline"), and its shapes and
// images are "rect_…", "line_…", "ellipse_…", "image_…".
const editorMade = (l: Layer) => l.id.startsWith("layer_") || l.id.startsWith("group_");
const timeSplit = (l: Layer) => l.id.startsWith("layer_") && / \(split\)$/.test(l.name);
const madeBySplit = (l: Layer) => l.type === "text" && (l.id.startsWith("text_") || timeSplit(l));
const QUOTED = /^“[\s\S]*”( \(split\))*$/;

// Which layers the split of the code layer at index i made: those between it and the first layer
// it couldn't have put there (more code, or a layer that is neither text nor made in the editor),
// up to the last still named by its words. Text past that (a recreation's) isn't the split's; nor is
// a split layer renamed since, when nothing the split named follows it.
export function splitLayersOf(layers: Layer[], i: number): number[] {
  let end = i + 1;
  while (end < layers.length && layers[end].type !== "code" && (layers[end].type === "text" || editorMade(layers[end]))) end++;
  let last = i;
  for (let j = i + 1; j < end; j++) if (madeBySplit(layers[j]) && QUOTED.test(layers[j].name)) last = j;
  const out: number[] = [];
  for (let j = i + 1; j <= last; j++) if (madeBySplit(layers[j])) out.push(j);
  return out;
}

// A layer still named by the words it ends on, as the split named it.
const namedByWords = (l: Layer) => {
  const keys = l.anim["props.text"];
  return l.name === textLabel(String(keys?.length ? keys[keys.length - 1].v : l.props.text ?? ""));
};

// Such a doc in today's terms, painting what it painted before: each of those code layers marked as
// split from the code it has now (so it goes on skipping the text that split moved out), and the text
// layers that split made tied to it, so they follow it and stand down if its code changes (and, still
// named by their words, are renamed when those change).
export function fromUnchecked(doc: Doc): Doc {
  const owner = new Map<number, string>();
  doc.layers.forEach((l, i) => {
    if (l.type === "code" && unchecked(l.props)) for (const j of splitLayersOf(doc.layers, i)) owner.set(j, l.id);
  });
  const layers = doc.layers.map((l, i) => {
    if (l.type === "code" && unchecked(l.props)) return { ...l, props: { ...l.props, splitHash: codeHash(String(l.props.code ?? "")) } };
    const o = owner.get(i);
    return o && typeof l.props.splitFrom !== "string" ? { ...l, props: { ...l.props, splitFrom: o, ...(namedByWords(l) ? { autoName: true } : {}) } } : l;
  });
  return { ...doc, layers };
}
