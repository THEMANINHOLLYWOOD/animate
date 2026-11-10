import { unsplit } from "../extract/codeHash";
import { valueAt } from "./interpolate";
import type { Doc, Ease, Keyframe, Layer, Value } from "./schema";
import { Layer as LayerSchema, newId } from "./schema";
import { LINKED_PATHS, evolves, linkedLayers, splitChildren, textLabel } from "./split";

// Every edit is a recipe that mutates an Immer draft. The store runs recipes
// through produceWithPatches, which gives immutability and undo for free.
// Ops keep the doc valid (opacity in [0, 1], times ≥ 0, no NaN): a bad value is clamped or ignored.
export type Op = (doc: Doc) => void;

const layerById = (doc: Doc, id: string) => {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) throw new Error(`No layer ${id}`);
  return l;
};

const sortKeys = (keys: Keyframe[]) => keys.sort((a, b) => a.t - b.t);

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof o[p] !== "object" || o[p] === null) o[p] = {};
    o = o[p] as Record<string, unknown>;
  }
  o[parts[parts.length - 1]] = value;
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  let v: unknown = obj;
  for (const p of path.split(".")) v = (v as Record<string, unknown> | undefined)?.[p];
  return v;
}

const finite = (v: Value) => (typeof v === "number" ? Number.isFinite(v) : Array.isArray(v) ? v.every(Number.isFinite) : true);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// Values the schema bounds, brought within bounds.
const normalize = (path: string, v: Value): Value => (path === "transform.opacity" && typeof v === "number" ? clamp01(v) : v);

const add = (a: Value, d: number | number[]): Value => {
  if (typeof a === "number") return a + (Array.isArray(d) ? d[0] ?? 0 : d);
  if (Array.isArray(a)) return a.map((x, i) => x + (Array.isArray(d) ? d[i] ?? 0 : d));
  return a;
};
const sub = (a: Value, b: Value): number | number[] | null => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => x - (b[i] ?? x));
  return null;
};

// A static value, for paths a layer keeps statics at (its transform and props).
function setStatic(l: Layer, path: string, v: Value) {
  if (path.startsWith("transform.") || path.startsWith("props.")) setPath(l as unknown as Record<string, unknown>, path, normalize(path, v));
}

// Split text carries a recording of what the code drew: a key on nearly every frame of a shake,
// a held key per digit of a counter. A value edit changes the whole recording, not one frame of it.
const recorded = (l: Layer) => typeof l.props.splitFrom === "string";
// Where it is and how big: what a recorded track keeps the motion of when it's moved as a whole.
const MOVED = new Set(["transform.x", "transform.y", "transform.rotation", "transform.scale", "transform.opacity", "props.size"]);

// The value a layer shows for `path` at doc time t: its track's, else its static value.
function shownAt(l: Layer, path: string, t: number): Value | undefined {
  const keys = l.anim[path];
  if (keys?.length) return valueAt(keys, t - l.start);
  const v = getPath(l as unknown as Record<string, unknown>, path);
  return typeof v === "number" || typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "number")) ? (v as Value) : undefined;
}

// The key of a track at layer-local time localT: the nearest within half a frame.
export function keyAt(keys: Keyframe[] | undefined, localT: number, fps: number): Keyframe | undefined {
  let near: Keyframe | undefined;
  let best = 0.5 / fps;
  for (const k of keys ?? []) {
    const d = Math.abs(k.t - localT);
    if (d <= best) [near, best] = [k, d];
  }
  return near;
}

const DEFAULT_EASE: Ease = { bezier: [0.33, 0, 0.2, 1] };

// Update the key at localT (within half a frame), or add one. A new key takes the ease of the key
// before it, so the motion after it keeps its shape, unless an ease is given.
function upsertKey(l: Layer, path: string, localT: number, v: Value, fps: number, ease?: Ease) {
  const keys = (l.anim[path] ??= []);
  const near = keyAt(keys, localT, fps);
  if (near) {
    near.v = normalize(path, v);
    if (ease) near.ease = ease;
    return;
  }
  const prev = keys.filter((k) => k.t < localT).at(-1) ?? keys.find((k) => k.t > localT);
  keys.push({ id: newId("key"), t: localT, v: normalize(path, v), ease: ease ?? (prev ? prev.ease : DEFAULT_EASE) });
  sortKeys(keys);
}

