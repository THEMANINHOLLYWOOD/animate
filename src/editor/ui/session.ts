// The editor's bookkeeping, kept free of React and the DOM so it can be tested: what to open,
// what a selection still points at, where the playhead goes to show a layer, and how the
// timeline scrolls to keep things in view.

import { propAt } from "../doc/interpolate";
import type { Doc, Layer } from "../doc/schema";
import { splitOwner } from "../doc/split";

export type KeySel = { layerId: string; path: string; keyId: string };

// ── Selections that outlive what they point at (undo, the agent, a re-split) ──

// The selected layers still in the doc: the same array when they all are.
export function liveSelection(doc: Doc, ids: string[]): string[] {
  if (!ids.length) return ids;
  const have = new Set(doc.layers.map((l) => l.id));
  const out = ids.filter((id) => have.has(id));
  return out.length === ids.length ? ids : out;
}

// The selected keyframes still in the doc (their layer, track and key): the same array when they all are.
export function liveKeys(doc: Doc, sel: KeySel[]): KeySel[] {
  if (!sel.length) return sel;
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  const out = sel.filter((s) => !!byId.get(s.layerId)?.anim[s.path]?.some((k) => k.id === s.keyId));
  return out.length === sel.length ? sel : out;
}

// What a delete may touch: layers and keyframes of layers that aren't locked.
export function unlocked(doc: Doc, ids: string[]): string[] {
  const locked = new Set(doc.layers.filter((l) => l.locked).map((l) => l.id));
  return ids.filter((id) => !locked.has(id));
}
export function unlockedKeys(doc: Doc, sel: KeySel[]): KeySel[] {
  const locked = new Set(doc.layers.filter((l) => l.locked).map((l) => l.id));
  return sel.filter((s) => !locked.has(s.layerId));
}

// ── The inspector's Text field ──

// The words a text layer's Text field shows (and an edit replaces, for the whole clip: setText): what
// it says at doc time t, except text being typed (keys that each start the longest), which shows the
// whole words. Mid-typing the playhead shows "Hel", but editing it means editing "Hello world".
export function wordsOf(l: Layer, t: number): string {
  const keys = l.anim["props.text"];
  if (keys?.length) {
    const vals = keys.map((k) => String(k.v));
    const longest = vals.reduce((a, b) => (b.length > a.length ? b : a), "");
    if (vals.some((v) => v !== longest) && vals.every((v) => longest.startsWith(v))) return longest;
  }
  return String(propAt(l, "props.text", t) ?? "");
}

// ── Showing a layer ──

// When a layer can be on screen: its clip, and for split text, the part of it its code layer is on too.
export function spanOf(doc: Doc, l: Layer): [number, number] {
  const o = splitOwner(doc, l);
  if (o && Math.max(l.start, o.start) < Math.min(l.end, o.end)) return [Math.max(l.start, o.start), Math.min(l.end, o.end)];
  return [l.start, l.end];
}

// Where the playhead goes to show a layer: `t` itself while the layer is on then; otherwise the frame
// inside its span nearest `t`, moved inward past frames where it's faded out (a fade-in's first frame).
export function spanTime(doc: Doc, l: Layer, t: number): number {
  const [s, e] = spanOf(doc, l);
  if (t >= s && t < e) return t;
  const fps = doc.meta.fps;
  const first = Math.min(Math.ceil(s * fps - 1e-6) / fps, e);
  const last = Math.max(first, Math.ceil(e * fps - 1e-6) / fps - 1 / fps);
  if (last <= first) return first < e ? first : s;
  const frames = Math.round((last - first) * fps);
  const step = Math.max(1, Math.ceil(frames / 30));
  const from = t < s ? first : last;
  const dir = t < s ? 1 : -1;
  for (let k = 0; k <= frames; k += step) {
    const at = from + (dir * k) / fps;
    const op = propAt(l, "transform.opacity", at);
    if (typeof op !== "number" || op > 0.05) return Math.round(at * fps) / fps;
  }
  return from;
}

// ── Keeping things in view ──

// The scroll offset that brings [top, top + size) into a view of `view` px scrolled to `scroll`, whose
// first `inset` px are covered (a sticky ruler, the layer names); null when it's in view already.
export function scrollToShow(top: number, size: number, scroll: number, view: number, inset = 0): number | null {
  const lo = scroll + inset;
  const hi = scroll + view;
  if (top >= lo && top + size <= hi) return null;
  if (top < lo || size > view - inset) return Math.max(0, top - inset);
  return Math.max(0, top + size - view);
}

