import { describe, expect, it } from "vitest";
import { codeHash } from "../extract/codeHash";
import { createEditorStore } from "../store/store";
import { propAt, valueAt } from "./interpolate";
import {
  addKeyframe,
  addLayer,
  moveLayerTime,
  offsetPropTo,
  removeKeyframes,
  removeLayers,
  renameLayer,
  restorePart,
  retime,
  setProp,
  setText,
  splitLayer,
  trimLayer,
  unlinkLayer,
} from "./ops";
import { Doc, type Keyframe } from "./schema";
import { isStoodDown, splitStatus } from "./split";

const key = (t: number, v: Keyframe["v"], ease: Keyframe["ease"] = "linear"): Keyframe => ({ id: `k${t}_${String(v)}`, t, v, ease });

// A code layer (its text split out, matching its code) and text split from it.
const film = (layers: object[] = []) =>
  Doc.parse({
    meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, fps: 30, duration: 10 },
    layers: [{ id: "code", name: "Artwork (code)", type: "code", start: 0, end: 10, props: { code: "x", skipText: true, keepText: [], splitHash: codeHash("x") } }, ...layers],
  });
const text = (id: string, props: object = {}, rest: object = {}) => ({ id, name: "“Hi”", type: "text", start: 0, end: 10, props: { text: "Hi", splitFrom: "code", autoName: true, ...props }, ...rest });
const get = (d: Doc, id: string) => d.layers.find((l) => l.id === id)!;

describe("changing words", () => {
  it("changes linked copies too, renaming layers named by their words but not ones named by hand", () => {
    const d = film([text("a", { linkId: "L" }), text("b", { linkId: "L" }), text("c")]);
    renameLayer("b", "Shadow")(d);
    expect(get(d, "b").props.autoName).toBeUndefined();
    setProp("a", "props.text", "LOUD", 1)(d);
    expect(["a", "b", "c"].map((id) => get(d, id).props.text)).toEqual(["LOUD", "LOUD", "Hi"]);
    expect(["a", "b", "c"].map((id) => get(d, id).name)).toEqual(["“LOUD”", "Shadow", "“Hi”"]);
    unlinkLayer("a")(d);
    expect(get(d, "a").props.linkId).toBeUndefined();
    expect(get(d, "b").props.linkId).toBeUndefined(); // a link of one links nothing
  });

  it("replaces the words shown wherever a keyed text shows them", () => {
    const d = film([text("a", {}, { anim: { "props.text": [key(0, "NO."), key(2, "QUIET."), key(4, "NO.")] } })]);
    setText("a", "YES.", 0.5)(d);
    expect(get(d, "a").anim["props.text"].map((k) => k.v)).toEqual(["YES.", "QUIET.", "YES."]);
    expect(get(d, "a").name).toBe("“YES.”");
  });

  it("types new words at the same pace, as a character reveal", () => {
    const typed = ["", "H", "He", "Hel", "Hell", "Hello"].map((s, i) => key(i / 10, s, "hold"));
    const d = film([text("a", { raw: true }, { anim: { "props.text": typed } })]);
    setText("a", "Bye")(d);
    const l = get(d, "a");
    expect(l.anim["props.text"]).toBeUndefined();
    expect([l.props.text, l.props.revealMode]).toEqual(["Bye", "chars"]);
    // The reveal shows exactly the prefix the original had typed by then, for the original words.
    const shown = (s: string, t: number) => s.slice(0, Math.floor(Number(valueAt(l.anim["props.reveal"], t)) * s.length));
    expect([0, 0.1, 0.2, 0.5].map((t) => shown("Hello", t))).toEqual(["", "H", "He", "Hello"]);
    expect(shown("Bye", 0.5)).toBe("Bye");
  });

  it("turns a counter into the new words, standing still", () => {
    const d = film([text("a", {}, { anim: { "props.text": [key(0, "~9,992"), key(1, "~50,000"), key(2, "~100,000")] } })]);
    setText("a", "A lot")(d);
    expect(get(d, "a").anim["props.text"]).toBeUndefined();
    expect(get(d, "a").props.text).toBe("A lot");
  });

  it("changes every linked copy as one undo step", () => {
    const store = createEditorStore(film([text("a", { linkId: "L" }), text("b", { linkId: "L" })]));
    store.getState().apply(setText("a", "LOUD"), "Edit text");
    expect(store.getState().doc.layers.map((l) => l.props.text)).toEqual([undefined, "LOUD", "LOUD"]);
    store.getState().undo();
    expect(store.getState().doc.layers.map((l) => l.props.text)).toEqual([undefined, "Hi", "Hi"]);
  });
});