// A code layer's scene clock, made independent of its clip: the scene time at the clip's start
// (props.sceneIn) and the scene's length (props.sceneT). Until set, the clip is the scene (0 and
// end - start). Pinned before a trim, so a trim only shows less or more of the scene (and of the
// text split out of it) instead of re-timing it. Lengthened past the stretch its text was split
// from (props.splitSpan), the code paints its own text there.
function pinScene(l: Layer) {
  if (l.type !== "code") return;
  if (!(typeof l.props.sceneT === "number" && l.props.sceneT > 0)) l.props.sceneT = Math.max(1e-3, l.end - l.start);
  if (typeof l.props.sceneIn !== "number") l.props.sceneIn = 0;
}

// ── Layers ─────────────────────────────────────────────────────────────────

export const addLayer =
  (input: Partial<Layer> & Pick<Layer, "type">, index?: number): Op =>
  (doc) => {
    const tr = input.transform as Partial<Layer["transform"]> | undefined;
    const layer = LayerSchema.parse({
      id: newId("layer"),
      name: input.type,
      start: 0,
      end: doc.meta.duration,
      ...input,
      ...(tr && typeof tr.opacity === "number" ? { transform: { ...tr, opacity: Number.isFinite(tr.opacity) ? clamp01(tr.opacity) : 1 } } : {}),
    });
    // A code layer copied from a split one would skip text that no layer of its own paints: it starts
    // unsplit (painting all its text) unless text split from it is already in the doc.
    if (layer.type === "code" && !doc.layers.some((l) => l.props.splitFrom === layer.id)) layer.props = unsplit(layer.props);
    if (index === undefined) doc.layers.push(layer);
    else doc.layers.splice(index, 0, layer);
  };

export const removeLayers =
  (ids: string[]): Op =>
  (doc) => {
    const gone = new Set(ids);
    // Removing a group removes its children too, and removing a code layer the text split out of it.
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of doc.layers) {
        if (gone.has(l.id)) continue;
        const owner = typeof l.props.splitFrom === "string" ? l.props.splitFrom : l.type === "part" && typeof l.props.partOf === "string" ? l.props.partOf : null;
        if ((l.parentId && gone.has(l.parentId)) || (owner && gone.has(owner) && doc.layers.some((o) => o.id === owner && o.type === "code"))) {
          gone.add(l.id);
          grew = true;
        }
      }
    }
    // A deleted part is still in its code layer's code: the layer remembers not to paint it.
    for (const l of doc.layers) {
      if (!gone.has(l.id) || l.type !== "part") continue;
      const owner = doc.layers.find((o) => o.id === l.props.partOf && o.type === "code" && !gone.has(o.id));
      if (!owner || typeof l.props.part !== "string") continue;
      const dropped = Array.isArray(owner.props.dropParts) ? (owner.props.dropParts as unknown[]).filter((x): x is string => typeof x === "string") : [];
      if (!dropped.includes(l.props.part)) owner.props.dropParts = [...dropped, l.props.part];
    }
    doc.layers = doc.layers.filter((l) => !gone.has(l.id));
    pruneLinks(doc); // a copy whose other copies went links nothing
  };

export const reorderLayer =
  (id: string, toIndex: number): Op =>
  (doc) => {
    const from = doc.layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [l] = doc.layers.splice(from, 1);
    doc.layers.splice(Math.max(0, Math.min(toIndex, doc.layers.length)), 0, l);
  };

// A name given by hand: the layer stops being named after its words.
export const renameLayer =
  (id: string, name: string): Op =>
  (doc) => {
    const l = layerById(doc, id);
    l.name = name;
    delete l.props.autoName;
  };

export const setLayerFlags =
  (id: string, flags: Partial<Pick<Layer, "hidden" | "locked" | "blend">>): Op =>
  (doc) => {
    Object.assign(layerById(doc, id), flags);
  };

// Trim a layer's in and out points. Keyframes stay where they are in film time, and so does a code
// layer's scene (and the text split from it, which shows only while its code layer does).
export const trimLayer =
  (id: string, start: number, end: number): Op =>
  (doc) => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const l = layerById(doc, id);
    const s = Math.max(0, Math.min(start, end));
    const delta = s - l.start;
    if (l.type === "code" && (delta || Math.max(s, end) !== l.end)) {
      pinScene(l);
      l.props.sceneIn = (l.props.sceneIn as number) + delta;
    }
    if (delta) for (const keys of Object.values(l.anim)) for (const k of keys) k.t -= delta;
    l.start = s;
    l.end = Math.max(s, end);
  };

