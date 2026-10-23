import { describe, expect, it } from "vitest";
import { dropper, paintOrder } from "./keep";

describe("keeping text in code", () => {
  it("drops every layer that shares copy with a dropped one, transitively", () => {
    const strs = [new Set(["A"]), new Set(["A", "B"]), new Set(["B", "C"]), new Set(["D"])];
    const keep = new Set<string>();
    const { dropped, drop } = dropper(strs, keep);
    expect(drop(0).sort()).toEqual([0, 1, 2]);
    expect([...dropped].sort()).toEqual([0, 1, 2]);
    expect([...keep].sort()).toEqual(["A", "B", "C"]);
    expect(drop(1)).toEqual([]); // already gone
    expect(dropped.has(3)).toBe(false);
  });
});

describe("paint order", () => {
  it("orders layers by the order their text is painted, not first appearance", () => {
    // Run 0 appears first, but from frame 2 run 1 is painted under it.
    const frames = [[0], [0], [1, 0], [1, 0], [2, 1, 0]];
    expect(paintOrder([0, 1, 2], frames)).toEqual([2, 1, 0]);
  });

  it("keeps first appearance for text that never overlaps in a frame", () => {
    expect(paintOrder([0, 1, 2], [[0], [1], [2]])).toEqual([0, 1, 2]);
  });

  it("orders through dropped layers and breaks cycles by first appearance", () => {
    // 0 before 5 before 1; 5 is not a layer any more.
    expect(paintOrder([0, 1], [[1], [0, 5, 1]])).toEqual([0, 1]);
    expect(paintOrder([0, 1], [[0, 1], [1, 0]])).toEqual([0, 1]);
  });
});
