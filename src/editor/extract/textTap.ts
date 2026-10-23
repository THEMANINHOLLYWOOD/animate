/* eslint-disable @typescript-eslint/no-explicit-any */
// Intercepts the text a code scene draws. Used twice with the same rule:
// - splitting: record every movable text draw so it can become a native text layer;
// - playback: skip exactly those draws in the code layer, since the text layers now paint them.
// A draw is movable when nothing but its transform, alpha and font decides how it
// looks: a plain colour, no clip, filter, shadow or blend mode, a transform without
// skew, an alpha the canvas actually applies, and not inside a kit helper that draws
// text as part of something else (globe labels).
// Transform and blend mode count from where the scene starts: playback runs it under its code
// layer's transform and blend (which the text layers follow too), extraction at the origin, and
// both have to agree on what's movable or text would be painted twice, or not at all.

import type { Kit } from "@/lib/kit";

export type TextDraw = {
  kind: "text" | "words" | "typewriter" | "raw";
  str: string;
  k: number | null; // reveal progress for words / typewriter
  o: Record<string, unknown>; // kit text options (serialisable ones), or raw canvas text state
  m: { a: number; b: number; c: number; d: number; e: number; f: number }; // transform at the text origin, from where the scene started
  alpha: number;
  site: string; // where in the scene code the draw came from (grouping only)
};

// A box from where the scene started: [x0, x1] × [y0, y1].
export type Box = { x0: number; y0: number; x1: number; y1: number };

// What a paint is: the canvas call, its colour without alpha ("image", "clear", "pixels", or "pattern"
// for a gradient or pattern), and the alpha it paints with (the colour's own times globalAlpha).
export type Paint = { kind: string; style: string; alpha: number };

// Extraction also watches what the scene paints after its text (used to find frames where art covers
// text, which the split can't reproduce: its text layers paint above all of the code).
export type TapHooks = {
  // Where a movable text draw painted, once it has.
  drawn?: (d: TextDraw, box: Box) => void;
  // Anything else the scene paints (shapes, images, text that stays in code…) as the box it can
  // touch, or null for anywhere (a Path2D, a filter, a blend that reaches outside the shape).
  paint?: (box: Box | null, what: Paint) => void;
  // Whether paint matters right now (once some text is on the frame); boxes aren't worked out until then.
  armed?: () => boolean;
};

const TEXT_FNS = new Set(["text", "words", "typewriter"]);
// Kit helpers that call back into scene code; they draw no text of their own.
const CALLBACK_FNS = new Set(["camera", "mask"]);

type M = TextDraw["m"];