// Move layers in time. Text split out of a code layer moves with it.
export const moveLayerTime =
  (ids: string[], dt: number): Op =>
  (doc) => {
    if (!Number.isFinite(dt)) return;
    const asked = new Set(ids);
    const moved = new Set<string>();
    const shift = (l: Layer, d: number) => {
      if (moved.has(l.id)) return;
      moved.add(l.id);
      l.start += d;
      l.end += d;
    };
    for (const id of ids) {
      const l = layerById(doc, id);
      const owner = typeof l.props.splitFrom === "string" ? l.props.splitFrom : null;
      if (owner && asked.has(owner) && doc.layers.some((o) => o.id === owner && o.type === "code")) continue; // goes with its code layer
      const d = Math.max(dt, -l.start);
      shift(l, d);
      if (l.type === "code") for (const c of splitChildren(doc, l.id)) shift(c, Math.max(d, -c.start));
    }
  };

// Cut the layer at index idx at absolute time t; returns the copy (put just after it) that gets [t, end].
function cut(doc: Doc, idx: number, t: number, name: string): Layer {
  const l = doc.layers[idx];
  const copy: Layer = JSON.parse(JSON.stringify(l));
  copy.id = newId("layer");
  copy.name = name;
  const local = t - l.start;
  copy.start = t;
  for (const keys of Object.values(copy.anim)) for (const k of keys) k.t -= local;
  l.end = t;
  doc.layers.splice(idx + 1, 0, copy);
  return copy;
}

// Split at absolute time t: the original keeps [start, t], a copy gets [t, end]. A code layer's
// copy goes on with the same scene from t, and takes the text split from it that is on after t
// (text across the cut is cut too). A cut copy of linked text goes its own way.
export const splitLayer =
  (id: string, t: number): Op =>
  (doc) => {
    const idx = doc.layers.findIndex((l) => l.id === id);
    const l = doc.layers[idx];
    if (!l || !(t > l.start && t < l.end)) return;
    pinScene(l);
    const local = t - l.start;
    const children = l.type === "code" ? splitChildren(doc, l.id) : [];
    const copy = cut(doc, idx, t, `${l.name} (split)`);
    if (l.type !== "code") {
      delete copy.props.linkId;
      return;
    }
    copy.props.sceneIn = (l.props.sceneIn as number) + local;
    // Links stay within one code layer's text: the copy's text is linked among itself.
    const links = new Map<string, string>();
    const take = (c: Layer) => {
      c.props.splitFrom = copy.id;
      const link = c.props.linkId;
      if (typeof link !== "string") return;
      if (!links.has(link)) links.set(link, newId("link"));
      c.props.linkId = links.get(link)!;
    };
    for (const c of children) {
      if (c.start >= t) take(c);
      else if (c.end > t) take(cut(doc, doc.layers.indexOf(c), t, c.name));
    }
    // Text all on one side of the cut may have left a link of one behind: it links nothing.
    pruneLinks(doc);
  };

// Drop links that only one layer is left in.
function pruneLinks(doc: Doc) {
  const count = new Map<string, number>();
  for (const l of doc.layers) if (typeof l.props.linkId === "string") count.set(l.props.linkId, (count.get(l.props.linkId) ?? 0) + 1);
  for (const l of doc.layers) if (typeof l.props.linkId === "string" && count.get(l.props.linkId) === 1) delete l.props.linkId;
}

export const groupLayers =
  (ids: string[], name = "Group"): Op =>
  (doc) => {
    if (!ids.length) return;
    const members = doc.layers.filter((l) => ids.includes(l.id));
    const group = LayerSchema.parse({
      id: newId("group"),
      name,
      type: "group",
      start: Math.min(...members.map((m) => m.start)),
      end: Math.max(...members.map((m) => m.end)),
      parentId: members[0].parentId,
    });
    for (const m of members) m.parentId = group.id;
    const at = Math.max(...members.map((m) => doc.layers.indexOf(m)));
    doc.layers.splice(at + 1, 0, group);
  };

