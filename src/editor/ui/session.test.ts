import { describe, expect, it } from "vitest";
import { codeHash } from "../extract/codeHash";
import { Doc, type Keyframe } from "../doc/schema";
import { followX, isTextField, liveKeys, liveSelection, ownsKey, pickDoc, scrollToShow, spanOf, spanTime, unlocked, unlockedKeys, wordsOf, type SavedRec } from "./session";

const key = (t: number, v: Keyframe["v"]): Keyframe => ({ id: `k${t}`, t, v, ease: "linear" });

const film = (layers: object[] = []) =>
  Doc.parse({
    meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, fps: 30, duration: 10 },
    layers: [{ id: "code", name: "Artwork (code)", type: "code", start: 2, end: 8, props: { code: "x", skipText: true, splitHash: codeHash("x") } }, ...layers],
  });

describe("selections after the doc changes", () => {
  const doc = film([{ id: "a", name: "A", type: "text", start: 0, end: 10, anim: { "transform.x": [key(0, 0), key(1, 10)] } }]);

  it("keeps what's still there, and the same array when nothing went", () => {
    const sel = ["a", "code"];
    expect(liveSelection(doc, sel)).toBe(sel);
    expect(liveSelection(doc, ["gone", "a"])).toEqual(["a"]);
    expect(liveSelection(doc, [])).toEqual([]);
  });

  it("drops keyframes whose layer, track or key is gone", () => {
    const ok = [{ layerId: "a", path: "transform.x", keyId: "k1" }];
    expect(liveKeys(doc, ok)).toBe(ok);
    expect(
      liveKeys(doc, [
        ...ok,
        { layerId: "a", path: "transform.x", keyId: "k9" },
        { layerId: "a", path: "transform.y", keyId: "k0" },
        { layerId: "gone", path: "transform.x", keyId: "k0" },
      ]),
    ).toEqual(ok);
  });

  it("leaves locked layers and their keys out of a delete", () => {
    const d = film([
      { id: "a", name: "A", type: "text", start: 0, end: 10, locked: true, anim: { "transform.x": [key(0, 0)] } },
      { id: "b", name: "B", type: "text", start: 0, end: 10, anim: { "transform.x": [key(0, 0)] } },
    ]);
    expect(unlocked(d, ["a", "b"])).toEqual(["b"]);
    expect(unlockedKeys(d, [{ layerId: "a", path: "transform.x", keyId: "k0" }, { layerId: "b", path: "transform.x", keyId: "k0" }])).toEqual([
      { layerId: "b", path: "transform.x", keyId: "k0" },
    ]);
  });
});

describe("wordsOf: what the Text field shows", () => {
  const layer = (props: object, anim: object = {}) => film([{ id: "w", name: "W", type: "text", start: 1, end: 9, props, anim }]).layers[1];

  it("shows the whole words of text being typed, not the prefix at the playhead", () => {
    const l = layer({}, { "props.text": [key(0, "H"), key(0.5, "Hel"), key(1, "Hello world")] });
    expect(wordsOf(l, 1.6)).toBe("Hello world");
  });

  it("shows what other keyed text says at the playhead, and static text as it is", () => {
    const l = layer({}, { "props.text": [key(0, "One"), key(2, "Two")] });
    expect(wordsOf(l, 1.5)).toBe("One");
    expect(wordsOf(l, 4)).toBe("Two");
    expect(wordsOf(layer({ text: "Still" }), 3)).toBe("Still");
    expect(wordsOf(layer({}), 3)).toBe("");
  });
});

describe("spanTime: where the playhead goes to show a layer", () => {
  it("stays put while the layer is on", () => {
    const d = film([{ id: "a", name: "A", type: "text", start: 1, end: 4 }]);
    expect(spanTime(d, d.layers[1], 2.5)).toBe(2.5);
  });

  it("goes to the nearest frame of its clip: the first one coming from before, the last from after", () => {
    const d = film([{ id: "a", name: "A", type: "text", start: 1, end: 4 }]);
    expect(spanTime(d, d.layers[1], 0)).toBe(1);
    expect(spanTime(d, d.layers[1], 9)).toBeCloseTo(4 - 1 / 30, 9);
    expect(spanTime(d, d.layers[1], 4)).toBeLessThan(4); // its end is already off
  });

  it("moves past frames where it's faded out", () => {
    const d = film([{ id: "a", name: "A", type: "text", start: 1, end: 4, anim: { "transform.opacity": [key(0, 0), key(1, 1)] } }]);
    const t = spanTime(d, d.layers[1], 0);
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThan(1.5);
    expect(Math.abs(t * 30 - Math.round(t * 30))).toBeLessThan(1e-6); // on a frame
  });

  it("keeps split text within its code layer's clip", () => {
    const d = film([{ id: "a", name: "“Hi”", type: "text", start: 0, end: 10, props: { splitFrom: "code" } }]);
    expect(spanOf(d, d.layers[1])).toEqual([2, 8]);
    expect(spanTime(d, d.layers[1], 0.5)).toBe(2);
    expect(spanTime(d, d.layers[1], 9)).toBeCloseTo(8 - 1 / 30, 9);
  });

  it("handles a clip shorter than a frame", () => {
    const d = film([{ id: "a", name: "A", type: "text", start: 1, end: 1.01 }]);
    const t = spanTime(d, d.layers[1], 5);
    expect(t).toBeGreaterThanOrEqual(1);
    expect(t).toBeLessThan(1.01);
  });
});

