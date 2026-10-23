/* eslint-disable @typescript-eslint/no-explicit-any */
// The split end to end, on a stand-in 2D canvas that keeps real transform/alpha/shadow state but
// paints nothing (so pixels always match and the checks here are about what extraction proposes).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileScene } from "@/lib/engine";
import { makeKit } from "@/lib/kit";
import { Doc } from "../doc/schema";
import { renderDoc } from "../render/renderDoc";
import { codeHash } from "./codeHash";
import { extractText, splitDocText } from "./splitText";
import { tapText } from "./textTap";
import { verifySplit } from "./verifySplit";

type M = [number, number, number, number, number, number];
const mul = ([a, b, c, d, e, f]: M, [A, B, C, D, E, F]: M): M => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];

class Ctx2D {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  filter = "none";
  fillStyle: unknown = "#000000";
  strokeStyle: unknown = "#000000";
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  letterSpacing = "0px";
  shadowColor = "rgba(0, 0, 0, 0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  m: M = [1, 0, 0, 1, 0, 0];
  stack: Record<string, unknown>[] = [];
  static KEYS = ["globalAlpha", "globalCompositeOperation", "filter", "fillStyle", "strokeStyle", "font", "textAlign", "textBaseline", "letterSpacing", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "m"];
  save() {
    this.stack.push(Object.fromEntries(Ctx2D.KEYS.map((k) => [k, (this as any)[k]])));
  }
  restore() {
    Object.assign(this, this.stack.pop() ?? {});
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = [a, b, c, d, e, f];
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = mul(this.m, [a, b, c, d, e, f]);
  }
  translate(x: number, y: number) {
    this.transform(1, 0, 0, 1, x, y);
  }
  rotate(r: number) {
    this.transform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0);
  }
  scale(x: number, y: number) {
    this.transform(x, 0, 0, y, 0, 0);
  }
  getTransform() {
    const [a, b, c, d, e, f] = this.m;
    return { a, b, c, d, e, f };
  }
  measureText(s: string) {
    return { width: String(s).length * Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10) * 0.5 };
  }
  fillText() {}
  clip() {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4) };
  }
}
// Every other canvas call is a no-op.
const ctx2d = () =>
  new Proxy(new Ctx2D(), {
    get: (o, k, r) => (k in o ? Reflect.get(o, k, r) : typeof k === "symbol" ? undefined : () => ({ addColorStop() {} })),
  });

