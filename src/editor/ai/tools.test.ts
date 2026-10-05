import { describe, expect, it } from "vitest";
import { propAt } from "../doc/interpolate";
import { Doc } from "../doc/schema";
import { buildGaiaDoc } from "../presets/gaiaDoc";
import { AGENT_TOOLS, runTool, summarizeDoc } from "./tools";

const byName = (doc: Doc, name: string) => doc.layers.find((l) => l.name === name)!;

describe("agent tools on the Gaia film", () => {
  const gaia = buildGaiaDoc();

  it("declares strict, valid schemas for every tool", () => {
    for (const t of AGENT_TOOLS) {
      expect(t.strict).toBe(true);
      const schema = t.input_schema as { properties: object; required: string[]; additionalProperties: boolean };
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    }
  });

  it("summarises layers with ids, timing and animated props", () => {
    const s = summarizeDoc(gaia, 7);
    expect(s).toContain('"Headline · line 1"');
    expect(s).toContain("animated: props.reveal");
    expect(s.split("\n").length).toBeGreaterThan(gaia.layers.length);
  });

  it("sets a static property and keyframes an animated one at the playhead", () => {
    const h = byName(gaia, "Headline · line 1");
    let r = runTool(gaia, "set_property", { layer_id: h.id, path: "props.size", value: 130, time: null }, 7);
    expect(byName(r.doc, "Headline · line 1").props.size).toBe(130);
    r = runTool(r.doc, "set_property", { layer_id: h.id, path: "transform.opacity", value: 0.5, time: 7 }, 7);
    expect(propAt(byName(r.doc, "Headline · line 1"), "transform.opacity", 7)).toBeCloseTo(0.5);
    expect(r.isError).toBeFalsy();
  });

  it("moves a whole section later, keyframes travelling with the clips", () => {
    const facts = gaia.layers.filter((l) => l.name.startsWith("Facts") || l.name.startsWith("Principle"));
    const before = propAt(facts[0], "props.reveal", 25.2);
    const r = runTool(gaia, "move_layers", { layer_ids: facts.map((l) => l.id), dt: 2 }, 0);
    const moved = r.doc.layers.find((l) => l.id === facts[0].id)!;
    expect(moved.start).toBeCloseTo(facts[0].start + 2);
    expect(propAt(moved, "props.reveal", 27.2)).toBeCloseTo(before as number);
  });

  it("adds, keyframes, eases and deletes a new layer", () => {
    let r = runTool(
      gaia,
      "add_layer",
      { type: "text", name: "Subtitle", start: 1, end: 5, x: 960, y: 900, props_json: '{"text":"Hello","size":40,"align":"center"}', above_layer_id: null },
      0,
    );
    const id = r.result.replace("created layer id ", "");
    expect(r.doc.layers.find((l) => l.id === id)?.props.text).toBe("Hello");
    r = runTool(r.doc, "add_keyframe", { layer_id: id, path: "transform.opacity", time: 1, value: 0, ease: "ease_out" }, 0);
    r = runTool(r.doc, "add_keyframe", { layer_id: id, path: "transform.opacity", time: 2, value: 1, ease: "linear" }, 0);
    expect(propAt(r.doc.layers.find((l) => l.id === id)!, "transform.opacity", 1.5)).toBeGreaterThan(0.5);
    r = runTool(r.doc, "set_ease", { layer_id: id, path: null, ease: "spring" }, 0);
    expect(r.doc.layers.find((l) => l.id === id)!.anim["transform.opacity"][0].ease).toHaveProperty("spring");
    r = runTool(r.doc, "remove_keyframes", { layer_id: id, path: "transform.opacity", times: [2] }, 0);
    expect(r.doc.layers.find((l) => l.id === id)!.anim["transform.opacity"]).toHaveLength(1);
    r = runTool(r.doc, "delete_layers", { layer_ids: [id] }, 0);
    expect(r.doc.layers.some((l) => l.id === id)).toBe(false);
  });

  it("trims, splits, renames, hides, reorders and retimes", () => {
    const g = byName(gaia, "Globe");
    let r = runTool(gaia, "trim_layer", { layer_id: g.id, start: 1, end: 29 }, 0);
    r = runTool(r.doc, "split_layer", { layer_id: g.id, time: 10 }, 0);
    expect(r.doc.layers.filter((l) => l.type === "globe")).toHaveLength(2);
    r = runTool(r.doc, "rename_layer", { layer_id: g.id, name: "Earth" }, 0);
    r = runTool(r.doc, "set_layer_flags", { layer_id: g.id, hidden: true, locked: null }, 0);
    r = runTool(r.doc, "reorder_layer", { layer_id: g.id, index: 5 }, 0);
    expect(r.doc.layers[5].name).toBe("Earth");
    expect(r.doc.layers[5].hidden).toBe(true);
    r = runTool(r.doc, "retime_film", { duration: 45, mode: "scale", from: 0 }, 0);
    expect(r.doc.meta.duration).toBe(45);
  });

  it("reports bad ids and invalid input as tool errors without changing the doc", () => {
    const r = runTool(gaia, "set_property", { layer_id: "nope", path: "props.size", value: 1, time: null }, 0);
    expect(r.isError).toBe(true);
    expect(r.doc).toBe(gaia);
    const bad = runTool(gaia, "add_layer", { type: "text", name: "x", start: 0, end: 1, x: 0, y: 0, props_json: "{nope", above_layer_id: null }, 0);
    expect(bad.isError).toBe(true);
  });

  it("seek moves the playhead without editing", () => {
    const r = runTool(gaia, "seek", { time: 12 }, 0);
    expect(r.seek).toBe(12);
    expect(r.doc).toBe(gaia);
  });
});