// A canvas shadow is painted when its colour isn't fully transparent and it's blurred or offset.
export function castsShadow(color: string, blur: number, ox: number, oy: number) {
  if (!blur && !ox && !oy) return false;
  const c = color.replace(/\s+/g, "").toLowerCase();
  return !(c === "transparent" || /^rgba\(.*,0(?:\.0*)?\)$/.test(c) || /^#[0-9a-f]{6}00$/.test(c));
}

// A text layer replays translate, rotate and scale (mirroring included); a skewed matrix
// (columns not perpendicular) would come back upright.
export function skewed(m: Pick<M, "a" | "b" | "c" | "d">) {
  const sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
  return sx * sy > 1e-12 && Math.abs(m.a * m.c + m.b * m.d) > 1e-3 * sx * sy;
}

// m as seen from base: base⁻¹ · m, what the scene's own transforms add to the one it started under.
// Nothing paints under a singular base, so m is left as it is there.
export function relativeTo(base: M, m: M): M {
  const det = base.a * base.d - base.b * base.c;
  if (!(Math.abs(det) > 1e-12)) return m;
  const a = base.d / det, b = -base.b / det, c = -base.c / det, d = base.a / det;
  const e = -(a * base.e + c * base.f), f = -(b * base.e + d * base.f);
  return { a: a * m.a + c * m.b, b: b * m.a + d * m.b, c: a * m.c + c * m.d, d: b * m.c + d * m.d, e: a * m.e + c * m.f + e, f: b * m.e + d * m.f + f };
}

// The kit applies alpha as globalAlpha *= alpha, which the canvas ignores outside [0, 1].
export const alphaOk = (a: unknown, outer: number) => typeof a === "number" && a >= 0 && a <= 1 && a * outer >= 0 && a * outer <= 1;

// The alpha the canvas paints a kit draw with (globalAlpha *= alpha ?? 1): the product, unless the
// canvas ignores it (outside [0, 1], or not a number).
const appliedAlpha = (a: unknown, outer: number) => {
  const p = outer * Number(a ?? 1);
  return p >= 0 && p <= 1 ? p : outer;
};

// A colour that paints nothing.
const clearColor = (color: unknown) => {
  if (typeof color !== "string") return false;
  const c = color.replace(/\s+/g, "").toLowerCase();
  return c === "transparent" || /^(?:rgba|hsla)\(.*,0(?:\.0*)?%?\)$/.test(c) || /^#[0-9a-f]{6}00$/.test(c) || /^#[0-9a-f]{3}0$/.test(c);
};

// A draw that leaves no pixel: an alpha under half a step of 8-bit colour, a clear colour (a scene
// measuring text with { alpha: 0 }), or nothing but spaces. It never makes a layer of its own (it may
// continue one, as the moments a blinking word is off); whether playback skips it or draws it makes no
// difference.
export const invisible = (d: Pick<TextDraw, "alpha" | "o"> & { str?: string }) => d.alpha < 0.5 / 255 || clearColor(d.o.color) || (d.str !== undefined && !d.str.trim());

// A paint style as a colour without its alpha, and that alpha: rgb(a)/hsl(a) (comma or space syntax)
// and #rgba/#rrggbbaa; anything else (a named colour, a gradient, a pattern) counts as opaque.
export function colorParts(style: unknown): { color: string; alpha: number } {
  if (typeof style !== "string") return { color: "pattern", alpha: 1 };
  const c = style.trim().toLowerCase();
  if (c === "transparent") return { color: c, alpha: 0 };
  const fn = c.match(/^(rgb|hsl)a?\((.*)\)$/);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    const a = parts[3];
    const alpha = a === undefined ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
    return { color: `${fn[1]}(${parts.slice(0, 3).join(",")})`, alpha: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1 };
  }
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{1,2})?$/);
  if (hex && (hex[2] === undefined || hex[2].length === (hex[1].length === 3 ? 1 : 2))) {
    const a = hex[2] === undefined ? 1 : parseInt(hex[2].length === 1 ? hex[2] + hex[2] : hex[2], 16) / 255;
    return { color: `#${hex[1]}`, alpha: a };
  }
  return { color: c, alpha: 1 };
}

export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// The box around points (x, y) mapped by m.
function boxOf(m: M, pts: number[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = m.a * pts[i] + m.c * pts[i + 1] + m.e, y = m.b * pts[i] + m.d * pts[i + 1] + m.f;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by });
const union = (a: Box | null | undefined, b: Box): Box | null => (a === null ? null : a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b);