describe("editing a recorded track", () => {
  const shake = [key(0, 100), key(1 / 30, 104), key(2 / 30, 97), key(3 / 30, 102)];

  it("moves the whole track so it reads the new value now, shake and all, landing on the latest value", () => {
    const d = film([text("a", {}, { anim: { "transform.x": shake.map((k) => ({ ...k })) } })]);
    setProp("a", "transform.x", 204, 1 / 30)(d);
    expect(get(d, "a").anim["transform.x"].map((k) => k.v)).toEqual([200, 204, 197, 202]);
    setProp("a", "transform.x", 214, 1 / 30)(d); // the same drag, further
    expect(get(d, "a").anim["transform.x"].map((k) => k.v)).toEqual([210, 214, 207, 212]);
    offsetPropTo("a", "transform.x", 107, 2 / 30)(d);
    expect(get(d, "a").anim["transform.x"].map((k) => k.v)).toEqual([110, 114, 107, 112]);
  });

  it("scales a recorded fade, so it still fades", () => {
    const d = film([text("a", {}, { anim: { "transform.opacity": [key(0, 0), key(0.5, 1), key(1, 0)] } })]);
    setProp("a", "transform.opacity", 0.5, 0.5)(d);
    expect(get(d, "a").anim["transform.opacity"].map((k) => k.v)).toEqual([0, 0.5, 0]);
  });

  it("recolours every frame showing the colour, and resizes linked copies by as much", () => {
    const strobe = [key(0, "#ffffff", "hold"), key(0.1, "#000000", "hold"), key(0.2, "#ffffff", "hold")];
    const d = film([text("a", { linkId: "L", size: 100 }, { anim: { "props.color": strobe } }), text("b", { linkId: "L", size: 120 })]);
    setProp("a", "props.color", "#ff0000", 0.25)(d);
    expect(get(d, "a").anim["props.color"].map((k) => k.v)).toEqual(["#ff0000", "#000000", "#ff0000"]);
    expect(get(d, "b").props.color).toBeUndefined(); // colour isn't linked: a shadow keeps its own
    setProp("a", "props.size", 150, 0)(d);
    expect([get(d, "a").props.size, get(d, "b").props.size]).toEqual([150, 170]);
  });

  it("keys a layer that isn't a recording at the frame, matching a key within half a frame", () => {
    const d = film([{ id: "s", name: "Shape", type: "shape", start: 0, end: 10 }]);
    addKeyframe("s", "transform.x", 1, 10)(d);
    addKeyframe("s", "transform.x", 2, 20)(d);
    setProp("s", "transform.x", 15, 1 + 0.4 / 30)(d);
    expect(get(d, "s").anim["transform.x"].map((k) => [k.t, k.v])).toEqual([
      [1, 15],
      [2, 20],
    ]);
    addKeyframe("s", "transform.x", 1 + 0.6 / 30, 16)(d);
    expect(get(d, "s").anim["transform.x"]).toHaveLength(3);
  });
});

