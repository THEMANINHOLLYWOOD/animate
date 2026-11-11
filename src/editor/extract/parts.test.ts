/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { compileScene } from "@/lib/engine";
import { makeKit } from "@/lib/kit";
import { Doc } from "../doc/schema";
import { moveLayerTime, retime, splitLayer } from "../doc/ops";
import { renderDoc } from "../render/renderDoc";
import { controlsOf, findParts, partsKey, partsOf, syncParts, tapParts } from "./parts";

// A 2D canvas stand-in that keeps transform, alpha, clip and save depth, and records the rectangles
// it paints as where they land on the canvas (nothing, while clipped to an empty path).
class Spy {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  filter = "none";
  fillStyle: unknown = "#000";
  lineWidth = 1;
  m = [1, 0, 0, 1, 0, 0];
  clipped = false;
  stack: Record<string, unknown>[] = [];
  rects: { x: number; y: number; w: number; h: number; alpha: number }[] = [];
  save() {
    this.stack.push({ m: [...this.m], globalAlpha: this.globalAlpha, clipped: this.clipped, globalCompositeOperation: this.globalCompositeOperation });
  }
  restore() {
    Object.assign(this, this.stack.pop() ?? {});
  }
  translate(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a * x, b * x, c * y, d * y, e, f];
  }
  rotate() {}
  getTransform() {
    const [a, b, c, d, e, f] = this.m;
    return { a, b, c, d, e, f };
  }
  beginPath() {}
  rect() {}
  clip() {
    this.clipped = true;
  }
  fillRect(x: number, y: number, w: number, h: number) {
    if (this.clipped) return;
    const [a, , , d, e, f] = this.m;
    this.rects.push({ x: a * x + e, y: d * y + f, w: a * w, h: d * h, alpha: this.globalAlpha });
  }
}
const spy = () => {
  const o = new Spy();
  const ctx: any = new Proxy(o, { get: (t, k, r) => (k in t ? Reflect.get(t, k, r) : typeof k === "symbol" ? undefined : () => ({ addColorStop() {} })) });
  return { ctx, o };
};

const kit = makeKit(1920, 1080, { serif: "serif", sans: "sans", mono: "mono" });
const NO_ASSETS = { images: [], byName: {} };

// A sun that is always there, and a bird that flies in between 4 s and 8 s.
const CODE = `
lib.layer(ctx, 'Sun', () => { ctx.fillRect(100, 100, 200, 200); });
if (t >= 4 && t < 8) lib.layer(ctx, 'Bird', () => { ctx.translate(t * 100, 0); ctx.fillRect(0, 500, 40, 20); });
ctx.fillRect(0, 1000, 1920, 80);
`;
const film = (layers: object[] = [], codeProps: object = {}) =>
  Doc.parse({
    meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, duration: 10 },
    layers: [{ id: "code", name: "Scene (code)", type: "code", start: 0, end: 10, props: { code: CODE, ...codeProps } }, ...layers],
  });
// What a frame painted, the doc's background aside.
const painted = (o: Spy) => o.rects.filter((r) => !(r.w === 1920 && r.h === 1080));
const part = (name: string, extra: object = {}) => ({ id: `p-${name}`, name, type: "part", start: 0, end: 10, props: { partOf: "code", part: name }, ...extra });

describe("tapParts", () => {
  it("records where each part paints, and leaves the rest of the scene alone", () => {
    const { ctx, o } = spy();
    const tap = tapParts(ctx, kit, { track: true });
    compileScene(CODE)(ctx, 1920, 1080, 5, 10, 0.5, tap.lib, NO_ASSETS);
    tap.restore();
    expect(tap.order).toEqual(["Sun", "Bird"]);
    expect(tap.seen.get("Sun")!.box).toEqual({ x0: 100, y0: 100, x1: 300, y1: 300 });
    expect(tap.seen.get("Bird")!.box).toEqual({ x0: 500, y0: 500, x1: 540, y1: 520 });
    expect(o.rects).toHaveLength(3);
    // Nothing of the tap is left on the canvas.
    expect(Object.keys(o).filter((k) => typeof (o as any)[k] === "function")).toEqual([]);
  });
});