export const ungroup =
  (groupId: string): Op =>
  (doc) => {
    const g = layerById(doc, groupId);
    for (const l of doc.layers) if (l.parentId === groupId) l.parentId = g.parentId;
    doc.layers = doc.layers.filter((l) => l.id !== groupId);
  };

// Take a layer out of its link: its words and face no longer change with its copies'.
export const unlinkLayer =
  (id: string): Op =>
  (doc) => {
    const l = layerById(doc, id);
    const link = l.props.linkId;
    if (typeof link !== "string") return;
    delete l.props.linkId;
    const rest = doc.layers.filter((x) => x.props.linkId === link);
    if (rest.length === 1) delete rest[0].props.linkId; // a link of one links nothing
  };

// ── Properties & keyframes ─────────────────────────────────────────────────

// Set a property at doc time t.
// - Static properties are written directly; autoKey keys them at t instead.
// - Animated properties get a key at t (updated within half a frame of an existing one, else added),
//   except on split text, whose keys are a recording: a new position, size, rotation, scale or opacity
//   moves the whole track so it reads `value` at t (a drag or a typed X moves the shaking word, shake
//   and all; a fade keeps fading), and a new colour or other string replaces the value shown at t
//   wherever the track has it (every frame of a strobe's white, say).
// - props.text changes the layer's words for its whole clip (setText) unless autoKey.
// Words, size and face (LINKED_PATHS) change on every linked copy too: a number by as much as on
// this layer (a copy drawn bigger stays bigger), anything else to the same value.
export const setProp =
  (id: string, path: string, value: Value, t: number, autoKey = false): Op =>
  (doc) => {
    if (!finite(value) || !Number.isFinite(t)) return;
    if (path === "props.text" && typeof value === "string" && !autoKey) return setText(id, value, t)(doc);
    const fps = doc.meta.fps;
    const l = layerById(doc, id);
    const copies = LINKED_PATHS.has(path) ? linkedLayers(doc, id).slice(1) : [];
    const before = shownAt(l, path, t);
    const d = before === undefined ? null : sub(value, before);
    setOne(l, path, value, t, fps, autoKey);
    for (const c of copies) {
      const own = shownAt(c, path, t);
      setOne(c, path, d !== null && own !== undefined && sub(own, own) !== null ? add(own, d) : value, t, fps, autoKey);
    }
    if (path === "props.text") for (const x of [l, ...copies]) if (x.props.autoName) x.name = textLabel(finalText(x));
  };

function setOne(l: Layer, path: string, value: Value, t: number, fps: number, autoKey: boolean) {
  const keys = l.anim[path];
  if (autoKey) upsertKey(l, path, t - l.start, value, fps);
  else if (!keys?.length) setStatic(l, path, value);
  else if (recorded(l) && MOVED.has(path) && moveTo(l, path, value, t)) return;
  else if (recorded(l) && typeof value === "string") replaceShown(l, path, valueAt(keys, t - l.start)!, value, t, fps);
  else upsertKey(l, path, t - l.start, value, fps);
}

// Move a property's whole track (or its static value) so it reads `value` at doc time t, keeping its
// motion: by the difference, or for a keyed opacity by the ratio (a fade stays a fade instead of being
// cut off at 0 or 1). False when it can't (not a number).
function moveTo(l: Layer, path: string, value: Value, t: number): boolean {
  const shown = shownAt(l, path, t);
  const keys = l.anim[path];
  if (path === "transform.opacity" && keys?.length && typeof value === "number" && typeof shown === "number" && shown > 1e-3) {
    for (const k of keys) if (typeof k.v === "number") k.v = clamp01(k.v * (value / shown));
    return true;
  }
  const d = shown === undefined ? null : sub(value, shown);
  if (d === null) return false;
  offsetTrack(l, path, d);
  return true;
}

// Every key showing `shown` now shows `value` (no key does: a key at t instead).
function replaceShown(l: Layer, path: string, shown: Value, value: Value, t: number, fps: number) {
  const same = JSON.stringify(shown);
  let hit = false;
  for (const k of l.anim[path]) if (JSON.stringify(k.v) === same) [k.v, hit] = [normalize(path, value), true];
  if (!hit) upsertKey(l, path, t - l.start, value, fps);
}

