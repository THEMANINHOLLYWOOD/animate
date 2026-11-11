import { produce } from "immer";
import type Anthropic from "@anthropic-ai/sdk";
import { splitLive, withKeyedControls } from "../extract/codeHash";
import { controlKey, controlPath, controlValue, declaredControls } from "@/lib/controls";
import {
  addKeyframe,
  addLayer,
  groupLayers,
  moveKeyframes,
  moveLayerTime,
  removeKeyframes,
  removeLayers,
  renameLayer,
  reorderLayer,
  restorePart,
  retime,
  setEase,
  setLayerFlags,
  setProp,
  setText,
  splitLayer,
  trimLayer,
  unlinkLayer,
  type Op,
} from "../doc/ops";
import { propAt } from "../doc/interpolate";
import { Doc, type Ease, type Keyframe, type Layer, type Value } from "../doc/schema";
import { isStoodDown, linkedLayers, splitChildren, splitOwner, splitStatus } from "../doc/split";
import type { EditorState } from "../store/store";

// Tools the editor agent can call. Each maps onto the same pure ops the UI uses,
// so anything the agent does is exactly what a person could do by hand.

export const EASES: Record<string, Ease> = {
  linear: "linear",
  hold: "hold",
  ease_out: { bezier: [0.22, 1, 0.36, 1] },
  ease_in: { bezier: [0.55, 0, 1, 0.45] },
  ease_in_out: { bezier: [0.65, 0, 0.35, 1] },
  spring: { spring: { stiffness: 170, damping: 12 } },
};
const EASE_NAMES = Object.keys(EASES);

// The most the editor sends the agent in one request (a hosted function takes 4.5 MB at most).
export const MAX_AGENT_BODY = 4_000_000;

const value = { anyOf: [{ type: "number" }, { type: "string" }, { type: "array", items: { type: "number" } }] };
const nul = (t: object) => ({ anyOf: [t, { type: "null" }] });

