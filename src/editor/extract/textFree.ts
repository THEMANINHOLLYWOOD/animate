// Which of a film's controls leave its text alone.
// A split (the code's text as layers) is recorded at one setting of the film's controls, and a control
// can reword, move or recolour text, so a change to any of them stood the whole split down: the code
// drew its text again and edits to the text layers seemed to be lost. Most controls don't touch text
// (grain, glow, a background colour, how many embers). Each one is tried here at other values, and
// when every text draw through the clip comes out the same, the control is noted on the code layer
// (props.splitFree, by control key) and no longer counts against the split (see splitKey).

import { compileScene, type Assets, type SceneFn } from "@/lib/engine";
import type { Kit } from "@/lib/kit";
import { controlKey, controlsSet, controlValue, declaredControls, withControls, type ControlDef } from "@/lib/controls";
import { produce } from "immer";
import type { Op } from "../doc/ops";
import type { Doc, Layer } from "../doc/schema";
import { sceneClock, splitKey, splitLive, withKeyedControls } from "./codeHash";
import { pacer } from "./pace";
import { tapText } from "./textTap";

// How long a film may be tried for; controls not reached by then count as touching text.
const BUDGET_MS = 4000;
const r2 = (x: number) => Math.round(x * 100) / 100;

// Other values to try a control at: the ends of a slider, the other side of a switch, the other
// choices, another colour, another place. Null for words, which are text.
export function otherValues(d: ControlDef, cur: unknown): unknown[] | null {
  const v = controlValue(d, cur);
  switch (d.kind) {
    case "number":
      return [d.min, d.max, (d.min + d.max) / 2].filter((x) => x !== v).slice(0, 2);
    case "toggle":
      return [!v];
    case "select":
      return d.options.filter((o) => o !== v).slice(0, 4);
    case "color":
      return [String(v).toLowerCase() === "#19e0a8" ? "#e01978" : "#19e0a8"];
    case "point":
      return [[v[0] < 0.5 ? v[0] + 0.3 : v[0] - 0.3, v[1] < 0.5 ? v[1] + 0.3 : v[1] - 0.3]];
    case "text":
      return null;
  }
}

// Every text draw a scene makes at the sampled times, with everything that decides how each looks.
export async function textSignature(
  scene: SceneFn,
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  clock: { sceneIn: number; sceneT: number; len: number },
  kit: Kit,
  assets: Assets,
  set: Record<string, unknown>,
  pace: () => Promise<void>,
): Promise<string> {
  const n = Math.min(24, Math.max(8, Math.round(clock.len * 3)));
  const out: string[] = [];
  const T = clock.sceneT;
  for (let i = 0; i < n; i++) {
    await pace();
    const t = clock.sceneIn + ((i + 0.5) / n) * clock.len;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const tap = tapText(ctx, withControls(kit, set), (d, movable) => {
      out.push(`${i}|${movable ? 1 : 0}|${d.kind}|${d.str}|${d.k === null ? "" : r2(d.k)}|${JSON.stringify(d.o)}|${[d.m.a, d.m.b, d.m.c, d.m.d, d.m.e, d.m.f].map(r2).join(",")}|${r2(d.alpha)}`);
      return "draw";
    });
    try {
      scene(ctx, size.w, size.h, t, T, T > 0 ? Math.min(1, Math.max(0, t / T)) : 0, tap.lib, assets);
    } finally {
      tap.restore();
      ctx.restore();
    }
  }
  return out.join("\n");
}

// Whether a code layer's controls are still to be tried: its text is split and the split holds, it
// declares controls, and nothing is noted yet.
export const freeUnknown = (l: Layer) =>
  l.type === "code" && !Array.isArray(l.props.splitFree) && declaredControls(l.props).length > 0 && splitLive(withKeyedControls(l.props, l.anim));

// The keys of the controls that leave this code layer's text as it is. A scene that throws has none.
export async function textFree(layer: Layer, doc: Doc, kit: Kit, assets: Assets, signal?: AbortSignal): Promise<string[]> {
  const defs = declaredControls(layer.props);
  if (!defs.length) return [];
  const pace = pacer(signal);
  const started = performance.now();
  const c = document.createElement("canvas");
  c.width = c.height = 200;
  const ctx = c.getContext("2d")!;
  const { sceneIn, sceneT } = sceneClock(layer.props, layer.start, layer.end);
  const clock = { sceneIn, sceneT, len: Math.max(0.05, layer.end - layer.start) };
  const set = controlsSet(layer.props);
  const free: string[] = [];
  try {
    const scene = compileScene(String(layer.props.code ?? ""));
    const sig = (s: Record<string, unknown>) => textSignature(scene, ctx, doc.meta.size, clock, kit, assets, s, pace);
    const base = await sig(set);
    // A film that draws no text has nothing a control could touch.
    for (const d of defs) {
      if (performance.now() - started > BUDGET_MS) break;
      const key = controlKey(d.name);
      const tries = otherValues(d, set[key]);
      if (!tries?.length) continue;
      let same = true;
      for (const v of tries) {
        if ((await sig({ ...set, [key]: v })) !== base) {
          same = false;
          break;
        }
      }
      if (same) free.push(key);
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    return [];
  }
  return free;
}

// Note what was found on the code layer, if it is still the layer that was tried (same code, same
// split). The split's fingerprint is taken again without the free controls, at the settings it was
// tried under: a free control changed meanwhile then leaves it holding, any other stands it down.
export const freeOp =
  (layerId: string, tried: Record<string, unknown>, free: string[]): Op =>
  (doc) => {
    const l = doc.layers.find((x) => x.id === layerId);
    if (!l || l.type !== "code" || l.props.code !== tried.code || l.props.splitHash !== tried.splitHash || Array.isArray(l.props.splitFree)) return;
    l.props = { ...l.props, splitFree: free, splitHash: splitKey({ ...tried, splitFree: free }) };
  };

// The op that notes one code layer's text-free controls.
export async function freeOpFor(layer: Layer, doc: Doc, kit: Kit, assets: Assets, signal?: AbortSignal): Promise<Op> {
  const tried = withKeyedControls(layer.props, layer.anim);
  return freeOp(layer.id, tried, await textFree(layer, doc, kit, assets, signal));
}

// A doc with every split code layer's text-free controls noted (on open, before anything is edited).
export async function withFree(doc: Doc, kit: Kit, assets: Assets, signal?: AbortSignal): Promise<Doc> {
  let out = doc;
  for (const l of doc.layers.filter(freeUnknown)) out = produce(out, await freeOpFor(l, out, kit, assets, signal));
  return out;
}
