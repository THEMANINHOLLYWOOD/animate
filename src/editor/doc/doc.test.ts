import { describe, expect, it } from "vitest";
import { createEditorStore } from "../store/store";
import { addKeyframe, addLayer, groupLayers, moveKeyframes, removeLayers, retime, setProp, splitLayer, trimLayer, ungroup } from "./ops";
import { applyEase, cubicBezier, mixValue, propAt, springCurve, valueAt } from "./interpolate";
import { Doc, type Keyframe } from "./schema";

const blank = () =>
  Doc.parse({ meta: { id: "d1", title: "Test", size: { w: 1920, h: 1080 }, duration: 10 } });

const key = (t: number, v: Keyframe["v"], ease: Keyframe["ease"] = "linear"): Keyframe => ({ id: `k${t}`, t, v, ease });

describe("easing", () => {
  it("cubic-bézier hits its endpoints and matches linear for the identity curve", () => {
    expect(cubicBezier(0.42, 0, 0.58, 1, 0)).toBe(0);
    expect(cubicBezier(0.42, 0, 0.58, 1, 1)).toBe(1);
    expect(cubicBezier(0.25, 0.25, 0.75, 0.75, 0.3)).toBeCloseTo(0.3, 4);
  });

  it("ease-in-out is symmetric and monotonic", () => {
    const f = (k: number) => cubicBezier(0.42, 0, 0.58, 1, k);
    expect(f(0.5)).toBeCloseTo(0.5, 4);
    expect(f(0.25) + f(0.75)).toBeCloseTo(1, 4);
    let prev = 0;
    for (let k = 0; k <= 1; k += 0.05) {
      expect(f(k)).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f(k);
    }
  });

  it("springs overshoot when under-damped and settle at 1", () => {
    const samples = Array.from({ length: 50 }, (_, i) => springCurve(170, 12, i / 49));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(springCurve(170, 12, 1)).toBe(1);
  });

  it("hold keeps the start value", () => {
    expect(applyEase("hold", 0.9)).toBe(0);
  });
});

describe("interpolation", () => {
  it("interpolates numbers, vectors and clamps outside the range", () => {
    const keys = [key(1, 0), key(3, 100)];
    expect(valueAt(keys, 0)).toBe(0);
    expect(valueAt(keys, 2)).toBe(50);
    expect(valueAt(keys, 9)).toBe(100);
    expect(valueAt([key(0, [0, 0]), key(1, [10, 20])], 0.5)).toEqual([5, 10]);
  });

  it("mixes colours in OKLab and returns exact endpoints", () => {
    expect(mixValue("#ff0000", "#0000ff", 0)).toBe("#ff0000");
    expect(mixValue("#ff0000", "#0000ff", 1)).toBe("#0000ff");
    const mid = mixValue("#000000", "#ffffff", 0.5) as string;
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe("#000000");
  });

  it("holds non-numeric strings until the next key", () => {
    expect(valueAt([key(0, "Hello"), key(2, "World")], 1.99)).toBe("Hello");
    expect(valueAt([key(0, "Hello"), key(2, "World")], 2)).toBe("World");
  });

  it("propAt reads keyframes in layer-local time and falls back to static values", () => {
    const d = blank();
    addLayer({ type: "text", start: 2, transform: { x: 7, y: 0, scale: [1, 1], rotation: 0, anchor: [0.5, 0.5], opacity: 1 } })(d);
    const l = d.layers[0];
    expect(propAt(l, "transform.x", 5)).toBe(7);
    l.anim["transform.x"] = [key(0, 0), key(2, 100)];
    expect(propAt(l, "transform.x", 3)).toBe(50); // doc 3s = local 1s
  });
});

describe("ops", () => {
  it("setProp writes statics, and keys once a property is animated", () => {
    const d = blank();
    addLayer({ type: "shape", id: "a" })(d);
    setProp("a", "transform.x", 40, 0)(d);
    expect(d.layers[0].transform.x).toBe(40);
    setProp("a", "transform.y", 10, 1, true)(d);
    setProp("a", "transform.y", 90, 3)(d);
    expect(d.layers[0].anim["transform.y"].map((k) => [k.t, k.v])).toEqual([
      [1, 10],
      [3, 90],
    ]);
  });

  it("trims the in-point without moving keyframes in absolute time", () => {
    const d = blank();
    addLayer({ type: "shape", id: "a" })(d);
    addKeyframe("a", "transform.x", 4, 100)(d);
    trimLayer("a", 1, 8)(d);
    const l = d.layers[0];
    expect([l.start, l.end]).toEqual([1, 8]);
    expect(l.start + l.anim["transform.x"][0].t).toBe(4);
  });

  it("splits a layer into two that render the same timeline", () => {
    const d = blank();
    addLayer({ type: "shape", id: "a" })(d);
    addKeyframe("a", "transform.x", 0, 0)(d);
    addKeyframe("a", "transform.x", 10, 100)(d);
    splitLayer("a", 4)(d);
    const [left, right] = d.layers;
    expect([left.end, right.start, right.end]).toEqual([4, 4, 10]);
    expect(propAt(right, "transform.x", 6)).toBeCloseTo(propAt(left, "transform.x", 6) as number, 6);
  });

  it("moves and re-sorts keyframes", () => {
    const d = blank();
    addLayer({ type: "shape", id: "a" })(d);
    addKeyframe("a", "o", 1, 0)(d);
    addKeyframe("a", "o", 2, 1)(d);
    const first = d.layers[0].anim.o[0].id;
    moveKeyframes([{ layerId: "a", path: "o", keyId: first }], 5)(d);
    expect(d.layers[0].anim.o.map((k) => k.t)).toEqual([2, 6]);
  });

  it("retimes by scale and by ripple", () => {
    const d = blank();
    addLayer({ type: "shape", id: "a", start: 2, end: 6 })(d);
    addKeyframe("a", "o", 1, 0)(d);
    retime(20)(d);
    expect([d.layers[0].start, d.layers[0].end, d.layers[0].anim.o[0].t, d.meta.duration]).toEqual([4, 12, 2, 20]);
    retime(25, "ripple", 3)(d);
    expect([d.layers[0].start, d.layers[0].end]).toEqual([9, 17]);
  });

  it("groups, ungroups, and removes children with their group", () => {
    const d = blank();
    addLayer({ type: "shape", id: "a" })(d);
    addLayer({ type: "text", id: "b" })(d);
    groupLayers(["a", "b"], "G")(d);
    const g = d.layers.find((l) => l.type === "group")!;
    expect(d.layers.filter((l) => l.parentId === g.id)).toHaveLength(2);
    ungroup(g.id)(d);
    expect(d.layers.every((l) => l.parentId === null)).toBe(true);
    groupLayers(["a", "b"])(d);
    removeLayers([d.layers.find((l) => l.type === "group")!.id])(d);
    expect(d.layers).toHaveLength(0);
  });
});

describe("history", () => {
  it("undoes and redoes, and coalesces a drag into one step", () => {
    const store = createEditorStore(blank());
    const s = () => store.getState();
    s().apply(addLayer({ type: "shape", id: "a" }), "Add");
    for (let x = 1; x <= 5; x++) s().apply(setProp("a", "transform.x", x * 10, 0), "Move", { coalesce: "drag-a" });
    expect(s().doc.layers[0].transform.x).toBe(50);
    expect(s().past).toHaveLength(2);
    s().undo();
    expect(s().doc.layers[0].transform.x).toBe(0);
    s().undo();
    expect(s().doc.layers).toHaveLength(0);
    s().redo();
    s().redo();
    expect(s().doc.layers[0].transform.x).toBe(50);
  });
});