function tool(name: string, description: string, properties: Record<string, object>): Anthropic.Tool {
  return {
    name,
    description,
    strict: true,
    input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  tool(
    "list_layers",
    "List every layer with id, name, type, timing, position and key props at the playhead, how split text relates to its code layer and its linked copies, and which properties are animated (long recorded tracks with their key counts).",
    {},
  ),
  tool(
    "get_layer",
    "One layer as JSON: transform, props, effects and its keyframe tracks. Keyframe times are film seconds. A long track (recorded motion on split text) is summarised: key count, time span, value range and its first and last keys; get_keyframes lists it. A code layer's props.code comes whole (other very long props are cut short).",
    { layer_id: { type: "string" } },
  ),
  tool("get_keyframes", "List one property's keyframes (film seconds, value, ease), optionally only those between film times from and to (null = no bound). At most 200 keys per call.", {
    layer_id: { type: "string" },
    path: { type: "string" },
    from: nul({ type: "number" }),
    to: nul({ type: "number" }),
  }),
  tool(
    "set_property",
    "Set a property at `time` (film seconds; null = the playhead). A static property takes the value; an animated one gets a keyframe at `time`. On split text (props.splitFrom) whose property is a recorded track, a new transform.x/y/rotation/scale/opacity or props.size moves the whole track so it reads the value at `time` (its motion is kept; opacity scales, so a fade stays a fade), and a colour or other string replaces every frame showing the current value, instead of writing one keyframe. Size and face (props.size, family, weight, italic, tracking, font) change on linked copies too. For words, use set_text. Paths: transform.x, transform.y, transform.rotation, transform.opacity, transform.scale ([sx, sy]), or props.<name> (e.g. props.size, props.color, props.fill).",
    { layer_id: { type: "string" }, path: { type: "string" }, value, time: nul({ type: "number" }) },
  ),
  tool(
    "set_text",
    "Change what a text layer says, for its whole clip. Use this for any change of words, above all on split text: typed text is typed anew at the same pace, a counter becomes the new words, and otherwise every frame showing the words shown at `time` (film seconds; null = the playhead) shows the new ones. Linked copies change too, and layers named by their words are renamed.",
    { layer_id: { type: "string" }, text: { type: "string" }, time: nul({ type: "number" }) },
  ),
  tool(
    "add_keyframe",
    "Add (or overwrite) a keyframe at film time `time` (seconds). The ease shapes motion from this key to the next.",
    { layer_id: { type: "string" }, path: { type: "string" }, time: { type: "number" }, value, ease: { type: "string", enum: EASE_NAMES } },
  ),
  tool(
    "remove_keyframes",
    "Remove keyframes on a property at the given film times (seconds, matched within one frame). Pass times null to remove all keys on that property; it then keeps the value it shows at the playhead.",
    {
      layer_id: { type: "string" },
      path: { type: "string" },
      times: nul({ type: "array", items: { type: "number" } }),
    },
  ),
  tool("shift_keyframes", "Shift all keyframes of a property (or of every property when path is null) by dt seconds.", {
    layer_id: { type: "string" },
    path: nul({ type: "string" }),
    dt: { type: "number" },
  }),
  tool("set_ease", "Set the ease on every keyframe of a property (or all properties when path is null).", {
    layer_id: { type: "string" },
    path: nul({ type: "string" }),
    ease: { type: "string", enum: EASE_NAMES },
  }),
  tool("move_layers", "Move layers in time by dt seconds (positive = later). Keyframes travel with them, and a code layer's split text with it.", {
    layer_ids: { type: "array", items: { type: "string" } },
    dt: { type: "number" },
  }),
  tool("trim_layer", "Set a layer's in and out points (film seconds). Keyframes stay at the same absolute times.", {
    layer_id: { type: "string" },
    start: { type: "number" },
    end: { type: "number" },
  }),
  tool("split_layer", "Split a layer into two at film time `time`.", { layer_id: { type: "string" }, time: { type: "number" } }),
  tool(
    "add_layer",
    "Create a layer. Types: text (props: text, size, family serif|sans|mono, weight, italic, color, align left|center|right, maxWidth, revealMode words|chars|none, reveal 0..1), shape (props: kind rect|ellipse|line, w, h, radius, fill, stroke, lineWidth, points, trim 0..1), waveform (props: w, h, bars, color), globe (props: R, rot, tilt, draw). x/y are canvas pixels (text: x is the alignment point, y is the baseline). Returns the new layer id.",
    {
      type: { type: "string", enum: ["text", "shape", "image", "globe", "waveform"] },
      name: { type: "string" },
      start: { type: "number" },
      end: { type: "number" },
      x: { type: "number" },
      y: { type: "number" },
      props_json: { type: "string", description: "JSON object of props" },
      above_layer_id: nul({ type: "string" }),
    },
  ),
  tool("delete_layers", "Delete layers (and children of groups; deleting a code layer deletes its split text).", { layer_ids: { type: "array", items: { type: "string" } } }),
  tool("restore_object", "Bring back an object that was deleted from a code layer's film (the code layer lists them as removed objects).", { layer_id: { type: "string" }, name: { type: "string" } }),
  tool("rename_layer", "Rename a layer. A layer named by its words keeps the new name from then on.", { layer_id: { type: "string" }, name: { type: "string" } }),
  tool("unlink_layer", "Take a text layer out of its link, so its words, size and face stop changing with its linked copies.", { layer_id: { type: "string" } }),
  tool("set_layer_flags", "Show/hide or lock/unlock a layer. Pass null to leave a flag unchanged.", {
    layer_id: { type: "string" },
    hidden: nul({ type: "boolean" }),
    locked: nul({ type: "boolean" }),
  }),
  tool("reorder_layer", "Move a layer in paint order. 0 = back-most; higher = in front.", { layer_id: { type: "string" }, index: { type: "integer" } }),
  tool("group_layers", "Group layers under a new group layer.", { layer_ids: { type: "array", items: { type: "string" } }, name: { type: "string" } }),
  tool("retime_film", "Change the film length. scale stretches everything proportionally; ripple pushes everything after `from` by the difference.", {
    duration: { type: "number" },
    mode: { type: "string", enum: ["scale", "ripple"] },
    from: { type: "number" },
  }),
  tool("seek", "Move the playhead to film time `time` so the user sees the result.", { time: { type: "number" } }),
];

const short = (s: unknown, n = 70) => {
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return str && str.length > n ? str.slice(0, n) + "…" : str;
};

// Numbers to a few places, for reading (a recording keeps many).
const round = (v: unknown, places = 2): unknown =>
  typeof v === "number" ? Number(v.toFixed(places))
  : Array.isArray(v) ? v.map((x) => round(x, places))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x, places)]))
  : v;

// A track longer than this is a recording (split text keys nearly every frame): summarised, not listed.
const LONG_TRACK = 16;
const KEYS_PER_CALL = 200;
const LONG_PROP = 4000;
// Code is read whole up to this many characters (about 100k tokens); longer code is cut, and the cut
// text is refused as new code so it can't replace the whole.
const MAX_CODE = 400_000;
const CUT_CODE = "…[cut]";

// A property path as it is kept: a film control is named in full by the agent ("props.controls.Fire
// height") and kept under its key; one the code layer doesn't declare is refused.
function pathOf(l: Layer, path: unknown): string {
  const p = String(path);
  if (!p.startsWith("props.controls.")) return p;
  const name = p.slice("props.controls.".length);
  const d = declaredControls(l.props).find((c) => c.name === name || controlKey(c.name) === name);
  if (!d) throw new Error(`${l.name} has no control named "${name}". Its controls: ${declaredControls(l.props).map((c) => c.name).join(", ") || "none"}.`);
  return controlPath(d.name);
}

