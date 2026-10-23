/* eslint-disable @typescript-eslint/no-explicit-any */
// Art the code paints over its text, checked by real pixels: a split's text layers paint above all of
// the code, so text the code covers has to stay in code. The canvas here is a tiny rasterizer (solid
// rectangles; text is painted as the box it measures) so the pixel check sees what a browser would.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeKit } from "@/lib/kit";
import { Doc } from "../doc/schema";
import { splitDocText } from "./splitText";
import { matches } from "./verifySplit";

type M = [number, number, number, number, number, number];
const mul = ([a, b, c, d, e, f]: M, [A, B, C, D, E, F]: M): M => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];

const rgb = (s: unknown): [number, number, number] => {
  const m = String(s).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

class PixelCtx {
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  filter = "none";
  fillStyle: unknown = "#000000";
  strokeStyle: unknown = "#000000";
  lineWidth = 1;
  lineJoin = "miter";
  miterLimit = 10;
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
  rects: [number, number, number, number][] = [];
  px: Uint8ClampedArray;
  static KEYS = ["globalAlpha", "globalCompositeOperation", "filter", "fillStyle", "font", "textAlign", "textBaseline", "letterSpacing", "shadowColor", "shadowBlur", "shadowOffsetX", "shadowOffsetY", "m"];
  constructor(
    public W: number,
    public H: number,
  ) {
    this.px = new Uint8ClampedArray(W * H * 4);
  }
  save() {
    this.stack.push(Object.fromEntries(PixelCtx.KEYS.map((k) => [k, (this as any)[k]])));
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
  // Axis-aligned only: the scenes here neither rotate nor skew.
  private device(x: number, y: number, w: number, h: number) {
    const [a, , , d, e, f] = this.m;
    const xs = [a * x + e, a * (x + w) + e], ys = [d * y + f, d * (y + h) + f];
    return [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))];
  }
  private paint(x: number, y: number, w: number, h: number, color: unknown, clear = false) {
    const [x0, y0, x1, y1] = this.device(x, y, w, h);
    const [r, g, b] = rgb(color);
    // Locals: methods run with `this` as the proxy, which is slow per pixel.
    const { px, W, H } = this;
    const al = clear ? 1 : this.globalAlpha;
    for (let yy = Math.max(0, y0); yy < Math.min(H, y1); yy++)
      for (let xx = Math.max(0, x0); xx < Math.min(W, x1); xx++) {
        const o = (yy * W + xx) * 4;
        if (clear) px.fill(0, o, o + 4);
        else {
          px[o] = px[o] * (1 - al) + r * al;
          px[o + 1] = px[o + 1] * (1 - al) + g * al;
          px[o + 2] = px[o + 2] * (1 - al) + b * al;
          px[o + 3] = Math.min(255, px[o + 3] + 255 * al);
        }
      }
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.paint(x, y, w, h, this.fillStyle);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    this.paint(x, y, w, h, null, true);
  }
  beginPath() {
    this.rects = [];
  }
  rect(x: number, y: number, w: number, h: number) {
    const [x0, y0, x1, y1] = this.device(x, y, w, h);
    this.rects.push([x0, y0, x1 - x0, y1 - y0]);
  }
  fill() {
    const m = this.m;
    this.m = [1, 0, 0, 1, 0, 0];
    for (const [x, y, w, h] of this.rects) this.paint(x, y, w, h, this.fillStyle);
    this.m = m;
  }
  size() {
    return Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
  }
  measureText(s: string) {
    return { width: String(s).length * this.size() * 0.5 };
  }
  // Text as the box it measures: from 0.7 of its size above the baseline down to the baseline.
  fillText(s: string, x: number, y: number) {
    const w = this.measureText(s).width, size = this.size();
    const ax = this.textAlign === "center" ? -w / 2 : this.textAlign === "right" || this.textAlign === "end" ? -w : 0;
    this.paint(x + ax, y - 0.7 * size, w, 0.7 * size, this.fillStyle);
  }
  getImageData(x: number, y: number, w: number, h: number) {
    const data = new Uint8ClampedArray(w * h * 4);
    const { px, W } = this;
    for (let r = 0; r < h; r++) data.set(px.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
    return { data };
  }
}
// Every other canvas call is a no-op.
const pixelCtx = (W: number, H: number) =>
  new Proxy(new PixelCtx(W, H), { get: (o, k, r) => (k in o ? Reflect.get(o, k, r) : typeof k === "symbol" ? undefined : () => ({ addColorStop() {} })) });

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => {
      const c: any = { width: 0, height: 0 };
      c.getContext = () => (c.ctx ??= pixelCtx(c.width, c.height));
      return c;
    },
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const NO_ASSETS = { images: [], byName: {} };
const split = (code: string, W: number, H: number, duration: number, fps = 10) => {
  const kit = makeKit(W, H, { serif: "serif", sans: "sans", mono: "mono" });
  const doc = Doc.parse({ meta: { id: "f", title: "F", size: { w: W, h: H }, fps, duration }, layers: [{ id: "scene", name: "Scene (code)", type: "code", start: 0, end: duration, props: { code } }] });
  return splitDocText(doc, kit, NO_ASSETS);
};
const texts = (doc: Doc) => doc.layers.filter((l) => l.type === "text").map((l) => l.name);

describe("how many changed pixels fail a layer", () => {
  it("forgives a share of a region, but never a lot of pixels", () => {
    expect(matches(12, 10, 10)).toBe(true); // a few pixels of anti-aliasing, even in a small region
    expect(matches(96, 300, 100)).toBe(true); // anti-aliasing on big text
    expect(matches(400, 300, 100)).toBe(false); // over 1% of the region
    expect(matches(2400, 700, 460)).toBe(false); // under 1% of a huge region, but a bar's worth of pixels
  });
});

describe("art painted over text", () => {
  const NO = (bar: string) => `
lib.bg(ctx, W, H, '#000000');
lib.text(ctx, 'NO.', 100, 500, { size: 400, color: '#ffffff' });
${bar}`;

  it("keeps huge text in code when a bar crosses it, though the bar is a small share of its region", async () => {
    const plain = await split(NO(""), 800, 600, 1);
    expect(texts(plain)).toEqual(["“NO.”"]);
    // 600 × 4 px of red across the word: about 2,400 pixels, under 1% of the word's padded region.
    const crossed = await split(NO(`ctx.fillStyle = '#ff0000'; ctx.fillRect(100, 400, 600, 4);`), 800, 600, 1);
    expect(texts(crossed)).toEqual([]);
    expect(crossed.layers[0].props.textSplit).toBe(false);
  }, 60_000);

  const HELLO = (art: string, before = false) => `
lib.bg(ctx, W, H, '#000000');
${before ? art : ""}
lib.text(ctx, 'Hello', 20, 100, { size: 40, color: '#ffffff' });
${before ? "" : art}`;
  // Frames 4 and 5 of 20, between the regular samples (every third frame).
  const card = `if (t > 0.35 && t < 0.55) { ctx.fillStyle = '#ff0000'; ctx.fillRect(10, 60, 140, 50); }`;
  const path = `if (t > 0.35 && t < 0.55) { ctx.save(); ctx.translate(10, 60); ctx.fillStyle = '#ff0000'; ctx.beginPath(); ctx.rect(0, 0, 140, 50); ctx.fill(); ctx.restore(); }`;

  it("keeps text in code when a card covers it for a moment between the sampled frames", async () => {
    expect(texts(await split(HELLO(""), 320, 180, 2))).toEqual(["“Hello”"]);
    expect(texts(await split(HELLO(card, true), 320, 180, 2))).toEqual(["“Hello”"]); // under the text: fine
    expect(texts(await split(HELLO(card), 320, 180, 2))).toEqual([]);
    expect(texts(await split(HELLO(path), 320, 180, 2))).toEqual([]);
  }, 60_000);

  it("still finds the card when faint art covers the text on every frame", async () => {
    // 120 frames, more than the frames it checks where art covers text; the card is on two of them
    // (61 and 62), between the regular samples (every third frame).
    const overlay = `ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.restore();`;
    const brief = `if (t > 6.05 && t < 6.25) { ctx.fillStyle = '#ff0000'; ctx.fillRect(10, 60, 140, 50); }`;
    expect(texts(await split(HELLO(overlay), 320, 180, 12))).toEqual(["“Hello”"]); // too faint to matter
    expect(texts(await split(HELLO(brief + "\n" + overlay), 320, 180, 12))).toEqual([]);
  }, 120_000);
});
