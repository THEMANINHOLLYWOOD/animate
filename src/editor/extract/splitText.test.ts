import { describe, expect, it } from "vitest";
import { keepIndices, track } from "./splitText";

describe("keyframe thinning", () => {
  it("keeps only the endpoints of a straight line", () => {
    const v = Array.from({ length: 30 }, (_, i) => [i * 2]);
    expect(keepIndices(v, 0.5)).toEqual([0, 29]);
  });

  it("keeps the corner of a move that stops", () => {
    const v = Array.from({ length: 30 }, (_, i) => [Math.min(i, 10) * 10]);
    expect(keepIndices(v, 0.5)).toEqual([0, 10, 29]);
  });

  it("stays within tolerance on an eased curve", () => {
    const n = 60;
    const v = Array.from({ length: n }, (_, i) => [1000 * (1 - (1 - i / (n - 1)) ** 3)]);
    const idx = keepIndices(v, 0.5);
    expect(idx.length).toBeLessThan(n);
    for (let i = 0; i < n; i++) {
      const a = idx.filter((j) => j <= i).at(-1)!, b = idx.find((j) => j >= i)!;
      const k = b === a ? 0 : (i - a) / (b - a);
      expect(Math.abs(v[a][0] + (v[b][0] - v[a][0]) * k - v[i][0])).toBeLessThanOrEqual(0.5);
    }
  });

  it("turns a constant into a static value and text changes into held keys", () => {
    const t = [0, 0.1, 0.2, 0.3];
    expect(track(t, [5, 5, 5, 5], 0.5)).toEqual({ value: 5 });
    const r = track(t, ["01", "01", "02", "03"], 0);
    expect("keys" in r && r.keys.map((k) => [k.t, k.v, k.ease])).toEqual([
      [0, "01", "hold"],
      [0.2, "02", "hold"],
      [0.3, "03", "hold"],
    ]);
  });
});

describe("text identity", () => {
  it("treats typing and counting as the same text, different sentences as different", async () => {
    const { evolves } = await import("./splitText");
    expect(evolves("deploy to", "deploy to prod")).toBe(true);
    expect(evolves("~9,992", "~100,000")).toBe(true);
    expect(evolves("Each beat writes a trace.", "Two pumps. One rhythm. For life.")).toBe(false);
  });
});

describe("recorded numbers", () => {
  it("puts key times just before their frame, never after", async () => {
    const { keyTime } = await import("./splitText");
    expect(keyTime(0)).toBe(0);
    for (const t of [1 / 30, 0.3, 7 / 24, 12.5 / 30, 3]) {
      expect(keyTime(t)).toBeLessThan(t - 4e-5);
      expect(keyTime(t)).toBeGreaterThan(t - 2e-4);
    }
  });
});

describe("re-splitting a code layer", () => {
  it("swaps the old text layers for the new ones just above the code, as one edit", async () => {
    const { produce } = await import("immer");
    const { Doc } = await import("../doc/schema");
    const { applySplit } = await import("./splitText");
    const doc = Doc.parse({
      meta: { id: "f", title: "F", size: { w: 100, h: 100 }, duration: 1 },
      layers: [
        { id: "bg", name: "bg", type: "shape", start: 0, end: 1 },
        { id: "code", name: "Artwork (code)", type: "code", start: 0, end: 1, props: { code: "new", skipText: true, keepText: ["x"], splitHash: "old" } },
        { id: "t1", name: "old 1", type: "text", start: 0, end: 1, props: { splitFrom: "code" } },
        { id: "mine", name: "mine", type: "text", start: 0, end: 1 },
        { id: "t2", name: "old 2", type: "text", start: 0, end: 1, props: { splitFrom: "code" } },
      ],
    });
    const fresh = Doc.parse({ ...doc, layers: [{ id: "n1", name: "new", type: "text", start: 0, end: 1, props: { splitFrom: "code" } }] }).layers;
    const r = { name: "Artwork (code)", props: { skipText: true, keepText: [], splitHash: "h" }, layers: fresh };
    const next = produce(doc, applySplit("code", "new", r));
    expect(next.layers.map((l) => l.id)).toEqual(["bg", "code", "n1", "mine"]);
    expect(next.layers[1].props).toEqual({ code: "new", skipText: true, keepText: [], splitHash: "h" });
    // The code changed again while splitting: nothing happens.
    expect(produce(doc, applySplit("code", "older", r))).toBe(doc);
  });
});