export function summarizeDoc(doc: Doc, time: number) {
  const links = new Map<string, string[]>();
  for (const l of doc.layers) if (typeof l.props.linkId === "string") links.set(l.props.linkId, [...(links.get(l.props.linkId) ?? []), l.id]);
  const lines = doc.layers.map((l, i) => {
    const x = propAt(l, "transform.x", time), y = propAt(l, "transform.y", time);
    // Shown at the playhead, so a keyed text or colour reads as it looks now.
    const keyProps = ["text", "number", "size", "color", "fill", "stroke", "R"]
      .map((k) => [k, l.anim[`props.${k}`]?.length ? propAt(l, `props.${k}`, time) : l.props[k]] as const)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${short(round(v), 50)}`);
    const notes: string[] = [];
    if (l.type === "code") {
      const n = splitChildren(doc, l.id).length;
      notes.push(`code artwork (${String(l.props.code ?? "").length} chars of code)`);
      const ctl = declaredControls(l.props);
      if (ctl.length)
        notes.push(
          `controls: ${ctl
            .map((d) => `${d.name} (${d.kind}${d.kind === "number" ? ` ${d.min}..${d.max}` : d.kind === "select" ? ` ${d.options.join("/")}` : ""}) = ${short(JSON.stringify(round(controlValue(d, propAt(l, controlPath(d.name), time)))), 40)}`)
            .join("; ")}`,
        );
      const gone = Array.isArray(l.props.dropParts) ? (l.props.dropParts as unknown[]).map(String) : [];
      if (gone.length) notes.push(`removed objects: ${gone.join(", ")} (restore_object brings one back)`);
      if (n) notes.push(`${n} split text layer${n === 1 ? "" : "s"}${splitLive(withKeyedControls(l.props, l.anim)) ? "" : ", stood down (the code, or a control that shapes its text, changed since the split)"}`);
    }
    const owner = splitOwner(doc, l);
    if (owner) notes.push(`split text of ${owner.id}${isStoodDown(doc, l) ? " (stood down)" : ""}`);
    const copies = typeof l.props.linkId === "string" ? (links.get(l.props.linkId) ?? []).filter((id) => id !== l.id) : [];
    if (copies.length) notes.push(`linked with ${copies.slice(0, 3).join(", ")}${copies.length > 3 ? ` +${copies.length - 3} more` : ""}`);
    if (l.parentId) notes.push(`in group ${l.parentId}`);
    const anim = Object.entries(l.anim)
      .filter(([, keys]) => keys.length)
      .map(([path, keys]) => (keys.length > LONG_TRACK ? `${path} (${keys.length} keys)` : path));
    return `#${i} ${l.id} | "${l.name}" | ${l.type} | ${l.start.toFixed(2)}–${l.end.toFixed(2)}s | x=${Math.round(x as number)} y=${Math.round(y as number)}${l.hidden ? " | hidden" : ""}${l.locked ? " | locked" : ""}${keyProps.length ? " | " + keyProps.join(" ") : ""}${notes.length ? " | " + notes.join(" | ") : ""}${anim.length ? " | animated: " + anim.join(", ") : ""}`;
  });
  return `Film "${doc.meta.title}" · ${doc.meta.size.w}×${doc.meta.size.h} · ${doc.meta.duration}s · ${doc.meta.fps}fps · background ${doc.meta.background}
Markers: ${doc.markers.map((m) => `${m.label}@${m.t}s`).join(", ") || "none"}
Layers (paint order, #0 = back):
${lines.join("\n")}`;
}

const easeName = (e: Ease) => (typeof e === "string" ? e : (Object.entries(EASES).find(([, v]) => JSON.stringify(v) === JSON.stringify(e))?.[0] ?? e));
// A key as the agent passes it: at film time.
const keyJson = (l: Layer) => (k: Keyframe) => ({ t: round(l.start + k.t, 3), v: round(k.v, 3), ease: easeName(k.ease) });

function trackJson(l: Layer, keys: Keyframe[]) {
  if (keys.length <= LONG_TRACK) return keys.map(keyJson(l));
  const nums = keys.map((k) => k.v).filter((v): v is number => typeof v === "number");
  const words = [...new Set(keys.map((k) => k.v).filter((v): v is string => typeof v === "string"))];
  return {
    keys: keys.length,
    from: round(l.start + keys[0].t, 3),
    to: round(l.start + keys[keys.length - 1].t, 3),
    ...(nums.length ? { min: round(Math.min(...nums), 3), max: round(Math.max(...nums), 3) } : {}),
    ...(words.length ? { values: words.slice(0, 8).map((s) => short(s, 60)), ...(words.length > 8 ? { otherValues: words.length - 8 } : {}) } : {}),
    first: keys.slice(0, 3).map(keyJson(l)),
    last: keys.slice(-3).map(keyJson(l)),
  };
}

