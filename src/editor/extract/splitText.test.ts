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