describe("keeping things in view", () => {
  it("scrolls a row in under a sticky header, and leaves a visible one", () => {
    expect(scrollToShow(100, 28, 0, 300, 42)).toBeNull();
    expect(scrollToShow(20, 28, 0, 300, 42)).toBe(0); // under the header: scrolled to show it below the header
    expect(scrollToShow(500, 28, 0, 300, 42)).toBe(228); // below: scrolled up just enough
    expect(scrollToShow(100, 28, 200, 300, 42)).toBe(58); // above: brought down under the header
  });

  it("follows the playhead a page at a time, and back when it loops", () => {
    expect(followX(500, 0, 800, 240)).toBeNull();
    expect(followX(900, 0, 800, 240)).toBe(900 - 240 - 24);
    expect(followX(240, 600, 800, 240)).toBe(0);
  });
});

describe("pickDoc: what opens", () => {
  const filmDoc = film();
  const edited = film([{ id: "t", name: "T", type: "text", start: 0, end: 1 }]);
  const parse = (u: unknown) => {
    const r = Doc.safeParse(u);
    return r.success ? r.data : null;
  };
  const rec = (doc: Doc, edited: boolean, source: string, v = 2): SavedRec => ({ v, doc, edited, source });
  const pick = (saved?: SavedRec, legacy?: Doc | null) => pickDoc({ film: filmDoc, sources: ["v1", "legacy"], saved, legacy, splitVersion: 2, parse });

  it("opens the film when nothing is kept", () => {
    expect(pick()).toMatchObject({ doc: filmDoc, restored: null, cached: false, dropSaved: false });
  });

  it("brings back edits that never reached the film, flagged when the film changed since", () => {
    expect(pick(rec(edited, true, "v1"))).toMatchObject({ doc: edited, restored: "same" });
    expect(pick(rec(edited, true, "legacy"))).toMatchObject({ doc: edited, restored: "same" });
    expect(pick(rec(edited, true, "v0"))).toMatchObject({ doc: edited, restored: "conflict" });
  });

  it("treats kept edits the film already has as none", () => {
    expect(pick(rec(filmDoc, true, "v0"))).toMatchObject({ doc: filmDoc, restored: null, dropSaved: true });
  });

  it("reuses a split kept for this version only", () => {
    expect(pick(rec(edited, false, "v1"))).toMatchObject({ doc: edited, cached: true, dropSaved: false });
    expect(pick(rec(edited, false, "v0"))).toMatchObject({ doc: filmDoc, cached: false, dropSaved: true });
    expect(pick(rec(edited, false, "v1", 1))).toMatchObject({ doc: filmDoc, cached: false, dropSaved: true });
  });

  it("offers the earlier editor's edits without saving them over the film unasked", () => {
    expect(pick(undefined, edited)).toMatchObject({ doc: edited, restored: "conflict", fromLegacy: true });
    expect(pick(undefined, filmDoc)).toMatchObject({ doc: filmDoc, restored: null, dropLegacy: true });
  });

  it("ignores a kept record it can't read", () => {
    expect(pick({ v: 2, doc: { nope: true }, edited: true, source: "v1" })).toMatchObject({ doc: filmDoc, restored: null, dropSaved: true });
  });
});

describe("keys in focused fields", () => {
  const input = (type: string) => ({ tagName: "INPUT", type });

  it("leaves everything typed in a text field to the field", () => {
    expect(isTextField(input("text"))).toBe(true);
    expect(isTextField(input("number"))).toBe(true);
    expect(isTextField({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextField({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(ownsKey(input("text"), " ")).toBe(true);
  });

  it("keeps shortcuts on a checkbox, slider or button, short of the keys that work them", () => {
    expect(isTextField(input("checkbox"))).toBe(false);
    expect(ownsKey(input("checkbox"), " ")).toBe(true);
    expect(ownsKey(input("checkbox"), "z")).toBe(false);
    expect(ownsKey(input("checkbox"), "Backspace")).toBe(false);
    expect(ownsKey(input("range"), "ArrowLeft")).toBe(true);
    expect(ownsKey(input("range"), " ")).toBe(false);
    expect(ownsKey(input("color"), " ")).toBe(true);
    expect(ownsKey(input("color"), "Enter")).toBe(true);
    expect(ownsKey(input("color"), "Backspace")).toBe(true);
    expect(ownsKey(input("color"), "Delete")).toBe(true);
    expect(ownsKey(input("color"), "z")).toBe(false);
    expect(ownsKey(input("color"), "ArrowLeft")).toBe(false);
    expect(ownsKey({ tagName: "BUTTON" }, " ")).toBe(false);
    expect(ownsKey(null, " ")).toBe(false);
  });
});