// A layer as the agent reads it: film-time keys, long tracks summarised, long props cut short (but a
// code layer's code whole, as setting props.code replaces all of it), and where split text stands.
function layerJson(doc: Doc, l: Layer, time: number) {
  const props = Object.fromEntries(
    Object.entries(l.props).map(([k, v]) => {
      const json = JSON.stringify(v) ?? "";
      const max = k === "code" ? MAX_CODE : LONG_PROP;
      // A string is measured as it is cut: in characters, not as escaped JSON.
      if ((typeof v === "string" ? v.length : json.length) <= max) return [k, v];
      if (k === "code" && typeof v === "string") return [k, `${v.slice(0, max)}${CUT_CODE} (${v.length} characters in all; too long to rewrite, so leave props.code as it is)`];
      return [k, typeof v === "string" ? `${v.slice(0, max)}… (${v.length} characters in all)` : `(a large value: ${json.length} characters of JSON)`];
    }),
  );
  const status = splitStatus(doc, l, time);
  const linked = linkedLayers(doc, l.id).slice(1).map((x) => x.id);
  return {
    id: l.id,
    name: l.name,
    type: l.type,
    parentId: l.parentId,
    start: round(l.start, 3),
    end: round(l.end, 3),
    hidden: l.hidden,
    locked: l.locked,
    blend: l.blend,
    transform: round(l.transform, 3),
    props,
    anim: Object.fromEntries(Object.entries(l.anim).map(([path, keys]) => [path, trackJson(l, keys)])),
    ...(status ? { split: { from: l.props.splitFrom, status } } : {}),
    ...(linked.length ? { linkedWith: linked } : {}),
    ...(l.type === "code" ? { splitText: splitChildren(doc, l.id).map((x) => x.id) } : {}),
  };
}

type In = Record<string, unknown>;
// created: the ids of layers the call made, in paint order (so a replay can map them to its own).
export type ToolOutcome = { doc: Doc; result: string; label: string; seek?: number; isError?: boolean; created?: string[] };

const fps = (doc: Doc) => doc.meta.fps;

