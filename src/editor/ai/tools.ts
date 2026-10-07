import { produce } from "immer";
import type Anthropic from "@anthropic-ai/sdk";
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
  retime,
  setEase,
  setLayerFlags,
  setProp,
  splitLayer,
  trimLayer,
  type Op,
} from "../doc/ops";
import { propAt } from "../doc/interpolate";
import { Doc, type Ease, LayerType, type Value } from "../doc/schema";

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
  tool("list_layers", "List every layer with id, name, type, timing, position and which properties are animated.", {}),
  tool("get_layer", "Full JSON of one layer, including all keyframes.", { layer_id: { type: "string" } }),
  tool(
    "set_property",
    "Set a property. If the property is animated, this writes a keyframe at `time` (seconds, film time); otherwise it sets the static value. Pass time null to use the playhead. Paths: transform.x, transform.y, transform.rotation, transform.opacity, transform.scale ([sx, sy]), or props.<name> (e.g. props.text, props.size, props.color, props.fill).",
    { layer_id: { type: "string" }, path: { type: "string" }, value, time: nul({ type: "number" }) },
  ),
  tool(
    "add_keyframe",
    "Add (or overwrite) a keyframe at film time `time` (seconds). The ease shapes motion from this key to the next.",
    { layer_id: { type: "string" }, path: { type: "string" }, time: { type: "number" }, value, ease: { type: "string", enum: EASE_NAMES } },
  ),
  tool("remove_keyframes", "Remove keyframes on a property at the given film times (seconds, matched within one frame). Pass times null to remove all keys on that property.", {
    layer_id: { type: "string" },
    path: { type: "string" },
    times: nul({ type: "array", items: { type: "number" } }),
  }),
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
  tool("move_layers", "Move layers in time by dt seconds (positive = later). Keyframes travel with them.", {
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
      type: { type: "string", enum: LayerType.options.filter((t) => t !== "code" && t !== "group" && t !== "video") },
      name: { type: "string" },
      start: { type: "number" },
      end: { type: "number" },
      x: { type: "number" },
      y: { type: "number" },
      props_json: { type: "string", description: "JSON object of props" },
      above_layer_id: nul({ type: "string" }),
    },
  ),
  tool("delete_layers", "Delete layers (and children of groups).", { layer_ids: { type: "array", items: { type: "string" } } }),
  tool("rename_layer", "Rename a layer.", { layer_id: { type: "string" }, name: { type: "string" } }),
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

export function summarizeDoc(doc: Doc, time: number) {
  const lines = doc.layers.map((l, i) => {
    const x = propAt(l, "transform.x", time), y = propAt(l, "transform.y", time);
    const keyProps = ["text", "number", "size", "color", "fill", "stroke", "R"].filter((k) => l.props[k] !== undefined).map((k) => `${k}=${short(l.props[k], 50)}`);
    const anim = Object.keys(l.anim);
    return `#${i} ${l.id} | "${l.name}" | ${l.type} | ${l.start.toFixed(2)}–${l.end.toFixed(2)}s | x=${Math.round(x as number)} y=${Math.round(y as number)}${l.hidden ? " | hidden" : ""}${l.locked ? " | locked" : ""}${keyProps.length ? " | " + keyProps.join(" ") : ""}${anim.length ? " | animated: " + anim.join(", ") : ""}`;
  });
  return `Film "${doc.meta.title}" · ${doc.meta.size.w}×${doc.meta.size.h} · ${doc.meta.duration}s · ${doc.meta.fps}fps · background ${doc.meta.background}
Markers: ${doc.markers.map((m) => `${m.label}@${m.t}s`).join(", ") || "none"}
Layers (paint order, #0 = back):
${lines.join("\n")}`;
}

type In = Record<string, unknown>;
export type ToolOutcome = { doc: Doc; result: string; label: string; seek?: number; isError?: boolean };

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
    return { doc: next, result, label };
  };

  try {
    switch (name) {
      case "list_layers":
        return { doc, result: summarizeDoc(doc, playhead), label: "Read the layers" };
      case "get_layer":
        return { doc, result: JSON.stringify(layer(input.layer_id)), label: `Inspected ${layer(input.layer_id).name}` };
      case "set_property": {
        const l = layer(input.layer_id);
        const t = (input.time as number | null) ?? playhead;
        return ok(apply(setProp(l.id, String(input.path), input.value as Value, t)), `Set ${l.name} · ${input.path}`);
      }
      case "add_keyframe": {
        const l = layer(input.layer_id);
        const ease = EASES[String(input.ease)] ?? EASES.ease_out;
        return ok(apply(addKeyframe(l.id, String(input.path), (input.time as number) - l.start, input.value as Value, ease)), `Keyframed ${l.name} · ${input.path} @ ${(input.time as number).toFixed(2)}s`);
      }
      case "remove_keyframes": {
        const l = layer(input.layer_id);
        const path = String(input.path);
        const times = input.times as number[] | null;
        const keys = (l.anim[path] ?? []).filter((k) => !times || times.some((t) => Math.abs(l.start + k.t - t) <= 1 / fps(doc)));
        return ok(apply(removeKeyframes(keys.map((k) => ({ layerId: l.id, path, keyId: k.id })))), `Removed ${keys.length} keyframe${keys.length === 1 ? "" : "s"} on ${l.name}`, `removed ${keys.length}`);
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
      case "rename_layer": {
        const l = layer(input.layer_id);
        return ok(apply(renameLayer(l.id, String(input.name))), `Renamed ${l.name} → ${input.name}`);
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
        return ok(apply(reorderLayer(l.id, input.index as number)), `Reordered ${l.name}`);
      }
      case "group_layers": {
        const ids = (input.layer_ids as string[]).map((id) => layer(id).id);
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

export const AGENT_SYSTEM = `You are the editing agent inside animate's timeline editor (think Figma's canvas plus Premiere's timeline). The user talks to you instead of editing by hand; you make the change directly with your tools, then reply in one or two short sentences saying what you changed.

How the film works:
- A document of layers painted back to front. Times are in seconds of film time. Canvas coordinates are pixels (origin top-left).
- Every layer has start/end (when it is visible), a transform (x, y, rotation in degrees, opacity 0–1, scale [sx, sy]) and type-specific props.
- Any property can be keyframed. Paths are "transform.x", "transform.opacity", "props.size", "props.reveal" and so on. Keyframe times you pass are film times; the tools handle layer-local conversion.
- Text layers: x is the alignment point and y the baseline. props.reveal (0–1) drives a word-by-word reveal when revealMode is "words". props.number shows a counting number.
- Eases describe motion from a key to the next: ease_out for arrivals, ease_in for exits, ease_in_out for moves, spring for a lively settle, hold for a jump cut.

How to work:
- Act; don't ask, unless the request is genuinely ambiguous. Resolve "the headline", "the globe", "the end card" etc. from layer names, types and timing. Call get_layer before changing a layer's animation so you preserve what's there.
- Respect existing timing and style unless asked. When moving a section, move every layer in it together (clips and their keyframes travel together with move_layers).
- Keep elements inside the frame and legible. Match the film's existing palette and type unless asked otherwise.
- Finish by calling seek to a moment that shows the change.
- If something can't be done with the tools, say so plainly.`;