describe("keeping a doc valid", () => {
  it("clamps opacity, wherever it's set", () => {
    const d = film();
    addLayer({ type: "shape", id: "s", transform: { x: 0, y: 0, scale: [1, 1], rotation: 0, anchor: [0.5, 0.5], opacity: 2 } })(d);
    expect(get(d, "s").transform.opacity).toBe(1);
    setProp("s", "transform.opacity", -0.5, 0)(d);
    expect(get(d, "s").transform.opacity).toBe(0);
    addKeyframe("s", "transform.opacity", 1, 1.7)(d);
    expect(get(d, "s").anim["transform.opacity"][0].v).toBe(1);
    setProp("s", "transform.x", NaN, 0)(d);
    expect(get(d, "s").transform.x).toBe(0);
    expect(() => Doc.parse(d)).not.toThrow();
  });

  it("keeps a property's value when its last key goes, not the default", () => {
    const d = film([{ id: "s", name: "Shape", type: "shape", start: 1, end: 10, anim: { "transform.x": [key(0, 0), key(2, 200)], "transform.opacity": [key(0, 0.6), key(1, 0.2)] } }]);
    const sel = (path: string) => get(d, "s").anim[path].map((k) => ({ layerId: "s", path, keyId: k.id }));
    removeKeyframes(sel("transform.x"), 2)(d); // at doc time 2: local 1, halfway
    expect(get(d, "s").transform.x).toBe(100);
    expect(get(d, "s").anim["transform.x"]).toBeUndefined();
    removeKeyframes(sel("transform.opacity"))(d);
    expect(get(d, "s").transform.opacity).toBe(0.6); // no time given: at its most opaque
  });
});

describe("text split from a code layer keeps to it", () => {
  it("moves with it, and goes with it", () => {
    const d = film([text("a", {}, { start: 2, end: 5 }), { id: "s", name: "Shape", type: "shape", start: 0, end: 10 }]);
    moveLayerTime(["code", "a"], 1)(d); // asked for both: moved once
    expect([get(d, "code").start, get(d, "a").start, get(d, "a").end]).toEqual([1, 3, 6]);
    removeLayers(["code"])(d);
    expect(d.layers.map((l) => l.id)).toEqual(["s"]);
  });

  it("unlinks a copy whose other copies are deleted", () => {
    const d = film([text("a", { linkId: "L" }), text("b", { linkId: "L" }), text("c", { linkId: "L" })]);
    removeLayers(["b"])(d);
    expect([get(d, "a").props.linkId, get(d, "c").props.linkId]).toEqual(["L", "L"]);
    removeLayers(["c"])(d);
    expect(get(d, "a").props.linkId).toBeUndefined();
  });

  it("stays put in film time when the code layer is trimmed, as the scene does", () => {
    const d = film([text("a", {}, { start: 2, end: 5 })]);
    trimLayer("code", 3, 10)(d);
    expect([get(d, "code").props.sceneIn, get(d, "code").props.sceneT]).toEqual([3, 10]);
    expect([get(d, "a").start, get(d, "a").end]).toEqual([2, 5]);
  });

  it("goes with the half of a split code layer it's on, cut where it spans the cut, links kept within each half", () => {
    const d = film([text("early", { linkId: "L" }, { start: 1, end: 3 }), text("across", { linkId: "M" }, { start: 3, end: 7 }), text("late", { linkId: "M" }, { start: 6, end: 8 })]);
    splitLayer("code", 5)(d);
    const copy = d.layers[1];
    expect(copy.props.sceneIn).toBe(5);
    const owned = (id: string) => d.layers.filter((l) => l.props.splitFrom === id).map((l) => [l.start, l.end]);
    expect(owned("code")).toEqual([
      [1, 3],
      [3, 5],
    ]);
    expect(owned(copy.id)).toEqual([
      [5, 7],
      [6, 8],
    ]);
    const after = d.layers.filter((l) => l.props.splitFrom === copy.id);
    expect(after[0].props.linkId).toBe(after[1].props.linkId);
    expect(after[0].props.linkId).not.toBe("M");
    expect(get(d, "across").props.linkId).toBeUndefined(); // its copy across the cut went with the other half
    expect(get(d, "early").props.linkId).toBeUndefined(); // a link of one links nothing
  });

  it("doesn't let a copied code layer skip text no layer of its own paints", () => {
    const d = film();
    const props = { ...get(d, "code").props };
    addLayer({ type: "code", id: "copy", props })(d);
    expect(get(d, "copy").props).toEqual({ code: "x" });
    addLayer({ type: "text", id: "t", props: { text: "Hi", splitFrom: "again" } })(d);
    addLayer({ type: "code", id: "again", props })(d); // its text is in the doc: it stays split
    expect(get(d, "again").props.skipText).toBe(true);
  });

  it("shifts with it in a ripple, and stretches with everything in a scale", () => {
    const d = film([text("a", {}, { start: 6, end: 8 })]);
    trimLayer("code", 5, 10)(d);
    retime(12, "ripple", 4)(d);
    expect([get(d, "code").start, get(d, "a").start]).toEqual([7, 8]);
    retime(24, "scale")(d);
    expect([get(d, "code").start, get(d, "code").props.sceneIn, get(d, "a").start]).toEqual([14, 10, 16]);
  });

  it("stretches the stretch of the scene its text was split from with the scene's clock", () => {
    const d = film([text("a")]);
    get(d, "code").props.splitSpan = [0, 10];
    retime(20, "scale")(d); // the clip is the scene: its clock stretches by itself
    expect(get(d, "code").props.splitSpan).toEqual([0, 20]);
    trimLayer("code", 0, 30)(d); // lengthened: the scene's clock is pinned, the split still covers 0–20
    expect([get(d, "code").props.sceneT, get(d, "code").props.splitSpan]).toEqual([20, [0, 20]]);
    retime(10, "scale")(d);
    expect([get(d, "code").props.sceneT, get(d, "code").props.splitSpan]).toEqual([10, [0, 10]]);
  });

  it("stands down when the code changes, and doesn't show where its code layer doesn't", () => {
    const d = film([text("a")]);
    const a = get(d, "a");
    expect([isStoodDown(d, a), splitStatus(d, a, 1)]).toEqual([false, "live"]);
    trimLayer("code", 0, 4)(d);
    expect(splitStatus(d, a, 5)).toBe("outside-owner");
    get(d, "code").hidden = true;
    expect(splitStatus(d, a, 1)).toBe("owner-hidden");
    get(d, "code").props.code = "y";
    expect([isStoodDown(d, a), splitStatus(d, a, 1)]).toEqual([true, "code-changed"]);
    expect(splitStatus(d, get(d, "code"))).toBeNull();
  });
});