// Execute one tool call against a doc. Returns the new doc (immutably) and a result for Claude.
export function runTool(doc: Doc, name: string, input: In, playhead: number): ToolOutcome {
  const apply = (op: Op) => produce(doc, op);
  const layer = (id: unknown) => {
    const l = doc.layers.find((x) => x.id === id);
    if (!l) throw new Error(`No layer with id ${String(id)}. Call list_layers to see ids.`);
    return l;
  };
  const ok = (next: Doc, label: string, result = "ok"): ToolOutcome => {
    Doc.parse(next); // every edit must leave a valid document
    const had = new Set(doc.layers.map((l) => l.id));
    const created = next.layers.filter((l) => !had.has(l.id)).map((l) => l.id);
    return { doc: next, result, label, ...(created.length ? { created } : {}) };
  };
  // Edits to text that has stood down don't show until its text is split again: say so.
  const shows = (l: Layer, result = "ok") => (isStoodDown(doc, l) ? `${result}. Note: this split text has stood down (its code, or a control that shapes its text, changed), so the change won't show until the text is split again.` : result);

  try {
    switch (name) {
      case "list_layers":
        return { doc, result: summarizeDoc(doc, playhead), label: "Read the layers" };
      case "get_layer": {
        const l = layer(input.layer_id);
        return { doc, result: JSON.stringify(layerJson(doc, l, playhead)), label: `Inspected ${l.name}` };
      }
      case "get_keyframes": {
        const l = layer(input.layer_id);
        const path = pathOf(l, input.path);
        const from = typeof input.from === "number" ? input.from : -Infinity;
        const to = typeof input.to === "number" ? input.to : Infinity;
        const keys = (l.anim[path] ?? []).filter((k) => l.start + k.t >= from - 1e-6 && l.start + k.t <= to + 1e-6);
        const shown = keys.slice(0, KEYS_PER_CALL);
        const out = l.anim[path]?.length
          ? { path, keys: shown.map(keyJson(l)), ...(keys.length > shown.length ? { more: keys.length - shown.length, next: round(l.start + keys[shown.length].t, 3) } : {}) }
          : { path, keys: [], static: round(propAt(l, path, playhead), 3) ?? null };
        return { doc, result: JSON.stringify(out), label: `Read ${l.name} · ${path}` };
      }
      case "set_property": {
        const l = layer(input.layer_id);
        const t = (input.time as number | null) ?? playhead;
        if (input.path === "props.code" && typeof input.value === "string" && input.value.includes(CUT_CODE))
          throw new Error("That is the cut-short code get_layer showed, not the whole of it. The code is too long to rewrite here.");
        const path = pathOf(l, input.path);
        if (!/^(transform|props)\.[^.]/.test(path)) throw new Error(`"${input.path}" is not a property path. Paths start with "transform." or "props." (for example transform.opacity, props.size, props.controls.<Name>).`);
        const next = apply(setProp(l.id, path, input.value as Value, t));
        if (next === doc) throw new Error(`Nothing changed: ${l.name} already has that value at ${path}, or the value isn't one that property takes.`);
        // New code stands its split text down: the code paints all its words again.
        const after = next.layers.find((x) => x.id === l.id);
        const text = splitChildren(next, l.id).length;
        if (l.type === "code" && text && splitLive(withKeyedControls(l.props, l.anim)) && after && !splitLive(withKeyedControls(after.props, after.anim)))
          return ok(next, `Set ${l.name} · ${input.path}`, `ok. That changes what the code draws as text, so its ${text} split text layer${text === 1 ? "" : "s"} stood down: the code paints all its words again, and they show once the user splits the text again in the editor.`);
        return ok(next, `Set ${l.name} · ${input.path}`, shows(l));
      }
      case "set_text": {
        const l = layer(input.layer_id);
        if (l.type !== "text") throw new Error(`${l.name} is a ${l.type} layer, not text.`);
        const t = (input.time as number | null) ?? playhead;
        const copies = linkedLayers(doc, l.id).length - 1;
        const next = apply(setText(l.id, String(input.text), t));
        return ok(next, `Changed the words of ${l.name}`, shows(l, copies ? `ok (and on ${copies} linked cop${copies === 1 ? "y" : "ies"})` : "ok"));
      }
      case "add_keyframe": {
        const l = layer(input.layer_id);
        const ease = EASES[String(input.ease)] ?? EASES.ease_out;
        return ok(apply(addKeyframe(l.id, pathOf(l, input.path), (input.time as number) - l.start, input.value as Value, ease)), `Keyframed ${l.name} · ${input.path} @ ${(input.time as number).toFixed(2)}s`, shows(l));
      }
      case "remove_keyframes": {
        const l = layer(input.layer_id);
        const path = pathOf(l, input.path);
        const times = input.times as number[] | null;
        const keys = (l.anim[path] ?? []).filter((k) => !times || times.some((t) => Math.abs(l.start + k.t - t) <= 1 / fps(doc)));
        return ok(apply(removeKeyframes(keys.map((k) => ({ layerId: l.id, path, keyId: k.id })), playhead)), `Removed ${keys.length} keyframe${keys.length === 1 ? "" : "s"} on ${l.name}`, `removed ${keys.length}`);
      }
      case "shift_keyframes":
      case "set_ease": {
        const l = layer(input.layer_id);
        const paths = input.path ? [String(input.path)] : Object.keys(l.anim);
        const sel = paths.flatMap((p) => (l.anim[p] ?? []).map((k) => ({ layerId: l.id, path: p, keyId: k.id })));
        if (name === "shift_keyframes") return ok(apply(moveKeyframes(sel, input.dt as number)), `Shifted ${sel.length} keys on ${l.name}`);
        return ok(apply(setEase(sel, EASES[String(input.ease)] ?? "linear")), `Eased ${l.name} · ${input.ease}`);
      }
      case "move_layers": {
        const ids = (input.layer_ids as string[]).map((id) => layer(id).id);
        return ok(apply(moveLayerTime(ids, input.dt as number)), `Moved ${ids.length} layer${ids.length === 1 ? "" : "s"} ${(input.dt as number) > 0 ? "+" : ""}${(input.dt as number).toFixed(2)}s`);
      }
      case "trim_layer": {
        const l = layer(input.layer_id);
        return ok(apply(trimLayer(l.id, input.start as number, input.end as number)), `Trimmed ${l.name}`);
      }
      case "split_layer": {
        const l = layer(input.layer_id);
        if (l.type === "part") throw new Error(`${l.name} is one object its code layer draws, so it can't be split. Trim it, or keyframe its opacity, to change when it shows.`);
        return ok(apply(splitLayer(l.id, input.time as number)), `Split ${l.name}`);
      }
      case "add_layer": {
        let props: Record<string, unknown> = {};
        try {
          props = JSON.parse(String(input.props_json || "{}"));
        } catch {
          throw new Error("props_json is not valid JSON.");
        }
        const above = input.above_layer_id ? doc.layers.findIndex((l) => l.id === input.above_layer_id) : -1;
        const before = new Set(doc.layers.map((l) => l.id));
        const next = apply(
          addLayer(
            {
              type: input.type as never,
              name: String(input.name),
              start: input.start as number,
              end: input.end as number,
              props,
              transform: { x: input.x as number, y: input.y as number, scale: [1, 1], rotation: 0, anchor: [0, 0], opacity: 1 },
            },
            above >= 0 ? above + 1 : undefined,
          ),
        );
        const created = next.layers.find((l) => !before.has(l.id))!;
        return ok(next, `Added ${created.name}`, `created layer id ${created.id}`);
      }
      case "delete_layers": {
        const ids = (input.layer_ids as string[]).map((id) => layer(id).id);
        return ok(apply(removeLayers(ids)), `Deleted ${ids.length} layer${ids.length === 1 ? "" : "s"}`);
      }
      case "restore_object": {
        const l = layer(input.layer_id);
        const next = apply(restorePart(l.id, String(input.name)));
        if (next === doc) throw new Error(`${l.name} has no removed object named "${input.name}".`);
        return ok(next, `Restored ${input.name}`);
      }
      case "rename_layer": {
        const l = layer(input.layer_id);
        return ok(apply(renameLayer(l.id, String(input.name))), `Renamed ${l.name} → ${input.name}`);
      }
      case "unlink_layer": {
        const l = layer(input.layer_id);
        return ok(apply(unlinkLayer(l.id)), `Unlinked ${l.name}`);
      }
      case "set_layer_flags": {
        const l = layer(input.layer_id);
        const flags: { hidden?: boolean; locked?: boolean } = {};
        if (input.hidden !== null) flags.hidden = input.hidden as boolean;
        if (input.locked !== null) flags.locked = input.locked as boolean;
        return ok(apply(setLayerFlags(l.id, flags)), `${flags.hidden === true ? "Hid" : flags.hidden === false ? "Showed" : "Updated"} ${l.name}`);
      }
      case "reorder_layer": {
        const l = layer(input.layer_id);
        if (l.type === "part") throw new Error(`${l.name} is drawn by its code layer, which decides what paints over what: it can't be reordered.`);
        return ok(apply(reorderLayer(l.id, input.index as number)), `Reordered ${l.name}`);
      }
      case "group_layers": {
        const members = (input.layer_ids as string[]).map((id) => layer(id));
        const part = members.find((m) => m.type === "part");
        if (part) throw new Error(`${part.name} is drawn by its code layer and can't be grouped. Move or keyframe the objects one by one.`);
        const ids = members.map((m) => m.id);
        return ok(apply(groupLayers(ids, String(input.name))), `Grouped ${ids.length} layers`);
      }
      case "retime_film":
        return ok(apply(retime(input.duration as number, input.mode as "scale" | "ripple", input.from as number)), `Retimed film to ${input.duration}s`);
      case "seek":
        return { doc, result: "ok", label: `Moved playhead to ${(input.time as number).toFixed(2)}s`, seek: input.time as number };
      default:
        return { doc, result: `Unknown tool ${name}`, label: name, isError: true };
    }
  } catch (e) {
    return { doc, result: `Error: ${(e as Error).message}`, label: `Couldn't ${name.replace(/_/g, " ")}`, isError: true };
  }
}

