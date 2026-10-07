/* eslint-disable @typescript-eslint/no-explicit-any */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { makeKit, type Fonts } from "./kit";
import { cueAt, drawCaption, type Cue } from "./captions";

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
  // Determinism: the same t must paint the same frame (frames export out of order).
  const ctx = c.getContext("2d")!;
  const snap = () => {
    const d = ctx.getImageData(0, 0, W, H).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0;
    return h;
  };
  const tMid = T * 0.47;
  r.draw(scene, tMid, T, assets);
  const a = snap();
  r.draw(scene, T * 0.9, T, assets);
  r.draw(scene, tMid, T, assets);
  if (snap() !== a) return `The frame at t=${tMid.toFixed(2)}s differs between two renders: the scene must be a pure function of t (no Math.random, Date, or state kept between frames).`;
  return null;
}

// Contact sheets for the critique loop: frames in order with time labels, as JPEG base64.
export function contactSheet(scene: SceneFn, fonts: Fonts, W: number, H: number, assets: Assets, T: number, times: number[], tileW: number, cols: number) {
  const src = document.createElement("canvas");
  src.width = W;
  src.height = H;
  const r = new Renderer(src.getContext("2d")!, W, H, fonts);
  const tileH = Math.round((tileW * H) / W);
  const rows = Math.ceil(times.length / cols);
  const sheet = document.createElement("canvas");
  sheet.width = tileW * cols;
  sheet.height = tileH * rows;
  const g = sheet.getContext("2d")!;
  g.fillStyle = "#888";
  g.fillRect(0, 0, sheet.width, sheet.height);
  times.forEach((t, i) => {
    r.draw(scene, t, T, assets);
    const x = (i % cols) * tileW, y = Math.floor(i / cols) * tileH;
    g.drawImage(src, x + 1, y + 1, tileW - 2, tileH - 2);
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(x + 4, y + 4, 54, 18);
    g.fillStyle = "#fff";
    g.font = "12px monospace";
    g.fillText(`${t.toFixed(1)}s`, x + 8, y + 17);
  });
  return sheet.toDataURL("image/jpeg", 0.8).split(",")[1];
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
  audio?: AudioBuffer | null; // rendered mix; muxed as AAC when the browser can encode it
  captions?: Cue[]; // burned in when given
}): Promise<{ blob: Blob; ext: string; audioIncluded: boolean }> {
  const { scene, fonts, assets, W, H, T, fps, onProgress, signal, audio, captions } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const r = new Renderer(ctx, W, H, fonts);
  const frames = Math.round(T * fps);

  const codec = await pickCodec(W, H, fps);
  if (!codec) return exportRealtime({ ...opts, canvas, renderer: r });

  const aac = audio && typeof AudioEncoder !== "undefined" ? await pickAudioCodec(audio) : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: fps },
    ...(aac ? { audio: { codec: "aac", numberOfChannels: aac.numberOfChannels, sampleRate: aac.sampleRate } } : {}),
    fastStart: "in-memory",
  });
  let failure: any = null;

  // Audio first: encode the whole mix in one pass (it's small next to the video).
  if (aac && audio) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
    aenc.configure(aac);
    const chans = aac.numberOfChannels;
    const frameLen = 1024 * 20;
    const planar = new Float32Array(frameLen * chans);
    for (let off = 0; off < audio.length; off += frameLen) {
      const n = Math.min(frameLen, audio.length - off);
      for (let c = 0; c < chans; c++) planar.set(audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)).subarray(off, off + n), c * n);
      const data = new AudioData({ format: "f32-planar", sampleRate: aac.sampleRate, numberOfFrames: n, numberOfChannels: chans, timestamp: Math.round((off / aac.sampleRate) * 1e6), data: planar.subarray(0, n * chans) });
      aenc.encode(data);
      data.close();
    }
    await aenc.flush();
    aenc.close();
    if (failure) throw failure;
  }
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  enc.configure(codec);

  for (let i = 0; i < frames; i++) {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    if (failure) throw failure;
    r.draw(scene, i / fps, T, assets);
    if (captions?.length) {
      const cue = cueAt(captions, i / fps);
      if (cue) drawCaption(ctx, W, H, cue.text, fonts.sans);
    }
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
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4", audioIncluded: !!aac };
}

async function pickAudioCodec(audio: AudioBuffer): Promise<AudioEncoderConfig | null> {
  const config: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: audio.sampleRate, numberOfChannels: Math.min(2, audio.numberOfChannels), bitrate: 160_000 };
  try {
    return (await AudioEncoder.isConfigSupported(config)).supported ? config : null;
  } catch {
    return null;
  }
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
}): Promise<{ blob: Blob; ext: string; audioIncluded: boolean }> {
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
  return { blob: new Blob(chunks, { type: mime }), ext: mime.startsWith("video/mp4") ? "mp4" : "webm", audioIncluded: false };
}
