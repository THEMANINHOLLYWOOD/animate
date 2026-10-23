import { afterEach, describe, expect, it, vi } from "vitest";
import { addLayer, setProp } from "../doc/ops";
import { Doc } from "../doc/schema";
import { createEditorStore } from "./store";

const blank = () => Doc.parse({ meta: { id: "d", title: "T", size: { w: 100, h: 100 }, duration: 10 } });

afterEach(() => {
  vi.useRealTimers();
});

describe("undo steps per gesture", () => {
  it("makes one step of a drag however long it pauses, and a new one for the next drag", () => {
    vi.useFakeTimers();
    const store = createEditorStore(blank());
    const s = () => store.getState();
    s().apply(addLayer({ type: "shape", id: "a" }), "Add");
    s().beginGesture();
    for (let x = 1; x <= 4; x++) {
      s().apply(setProp("a", "transform.x", x * 10, 0), "Move");
      vi.advanceTimersByTime(2000); // a long pause mid-drag
    }
    s().endGesture();
    s().beginGesture();
    s().apply(setProp("a", "transform.y", 5, 0), "Move");
    s().endGesture();
    expect(s().past.map((p) => p.label)).toEqual(["Add", "Move", "Move"]);
    s().undo();
    s().undo();
    expect(s().doc.layers[0].transform).toMatchObject({ x: 0, y: 0 });
  });

  it("counts nested gestures as the outermost, and doesn't merge a later edit into a finished gesture", () => {
    const store = createEditorStore(blank());
    const s = () => store.getState();
    s().apply(addLayer({ type: "shape", id: "a" }), "Add");
    s().beginGesture();
    s().apply(setProp("a", "transform.x", 1, 0), "Move", { coalesce: "x" });
    s().beginGesture();
    s().apply(setProp("a", "transform.x", 2, 0), "Move", { coalesce: "x" });
    s().endGesture();
    s().apply(setProp("a", "transform.x", 3, 0), "Move", { coalesce: "x" });
    s().endGesture();
    s().apply(setProp("a", "transform.x", 4, 0), "Type", { coalesce: "x" });
    s().apply(setProp("a", "transform.x", 5, 0), "Type", { coalesce: "x" });
    expect(s().past.map((p) => p.label)).toEqual(["Add", "Move", "Type"]);
    s().undo();
    expect(s().doc.layers[0].transform.x).toBe(3);
  });

  it("closes a gesture left open by an undo, so it can't swallow later edits", () => {
    const store = createEditorStore(blank());
    const s = () => store.getState();
    s().apply(addLayer({ type: "shape", id: "a" }), "Add");
    s().beginGesture();
    s().apply(setProp("a", "transform.x", 1, 0), "Move");
    s().undo();
    s().apply(setProp("a", "transform.x", 2, 0), "Move");
    s().apply(setProp("a", "transform.y", 2, 0), "Move");
    expect(s().past).toHaveLength(3);
  });
});
