/* eslint-disable @typescript-eslint/no-explicit-any */
// Intercepts the text a code scene draws. Used twice with the same rule:
// - splitting: record every movable text draw so it can become a native text layer;
// - playback: skip exactly those draws in the code layer, since the text layers now paint them.
// A draw is movable when nothing but its transform, alpha and font decides how it
// looks: a plain colour, no clip, filter, shadow or blend mode, and not inside a
// kit helper that draws text as part of something else (globe labels).

import type { Kit } from "@/lib/kit";

export type TextDraw = {
  kind: "text" | "words" | "typewriter" | "raw";
  str: string;
  k: number | null; // reveal progress for words / typewriter
  o: Record<string, unknown>; // kit text options (serialisable ones), or raw canvas text state
  m: { a: number; b: number; c: number; d: number; e: number; f: number }; // canvas transform at the text origin
  alpha: number;
  site: string; // where in the scene code the draw came from (grouping only)
};

const TEXT_FNS = new Set(["text", "words", "typewriter"]);
// Kit helpers that call back into scene code; they draw no text of their own.
const CALLBACK_FNS = new Set(["camera", "mask"]);

// Where a call came from in the scene: every frame of the stack inside the compiled scene.
function siteOf() {
  const stack = new Error().stack ?? "";
  const m = stack.match(/(?:<anonymous>|> Function|anonymous):\d+:\d+/g);
  return m ? m.join(">") : "?";
}

// onDraw sees every text draw; `movable` says whether it could be a layer. Only movable draws may be skipped.
export function tapText(ctx: CanvasRenderingContext2D, kit: Kit, onDraw: (d: TextDraw, movable: boolean) => "skip" | "draw") {
  const proto = Object.getPrototypeOf(ctx);
  let inKit = 0;
  let clip = false;
  const clips: boolean[] = [];
  const saved = { fillText: ctx.fillText, save: ctx.save, restore: ctx.restore, clip: ctx.clip };
  const own = (name: keyof typeof saved, fn: (...a: any[]) => any) => Object.defineProperty(ctx, name, { value: fn, configurable: true, writable: true });

  own("save", function (this: any) {
    clips.push(clip);
    return proto.save.call(ctx);
  });
  own("restore", function (this: any) {
    clip = clips.pop() ?? false;
    return proto.restore.call(ctx);
  });
  own("clip", function (this: any, ...a: any[]) {
    clip = true;
    return proto.clip.apply(ctx, a);
  });

  const plain = (color: unknown) =>
    !clip &&
    typeof color === "string" &&
    (!ctx.filter || ctx.filter === "none") &&
    ctx.globalCompositeOperation === "source-over" &&
    !ctx.shadowBlur;

  const matrixAt = (x: number, y: number) => {
    const t = ctx.getTransform();
    return { a: t.a, b: t.b, c: t.c, d: t.d, e: t.a * x + t.c * y + t.e, f: t.b * x + t.d * y + t.f };
  };

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
    if (inKit === 0) {
      const movable = maxWidth === undefined && plain(ctx.fillStyle);
      const verdict = onDraw({
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
        m: matrixAt(x, y),
        alpha: ctx.globalAlpha,
        site: siteOf(),
      }, movable);
      if (movable && verdict === "skip") return;
    }
    return maxWidth === undefined ? proto.fillText.call(ctx, str, x, y) : proto.fillText.call(ctx, str, x, y, maxWidth);
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
        if (c === ctx && inKit === 0) {
          const movable = plain(color);
          const opts: Record<string, unknown> = {};
          for (const [key, v] of Object.entries(o)) {
            if (key === "alpha") continue;
            if (typeof v === "function") {
              const ease = Object.entries(kit.ease).find(([, f]) => f === v)?.[0];
              if (key === "ease" && ease) opts.ease = ease;
            } else if (v !== undefined) opts[key] = v;
          }
          verdict = onDraw({ kind: name as TextDraw["kind"], str: String(str), k, o: opts, m: matrixAt(x, y), alpha: ctx.globalAlpha * (o.alpha ?? 1), site: siteOf() }, movable);
          if (!movable) verdict = "draw";
        }
        inKit++;
        try {
          return verdict === "skip" ? silently(() => (fn as any)(c, str, x, y, a4, a5)) : (fn as any)(c, str, x, y, a4, a5);
        } finally {
          inKit--;
        }
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

  const restore = () => {
    for (const name of Object.keys(saved)) delete (ctx as any)[name];
  };
  return { lib: lib as Kit, restore };
}