beforeAll(() => {
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const kit = makeKit(1920, 1080, { serif: "serif", sans: "sans", mono: "mono" });
const NO_ASSETS = { images: [], byName: {} };

const SCENE = `
const k = t / T;
if (t >= 0.5) lib.text(ctx, 'Behind', 100, 100, { size: 60 });
lib.text(ctx, 'Title', 100, 100, { size: 60 });
lib.text(ctx, 'Mover', 100 + 300 * k, 400, { size: 40 });
if (t < 0.1) lib.text(ctx, 'Blink', 50, 50);
ctx.save(); ctx.shadowColor = '#000'; ctx.shadowOffsetX = 6; lib.text(ctx, 'Shadowed', 0, 600); ctx.restore();
ctx.save(); ctx.transform(1, 0, -0.25, 1, 0, 0); lib.text(ctx, 'Oblique', 0, 700); ctx.restore();
lib.text(ctx, 'Ghost', 0, 900, { alpha: -0.5 });
for (let i = 0; i < 8; i++) lib.text(ctx, 'abcdefgh'[i], 20 * i, 800);
`;

describe("extracting text", () => {
  it("proposes layers in paint order and keeps in code what a layer can't replay", async () => {
    const c = await extractText(SCENE, 1920, 1080, 1, 30, kit, NO_ASSETS);
    expect(c.layers.map((l) => l.name)).toEqual(["“Behind”", "“Title”", "“Mover”"]);
    for (const s of ["Blink", "Shadowed", "Oblique", "Ghost", "a", "h"]) expect(c.keep.has(s)).toBe(true);
    const [behind, title, mover] = c.layers;
    expect(title.transform.x).toBe(100);
    expect(title.anim["transform.x"]).toBeUndefined();
    expect(mover.anim["transform.x"].map((k) => k.v)).toEqual([100, 390]);
    // In and out points sit half a frame off the frames, and keys just before theirs.
    expect(behind.start).toBeCloseTo(15 / 30 - 0.5 / 30, 9);
    expect(behind.end).toBeCloseTo(29.5 / 30, 9);
    expect(c.frames[0].size).toBe(15);
  });

  it("caps the number of layers, keeping the shortest-lived text in code", async () => {
    // 200 distinct labels (letters, not digits: digits read as a counter), a quarter appearing late.
    const name = (i: number) => `Label ${"abcdefghij"[i % 10]}${"abcdefghijklmnopqrst"[Math.floor(i / 10)]}`;
    const code = `const name = ${name.toString()};
for (let i = 0; i < 200; i++) if (t >= (i % 4) * 0.05) lib.text(ctx, name(i), 10, 5 * i);`;
    const c = await extractText(code, 1920, 1080, 1, 30, kit, NO_ASSETS);
    expect(c.layers.length).toBe(160);
    expect(c.keep.size).toBe(40);
    // Labels that appear last (i % 4 === 3) are the ones that went back to the code.
    const late = new Set(Array.from({ length: 200 }, (_, i) => i).filter((i) => i % 4 === 3).map(name));
    expect([...c.keep].every((s) => late.has(s))).toBe(true);
  }, 60_000);

  it("never makes a layer of a draw that leaves no pixel (text measured at alpha 0)", async () => {
    const c = await extractText(
      `
const m = lib.text(ctx, 'QUIET.', 0, -9999, { size: 200, alpha: 0 });
lib.text(ctx, 'QUIET.', 960 - m.width / 2, 540, { size: 200 });
ctx.save(); ctx.globalAlpha = 0; ctx.fillText('Raw', 0, 0); ctx.restore();
lib.text(ctx, 'Clear', 0, 100, { color: 'rgba(0, 0, 0, 0)' });
ctx.save(); ctx.beginPath(); ctx.clip(); lib.text(ctx, 'Wide', 0, -9999, { alpha: 0 }); ctx.restore();
lib.text(ctx, 'Wide', 0, 300);`,
      1920,
      1080,
      1,
      30,
      kit,
      NO_ASSETS,
    );
    expect(c.layers.map((l) => l.name)).toEqual(["“QUIET.”", "“Wide”"]);
    expect([...c.frames[0].values()].every((a) => a === 1)).toBe(true);
    // A measuring draw under a clip says nothing about how the words look: they're still split.
    expect(c.keep.has("Wide")).toBe(false);
  });

  it("carries a layer through the moments its text is off, and starts it where the text first shows", async () => {
    const names = (c: Awaited<ReturnType<typeof extractText>>) => c.layers.map((l) => [l.name, l.start.toFixed(3), l.end.toFixed(3)]);
    // On for half a second, off for half a second: one layer, off (opacity 0) in between.
    const blink = await extractText(`lib.text(ctx, 'Hi', 100, 100, { size: 60, alpha: Math.floor(t * 2) % 2 ? 1 : 0 });`, 1920, 1080, 4, 30, kit, NO_ASSETS);
    expect(names(blink)).toEqual([["“Hi”", (14.5 / 30).toFixed(3), (119.5 / 30).toFixed(3)]]);
    const op = blink.layers[0].anim["transform.opacity"].map((k) => k.v);
    expect(op).toContain(0);
    expect(op).toContain(1);
    expect([...blink.frames[0].values()].filter((a) => a === 0)).toHaveLength(45); // three off stretches of 15 frames
    expect([...blink.strs[0]]).toEqual(["Hi"]);
    // A strobe, off every other frame: still one layer, not frames too short to keep.
    const strobe = await extractText(`lib.text(ctx, 'Strobe', 100, 100, { size: 60, alpha: Math.floor(t * 30) % 2 ? 1 : 0 });`, 1920, 1080, 2, 30, kit, NO_ASSETS);
    expect(strobe.layers.map((l) => l.name)).toEqual(["“Strobe”"]);
    expect(strobe.keep.size).toBe(0);
    // Off by a clear colour: the layer keeps its colour, at opacity 0.
    const clear = await extractText(`lib.text(ctx, 'Hi', 100, 100, { color: t > 0.4 && t < 0.6 ? 'rgba(0,0,0,0)' : '#ff0000' });`, 1920, 1080, 1, 30, kit, NO_ASSETS);
    expect(clear.layers[0].props.color).toBe("#ff0000");
    // Fading in from nothing: the layer starts on the first frame anything shows.
    const fade = await extractText(`lib.text(ctx, 'Fade', 100, 100, { alpha: Math.max(0, t - 0.5) * 2 });`, 1920, 1080, 1, 30, kit, NO_ASSETS);
    expect(fade.layers[0].start).toBeCloseTo(15.5 / 30, 9);
  });

  it("records the scene by its own clock: a trimmed scene's text where playback paints it", async () => {
    const code = `if (t >= 1.5) lib.text(ctx, 'Late', 20, 100, { size: 40 }); lib.text(ctx, String(T), 20, 300);`;
    // A 3 s clip showing scene time 1 to 4 of a 4 s scene.
    const c = await extractText(code, 1920, 1080, 3, 10, kit, NO_ASSETS, 0, { sceneIn: 1, sceneT: 4 });
    expect(c.layers.map((l) => [l.name, l.start])).toEqual([
      ["“Late”", 0.45],
      ["“4”", 0],
    ]);
  });

  it("names layers by their words and links copies of the same words drawn together", async () => {
    const c = await extractText(
      `
lib.text(ctx, 'LOUD', 106, 106, { size: 90, color: '#ff0000' });
lib.text(ctx, 'LOUD', 100, 100, { size: 90 });
lib.text(ctx, 'Other', 100, 400);
if (t > 0.6) lib.text(ctx, 'LOUD', 600, 600);`,
      1920,
      1080,
      1,
      30,
      kit,
      NO_ASSETS,
    );
    expect(c.layers.map((l) => l.name)).toEqual(["“LOUD”", "“LOUD”", "“Other”", "“LOUD”"]);
    expect(c.layers.every((l) => l.props.autoName === true)).toBe(true);
    const [shadow, word, other, late] = c.layers;
    expect(typeof shadow.props.linkId).toBe("string");
    expect(word.props.linkId).toBe(shadow.props.linkId);
    expect(other.props.linkId).toBeUndefined();
    // On screen with them for under half their life: another use of the word, not a copy.
    expect(late.props.linkId).toBeUndefined();
  });

  it("notes the frames where the code paints over its text, however briefly", async () => {
    const c = await extractText(
      `
if (t > 0.05 && t < 0.15) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080); }
lib.text(ctx, 'Card', 100, 100, { size: 60 });
if (t > 0.35 && t < 0.45) { ctx.fillStyle = '#fff'; ctx.fillRect(80, 40, 200, 80); }
if (t > 0.55 && t < 0.65) { ctx.fillRect(1000, 600, 100, 100); }
if (t > 0.75 && t < 0.85) { ctx.save(); ctx.translate(100, 80); ctx.beginPath(); ctx.rect(0, 0, 50, 20); ctx.fill(); ctx.restore(); }
if (t > 0.85 && t < 0.95) { ctx.save(); ctx.translate(1000, 900); ctx.beginPath(); ctx.rect(0, 0, 50, 20); ctx.fill(); ctx.restore(); }`,
      1920,
      1080,
      1,
      30,
      kit,
      NO_ASSETS,
    );
    expect(c.layers.map((l) => l.name)).toEqual(["“Card”"]);
    // Covered by a card (frames 11–13) and a path filled through a transform (23–25); paint under the
    // text, or away from it, doesn't count.
    expect(c.check).toEqual([11, 12, 13, 23, 24, 25]);
  });
});

describe("choosing frames to check", () => {
  const frames = (n: number, from: number, to: number, key: string, a: number | ((i: number) => number), into = new Map<number, Map<string, number>>()) => {
    for (let i = from; i < Math.min(n, to); i++) (into.get(i) ?? into.set(i, new Map()).get(i)!).set(key, typeof a === "number" ? a : a(i));
    return into;
  };

  it("checks every frame of a brief cover, and a long one where it starts and where it covers most", async () => {
    const { coveredFrames } = await import("./splitText");
    const cover = frames(100, 3, 6, "card", (i) => 10 * i);
    frames(100, 20, 60, "slide", (i) => 100 - Math.abs(i - 42), cover);
    expect(coveredFrames(cover, 30, 8)).toEqual([3, 4, 5, 20, 42]);
    // The same paint, back later: a stretch of its own.
    frames(100, 80, 82, "card", 5, cover);
    expect(coveredFrames(cover, 30, 8)).toEqual([3, 4, 5, 20, 42, 80, 81]);
  });

  it("puts brief covers first when there are too many frames, and an overlay on every frame doesn't hide a card", async () => {
    const { coveredFrames } = await import("./splitText");
    // A faint full-frame overlay on all 300 frames, specks of grain on every frame (a different size each
    // time), and a card over the text for two frames.
    const cover = frames(300, 0, 300, "overlay", 50);
    for (let i = 0; i < 300; i++) frames(300, i, i + 1, `speck${i % 7}`, 2, cover);
    frames(300, 121, 123, "card", 600, cover);
    const picked = coveredFrames(cover, 30, 8);
    expect(picked).toHaveLength(30);
    expect(picked).toContain(121);
    expect(picked).toContain(122);
    expect(coveredFrames(cover, 2, 8)).toEqual([121, 122]);
  });
});

describe("linking copies", () => {
  it("links layers saying the same thing on the frames they share, for most of each one's life", async () => {
    const { linkGroups, pruneLinks } = await import("./splitText");
    const run = (from: number, to: number, str: (i: number) => string) => new Map(Array.from({ length: to - from }, (_, j) => [from + j, str(from + j)]));
    const count = (i: number) => String(i);
    const groups = linkGroups([
      run(0, 30, () => "QUIET."),
      run(0, 30, () => "QUIET."),
      run(2, 30, () => "QUIET."), // a strobe copy a couple of frames late
      run(0, 30, count),
      run(0, 30, count), // a counter's shadow
      run(0, 30, (i) => String(i + 1)), // counting along, a frame ahead: different numbers on each frame
      run(24, 30, () => "QUIET."), // the word again, later
    ]);
    expect(groups).toEqual([
      [0, 1, 2],
      [3, 4],
    ]);
    const layers = ["a", "b", "c"].map((id, k) => Doc.parse({ meta: { id: "f", title: "F", size: { w: 10, h: 10 }, duration: 1 }, layers: [{ id, name: id, type: "text", start: 0, end: 1, props: { linkId: k < 2 ? "L1" : "L2" } }] }).layers[0]);
    expect(pruneLinks(layers).map((l) => l.props.linkId)).toEqual(["L1", "L1", undefined]);
  });
});

describe("splitting a doc", () => {
  const docWith = (code: string) =>
    Doc.parse({ meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, duration: 1 }, layers: [{ id: "scene", name: "Scene (code)", type: "code", start: 0, end: 1, props: { code } }] });

  it("marks the code layer with its code's hash and ties the text layers to it, reporting progress", async () => {
    const progress: number[] = [];
    const doc = await splitDocText(docWith(SCENE), kit, NO_ASSETS, { onProgress: (k) => progress.push(k) });
    const [code, ...text] = doc.layers;
    expect(code.props.skipText).toBe(true);
    expect(code.props.splitHash).toBe(codeHash(SCENE));
    expect(code.props.keepText).toContain("Shadowed");
    expect(text.map((l) => l.props.splitFrom)).toEqual(["scene", "scene", "scene"]);
    expect(progress.every((k, i) => i === 0 || k >= progress[i - 1] - 1e-9)).toBe(true);
    expect(progress.at(-1)).toBeCloseTo(1, 6);
  });

  it("marks a scene that throws so it isn't split again on every open", async () => {
    const doc = await splitDocText(docWith(`if (t > 0.5) throw new Error('boom'); lib.text(ctx, 'Hi', 0, 0);`), kit, NO_ASSETS);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].props.textSplit).toBe(false);
    expect(await splitDocText(doc, kit, NO_ASSETS)).toBe(doc);
  });

  it("splits a trimmed code layer by its scene clock, noting the stretch of the scene it covers", async () => {
    const code = `if (t >= 1.5) lib.text(ctx, 'Late', 20, 100, { size: 40 });`;
    const doc = Doc.parse({
      meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, fps: 10, duration: 3 },
      layers: [{ id: "scene", name: "Scene (code)", type: "code", start: 0, end: 3, props: { code, sceneIn: 1, sceneT: 4 } }],
    });
    const split = await splitDocText(doc, kit, NO_ASSETS);
    expect(split.layers.map((l) => [l.id, l.start])).toEqual([
      ["scene", 0],
      [split.layers[1].id, 0.45],
    ]);
    expect(split.layers[0].props.splitSpan).toEqual([1, 4]);
  });

  it("fails layers that aren't on where the code leaves their words to them", async () => {
    const code = `if (t >= 1.5) lib.text(ctx, 'Late', 20, 100, { size: 40 }); lib.text(ctx, 'Always', 20, 300);`;
    const layer = Doc.parse({
      meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, fps: 10, duration: 3 },
      layers: [{ id: "scene", name: "Scene (code)", type: "code", start: 0, end: 3, props: { code, sceneIn: 1, sceneT: 4 } }],
    });
    // Recorded by the clip's clock instead of the scene's: 'Late' a second late. The stand-in canvas
    // paints nothing, so only the frames where the code skips 'Late' with no layer of it on can tell.
    const wrong = await extractText(code, 1920, 1080, 3, 10, kit, NO_ASSETS);
    expect(wrong.layers.map((l) => l.name)).toEqual(["“Late”", "“Always”"]);
    const v = await verifySplit(layer, layer.layers[0], wrong, kit, NO_ASSETS, { pace: async () => {} });
    expect(v.layers.map((l) => l.name)).toEqual(["“Always”"]);
    expect(v.keep.has("Late")).toBe(true);
    // Text that changes from one run of the scene to the next can't be split at all.
    const random = `lib.text(ctx, 'Steady', 20, 300); lib.text(ctx, String(Math.random()), 20, 100);`;
    const rdoc = Doc.parse({ ...layer, layers: [{ ...layer.layers[0], props: { code: random } }] });
    const rv = await verifySplit(rdoc, rdoc.layers[0], await extractText(random, 1920, 1080, 3, 10, kit, NO_ASSETS), kit, NO_ASSETS, { pace: async () => {} });
    expect(rv.layers).toEqual([]);
  });

  it("stops when aborted, without marking anything", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(splitDocText(docWith(SCENE), kit, NO_ASSETS, { signal: ac.signal })).rejects.toThrow();
  });
});

