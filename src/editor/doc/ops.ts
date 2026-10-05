import type { Doc, Ease, Keyframe, Layer, Value } from "./schema";
import { Layer as LayerSchema, newId } from "./schema";

// Every edit is a recipe that mutates an Immer draft. The store runs recipes
// through produceWithPatches, which gives immutability and undo for free.
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

// ── Layers ─────────────────────────────────────────────────────────────────

export const addLayer =
  (input: Partial<Layer> & Pick<Layer, "type">, index?: number): Op =>
  (doc) => {
    const layer = LayerSchema.parse({
      id: newId("layer"),
      name: input.type,
      start: 0,
      end: doc.meta.duration,
      ...input,
    });
    if (index === undefined) doc.layers.push(layer);
    else doc.layers.splice(index, 0, layer);
  };

export const removeLayers =
  (ids: string[]): Op =>
  (doc) => {
    const gone = new Set(ids);
    // Removing a group removes its children too.
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of doc.layers) {
        if (l.parentId && gone.has(l.parentId) && !gone.has(l.id)) {
          gone.add(l.id);
          grew = true;
        }
      }
    }
    doc.layers = doc.layers.filter((l) => !gone.has(l.id));
  };

export const reorderLayer =
  (id: string, toIndex: number): Op =>
  (doc) => {
    const from = doc.layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const [l] = doc.layers.splice(from, 1);
    doc.layers.splice(Math.max(0, Math.min(toIndex, doc.layers.length)), 0, l);
  };

export const renameLayer =
  (id: string, name: string): Op =>
  (doc) => {
    layerById(doc, id).name = name;
  };

export const setLayerFlags =
  (id: string, flags: Partial<Pick<Layer, "hidden" | "locked" | "blend">>): Op =>
  (doc) => {
    Object.assign(layerById(doc, id), flags);
  };

export const trimLayer =
  (id: string, start: number, end: number): Op =>
  (doc) => {
    const l = layerById(doc, id);
    const s = Math.max(0, Math.min(start, end));
    const delta = s - l.start;
    // Keep keyframes pinned to the same absolute time when the in-point moves.
    if (delta) for (const keys of Object.values(l.anim)) for (const k of keys) k.t -= delta;
    l.start = s;
    l.end = Math.max(s, end);
  };

export const moveLayerTime =
  (ids: string[], dt: number): Op =>
  (doc) => {
    for (const id of ids) {
      const l = layerById(doc, id);
      const d = Math.max(dt, -l.start);
      l.start += d;
      l.end += d;
    }
  };

// Split at absolute time t: the original keeps [start, t], a copy gets [t, end].
export const splitLayer =
  (id: string, t: number): Op =>
  (doc) => {
    const idx = doc.layers.findIndex((l) => l.id === id);
    const l = doc.layers[idx];
    if (!l || t <= l.start || t >= l.end) return;
    const copy: Layer = JSON.parse(JSON.stringify(l));
    copy.id = newId("layer");
    copy.name = `${l.name} (split)`;
    const local = t - l.start;
    copy.start = t;
    for (const keys of Object.values(copy.anim)) for (const k of keys) k.t -= local;
    l.end = t;
    doc.layers.splice(idx + 1, 0, copy);
  };

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

// ── Properties & keyframes ─────────────────────────────────────────────────

// Set a property at doc time t. Animated properties get a keyframe (added or
// updated); static ones are written directly. autoKey animates static ones too.
export const setProp =
  (id: string, path: string, value: Value, t: number, autoKey = false): Op =>
  (doc) => {
    const l = layerById(doc, id);
    const keys = l.anim[path];
    if (keys?.length || autoKey) {
      upsertKey(l, path, t - l.start, value);
    } else {
      setPath(l as unknown as Record<string, unknown>, path, value);
    }
  };

function upsertKey(l: Layer, path: string, localT: number, v: Value, ease: Ease = { bezier: [0.33, 0, 0.2, 1] }) {
  const keys = (l.anim[path] ??= []);
  const near = keys.find((k) => Math.abs(k.t - localT) < 1e-4);
  if (near) near.v = v;
  else keys.push({ id: newId("key"), t: localT, v, ease });
  sortKeys(keys);
}

export const addKeyframe =
  (id: string, path: string, localT: number, v: Value, ease?: Ease): Op =>
  (doc) => upsertKey(layerById(doc, id), path, localT, v, ease);

export const removeKeyframes =
  (sel: { layerId: string; path: string; keyId: string }[]): Op =>
  (doc) => {
    for (const s of sel) {
      const l = layerById(doc, s.layerId);
      l.anim[s.path] = (l.anim[s.path] ?? []).filter((k) => k.id !== s.keyId);
      if (!l.anim[s.path].length) delete l.anim[s.path];
    }
  };

export const moveKeyframes =
  (sel: { layerId: string; path: string; keyId: string }[], dt: number): Op =>
  (doc) => {
    const touched = new Set<string>();
    for (const s of sel) {
      const k = layerById(doc, s.layerId).anim[s.path]?.find((x) => x.id === s.keyId);
      if (k) k.t += dt;
      touched.add(`${s.layerId}\u0000${s.path}`);
    }
    for (const key of touched) {
      const [layerId, path] = key.split("\u0000");
      sortKeys(layerById(doc, layerId).anim[path]);
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
export const retime =
  (duration: number, mode: "scale" | "ripple" = "scale", from = 0): Op =>
  (doc) => {
    const old = doc.meta.duration;
    if (duration <= 0 || duration === old) return;
    if (mode === "scale") {
      const s = duration / old;
      for (const l of doc.layers) {
        l.start *= s;
        l.end *= s;
        for (const keys of Object.values(l.anim)) for (const k of keys) k.t *= s;
      }
      for (const a of doc.audio) {
        a.start *= s;
        for (const g of a.gain) g.t *= s;
      }
      for (const m of doc.markers) m.t *= s;
    } else {
      const d = duration - old;
      for (const l of doc.layers) {
        if (l.start >= from) {
          l.start += d;
          l.end += d;
        } else if (l.end > from) l.end = Math.max(l.start, l.end + d);
      }
      for (const a of doc.audio) if (a.start >= from) a.start += d;
      for (const m of doc.markers) if (m.t >= from) m.t += d;
    }
    doc.meta.duration = duration;
  };