function offsetTrack(l: Layer, path: string, d: number | number[]) {
  const keys = l.anim[path];
  if (keys?.length) for (const k of keys) k.v = normalize(path, add(k.v, d));
  else {
    const cur = getPath(l as unknown as Record<string, unknown>, path);
    if (typeof cur === "number" || Array.isArray(cur)) setStatic(l, path, add(cur as Value, d));
  }
}

// Move a property's whole track by `delta` (added to every key, or to the static value), keeping its
// motion: how a recorded shake or slide is moved instead of bent at one frame. Size and face move on
// linked copies too.
export const offsetProp =
  (id: string, path: string, delta: number | number[]): Op =>
  (doc) => {
    if (!finite(delta)) return;
    for (const l of LINKED_PATHS.has(path) ? linkedLayers(doc, id) : [layerById(doc, id)]) offsetTrack(l, path, delta);
  };

// Move a property's whole track so it reads `value` at doc time t (what a drag or a typed number
// means on a recorded track; opacity scales, so a fade keeps its shape). Repeated within one gesture,
// it lands on the latest value, not a sum. Size and face move linked copies by as much.
export const offsetPropTo =
  (id: string, path: string, value: number | number[], t: number): Op =>
  (doc) => {
    if (!finite(value) || !Number.isFinite(t)) return;
    const l = layerById(doc, id);
    const shown = shownAt(l, path, t);
    const d = shown === undefined ? null : sub(value, shown);
    if (d === null || !moveTo(l, path, value, t)) return setProp(id, path, value, t)(doc);
    if (LINKED_PATHS.has(path)) for (const c of linkedLayers(doc, id).slice(1)) offsetTrack(c, path, d);
  };

const finalText = (l: Layer) => {
  const keys = l.anim["props.text"];
  return String(keys?.length ? keys[keys.length - 1].v : l.props.text ?? "");
};

// Change a layer's words for its whole clip (and its linked copies'), renaming layers named after
// their words. Text keyed as it was drawn changes everywhere:
// - typed text (every key a prefix of the longest) becomes the new words typed at the same pace,
//   as a character reveal;
// - a counter (keys that differ only in their digits) becomes the new words, standing still;
// - otherwise every key showing the words shown at doc time t (or the words it ends on) shows the new words.
export const setText =
  (id: string, text: string, t?: number): Op =>
  (doc) => {
    if (t !== undefined && !Number.isFinite(t)) t = undefined;
    for (const l of linkedLayers(doc, id)) {
      const keys = l.anim["props.text"];
      if (keys?.length) {
        const vals = keys.map((k) => String(k.v));
        const longest = vals.reduce((a, b) => (b.length > a.length ? b : a), "");
        const typed = vals.some((v) => v !== longest) && vals.every((v) => longest.startsWith(v));
        const counted = !typed && vals.every((v) => evolves(v, vals[0]));
        if (typed || counted) {
          delete l.anim["props.text"];
          l.props.text = text;
          if (typed && (l.props.revealMode ?? "none") === "none" && !l.anim["props.reveal"]) {
            // Shows floor(reveal × length) characters: exactly the typed prefix for the original words.
            l.props.revealMode = "chars";
            delete l.props.reveal;
            l.anim["props.reveal"] = keys.map((k) => ({ id: newId("key"), t: k.t, v: longest.length ? Math.min(1, String(k.v).length / longest.length + 1e-9) : 1, ease: "hold" as const }));
          }
        } else {
          const shown = t === undefined ? vals[vals.length - 1] : String(valueAt(keys, t - l.start));
          replaceShown(l, "props.text", shown, text, t ?? l.start, doc.meta.fps);
        }
      } else l.props.text = text;
      if (l.props.autoName) l.name = textLabel(finalText(l));
    }
  };

export const addKeyframe =
  (id: string, path: string, localT: number, v: Value, ease?: Ease): Op =>
  (doc) => {
    if (!finite(v) || !Number.isFinite(localT)) return;
    upsertKey(layerById(doc, id), path, localT, v, doc.meta.fps, ease);
  };