// The scroll offset that keeps the playhead (at x) in a timeline scrolled to `scroll`: a page on when it
// runs off the right, back when it's off the left (a loop starting over). Null while it's in view.
export function followX(x: number, scroll: number, view: number, inset: number, pad = 24): number | null {
  if (x >= scroll + inset && x <= scroll + view - 4) return null;
  return Math.max(0, x - inset - pad);
}

// ── Keys ──

// The focused element, as far as shortcuts care.
export type Focused = { tagName: string; type?: string; isContentEditable?: boolean };

const TEXT_TYPES = new Set(["", "text", "number", "search", "email", "url", "tel", "password", "date", "time", "datetime-local", "month", "week"]);

// A field you type into: its keystrokes are its own (the editor's shortcuts stay out of the way).
export function isTextField(el: Focused | null): boolean {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && TEXT_TYPES.has((el.type ?? "").toLowerCase());
}

// Whether `key` belongs to the focused element rather than to a shortcut: anything in a text field,
// Space or Enter on a checkbox, arrows, Home and End on a slider, and Space, Enter, Backspace and
// Delete on a color swatch (it keeps focus after its picker closes, so Delete must not take the
// layer it just colored). These keep shortcuts otherwise (one clicked keeps focus, and Space should
// still play, ⌘Z still undo).
export function ownsKey(el: Focused | null, key: string): boolean {
  if (!el) return false;
  if (isTextField(el)) return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el.type ?? "").toLowerCase();
  if (type === "checkbox" || type === "radio") return key === " " || key === "Enter";
  if (type === "range") return key.startsWith("Arrow") || key.startsWith("Page") || key === "Home" || key === "End";
  if (type === "color") return key === " " || key === "Enter" || key === "Backspace" || key === "Delete";
  return false;
}

// ── Opening a film ──

// What the editor keeps for a film in this browser (IndexedDB, keyed by film id): either the film's
// text split into layers, kept so reopening skips the split (`edited` false), or edits that haven't
// reached the film yet (`edited` true). `source` is the version of the film it was made from.
export type SavedRec = { v: number; doc: unknown; edited: boolean; source: string };

export type Picked = {
  doc: Doc;
  // Edits from this browser that never reached the film: made on the film as it is now ("same"), or on
  // a version of it the Studio (or another tab) has changed since ("conflict").
  restored: null | "same" | "conflict";
  // From the earlier editor's copy (localStorage), not this one's.
  fromLegacy: boolean;
  // A kept split of this very version: no need to split again.
  cached: boolean;
  // What's kept is no use any more.
  dropSaved: boolean;
  dropLegacy: boolean;
};

// Which doc opens. Edits that never reached the film open (they'd be lost otherwise), flagged when the
// film changed since they were made; edits identical to the film are no edits. Else the film's own doc,
// or its kept split while that was made from this version. `sources` are the versions the film as stored
// is known by (its version now, and the fingerprint earlier editors kept); `legacy` is a doc the earlier
// editor kept that isn't set aside.
export function pickDoc(o: { film: Doc; sources: string[]; saved?: SavedRec; legacy?: Doc | null; splitVersion: number; parse: (u: unknown) => Doc | null }): Picked {
  const json = JSON.stringify(o.film);
  const same = (d: Doc) => JSON.stringify(d) === json;
  const known = (src: string) => o.sources.includes(src);
  const kept = o.saved ? o.parse(o.saved.doc) : null;
  const base = { restored: null, fromLegacy: false, cached: false, dropSaved: false, dropLegacy: false } as const;
  if (o.saved?.edited && kept) {
    if (!same(kept)) return { ...base, doc: kept, restored: known(o.saved.source) ? "same" : "conflict", dropLegacy: !!o.legacy };
    return { ...base, doc: o.film, dropSaved: true, dropLegacy: !!o.legacy };
  }
  const dropSaved = !!o.saved && (!kept || o.saved.edited || o.saved.v !== o.splitVersion || !known(o.saved.source));
  if (o.legacy && !same(o.legacy)) return { ...base, doc: o.legacy, restored: "conflict", fromLegacy: true, dropSaved };
  if (kept && !dropSaved) return { ...base, doc: kept, cached: true, dropLegacy: !!o.legacy };
  return { ...base, doc: o.film, dropSaved, dropLegacy: !!o.legacy };
}
