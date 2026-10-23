import { describe, expect, it } from "vitest";
import { changedPixels } from "./verifySplit";

// A W×H RGBA image filled with `bg`, with the given pixels painted `fg`.
function img(W: number, H: number, bg: number, fg: number, on: (x: number, y: number) => boolean) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = on(x, y) ? fg : bg;
      d.set([v, v, v, 255], (y * W + x) * 4);
    }
  return d;
}

describe("pixel check", () => {
  const W = 40, H = 20;
  const stroke = (x0: number) => (x: number) => x >= x0 && x < x0 + 3;

  it("finds nothing in identical images", () => {
    const a = img(W, H, 250, 20, stroke(10));
    expect(changedPixels(a, a.slice(), W, H, 0, 0, W, H)).toBe(0);
  });

  it("forgives text that moved by a pixel or less (anti-aliasing)", () => {
    const a = img(W, H, 250, 20, stroke(10));
    const b = img(W, H, 250, 20, stroke(11));
    expect(changedPixels(a, b, W, H, 0, 0, W, H)).toBe(0);
    // A half-pixel shift: the edge pixels take in-between values.
    const c = img(W, H, 250, 20, stroke(10));
    for (let y = 0; y < H; y++) {
      c.set([135, 135, 135, 255], (y * W + 10) * 4);
      c.set([135, 135, 135, 255], (y * W + 13) * 4);
    }
    expect(changedPixels(a, c, W, H, 0, 0, W, H)).toBe(0);
  });

  it("finds text that's covered, missing or moved", () => {
    const text = img(W, H, 250, 20, stroke(10));
    const card = img(W, H, 255, 255, () => true);
    expect(changedPixels(card, text, W, H, 0, 0, W, H)).toBe(3 * H); // shows through a card that covers it
    expect(changedPixels(text, card, W, H, 0, 0, W, H)).toBe(3 * H); // missing
    expect(changedPixels(text, img(W, H, 250, 20, stroke(20)), W, H, 0, 0, W, H)).toBe(6 * H);
  });

  it("only counts the region asked for", () => {
    const a = img(W, H, 250, 20, stroke(10));
    const b = img(W, H, 250, 20, stroke(30));
    expect(changedPixels(a, b, W, H, 0, 0, 20, H)).toBe(3 * H);
  });
});