describe("reading split text", () => {
  it("resolves a recorded track like any other", () => {
    const d = film([text("a", {}, { start: 1, anim: { "transform.x": [key(0, 0), key(1, 10)] } })]);
    expect(propAt(get(d, "a"), "transform.x", 1.5)).toBe(5);
  });
});

describe("a deleted object", () => {
  const withPart = () =>
    Doc.parse({
      meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, fps: 30, duration: 10 },
      layers: [
        { id: "code", name: "Scene", type: "code", start: 1, end: 9, props: { code: "x", partsKey: "k" } },
        { id: "sun", name: "Sun", type: "part", start: 2, end: 6, props: { partOf: "code", part: "Sun", found: [2, 6] } },
      ],
    });

  it("is remembered by its code layer, and comes back when restored", () => {
    const s = createEditorStore(withPart());
    s.getState().apply(removeLayers(["sun"]), "Delete");
    expect(s.getState().doc.layers.map((l) => l.id)).toEqual(["code"]);
    expect(s.getState().doc.layers[0].props.dropParts).toEqual(["Sun"]);
    s.getState().apply(restorePart("code", "Sun"), "Restore");
    const [code, sun] = s.getState().doc.layers;
    expect(code.props.dropParts).toBeUndefined();
    // Looked at again, the code says when the object shows.
    expect(code.props.partsKey).toBeUndefined();
    expect(sun).toMatchObject({ type: "part", name: "Sun", start: 1, end: 9, props: { partOf: "code", part: "Sun" } });
  });

  it("is left alone when it was never deleted", () => {
    const d = withPart();
    const s = createEditorStore(d);
    s.getState().apply(restorePart("code", "Moon"), "Restore");
    expect(s.getState().doc).toBe(d);
  });
});