// Remove keyframes. A property that loses its last key keeps the value it had at doc time t (by
// default, the value it ends on; for opacity, its most opaque), not the property's default.
export const removeKeyframes =
  (sel: { layerId: string; path: string; keyId: string }[], t?: number): Op =>
  (doc) => {
    const before = new Map<string, Keyframe[]>();
    for (const s of sel) {
      const l = layerById(doc, s.layerId);
      const keys = l.anim[s.path] ?? [];
      const id = `${s.layerId}\u0000${s.path}`;
      if (!before.has(id)) before.set(id, [...keys]);
      const rest = keys.filter((k) => k.id !== s.keyId);
      if (rest.length) {
        l.anim[s.path] = rest;
        continue;
      }
      const all = before.get(id)!;
      if (all.length) {
        const v =
          t !== undefined && Number.isFinite(t) ? valueAt(all, t - l.start)!
          : s.path === "transform.opacity" ? Math.max(...all.map((k) => Number(k.v)))
          : all[all.length - 1].v;
        setStatic(l, s.path, v);
      }
      delete l.anim[s.path];
    }
  };

export const moveKeyframes =
  (sel: { layerId: string; path: string; keyId: string }[], dt: number): Op =>
  (doc) => {
    if (!Number.isFinite(dt)) return;
    const touched = new Set<string>();
    for (const s of sel) {
      const k = layerById(doc, s.layerId).anim[s.path]?.find((x) => x.id === s.keyId);
      if (k) k.t += dt;
      touched.add(`${s.layerId}\u0000${s.path}`);
    }
    for (const key of touched) {
      const [layerId, path] = key.split("\u0000");
      const keys = layerById(doc, layerId).anim[path];
      if (keys) sortKeys(keys);
    }
  };

export const setEase =
  (sel: { layerId: string; path: string; keyId: string }[], ease: Ease): Op =>
  (doc) => {
    for (const s of sel) {
      const k = layerById(doc, s.layerId).anim[s.path]?.find((x) => x.id === s.keyId);
      if (k) k.ease = ease;
    }
  };

// ── Time ───────────────────────────────────────────────────────────────────

// Change the film length. "scale" stretches everything proportionally (the
// length slider); "ripple" shifts everything after `from` by the difference.
// Text split out of a code layer keeps to its code layer: it shifts when that does, and stays put
// when the code layer only grows or shrinks (its scene doesn't move, so neither does its text).
export const retime =
  (duration: number, mode: "scale" | "ripple" = "scale", from = 0): Op =>
  (doc) => {
    const old = doc.meta.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration === old) return;
    if (mode === "scale") {
      const s = duration / old;
      for (const l of doc.layers) {
        l.start *= s;
        l.end *= s;
        for (const keys of Object.values(l.anim)) for (const k of keys) k.t *= s;
        // The scene's clock stretches too (by itself while the clip is the scene), and with it the
        // stretch of it the text was split from.
        if (l.type === "code" && typeof l.props.sceneT === "number") {
          l.props.sceneT *= s;
          l.props.sceneIn = (Number(l.props.sceneIn) || 0) * s;
        }
        const span = l.props.splitSpan;
        if (l.type === "code" && Array.isArray(span) && span.every((x) => typeof x === "number")) l.props.splitSpan = span.map((x: number) => x * s);
      }
      for (const a of doc.audio) {
        a.start *= s;
        for (const g of a.gain) g.t *= s;
      }
      for (const m of doc.markers) m.t *= s;
    } else {
      const d = duration - old;
      const code = new Map(doc.layers.filter((l) => l.type === "code").map((l) => [l.id, l]));
      const ownerOf = (l: Layer) => (typeof l.props.splitFrom === "string" ? code.get(l.props.splitFrom) : undefined);
      const shifted = new Map<string, number>();
      for (const l of doc.layers) {
        if (ownerOf(l)) continue;
        if (l.start >= from) {
          const s = Math.max(0, l.start + d);
          shifted.set(l.id, s - l.start);
          l.end += s - l.start;
          l.start = s;
        } else if (l.end > from) {
          pinScene(l);
          l.end = Math.max(l.start, l.end + d);
        }
      }
      for (const l of doc.layers) {
        const o = ownerOf(l);
        const sd = o && shifted.get(o.id);
        if (!sd) continue;
        const s = Math.max(0, l.start + sd);
        l.end += s - l.start;
        l.start = s;
      }
      for (const a of doc.audio) if (a.start >= from) a.start = Math.max(0, a.start + d);
      for (const m of doc.markers) if (m.t >= from) m.t = Math.max(0, m.t + d);
    }
    doc.meta.duration = duration;
  };