// ── Applying the agent's work ──────────────────────────────────────────────
// The agent edits a copy of the doc while the person may go on editing the original. Its result is
// the edits it made (each tool call that changed the doc, with the playhead it ran at and the layers
// it made), replayed onto the doc as it is by then: the person's edits stay, and an edit to a layer
// they deleted meanwhile is skipped.

export type AgentCall = { name: string; input: In; t: number; created?: string[] };

const ID_INPUTS = ["layer_id", "above_layer_id"];
const SOME_OF = new Set(["move_layers", "delete_layers"]);

export function replayCalls(doc: Doc, calls: AgentCall[]): { doc: Doc; applied: number; failed: { index: number; error: string }[] } {
  // Layers the agent made have other ids here: its ids, mapped to ours.
  const ids = new Map<string, string>();
  const map = (v: unknown) => (typeof v === "string" ? (ids.get(v) ?? v) : v);
  let applied = 0;
  const failed: { index: number; error: string }[] = [];
  calls.forEach((call, index) => {
    const input: In = { ...call.input };
    for (const k of ID_INPUTS) if (k in input) input[k] = map(input[k]);
    if (Array.isArray(input.layer_ids)) {
      input.layer_ids = input.layer_ids.map(map);
      // Moving or deleting several layers goes ahead on those still there (one deleted meanwhile is
      // left out, not a reason to drop the rest); with none left, it fails as usual.
      if (SOME_OF.has(call.name)) {
        const live = (input.layer_ids as unknown[]).filter((id) => doc.layers.some((l) => l.id === id));
        if (live.length) input.layer_ids = live;
      }
    }
    const out = runTool(doc, call.name, input, call.t);
    if (out.isError) {
      failed.push({ index, error: out.result.replace(/^Error: /, "").replace(/ Call list_layers to see ids\.$/, "") });
      return;
    }
    (call.created ?? []).forEach((theirs, i) => {
      const ours = out.created?.[i];
      if (ours && ours !== theirs) ids.set(theirs, ours);
    });
    if (out.doc !== doc) applied++;
    doc = out.doc;
  });
  return { doc, applied, failed };
}

type Step = EditorState["past"][number];