describe("renderDoc with part layers", () => {
  it("draws a film the same with untouched part layers as without", () => {
    const a = spy(), b = spy();
    renderDoc(a.ctx, film(), 5, kit, NO_ASSETS);
    renderDoc(b.ctx, film([part("Sun"), part("Bird")]), 5, kit, NO_ASSETS);
    expect(painted(b.o)).toEqual(painted(a.o));
    expect(painted(a.o)).toHaveLength(3);
  });

  it("moves, fades and hides parts, and gives each its box", () => {
    const { ctx, o } = spy();
    const doc = film([part("Sun", { transform: { x: 50, y: -20, opacity: 0.5 } }), part("Bird", { hidden: true })]);
    const bounds = renderDoc(ctx, doc, 5, kit, NO_ASSETS, { partBounds: true });
    // The ground (not a part) and the moved, faded sun; no bird.
    expect(painted(o)).toEqual([
      { x: 150, y: 80, w: 200, h: 200, alpha: 0.5 },
      { x: 0, y: 1000, w: 1920, h: 80, alpha: 1 },
    ]);
    expect(bounds["p-Sun"]).toEqual({ x: 150, y: 80, w: 200, h: 200 });
    expect(bounds["p-Bird"]).toBeUndefined();
  });

  it("scales a part about its own centre", () => {
    const { ctx, o } = spy();
    renderDoc(ctx, film([part("Sun", { transform: { scale: [2, 2] } })]), 1, kit, NO_ASSETS);
    // 200×200 centred on (200, 200) becomes 400×400 centred there.
    expect(painted(o)[0]).toEqual({ x: 0, y: 0, w: 400, h: 400, alpha: 1 });
  });

  it("stops painting a part outside its clip, and one that was deleted", () => {
    const { ctx, o } = spy();
    renderDoc(ctx, film([part("Bird", { start: 6, end: 8 })], { dropParts: ["Sun"] }), 5, kit, NO_ASSETS);
    expect(painted(o)).toEqual([{ x: 0, y: 1000, w: 1920, h: 80, alpha: 1 }]);
  });
});

describe("findParts and syncParts", () => {
  it("finds a scene's parts in paint order, with when each is on screen", async () => {
    const { ctx } = spy();
    const doc = film();
    const { parts: found, controls } = await findParts(doc.layers[0], doc, kit, NO_ASSETS, compileScene(CODE), ctx);
    expect(controls).toEqual([]);
    expect(found.map((f) => f.name)).toEqual(["Sun", "Bird"]);
    expect(found[0]).toMatchObject({ start: 0, end: 10 });
    expect(found[1].start).toBeCloseTo(3.9, 5);
    expect(found[1].end).toBeCloseTo(8, 5);
  });

  it("adds layers for new parts, keeps edited ones, and drops those the code no longer draws", () => {
    let doc = film([part("Sun", { transform: { x: 50 } }), part("Gone")]);
    const key = partsKey(doc.layers[0]);
    const op = syncParts("code", key, [
      { name: "Sun", start: 0, end: 10 },
      { name: "Bird", start: 3.9, end: 8 },
    ]);
    doc = structuredClone(doc);
    op(doc);
    const parts = partsOf(doc, "code");
    expect(parts.map((l) => l.name)).toEqual(["Sun", "Bird"]);
    expect(parts[0].transform.x).toBe(50);
    expect(parts[1]).toMatchObject({ type: "part", start: 3.9, end: 8 });
    expect(doc.layers[0].props.partsKey).toBe(key);
    expect(doc.layers.map((l) => l.id).slice(0, 2)).toEqual(["code", "p-Sun"]);
  });
});

describe("a film's own controls", () => {
  // The sun's size and whether there's a ground at all are the film's to set.
  const CTL = `
const P = lib.controls('Look', { 'Sun size': [200, 50, 400], Ground: true });
lib.layer(ctx, 'Sun', () => { ctx.fillRect(100, 100, P['Sun size'], P['Sun size']); });
if (P.Ground) ctx.fillRect(0, 1000, 1920, 80);
`;
  const ctlFilm = (props: object = {}, anim: object = {}) =>
    Doc.parse({
      meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, duration: 10 },
      layers: [{ id: "code", name: "Scene (code)", type: "code", start: 0, end: 10, props: { code: CTL, ...props }, anim }],
    });

  it("draws with the defaults until something is set, then with what's set (static or keyed)", () => {
    const a = spy(), b = spy(), c = spy();
    renderDoc(a.ctx, ctlFilm(), 5, kit, NO_ASSETS);
    expect(painted(a.o)).toEqual([{ x: 100, y: 100, w: 200, h: 200, alpha: 1 }, { x: 0, y: 1000, w: 1920, h: 80, alpha: 1 }]);
    renderDoc(b.ctx, ctlFilm({ controls: { "Sun size": 300, Ground: 0 } }), 5, kit, NO_ASSETS);
    expect(painted(b.o)).toEqual([{ x: 100, y: 100, w: 300, h: 300, alpha: 1 }]);
    const keyed = { "props.controls.Sun size": [{ id: "k1", t: 0, v: 100, ease: "linear" }, { id: "k2", t: 10, v: 300, ease: "linear" }] };
    renderDoc(c.ctx, ctlFilm({}, keyed), 5, kit, NO_ASSETS);
    expect(painted(c.o)[0]).toEqual({ x: 100, y: 100, w: 200, h: 200, alpha: 1 });
  });

  it("finds what a scene declares and keeps it on the code layer", async () => {
    const { ctx } = spy();
    let doc = ctlFilm();
    const found = await findParts(doc.layers[0], doc, kit, NO_ASSETS, compileScene(CTL), ctx);
    expect(found.controls.map((d) => [d.name, d.kind, d.group])).toEqual([["Sun size", "number", "Look"], ["Ground", "toggle", "Look"]]);
    doc = structuredClone(doc);
    syncParts("code", partsKey(doc.layers[0]), found.parts, found.controls)(doc);
    expect(controlsOf(doc.layers[0]).map((d) => d.name)).toEqual(["Sun size", "Ground"]);
  });
});

