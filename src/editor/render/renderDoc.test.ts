/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { makeKit } from "@/lib/kit";
import { Doc } from "../doc/schema";
import { codeHash } from "../extract/codeHash";
import { renderDoc } from "./renderDoc";

// A 2D canvas stand-in that keeps transform, alpha and save depth, and records the text it paints.
class Spy {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  filter = "none";
  fillStyle: unknown = "#000000";
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  m = [1, 0, 0, 1, 0, 0];
  stack: Record<string, unknown>[] = [];
  painted: string[] = [];
  save() {
    this.stack.push({ m: [...this.m], globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation, fillStyle: this.fillStyle });
  }
  restore() {
    Object.assign(this, this.stack.pop() ?? {});
  }
  translate(x: number, y: number) {
    this.m = [this.m[0], this.m[1], this.m[2], this.m[3], this.m[4] + this.m[0] * x + this.m[2] * y, this.m[5] + this.m[1] * x + this.m[3] * y];
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = [a, b, c, d, e, f];
  }
  getTransform() {
    const [a, b, c, d, e, f] = this.m;
    return { a, b, c, d, e, f };
  }
  measureText(s: string) {
    return { width: String(s).length * 5 };
  }
  fillText(s: string) {
    this.painted.push(String(s));
  }
}
const spy = () => {
  const o = new Spy();
  const ctx: any = new Proxy(o, { get: (t, k, r) => (k in t ? Reflect.get(t, k, r) : typeof k === "symbol" ? undefined : () => ({ addColorStop() {} })) });
  return { ctx, o };
};

const kit = makeKit(1920, 1080, { serif: "serif", sans: "sans", mono: "mono" });
const NO_ASSETS = { images: [], byName: {} };

const film = (code: string, codeLayer: object = {}, extra: object[] = []) =>
  Doc.parse({
    meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, duration: 10 },
    layers: [
      { id: "code", name: "Artwork (code)", type: "code", start: 2, end: 6, props: { code, skipText: true, keepText: [], splitHash: codeHash(code) }, ...codeLayer },
      { id: "t", name: "“Hi”", type: "text", start: 0, end: 10, props: { text: "Hi", raw: true, splitFrom: "code" } },
      ...extra,
    ],
  });

describe("text split from a code layer", () => {
  const paint = (doc: Doc, t: number) => {
    const { ctx, o } = spy();
    renderDoc(ctx, doc, t, kit, NO_ASSETS);
    return o.painted;
  };

  it("shows only while its code layer does", () => {
    const doc = film("");
    expect(paint(doc, 3)).toEqual(["Hi"]);
    expect(paint(doc, 1)).toEqual([]);
    expect(paint(doc, 7)).toEqual([]);
    expect(paint(film("", { hidden: true }), 3)).toEqual([]);
  });

  it("stands down once the code changes: the code paints its own text again", () => {
    const code = "lib.text(ctx, 'Hi', 0, 0);";
    const edited = (doc: Doc) => ((doc.layers[1].props.text = "Edited"), doc);
    expect(paint(edited(film(code)), 3)).toEqual(["Edited"]); // the code skips its text; the layer paints its own
    const changed = film(code, { props: { code: code + " ", skipText: true, keepText: [], splitHash: codeHash(code) } });
    expect(paint(edited(changed), 3)).toEqual(["Hi"]); // the code paints its text; the layer doesn't
  });
});

describe("a code layer lengthened past the stretch its text was split from", () => {
  const code = "lib.text(ctx, 'Hold', 0, 0);";
  // Split over its first 2 s (scene time 0–2), then trimmed out to 4 s: the scene clock is pinned.
  const doc = Doc.parse({
    meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, duration: 10 },
    layers: [
      { id: "code", name: "Artwork (code)", type: "code", start: 0, end: 4, props: { code, skipText: true, keepText: [], splitHash: codeHash(code), splitSpan: [0, 2], sceneIn: 0, sceneT: 2 } },
      { id: "t", name: "“Hold”", type: "text", start: 0, end: 2, props: { text: "Hold", raw: true, splitFrom: "code" } },
    ],
  });
  const paint = (d: Doc, t: number) => {
    const { ctx, o } = spy();
    const skipped: string[] = [];
    renderDoc(ctx, d, t, kit, NO_ASSETS, { onTextSkipped: (l, x) => skipped.push(`${l.id}:${x.str}`) });
    return { painted: o.painted, skipped };
  };

  it("paints its own text past it, and leaves it to the layers within it", () => {
    expect(paint(doc, 1)).toEqual({ painted: ["Hold"], skipped: ["code:Hold"] });
    expect(paint(doc, 3)).toEqual({ painted: ["Hold"], skipped: [] });
    // Trimmed to start earlier (scene time before 0): the code paints its text there too.
    const early = Doc.parse({ ...doc, layers: [{ ...doc.layers[0], start: 0, props: { ...doc.layers[0].props, sceneIn: -1 } }, doc.layers[1]] });
    expect(paint(early, 0.5).skipped).toEqual([]);
    expect(paint(early, 1.5).skipped).toEqual(["code:Hold"]);
  });
});

describe("a code layer that throws", () => {
  const BAD = "ctx.save(); ctx.save(); ctx.translate(500, 500); ctx.globalAlpha = 0.1; throw new Error('boom');";
  const above = { id: "top", name: "Top", type: "text", start: 0, end: 10, props: { text: "Top", raw: true } };

  it("is reported, leaves the canvas as it was, and the layers above it still paint", () => {
    const { ctx, o } = spy();
    const errors: string[] = [];
    renderDoc(ctx, film(BAD, {}, [above]), 3, kit, NO_ASSETS, { onError: (l, e) => errors.push(`${l.id}: ${(e as Error).message}`) });
    expect(errors).toEqual(["code: boom"]);
    expect(o.painted).toEqual(["Hi", "Top"]);
    expect(o.stack).toHaveLength(0);
    expect([o.m, o.globalAlpha]).toEqual([[1, 0, 0, 1, 0, 0], 1]);
    // The canvas's own save and restore are back.
    expect(Object.getOwnPropertyDescriptor(o, "save")).toBeUndefined();
  });

  it("throws once the frame is painted, without a handler", () => {
    const { ctx, o } = spy();
    expect(() => renderDoc(ctx, film(BAD, {}, [above]), 3, kit, NO_ASSETS)).toThrow("boom");
    expect(o.painted).toEqual(["Hi", "Top"]);
  });

  it("can't pop the renderer's own state with restores it never saved", () => {
    const { ctx, o } = spy();
    renderDoc(ctx, film("ctx.restore(); ctx.restore(); ctx.restore();", {}, [above]), 3, kit, NO_ASSETS);
    expect(o.painted).toEqual(["Hi", "Top"]);
    expect(o.stack).toHaveLength(0);
  });
});