describe("under its code layer's transform and blend", () => {
  it("a scene's text is as movable as it is at the origin, where it was split", () => {
    const scene = compileScene(`
ctx.save(); ctx.rotate(0.6); lib.text(ctx, 'Turned', 0, 0); ctx.restore();
ctx.globalCompositeOperation = 'source-over'; lib.text(ctx, 'Set back', 0, 100);
ctx.save(); ctx.globalCompositeOperation = 'lighter'; lib.text(ctx, 'Glow', 0, 200); ctx.restore();
ctx.save(); ctx.transform(1, 0, -0.25, 1, 0, 0); lib.text(ctx, 'Oblique', 0, 300); ctx.restore();`);
    const run = (layer: (ctx: any) => void) => {
      const ctx: any = ctx2d();
      layer(ctx);
      const seen: Record<string, boolean> = {};
      const tap = tapText(ctx, kit, (d, movable) => ((seen[d.str] = movable), "draw"));
      try {
        scene(ctx, 1920, 1080, 0, 1, 0, tap.lib, NO_ASSETS);
      } finally {
        tap.restore();
      }
      return seen;
    };
    const origin = run(() => {});
    expect(origin).toEqual({ Turned: true, "Set back": true, Glow: false, Oblique: false });
    // Stretched, moved, faded and blended, as playback runs a code layer the agent changed.
    expect(
      run((ctx) => {
        ctx.translate(40, 10);
        ctx.scale(2, 1);
        ctx.globalAlpha = 0.5;
        ctx.globalCompositeOperation = "screen";
      }),
    ).toEqual(origin);
  });
});

