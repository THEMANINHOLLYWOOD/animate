// Looping preview clips for the library: each film rendered once, small, to MP4,
// then played by the browser's video decoder (smooth, and nearly free to loop).
// Examples ship pre-rendered in /public/previews; other films render here, one at a
// time in the background, cached in Cache Storage under a hash of what they draw.

import { compileScene, exportVideo, type Aspect, type Assets, type SceneFn } from "./engine";
import { makeKit, type Fonts } from "./kit";
import { docScene } from "@/editor/render/renderDoc";
import type { Doc } from "@/editor/doc/schema";

export const PREVIEW_SIZE: Record<Aspect, [number, number]> = { "16:9": [480, 270], "9:16": [270, 480], "1:1": [360, 360] };
export const PREVIEW_FPS = 30;
const CACHE = "animate-previews-v1";
const EMPTY: Assets = { images: [], byName: {} };

type Film = { code: string; doc?: Doc; aspect: Aspect; duration: number };

export function previewKey(f: Film) {
  const s = `${f.aspect}|${f.duration}|${f.doc ? JSON.stringify(f.doc) : f.code}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + s.length.toString(36);
}

// The scene at preview size. Code scenes scale themselves (lib.u); docs are laid out in
// full-size pixels, so they're drawn at full size under a scale.
export function previewScene(f: Film, fonts: Fonts): SceneFn {
  if (!f.doc) return compileScene(f.code);
  const doc = f.doc;
  const { w, h } = doc.meta.size;
  const kit = makeKit(w, h, fonts);
  const full = docScene(doc);
  return (ctx, W, H, t, T, p, _lib, assets) => {
    ctx.scale(W / w, H / h);
    full(ctx, w, h, t, T, p, kit, assets);
  };
}

export async function renderPreview(f: Film, fonts: Fonts, signal?: AbortSignal): Promise<Blob | null> {
  if (typeof VideoEncoder === "undefined") return null; // no hardware encoding: the tile keeps its still
  const [W, H] = PREVIEW_SIZE[f.aspect];
  const { blob } = await exportVideo({ scene: previewScene(f, fonts), fonts, assets: EMPTY, W, H, T: f.duration, fps: PREVIEW_FPS, signal, bitsPerPixel: 0.11 });
  return blob;
}

// One preview renders at a time; everything else waits its turn.
let chain: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<string | null>>();

export function previewUrl(f: Film, fonts: Fonts): Promise<string | null> {
  const key = previewKey(f);
  const hit = pending.get(key);
  if (hit) return hit;
  const job = (async () => {
    const req = `/__preview/${key}.mp4`;
    const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
    const cached = await cache?.match(req);
    if (cached) return URL.createObjectURL(await cached.blob());
    const run = chain.then(() => renderPreview(f, fonts).catch(() => null));
    chain = run;
    const blob = await run;
    if (!blob) return null;
    await cache?.put(req, new Response(blob, { headers: { "Content-Type": "video/mp4" } })).catch(() => {});
    return URL.createObjectURL(blob);
  })();
  pending.set(key, job);
  return job;
}

// A single still for the tile while its clip renders (or when it can't).
export function drawStill(canvas: HTMLCanvasElement, f: Film, fonts: Fonts) {
  const [W, H] = PREVIEW_SIZE[f.aspect];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  try {
    const t = f.duration * 0.6;
    previewScene(f, fonts)(ctx, W, H, t, f.duration, 0.6, makeKit(W, H, fonts), EMPTY);
  } catch {}
}
