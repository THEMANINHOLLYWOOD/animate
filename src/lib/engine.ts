/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { makeKit, type Fonts } from "./kit";

export type Aspect = "16:9" | "9:16" | "1:1";
export const SIZES: Record<Aspect, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
};

export type Assets = { images: { name: string; img: HTMLImageElement }[]; byName: Record<string, HTMLImageElement> };
export type SceneFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t: number,
  T: number,
  p: number,
  lib: any,
  assets: Assets,
) => void;

export function compileScene(code: string): SceneFn {
  // Scenes are authored locally (by the user or by Claude for the user) and run in-page.
  return new Function("ctx", "W", "H", "t", "T", "p", "lib", "assets", '"use strict";\n' + code) as SceneFn;
}

let fontsPromise: Promise<Fonts> | null = null;
export function loadFonts(): Promise<Fonts> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const css = getComputedStyle(document.documentElement);
    const f = (v: string, fb: string) => css.getPropertyValue(v).trim() || fb;
    const fonts = {
      serif: f("--font-serif", "Georgia, serif"),
      sans: f("--font-sans", "system-ui, sans-serif"),
      mono: f("--font-mono", "ui-monospace, monospace"),
    };
    const loads = [
      `400 40px ${fonts.serif}`,
      `500 40px ${fonts.serif}`,
      `italic 400 40px ${fonts.serif}`,
      `400 40px ${fonts.sans}`,
      `500 40px ${fonts.sans}`,
      `600 40px ${fonts.sans}`,
      `400 40px ${fonts.mono}`,
    ];
    await Promise.all(loads.map((l) => document.fonts.load(l).catch(() => null)));
    await document.fonts.ready;
    return fonts;
  })();
  return fontsPromise;
}

export class Renderer {
  private kit: ReturnType<typeof makeKit>;
  constructor(
    public ctx: CanvasRenderingContext2D,
    public W: number,
    public H: number,
    fonts: Fonts,
  ) {
    this.kit = makeKit(W, H, fonts);
  }

  draw(scene: SceneFn, t: number, T: number, assets: Assets) {
    const { ctx, W, H } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.clearRect(0, 0, W, H);
    try {
      scene(ctx, W, H, t, T, Math.min(1, Math.max(0, t / T)), this.kit, assets);
    } finally {
      ctx.restore();
    }
  }
}

// Runs the scene at a spread of timestamps; returns the first error, if any.
export function probeScene(scene: SceneFn, fonts: Fonts, W: number, H: number, assets: Assets, T: number) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const r = new Renderer(c.getContext("2d")!, W, H, fonts);
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * T;
    try {
      r.draw(scene, t, T, assets);
    } catch (e: any) {
      return `At t=${t.toFixed(2)}s (p=${(t / T).toFixed(3)}): ${e?.message ?? String(e)}`;
    }
  }
  return null;
}

export async function exportVideo(opts: {
  scene: SceneFn;
  fonts: Fonts;
  assets: Assets;
  W: number;
  H: number;
  T: number;
  fps: number;
  onProgress?: (f: number) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; ext: string }> {
  const { scene, fonts, assets, W, H, T, fps, onProgress, signal } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const r = new Renderer(ctx, W, H, fonts);
  const frames = Math.round(T * fps);

  const codec = await pickCodec(W, H, fps);
  if (!codec) return exportRealtime({ ...opts, canvas, renderer: r });

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: fps },
    fastStart: "in-memory",
  });
  let failure: any = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  enc.configure(codec);

  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    if (failure) throw failure;
    r.draw(scene, i / fps, T, assets);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (enc.encodeQueueSize > 8) await new Promise((res) => setTimeout(res, 1));
    if (i % 6 === 0) {
      onProgress?.(i / frames);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  await enc.flush();
  if (failure) throw failure;
  muxer.finalize();
  onProgress?.(1);
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4" };
}

async function pickCodec(W: number, H: number, fps: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc1.640034", "avc1.640033", "avc1.4d0034", "avc1.42003e"]) {
    const config: VideoEncoderConfig = {
      codec,
      width: W,
      height: H,
      bitrate: Math.round(W * H * fps * 0.18),
      framerate: fps,
      avc: { format: "avc" },
    };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      if (s.supported) return config;
    } catch {}
  }
  return null;
}

// Fallback for browsers without WebCodecs: record the canvas in real time.
async function exportRealtime(opts: {
  scene: SceneFn;
  assets: Assets;
  T: number;
  fps: number;
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  onProgress?: (f: number) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; ext: string }> {
  const { scene, assets, T, fps, canvas, renderer, onProgress, signal } = opts;
  const stream = canvas.captureStream(fps);
  const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m))!;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  renderer.draw(scene, 0, T, assets);
  rec.start();
  const t0 = performance.now();
  await new Promise<void>((res, rej) => {
    const tick = () => {
      if (signal?.aborted) return rej(new DOMException("Export cancelled", "AbortError"));
      const t = (performance.now() - t0) / 1000;
      renderer.draw(scene, Math.min(t, T), T, assets);
      onProgress?.(Math.min(1, t / T));
      if (t >= T) res();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  return { blob: new Blob(chunks, { type: mime }), ext: mime.startsWith("video/mp4") ? "mp4" : "webm" };
}
