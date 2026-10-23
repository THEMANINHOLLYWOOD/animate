import { describe, expect, it } from "vitest";
import { Doc } from "../doc/schema";
import { codeHash, splitLive } from "./codeHash";
import { fromUnchecked, splitLayersOf, uncheckedSplit } from "./legacy";

const code = "lib.text(ctx, 'Every deploy.', 100, 100);";
const doc = (layers: unknown[]) => Doc.parse({ meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, duration: 4 }, layers });
// Named as the earlier split named its layers (by their words in curly quotes), unless given a name.
const text = (id: string, extra: Record<string, unknown> = {}, name = `“${id}”`) => ({ id, name, type: "text", start: 0, end: 4, props: { text: id, ...extra } });
const art = { id: "scene", name: "Artwork (code)", type: "code", start: 0, end: 4, props: { code, skipText: true, keepText: [] } };
const group = () => ({ id: "group_1", name: "Group", type: "group", start: 0, end: 4 });
const shape = (id: string) => ({ id, name: id, type: "shape", start: 0, end: 4, props: { kind: "rect", w: 10, h: 10 } });

describe("docs an earlier editor kept", () => {
  it("tells the first, unchecked split from a checked one and from no split", () => {
    expect(uncheckedSplit(doc([{ id: "scene", name: "Art", type: "code", start: 0, end: 4, props: { code, skipText: true, keepText: [] } }]))).toBe(true);
    expect(uncheckedSplit(doc([{ id: "scene", name: "Art", type: "code", start: 0, end: 4, props: { code, skipText: true, keepText: [], splitHash: codeHash(code) } }]))).toBe(false);
    expect(uncheckedSplit(doc([{ id: "scene", name: "Scene", type: "code", start: 0, end: 4, props: { code } }, text("text_a")]))).toBe(false);
  });

  it("brings one back as it painted: the code still skipping that text, and the split's text tied to it", () => {
    const before = doc([
      { ...art, props: { ...art.props, keepText: ["Kept"] } },
      text("text_a"),
      text("layer_added", {}, "text"), // added in the editor afterwards: left alone
      text("text_b", { color: "#ff0000" }), // edited
      text("layer_b2", {}, "“text_b” (split)"), // the second half of text_b, split in time in the editor
      { id: "other", name: "Plain code", type: "code", start: 0, end: 4, props: { code: "" } },
      text("text_c"), // above code that was never split
    ]);
    const after = fromUnchecked(before);
    const [code0, a, added, b, b2, other, c] = after.layers;
    expect(splitLive(code0.props)).toBe(true);
    expect(code0.props.keepText).toEqual(["Kept"]);
    expect(a.props.splitFrom).toBe("scene");
    expect(b.props).toEqual({ text: "text_b", color: "#ff0000", splitFrom: "scene", autoName: true });
    expect(b2.props.splitFrom).toBe("scene");
    expect(b2.props.autoName).toBeUndefined(); // named "… (split)", not by its words
    expect(added.props.splitFrom).toBeUndefined();
    expect(other).toBe(before.layers[5]);
    expect(c.props.splitFrom).toBeUndefined();
    expect(uncheckedSplit(after)).toBe(false);
    expect(Doc.parse(after)).toEqual(after);
  });

  it("leaves a recreation's own layers alone, though its text is 'text_…' too", () => {
    // Its code drew no text, so the split made no layers: the elements sit right above the code.
    const none = doc([{ ...art, name: "Scene (code)" }, text("text_head", {}, "Headline"), shape("rect_1"), text("text_cap", {}, "Caption")]);
    const after = fromUnchecked(none);
    expect(splitLive(after.layers[0].props)).toBe(true);
    expect(after.layers.slice(1)).toEqual(none.layers.slice(1));
    expect(after.layers[1]).toBe(none.layers[1]);

    // Its code drew some: the split's layers come first, then the elements (text before any shape too).
    const some = doc([
      art,
      text("text_a"),
      text("text_t", {}, "Title"), // a split layer renamed since, with split layers above it
      group(),
      text("text_b"),
      text("text_head", {}, "Headline"),
      text("layer_h2", {}, "Headline (split)"),
      shape("rect_1"),
      text("text_cap", {}, "Caption"),
      text("text_late", {}, "“Late”"), // past a shape: not where the split put its layers
    ]);
    expect(splitLayersOf(some.layers, 0)).toEqual([1, 2, 4]);
    const tied = fromUnchecked(some).layers.map((l) => l.props.splitFrom ?? null);
    expect(tied).toEqual([null, "scene", "scene", null, "scene", null, null, null, null, null]);
  });

  it("ties nothing when the code layer has nothing above it", () => {
    expect(splitLayersOf(doc([art]).layers, 0)).toEqual([]);
    expect(splitLayersOf(doc([art, { id: "other", name: "Code", type: "code", start: 0, end: 4, props: { code: "" } }, text("text_a")]).layers, 0)).toEqual([]);
  });
});