// Blend modes that paint only inside what's drawn; the others clear or change pixels outside it too.
const LOCAL_OPS = new Set(["source-over", "source-atop", "destination-over", "destination-out", "lighter", "xor", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
// Where the first line's top sits for a canvas text baseline, as a share of the size.
const TOP: Record<string, number> = { top: 0, hanging: -0.1, middle: -0.5, bottom: -1, ideographic: -1 };
const PATH_FNS = ["beginPath", "moveTo", "lineTo", "rect", "roundRect", "arc", "arcTo", "ellipse", "quadraticCurveTo", "bezierCurveTo"] as const;
const PAINT_FNS = ["fillRect", "strokeRect", "clearRect", "fill", "stroke", "drawImage", "putImageData", "strokeText"] as const;

// Where a call came from in the scene: every frame of the stack inside the compiled scene.
function siteOf() {
  const stack = new Error().stack ?? "";
  const m = stack.match(/(?:<anonymous>|> Function|anonymous):\d+:\d+/g);
  return m ? m.join(">") : "?";
}

// onDraw sees every text draw; `movable` says whether it could be a layer. Only movable draws may be skipped.
// Install it where the scene starts (after the code layer's transform and blend are applied).
export function tapText(ctx: CanvasRenderingContext2D, kit: Kit, onDraw: (d: TextDraw, movable: boolean) => "skip" | "draw", hooks: TapHooks = {}) {
  const proto = Object.getPrototypeOf(ctx);
  const t0 = ctx.getTransform();
  const base: M = { a: t0.a, b: t0.b, c: t0.c, d: t0.d, e: t0.e, f: t0.f };
  let inKit = 0;
  // Inside a movable draw's own painting (not paint over it).
  let own_ = 0;
  let clip = false;
  // The blend mode the scene itself set, or null while it hasn't (the one it started under applies).
  // Reading the canvas wouldn't do: under a blended code layer, a scene setting 'source-over' back would
  // read as blended in playback but not when split. Set back, it counts as normal both times (its text
  // layers then paint with the code layer's blend, as text the scene left alone does).
  let op: string | null = null;
  const states: { clip: boolean; op: string | null }[] = [];
  const saved: Record<string, unknown> = { fillText: ctx.fillText, save: ctx.save, restore: ctx.restore, clip: ctx.clip };
  const own = (name: keyof typeof saved, fn: (...a: any[]) => any) => Object.defineProperty(ctx, name, { value: fn, configurable: true, writable: true });

  own("save", function (this: any) {
    states.push({ clip, op });
    return proto.save.call(ctx);
  });
  own("restore", function (this: any) {
    const r = proto.restore.call(ctx);
    const s = states.pop();
    clip = s?.clip ?? false;
    op = s?.op ?? null;
    return r;
  });
  own("clip", function (this: any, ...a: any[]) {
    clip = true;
    return proto.clip.apply(ctx, a);
  });

  // Watch the scene set globalCompositeOperation: an accessor on the prototype in a browser, a plain
  // field on a stand-in canvas.
  const OP = "globalCompositeOperation";
  const ownOp = Object.getOwnPropertyDescriptor(ctx, OP);
  const field = ownOp && "value" in ownOp ? ownOp : undefined;
  let held = field?.value;
  let accessor = field ? undefined : ownOp;
  for (let p = proto; !ownOp && p && !accessor?.set; p = Object.getPrototypeOf(p)) accessor = Object.getOwnPropertyDescriptor(p, OP);
  const getOp = (): string => (field ? held : accessor!.get!.call(ctx));
  if (field || accessor?.set)
    Object.defineProperty(ctx, OP, {
      configurable: true,
      enumerable: true,
      get: getOp,
      set(v: unknown) {
        if (field) held = v;
        else accessor!.set!.call(ctx, v);
        if (getOp() === String(v)) op = String(v); // the canvas ignores modes it doesn't know
      },
    });

  const plain = (color: unknown, m: M) =>
    !clip &&
    typeof color === "string" &&
    (!ctx.filter || ctx.filter === "none") &&
    (op === null || op === "source-over") &&
    !castsShadow(ctx.shadowColor, ctx.shadowBlur, ctx.shadowOffsetX, ctx.shadowOffsetY) &&
    !skewed(m);

  // The transform at a text origin, from where the scene started.
  const matrixAt = (x: number, y: number) => {
    const t = relativeTo(base, ctx.getTransform());
    return { a: t.a, b: t.b, c: t.c, d: t.d, e: t.a * x + t.c * y + t.e, f: t.b * x + t.d * y + t.f };
  };

  // ── Paint watching (extraction only) ──
  const watching = !!hooks.paint;
  const armed = () => watching && own_ === 0 && (hooks.armed?.() ?? true);
  const here = () => relativeTo(base, ctx.getTransform());
  const scaleOf = (m: M) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
  // A paint's box with what reaches past it (shadow, stroke), or null where it can reach anywhere.
  const paintBox = (b: Box | null, stroke = false): Box | null => {
    if (!b || !LOCAL_OPS.has(ctx.globalCompositeOperation) || (ctx.filter && ctx.filter !== "none")) return null;
    let by = 1;
    if (stroke) by += ctx.lineWidth * scaleOf(here()) * (ctx.lineJoin === "miter" ? Math.max(1, ctx.miterLimit) : 1);
    if (castsShadow(ctx.shadowColor, ctx.shadowBlur, ctx.shadowOffsetX, ctx.shadowOffsetY)) by += 2 * ctx.shadowBlur + Math.abs(ctx.shadowOffsetX) + Math.abs(ctx.shadowOffsetY);
    return grow(b, by);
  };
  const report = (kind: string, b: () => Box | null, stroke = false, style?: string) => {
    if (!armed()) return;
    const c = style ? { color: style, alpha: 1 } : colorParts(stroke ? ctx.strokeStyle : ctx.fillStyle);
    hooks.paint!(paintBox(b(), stroke), { kind, style: c.color, alpha: ctx.globalAlpha * c.alpha });
  };
  // The text a fillText or strokeText call paints, from where the scene started.
  const textBox = (str: string, x: number, y: number, maxWidth?: number): Box => {
    const size = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 10);
    const w = Math.min(ctx.measureText(String(str)).width, maxWidth ?? Infinity);
    const al = ctx.textAlign;
    const ax = al === "center" ? -w / 2 : al === "right" || al === "end" ? -w : 0;
    const top = (TOP[ctx.textBaseline] ?? -0.8) * size;
    return grow(boxOf(here(), [x + ax, y + top, x + ax + w, y + top, x + ax, y + top + size, x + ax + w, y + top + size]), size * 0.25);
  };
  // The current path's box (undefined: empty; null: unknown, begun before paint mattered or before the
  // tap went on, since a canvas keeps its path from one frame to the next).
  let path: Box | null | undefined = null;
  const addPts = (pts: number[]) => {
    if (path === null) return;
    path = armed() ? union(path, boxOf(here(), pts)) : null;
  };
  if (watching) {
    const P: Record<(typeof PATH_FNS)[number], (...a: any[]) => number[] | null> = {
      beginPath: () => null,
      moveTo: (x, y) => [x, y],
      lineTo: (x, y) => [x, y],
      rect: (x, y, w, h) => [x, y, x + w, y, x, y + h, x + w, y + h],
      roundRect: (x, y, w, h) => [x, y, x + w, y, x, y + h, x + w, y + h],
      arc: (x, y, r) => [x - r, y - r, x + r, y - r, x - r, y + r, x + r, y + r],
      arcTo: (x1, y1, x2, y2, r) => [x1 - r, y1 - r, x1 + r, y1 + r, x2 - r, y2 - r, x2 + r, y2 + r],
      ellipse: (x, y, rx, ry) => {
        const r = Math.max(Math.abs(rx), Math.abs(ry));
        return [x - r, y - r, x + r, y - r, x - r, y + r, x + r, y + r];
      },
      quadraticCurveTo: (cx, cy, x, y) => [cx, cy, x, y],
      bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => [c1x, c1y, c2x, c2y, x, y],
    };
    for (const name of PATH_FNS) {
      saved[name] = (ctx as any)[name];
      own(name as any, function (this: any, ...a: any[]) {
        if (name === "beginPath") path = undefined;
        else addPts(P[name](...a)!.map(Number));
        return (saved[name] as (...a: any[]) => any).apply(ctx, a);
      });
    }
    const rectPts = (x: number, y: number, w: number, h: number) => boxOf(here(), [x, y, x + w, y, x, y + h, x + w, y + h]);
    const imageSize = (img: any): [number, number] => [Number(img?.videoWidth || img?.naturalWidth || img?.width) || 0, Number(img?.videoHeight || img?.naturalHeight || img?.height) || 0];
    const B: Record<(typeof PAINT_FNS)[number], (...a: any[]) => void> = {
      fillRect: (x, y, w, h) => report("fillRect", () => rectPts(x, y, w, h)),
      strokeRect: (x, y, w, h) => report("strokeRect", () => rectPts(x, y, w, h), true),
      clearRect: (x, y, w, h) => armed() && hooks.paint!(rectPts(x, y, w, h), { kind: "clearRect", style: "clear", alpha: 1 }),
      // An empty path paints nothing; a Path2D's extent isn't known.
      fill: (p) => (p && typeof p === "object" ? report("fill", () => null) : path !== undefined && report("fill", () => path ?? null)),
      stroke: (p) => (p && typeof p === "object" ? report("stroke", () => null, true) : path !== undefined && report("stroke", () => path ?? null, true)),
      drawImage: (img, ...n: number[]) => {
        const [iw, ih] = imageSize(img);
        const [x, y, w, h] = n.length >= 8 ? n.slice(4, 8) : n.length >= 4 ? n : [n[0], n[1], iw, ih];
        report("drawImage", () => rectPts(x, y, w, h), false, "image");
      },
      // Pixels go to the canvas as they are, transform and alpha aside.
      putImageData: (data, x, y) =>
        armed() &&
        hooks.paint!(boxOf(relativeTo(base, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), [x, y, x + (data?.width ?? 0), y, x, y + (data?.height ?? 0), x + (data?.width ?? 0), y + (data?.height ?? 0)]), {
          kind: "putImageData",
          style: "pixels",
          alpha: 1,
        }),
      strokeText: (str, x, y, maxWidth) => report("strokeText", () => textBox(str, x, y, maxWidth), true),
    };
    for (const name of PAINT_FNS) {
      saved[name] = (ctx as any)[name];
      own(name as any, function (this: any, ...a: any[]) {
        B[name](...a);
        return (saved[name] as (...a: any[]) => any).apply(ctx, a);
      });
    }
  }

  // Run fn with text painting switched off (layout and returned metrics still computed).
  const silently = <T,>(fn: () => T): T => {
    own("fillText", () => {});
    try {
      return fn();
    } finally {
      own("fillText", function (this: any, ...a: any[]) {
        return rawText(a[0], a[1], a[2], a[3]);
      });
    }
  };

  function rawText(str: string, x: number, y: number, maxWidth?: number) {
    let mine: TextDraw | null = null;
    if (inKit === 0) {
      const m = matrixAt(x, y);
      const movable = maxWidth === undefined && plain(ctx.fillStyle, m);
      const d: TextDraw = {
        kind: "raw",
        str: String(str),
        k: null,
        o: {
          font: ctx.font,
          color: ctx.fillStyle,
          align: ctx.textAlign,
          baseline: ctx.textBaseline,
          letterSpacing: (ctx as any).letterSpacing ?? "0px",
        },
        m,
        alpha: ctx.globalAlpha,
        site: siteOf(),
      };
      const verdict = onDraw(d, movable);
      if (movable && verdict === "skip") return;
      if (movable) mine = d;
    }
    const r = maxWidth === undefined ? proto.fillText.call(ctx, str, x, y) : proto.fillText.call(ctx, str, x, y, maxWidth);
    if (mine) hooks.drawn?.(mine, textBox(str, x, y));
    else report("fillText", () => textBox(str, x, y, maxWidth));
    return r;
  }
  own("fillText", function (this: any, ...a: any[]) {
    return rawText(a[0], a[1], a[2], a[3]);
  });

  // Same kit, with text calls observed and every other helper marked as kit-internal.
  const lib: any = { ...kit };
  for (const [name, fn] of Object.entries(kit)) {
    if (typeof fn !== "function" || CALLBACK_FNS.has(name)) continue;
    if (TEXT_FNS.has(name)) {
      lib[name] = (c: CanvasRenderingContext2D, str: string, x: number, y: number, a4?: any, a5?: any) => {
        const o = (name === "text" ? a4 : a5) ?? {};
        const k = name === "text" ? null : Number(a4);
        const color = o.color ?? kit.C.ink;
        let verdict: "skip" | "draw" = "draw";
        let mine: { d: TextDraw; size: number } | null = null;
        if (c === ctx && inKit === 0) {
          const m = matrixAt(x, y);
          const movable = plain(color, m) && alphaOk(o.alpha ?? 1, ctx.globalAlpha);
          const opts: Record<string, unknown> = {};
          for (const [key, v] of Object.entries(o)) {
            if (key === "alpha") continue;
            if (typeof v === "function") {
              const ease = Object.entries(kit.ease).find(([, f]) => f === v)?.[0];
              if (key === "ease" && ease) opts.ease = ease;
            } else if (v !== undefined) opts[key] = v;
          }
          const d: TextDraw = { kind: name as TextDraw["kind"], str: String(str), k, o: opts, m, alpha: appliedAlpha(o.alpha, ctx.globalAlpha), site: siteOf() };
          verdict = onDraw(d, movable);
          if (!movable) verdict = "draw";
          else mine = { d, size: Number(o.size ?? 48 * ((kit as any).u ?? 1)) };
        }
        inKit++;
        if (mine) own_++;
        let r: any;
        try {
          r = verdict === "skip" ? silently(() => (fn as any)(c, str, x, y, a4, a5)) : (fn as any)(c, str, x, y, a4, a5);
        } finally {
          inKit--;
          if (mine) own_--;
        }
        if (mine && hooks.drawn) hooks.drawn(mine.d, kitBox(mine.d, mine.size, r, o));
        return r;
      };
    } else {
      lib[name] = (...a: any[]) => {
        inKit++;
        try {
          return (fn as any)(...a);
        } finally {
          inKit--;
        }
      };
    }
  }

  // Where a kit text draw painted, from its result (width, height, lines) and options, as renderDoc
  // works out a text layer's bounds (a word reveal's words also rise into place from below).
  function kitBox(d: TextDraw, size: number, r: any, o: any): Box {
    const w = Number(r?.width) || 0, h = Number(r?.height) || size;
    const lh = (o.lineHeight ?? 1.2) * size;
    const align = d.kind === "words" ? o.align ?? "left" : o.align ?? "left";
    const x = align === "center" ? -w / 2 : align === "right" ? -w : 0;
    const top = o.baseline === "middle" ? -((Number(r?.lines || 1) - 1) * lh) / 2 - size / 2 : (TOP[o.baseline] ?? -0.8) * size;
    const bottom = top + h + (d.kind === "words" ? Math.abs(o.rise ?? size * 0.35) : 0);
    return grow(boxOf(d.m, [x, top, x + w, top, x, bottom, x + w, bottom]), size * 0.25);
  }

  const restore = () => {
    for (const name of Object.keys(saved)) delete (ctx as any)[name];
    if (field) Object.defineProperty(ctx, OP, { ...field, value: held });
    else if (ownOp) Object.defineProperty(ctx, OP, ownOp);
    else if (accessor?.set) delete (ctx as any)[OP];
  };
  return { lib: lib as Kit, restore };
}

// The playback rule matching extraction: skip a movable draw unless its text stays in code.
export const skipRule = (keep: string[]) => {
  const set = new Set(keep);
  return (d: TextDraw, movable: boolean): "skip" | "draw" => (movable && !set.has(d.str) ? "skip" : "draw");
};