// The agent's edits replayed onto the editor's doc as it is now and applied through its store (so the
// canvas, timeline and inspector show them at once) as one undo step called `label`. step: that step,
// unless the edits went into a drag being made just then (a step made in an open gesture takes in the
// rest of it), so it holds both. skipped: the calls that couldn't be replayed, with why.
export function commitCalls(store: { getState: () => EditorState }, calls: AgentCall[], label: string) {
  const st = store.getState();
  const before = st.past[st.past.length - 1];
  const r = replayCalls(st.doc, calls);
  const changed = r.doc !== st.doc;
  if (changed) {
    st.apply((d) => {
      for (const k of Object.keys(d) as (keyof Doc)[]) if (!(k in r.doc)) delete d[k];
      Object.assign(d, r.doc);
    }, label);
    const live = new Set(r.doc.layers.map((l) => l.id));
    const { selection } = store.getState();
    if (selection.some((id) => !live.has(id))) st.select(selection.filter((id) => live.has(id)));
  }
  const past = store.getState().past;
  const last = past[past.length - 1];
  const step: Step | undefined = changed && last !== before && last?.label === label && !last.gesture ? last : undefined;
  return { changed, step, skipped: new Map(r.failed.map((f) => [calls[f.index], f.error])) };
}

// Whether a reply's step is undone: while it's on the redo side, not once redone, and once a new edit
// has discarded it from the redo side, still (as it was last seen; `was`).
export const stepUndone = (step: Step, s: Pick<EditorState, "past" | "future">, was = false) =>
  s.future.includes(step) ? true : s.past.includes(step) ? false : was;

type Press = Event & { pointerId?: number; buttons?: number };

// Pointers pressed anywhere on `target` (the window). A drag (pointerdown to pointerup) is one undo
// step, so a reply's edits that arrive meanwhile wait for the release (released) and land after it, as
// their own step. A press whose release the page never sees (a scrollbar drag, a native menu,
// switching apps mid-press) counts as released once that pointer moves with no button down, or the
// window loses focus. `later` runs the waiting replies once the drag's own pointerup listeners have
// ended its gesture.
export function watchPresses(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, later: (f: () => void) => void = (f) => setTimeout(f)) {
  const held = new Set<number>();
  const waiting = new Set<() => void>();
  const release = (id?: number) => {
    if (id === undefined) held.clear();
    else if (!held.delete(id)) return;
    if (!held.size)
      later(() => {
        if (!held.size) for (const f of [...waiting]) f();
      });
  };
  // Pointer events in the capture phase, so a handler that stops them doesn't hide them; blur on the
  // window itself (an element's blur would reach a capturing listener too).
  const on: [string, (e: Press) => void, boolean][] = [
    ["pointerdown", (e) => e.pointerId !== undefined && held.add(e.pointerId), true],
    ["pointerup", (e) => e.pointerId !== undefined && release(e.pointerId), true],
    ["pointercancel", (e) => e.pointerId !== undefined && release(e.pointerId), true],
    ["pointermove", (e) => e.pointerId !== undefined && e.buttons === 0 && held.has(e.pointerId) && release(e.pointerId), true],
    ["blur", () => held.size && release(), false],
  ];
  for (const [type, f, capture] of on) target.addEventListener(type, f as EventListener, { capture });
  return {
    held: () => held.size > 0,
    // Resolves once nothing is pressed (at once if nothing is), or when the signal aborts.
    released: (signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (!held.size || signal?.aborted) return resolve();
        const done = () => {
          waiting.delete(done);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        waiting.add(done);
        signal?.addEventListener("abort", done);
      }),
    stop: () => {
      for (const [type, f, capture] of on) target.removeEventListener(type, f as EventListener, { capture });
      for (const f of [...waiting]) f();
    },
  };
}

// The doc as the agent needs it: embedded media (data: URLs) left out, as no tool reads them and
// they'd count against the request size. The result is replayed onto the full doc, so nothing is lost.
export function docForAgent(doc: Doc): Doc {
  if (!doc.assets.some((a) => a.src.startsWith("data:"))) return doc;
  return { ...doc, assets: doc.assets.map((a) => (a.src.startsWith("data:") ? { ...a, src: "" } : a)) };
}

// ── The conversation ───────────────────────────────────────────────────────

export type AgentMessage = { role: "user" | "assistant"; text: string };

// The conversation as the model takes it: no empty turns, user and assistant alternating (two
// requests in a row get a stand-in reply between them, so neither is read as part of the other),
// starting with the user and ending with the request. Empty when there's no request.
export function cleanHistory(raw: unknown, maxText = 20_000, maxMessages = 12): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    const text = typeof m?.text === "string" ? m.text.slice(0, maxText).trim() : "";
    if (!text) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const prev = out[out.length - 1];
    if (prev?.role === role) {
      if (role === "assistant") {
        prev.text += "\n\n" + text;
        continue;
      }
      out.push({ role: "assistant", text: "(No reply.)" });
    }
    out.push({ role, text });
  }
  if (out[out.length - 1]?.role !== "user") return [];
  const kept = out.slice(-maxMessages);
  while (kept[0]?.role === "assistant") kept.shift();
  return kept;
}

