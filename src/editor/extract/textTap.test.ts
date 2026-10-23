/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type { Kit } from "@/lib/kit";
import { alphaOk, castsShadow, colorParts, invisible, relativeTo, skewed, tapText } from "./textTap";

describe("what a text layer can replay", () => {
  it("sees hard shadows as well as blurred ones", () => {
    expect(castsShadow("#000000", 0, 8, 8)).toBe(true);
    expect(castsShadow("#000000", 6, 0, 0)).toBe(true);
    expect(castsShadow("rgba(0, 0, 0, 0)", 6, 4, 4)).toBe(false); // the default: transparent
    expect(castsShadow("rgba(0, 0, 0, 0.05)", 0, 2, 0)).toBe(true);
    expect(castsShadow("#000000", 0, 0, 0)).toBe(false);
  });

  it("rejects skew but accepts rotation, scale and mirroring", () => {
    const r = Math.PI / 5;
    expect(skewed({ a: Math.cos(r) * 2, b: Math.sin(r) * 2, c: -Math.sin(r) * 0.5, d: Math.cos(r) * 0.5 })).toBe(false);
    expect(skewed({ a: 1, b: 0, c: 0, d: -1 })).toBe(false);
    expect(skewed({ a: 1, b: 0, c: -0.25, d: 1 })).toBe(true);
    // Non-uniform scale applied after a rotation shears the text.
    expect(skewed({ a: Math.cos(r) * 2, b: Math.sin(r), c: -Math.sin(r) * 2, d: Math.cos(r) })).toBe(true);
  });

  it("sees draws that leave no pixel", () => {
    expect(invisible({ alpha: 0, o: {} })).toBe(true);
    expect(invisible({ alpha: 0.001, o: {} })).toBe(true); // under half a step of 8-bit colour
    expect(invisible({ alpha: 0.01, o: {} })).toBe(false);
    for (const color of ["transparent", "rgba(0, 0, 0, 0)", "hsla(0, 0%, 0%, 0)", "#ff000000", "#f000"]) expect(invisible({ alpha: 1, o: { color } })).toBe(true);
    for (const color of ["#000", "rgba(0, 0, 0, 0.5)", "#ff0000ff"]) expect(invisible({ alpha: 1, o: { color } })).toBe(false);
    for (const str of ["", "   ", "\n"]) expect(invisible({ alpha: 1, o: {}, str })).toBe(true); // nothing but spaces
    expect(invisible({ alpha: 1, o: {}, str: " a " })).toBe(false);
  });

  it("reads a paint's colour apart from its alpha", () => {
    expect(colorParts("rgba(0, 0, 0, 0.22)")).toEqual({ color: "rgb(0,0,0)", alpha: 0.22 });
    expect(colorParts("rgb(0 0 0 / 50%)")).toEqual({ color: "rgb(0,0,0)", alpha: 0.5 });
    expect(colorParts("hsla(10, 50%, 50%, 0.5)")).toEqual({ color: "hsl(10,50%,50%)", alpha: 0.5 });
    expect(colorParts("#FF000080")).toEqual({ color: "#ff0000", alpha: 128 / 255 });
    expect(colorParts("#f008")).toEqual({ color: "#f00", alpha: 136 / 255 });
    expect(colorParts("#ff0000")).toEqual({ color: "#ff0000", alpha: 1 });
    expect(colorParts("transparent").alpha).toBe(0);
    expect(colorParts({ addColorStop() {} })).toEqual({ color: "pattern", alpha: 1 }); // a gradient may be opaque anywhere
  });

  it("only accepts alphas the canvas applies", () => {
    expect(alphaOk(0.5, 1)).toBe(true);
    expect(alphaOk(-0.2, 1)).toBe(false);
    expect(alphaOk(1.5, 0.5)).toBe(false);
    expect(alphaOk("0.5", 1)).toBe(false);
  });
});

describe("measuring from where the scene starts", () => {
  type M = { a: number; b: number; c: number; d: number; e: number; f: number };
  const mul = (p: M, q: M): M => ({ a: p.a * q.a + p.c * q.b, b: p.b * q.a + p.d * q.b, c: p.a * q.c + p.c * q.d, d: p.b * q.c + p.d * q.d, e: p.a * q.e + p.c * q.f + p.e, f: p.b * q.e + p.d * q.f + p.f });
  const close = (p: M, q: M) => (Object.keys(p) as (keyof M)[]).forEach((k) => expect(p[k]).toBeCloseTo(q[k], 9));

  it("takes the starting transform back out", () => {
    const r = 0.6;
    const base: M = { a: 2, b: 0, c: 0, d: 1, e: 40, f: 10 }; // a code layer moved and stretched
    const local: M = { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 300, f: 200 };
    close(relativeTo(base, mul(base, local)), local);
    // Seen whole, stretched-then-turned text is skewed; from where the scene started it's only turned.
    expect(skewed(mul(base, local))).toBe(true);
    expect(skewed(relativeTo(base, mul(base, local)))).toBe(false);
    // Nothing paints under a singular transform; it's left alone rather than blown up.
    const flat: M = { a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 };
    expect(relativeTo(flat, local)).toBe(local);
  });

  // A canvas whose blend mode is a prototype accessor that ignores modes it doesn't know, as in a browser.
  const MODES = new Set(["source-over", "lighter", "screen", "multiply"]);
  class Canvas {
    #op = "source-over";
    #ops: string[] = [];
    fillStyle = "#000000";
    filter = "none";
    shadowColor = "rgba(0, 0, 0, 0)";
    shadowBlur = 0;
    shadowOffsetX = 0;
    shadowOffsetY = 0;
    globalAlpha = 1;
    get globalCompositeOperation() {
      return this.#op;
    }
    set globalCompositeOperation(v: string) {
      if (MODES.has(v)) this.#op = v;
    }
    save() {
      this.#ops.push(this.#op);
    }
    restore() {
      this.#op = this.#ops.pop() ?? this.#op;
    }
    clip() {}
    fillText() {}
    getTransform() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }
  }

  it("counts the blend mode the scene sets, not the one it runs under", () => {
    const ctx: any = new Canvas();
    ctx.globalCompositeOperation = "screen"; // the code layer's own blend
    const seen: [string, boolean][] = [];
    const tap = tapText(ctx, { C: { ink: "#000" }, ease: {} } as unknown as Kit, (d, movable) => (seen.push([d.str, movable]), "draw"));
    ctx.fillText("Inherits", 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillText("Set back", 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillText("Glow", 0, 0);
    ctx.globalCompositeOperation = "add"; // not a canvas mode: ignored, still lighter
    ctx.fillText("Still glow", 0, 0);
    ctx.restore();
    ctx.fillText("After", 0, 0);
    tap.restore();
    expect(seen).toEqual([
      ["Inherits", true],
      ["Set back", true],
      ["Glow", false],
      ["Still glow", false],
      ["After", true],
    ]);
    // Taken off cleanly: the canvas's own accessor again.
    expect(Object.getOwnPropertyDescriptor(ctx, "globalCompositeOperation")).toBeUndefined();
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });
});
