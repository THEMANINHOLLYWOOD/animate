import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { controlDefs } from "@/lib/controls";
import { Doc } from "../doc/schema";
import { splitKey, splitLive, unsplit, withKeyedControls } from "./codeHash";
import { freeOp, freeUnknown, otherValues } from "./textFree";

const defs = controlDefs({ Headline: "BURNING", Ember: "#ff5a1f", Grain: true, Heat: [0.6, 0, 1], Mood: { options: ["Night", "Dawn", "Noon"], value: "Dawn" }, Sun: { point: [0.7, 0.3] } });
const def = (name: string) => defs.find((d) => d.name === name)!;

describe("otherValues", () => {
  it("tries each kind of control somewhere else, and never words", () => {
    expect(otherValues(def("Headline"), undefined)).toBeNull();
    expect(otherValues(def("Grain"), undefined)).toEqual([false]);
    expect(otherValues(def("Heat"), undefined)).toEqual([0, 1]);
    expect(otherValues(def("Heat"), 0)).toEqual([1, 0.5]);
    expect(otherValues(def("Mood"), "Night")).toEqual(["Dawn", "Noon"]);
    expect(otherValues(def("Ember"), undefined)).toEqual(["#19e0a8"]);
    expect(otherValues(def("Ember"), "#19E0A8")).toEqual(["#e01978"]);
    expect(otherValues(def("Sun"), undefined)).toEqual([[0.7 - 0.3, 0.3 + 0.3]]);
  });
});

describe("controls that leave the text alone", () => {
  const props = { code: "x", controlDefs: defs, controls: { Grain: false }, skipText: true, keepText: [] };
  const film = (extra: object = {}) =>
    Doc.parse({
      meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, fps: 30, duration: 10 },
      layers: [{ id: "code", name: "Artwork (code)", type: "code", start: 0, end: 10, props: { ...props, splitHash: splitKey(props), ...extra } }],
    });
  const live = (d: Doc) => splitLive(withKeyedControls(d.layers[0].props, d.layers[0].anim));

  it("stands a split down for any control until it's known which touch text", () => {
    const d = film();
    expect(freeUnknown(d.layers[0])).toBe(true);
    expect(live(d)).toBe(true);
    const moved = produce(d, (x) => void ((x.layers[0].props.controls as Record<string, unknown>).Grain = true));
    expect(live(moved)).toBe(false);
  });

  it("keeps the split through changes to a free control, and stands it down for the others", () => {
    const d = film();
    const tried = withKeyedControls(d.layers[0].props, d.layers[0].anim);
    const noted = produce(d, freeOp("code", tried, ["Grain", "Heat"]));
    expect(noted.layers[0].props.splitFree).toEqual(["Grain", "Heat"]);
    expect(freeUnknown(noted.layers[0])).toBe(false);
    expect(live(noted)).toBe(true);
    const set = (name: string, v: unknown) => produce(noted, (x) => void ((x.layers[0].props.controls as Record<string, unknown>)[name] = v));
    expect(live(set("Grain", true))).toBe(true);
    expect(live(set("Heat", 0.1))).toBe(true);
    expect(live(set("Headline", "BLAZING"))).toBe(false);
    // Keyed, a free control still leaves it holding; any other stands it down.
    const keyed = (name: string) => produce(noted, (x) => void (x.layers[0].anim[`props.controls.${name}`] = [{ id: "k", t: 0, v: 1, ease: "linear" }]));
    expect(live(keyed("Heat"))).toBe(true);
    expect(live(keyed("Mood"))).toBe(false);
  });

  it("holds when a free control was changed while the film was being tried", () => {
    const d = film();
    const tried = withKeyedControls(d.layers[0].props, d.layers[0].anim);
    const meanwhile = produce(d, (x) => void ((x.layers[0].props.controls as Record<string, unknown>).Grain = true));
    expect(live(meanwhile)).toBe(false);
    expect(live(produce(meanwhile, freeOp("code", tried, ["Grain"])))).toBe(true);
    expect(live(produce(meanwhile, freeOp("code", tried, [])))).toBe(false);
  });

  it("notes nothing on a layer whose code or split changed since, and forgets it when the text is split again", () => {
    const d = film();
    const tried = withKeyedControls(d.layers[0].props, d.layers[0].anim);
    const recoded = produce(d, (x) => void (x.layers[0].props.code = "y"));
    expect(produce(recoded, freeOp("code", tried, ["Grain"]))).toBe(recoded);
    expect(unsplit({ ...props, splitFree: ["Grain"] })).not.toHaveProperty("splitFree");
  });
});