describe("rendering split text", () => {
  // Records the canvas transform and alpha each piece of text is painted with.
  class Spy extends Ctx2D {
    painted: { s: string; m: object; alpha: number }[] = [];
    fillText(...a: unknown[]) {
      this.painted.push({ s: String(a[0]), m: this.getTransform(), alpha: this.globalAlpha });
    }
  }
  const spy = () => {
    const o = new Spy();
    const ctx: any = new Proxy(o, { get: (t, k, r) => (k in t ? Reflect.get(t, k, r) : typeof k === "symbol" ? undefined : () => ({ addColorStop() {} })) });
    return { ctx, painted: o.painted };
  };
  const layers = (textParent: string | null) => [
    { id: "g", name: "Group", type: "group", start: 0, end: 1, transform: { x: 100, opacity: 0.5 } },
    { id: "scene", name: "Artwork (code)", type: "code", parentId: "g", start: 0, end: 1, transform: { y: 20 }, props: { code: "", skipText: true, keepText: [], splitHash: codeHash("") } },
    { id: "t", name: "“Hi”", type: "text", parentId: textParent, start: 0, end: 1, transform: { x: 10 }, props: { text: "Hi", raw: true, splitFrom: "scene" } },
  ];
  const paint = (textParent: string | null) => {
    const doc = Doc.parse({ meta: { id: "f", title: "F", size: { w: 1920, h: 1080 }, duration: 1 }, layers: layers(textParent) });
    const { ctx, painted } = spy();
    renderDoc(ctx, doc, 0.5, kit, NO_ASSETS);
    return painted;
  };

  it("follows its code layer, and a group they share applies once", () => {
    const once = [{ s: "Hi", m: { a: 1, b: 0, c: 0, d: 1, e: 110, f: 20 }, alpha: 0.5 }];
    expect(paint(null)).toEqual(once);
    // Grouped together with its code layer (say, to fade both out): the same, not moved or faded twice.
    expect(paint("g")).toEqual(once);
  });
});