describe("parts after the audit fixes", () => {
  // A measureText for the stand-in canvas (the Spy has none of its own).
  const measuring = () => {
    const sp = spy();
    Object.assign(sp.o, { font: "100px sans", textAlign: "left", textBaseline: "alphabetic", measureText: (str: string) => ({ width: String(str).length * 50 }), fillText() {} });
    return sp;
  };

  it("gives a part that only draws text a box", () => {
    const { ctx } = measuring();
    const tap = tapParts(ctx, kit, { track: true });
    compileScene("lib.layer(ctx, 'Title', () => { ctx.fillText('HELLO', 400, 300); });")(ctx, 1920, 1080, 0, 10, 0, tap.lib, NO_ASSETS);
    tap.restore();
    expect(tap.seen.get("Title")!.box).toEqual({ x0: 400, y0: 220, x1: 650, y1: 320 });
  });

  it("lets the code's own timing show a part whose clip nobody trimmed, and a trimmed clip window it", () => {
    const found = [6, 8];
    const untouched = spy(), trimmed = spy();
    renderDoc(untouched.ctx, film([part("Bird", { start: 6, end: 8, props: { partOf: "code", part: "Bird", found } })]), 5, kit, NO_ASSETS);
    expect(painted(untouched.o).some((r) => r.w === 40)).toBe(true);
    renderDoc(trimmed.ctx, film([part("Bird", { start: 6, end: 7, props: { partOf: "code", part: "Bird", found } })]), 5, kit, NO_ASSETS);
    expect(painted(trimmed.o).some((r) => r.w === 40)).toBe(false);
  });

  it("moves an untrimmed part's clip to where new code shows it, and leaves a trimmed one", () => {
    const doc = structuredClone(
      film([part("Sun", { start: 0, end: 10, props: { partOf: "code", part: "Sun", found: [0, 10] } }), part("Bird", { start: 5, end: 6, props: { partOf: "code", part: "Bird", found: [3.9, 8] } })]),
    );
    syncParts("code", partsKey(doc.layers[0]), [
      { name: "Sun", start: 2, end: 9 },
      { name: "Bird", start: 1, end: 4 },
    ])(doc);
    const [sun, bird] = partsOf(doc, "code");
    expect([sun.start, sun.end, sun.props.found]).toEqual([2, 9, [2, 9]]);
    expect([bird.start, bird.end, bird.props.found]).toEqual([5, 6, [1, 4]]);
  });

  it("takes a code layer's parts along when it moves in time or the film is retimed", () => {
    const base = () => structuredClone(film([part("Bird", { start: 4, end: 8, props: { partOf: "code", part: "Bird", found: [4, 8] } })]));
    const moved = base();
    moveLayerTime(["code"], 1)(moved);
    expect([moved.layers[1].start, moved.layers[1].end, moved.layers[1].props.found]).toEqual([5, 9, [5, 9]]);
    const stretched = base();
    retime(20)(stretched);
    expect([stretched.layers[1].start, stretched.layers[1].end, stretched.layers[1].props.found]).toEqual([8, 16, [8, 16]]);
  });

  it("never cuts a part in two, and copies a code layer's parts when it is split", () => {
    const doc = structuredClone(film([part("Sun", { transform: { x: 50 } })]));
    splitLayer("p-Sun", 5)(doc);
    expect(doc.layers).toHaveLength(2);
    splitLayer("code", 5)(doc);
    const copy = doc.layers.find((l) => l.type === "code" && l.id !== "code")!;
    const copied = partsOf(doc, copy.id);
    expect(copied.map((l) => [l.name, l.transform.x])).toEqual([["Sun", 50]]);
    expect(partsOf(doc, "code")).toHaveLength(1);
  });
});