export const AGENT_SYSTEM = `You are the editing agent inside animate's timeline editor (think Figma's canvas plus Premiere's timeline). The user talks to you instead of editing by hand; you make the change directly with your tools, then reply in one or two short sentences saying what you changed.

How the film works:
- A document of layers painted back to front. Times are in seconds of film time. Canvas coordinates are pixels (origin top-left).
- Every layer has start/end (when it is visible), a transform (x, y, rotation in degrees, opacity 0–1, scale [sx, sy]) and type-specific props.
- Any property can be keyframed. Paths are "transform.x", "transform.opacity", "props.size", "props.reveal" and so on. Keyframe times you pass, and the ones get_layer and get_keyframes show, are film times; the tools handle layer-local conversion.
- Text layers: x is the alignment point and y the baseline. props.reveal (0–1) drives a word-by-word reveal when revealMode is "words". props.number shows a counting number.
- Eases describe motion from a key to the next: ease_out for arrivals, ease_in for exits, ease_in_out for moves, spring for a lively settle, hold for a jump cut.

Films made from code (split text):
- A "code" layer is artwork drawn by code. Its words were split out into ordinary text layers so they can be edited (props.splitFrom is the code layer's id; list_layers says "split text of …"). While the split holds, the code leaves those words to their layers. Some text stays in the code (text the split couldn't reproduce exactly); it has no layer.
- Split text belongs to its code layer: it shows only while that layer is on screen and visible, and moves in time with it (move_layers or trim_layer on the code layer takes its text along). Deleting the code layer deletes its text. To remove one word, hide or delete its text layer, never the code layer.
- Split text carries a recording of what the code drew, often a key on nearly every frame (a shake, a slide, a fade, a typed line, a counter); list_layers shows long tracks with their key counts. Don't rebuild a recording key by key: set_property moves a whole recorded position, scale, rotation, opacity or size track so it reads the new value at the time you give (the motion is kept, a fade stays a fade), and a new colour replaces every frame showing the current colour. Use get_keyframes when you need a recording's detail.
- Change words with set_text, never by keyframing props.text: it rewrites the words for the whole clip (typed text is typed anew at the same pace, a counter becomes the new words).
- Linked copies ("linked with …") are the same words drawn more than once, like a shadow under a word. Their words, size and face change together; their position and colour don't. To change one copy alone, unlink_layer it first.
- Layers named “in curly quotes” are named after their words and are renamed when the words change; rename_layer gives a lasting name.
- Changing a code layer's code (props.code) makes its split stand down: the code paints all its own words again and its text layers stop showing ("stood down") until the user splits the text again in the editor; edits to stood-down text don't show. Only change code when the user asks to change the artwork itself: read it with get_layer first, set props.code to the whole new code (it replaces all of it), and tell them the text stood down.

Objects a code layer draws (parts):
- A "part" layer is one named object its code layer draws (the code wraps it in lib.layer(ctx, 'Name', …); props.partOf is the code layer's id, props.part the name). The code still draws it; the part layer says how: transform.x / transform.y move it (0, 0 is where the code puts it), transform.scale and transform.rotation resize and turn it about its own centre, transform.opacity fades it, hidden removes it, and its start/end are when it's allowed to show. All of these can be keyframed like any layer.
- To move, resize, fade, hide or re-time an object, change its part layer, not the code. Deleting a part layer stops the code painting that object. Part layers can't be reordered: the code decides what paints over what.
- If the user wants an object that isn't its own layer to be one, edit the code layer's code and wrap that object's drawing in lib.layer(ctx, 'Name', () => { … }) without changing what it draws; its layer appears on its own.

A film's own controls:
- A code layer may declare controls made for that film (get_layer shows them as props.controlDefs: each has a name, a kind and, by kind, a range, options or a default). They are the first thing to reach for: to change the film's words, colours, intensity, counts or where a key thing sits, set the control, not the code. Set one with set_property on the code layer at path "props.controls.<Name>" (a number within its range, a "#rrggbb" colour, the new words, 1 or 0 for a switch, one of its options, or [x, y] in fractions of the frame for a point). Controls of kind number, color and point can be keyframed at that path like any property.
- Only edit the code when no control or part layer can do what was asked.

How to work:
- Act; don't ask, unless the request is genuinely ambiguous. Resolve "the headline", "the globe", "the end card" etc. from layer names, types, words and timing; "this" or "it" usually means the selected layers. Call get_layer before changing a layer's animation so you preserve what's there.
- Respect existing timing and style unless asked. When moving a section, move every layer in it together (clips and their keyframes travel together with move_layers).
- Keep elements inside the frame and legible. Match the film's existing palette and type unless asked otherwise.
- Finish by calling seek to a moment that shows the change.
- If something can't be done with the tools, say so plainly.`;
