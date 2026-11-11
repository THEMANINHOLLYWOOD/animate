// Looping preview clips for the library: each film rendered once, small, to MP4,
// then played by the browser's video decoder (smooth, and nearly free to loop).
// Examples ship pre-rendered in /public/previews; other films render here, one at a
// time in the background, cached in Cache Storage under a hash of what they draw (and
// forgotten once no film has shown them for a while).
// Scene code runs on the main thread, so the library never trusts it with the page: frames
// draw in short slices, every frame is timed against a budget, and a film that froze the
// page is remembered for the tab's session so a reload doesn't run it again.

import { compileScene, exportVideo, pickCodec, Renderer, type Aspect, type Assets, type SceneFn } from "./engine";
import { makeKit, type Fonts } from "./kit";
import { SHOWCASE } from "./presets/showcase";
import { docScene } from "@/editor/render/renderDoc";
import type { Doc } from "@/editor/doc/schema";

export const PREVIEW_SIZE: Record<Aspect, [number, number]> = { "16:9": [480, 270], "9:16": [270, 480], "1:1": [360, 360] };
export const PREVIEW_FPS = 30;
const BPP = 0.11;
// Bump when the drawing changes (kit, renderDoc, how previews are drawn): clips cached by
// other versions are dropped. Shipped example clips (public/previews) are re-rendered by hand.
const RENDERER = 2;
const FORMAT = `${RENDERER}|${PREVIEW_FPS}|${BPP}|${JSON.stringify(PREVIEW_SIZE)}`;
const CACHE_PREFIX = "animate-previews-";
const CACHE = `${CACHE_PREFIX}v${RENDERER}`;
const EMPTY: Assets = { images: [], byName: {} };

// What a film may cost the main thread: a frame slower than FRAME_MS counts as a freeze, and
// more than BUDGET_MS of drawing per second of film (slower than it plays) loses the clip.
const FRAME_MS = 1000;
const BUDGET_MS = 1000;
const SLICE_MS = 6; // drawing between yields to the page

type Film = { code: string; doc?: Doc; aspect: Aspect; duration: number };

export function previewKey(f: Film) {
  const s = `${FORMAT}|${f.aspect}|${f.duration}|${f.doc ? JSON.stringify(f.doc) : f.code}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + s.length.toString(36);
}

// An example's shipped clip, as long as the example is still the film that clip shows
// (its Length and Format can be changed like any film's).
export function shippedClip(f: Film & { id: string; builtin?: boolean }): string | null {
  const o = f.builtin && !f.doc ? SHOWCASE.find((x) => x.id === f.id) : undefined;
  return o && o.aspect === f.aspect && o.duration === f.duration && o.code === f.code ? `/previews/${f.id}.mp4` : null;
}

// The scene at preview size. Code scenes scale themselves (lib.u). Docs are laid out in
// full-size pixels, and shadows, filters, setTransform and pixel reads in their code layers
// ignore a ctx.scale: so a doc draws 1:1 on a full-size canvas, as in the player, and that
// frame is scaled down.
export function previewScene(f: Film, fonts: Fonts): SceneFn {
  if (!f.doc) return compileScene(f.code);
  const { w, h } = f.doc.meta.size;
  const full = document.createElement("canvas");
  full.width = w;
  full.height = h;
  const r = new Renderer(full.getContext("2d")!, w, h, fonts);
  const scene = docScene(f.doc);
  return (ctx, W, H, t, T, _p, _lib, assets) => {
    r.draw(scene, t, T, assets);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, W, H);
  };
}

// ── freeze guard ──
// "frozen": a frame never returned (or took over FRAME_MS), so the library doesn't run the
// scene at all; "noclip": it overran its budget or threw, so the tile keeps its still.
export type Verdict = "frozen" | "noclip";
const BUSY = "animate-preview-busy";
const VERDICTS = "animate-preview-verdicts";
let known: Record<string, Verdict> | null = null;

function verdicts(): Record<string, Verdict> {
  if (known) return known;
  known = {};
  try {
    const saved = JSON.parse(sessionStorage.getItem(VERDICTS) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) known = saved;
    // Still marked busy: the page froze inside that film's scene last time.
    const hung = sessionStorage.getItem(BUSY);
    if (hung) {
      sessionStorage.removeItem(BUSY);
      record(hung, "frozen");
    }
  } catch {}
  return known!;
}

function record(key: string, v: Verdict) {
  const all = verdicts();
  if (all[key] === "frozen") return;
  all[key] = v;
  try {
    sessionStorage.setItem(VERDICTS, JSON.stringify(all));
  } catch {}
}

// Why a film gets no clip this session (or, when frozen, no still either).
export function verdictFor(f: Film): Verdict | undefined {
  return verdicts()[previewKey(f)];
}

// While a film's scene runs, its key sits in sessionStorage. It's cleared in a microtask,
// i.e. as soon as the synchronous run ends and before anything else can run, so it only
// survives a reload if the page froze inside that scene.
let marked: string | null = null;
function busy(key: string) {
  if (marked === key) return;
  verdicts(); // read a mark the last page left before this one replaces it
  if (marked === null)
    queueMicrotask(() => {
      marked = null;
      try {
        sessionStorage.removeItem(BUSY);
      } catch {}
    });
  marked = key;
  try {
    sessionStorage.setItem(BUSY, key);
  } catch {}
}

class Unfit extends Error {}

// The scene (made on first use) with every frame marked and timed. Throws Unfit, with the
// verdict recorded, when it throws, a frame takes over FRAME_MS, or all its frames together
// take over `budget` ms.
export function guarded(make: () => SceneFn, key: string, budget = Infinity): SceneFn {
  let scene: SceneFn | null = null;
  let spent = 0;
  return (...args) => {
    busy(key);
    const t0 = performance.now();
    try {
      (scene ??= make())(...args);
    } catch (e) {
      record(key, "noclip");
      throw new Unfit(e instanceof Error ? e.message : String(e));
    }
    const dt = performance.now() - t0;
    if (dt > FRAME_MS) {
      record(key, "frozen");
      throw new Unfit(`One frame took ${Math.round(dt)}ms`);
    }
    if ((spent += dt) > budget) {
      record(key, "noclip");
      throw new Unfit(`Drawing took over ${Math.round(budget)}ms`);
    }
  };
}

// ── clips ──
// Whether this browser can encode H.264 at a preview size (asked once per size).
const encodable = new Map<string, Promise<boolean>>();
function canEncode(W: number, H: number) {
  const k = `${W}x${H}`;
  let p = encodable.get(k);
  if (!p) encodable.set(k, (p = pickCodec(W, H, PREVIEW_FPS, BPP).then(Boolean, () => false)));
  return p;
}

async function render(f: Film, fonts: Fonts, key: string, signal?: AbortSignal): Promise<Blob | null> {
  const [W, H] = PREVIEW_SIZE[f.aspect];
  // No H.264 encoder: the tile keeps its still. (Recording in real time instead would take each
  // film's full length, stall in background tabs, and produce WebM at a full export's bitrate.)
  if (!(await canEncode(W, H))) return null;
  const scene = guarded(() => previewScene(f, fonts), key, BUDGET_MS * f.duration);
  const { blob } = await exportVideo({ scene, fonts, assets: EMPTY, W, H, T: f.duration, fps: PREVIEW_FPS, signal, bitsPerPixel: BPP, sliceMs: SLICE_MS, realtimeFallback: false });
  return blob;
}

export function renderPreview(f: Film, fonts: Fonts, signal?: AbortSignal): Promise<Blob | null> {
  return render(f, fonts, previewKey(f), signal);
}

const PATH = "/__preview/";
const request = (key: string) => `${PATH}${key}.mp4`;
const keyOf = (r: Request) => {
  const p = new URL(r.url).pathname;
  return p.startsWith(PATH) && p.endsWith(".mp4") ? p.slice(PATH.length, -".mp4".length) : null;
};

// Each cached clip carries when it was last shown (refreshed at most daily). Clips nobody has
// shown for KEEP_MS, and any past the MAX_CLIPS most recently shown, are deleted: that's what
// becomes of a deleted film's clip, or of a version edited away while its tile wasn't showing
// (on another device, say), since nothing asks for those again. This runs once a page, TIDY_MS
// after the library first asks for a clip; clips the page is showing or rendering are kept.
const USED = "X-Preview-Used";
const DAY_MS = 86_400_000;
const KEEP_MS = 30 * DAY_MS;
const MAX_CLIPS = 200;
const TIDY_MS = 10_000;

let opened: Promise<Cache | null> | undefined;
function openCache(): Promise<Cache | null> {
  return (opened ??= (async () => {
    if (typeof caches === "undefined") return null;
    // Clips drawn by another renderer version no longer match their films.
    void caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n))))
      .catch(() => {});
    const cache = await caches.open(CACHE).catch(() => null);
    if (cache) setTimeout(() => void evictPreviews().catch(() => {}), TIDY_MS);
    return cache;
  })());
}

function store(cache: Cache, key: string, blob: Blob) {
  return cache.put(request(key), new Response(blob, { headers: { "Content-Type": "video/mp4", [USED]: String(Date.now()) } })).catch(() => {});
}

// One preview renders at a time; everything else waits its turn.
let chain: Promise<unknown> = Promise.resolve();

async function load(key: string, f: Film, fonts: Fonts, signal: AbortSignal): Promise<string | null> {
  const cache = await openCache();
  const hit = await cache?.match(request(key)).catch(() => undefined);
  if (cache && hit) {
    const blob = await hit.blob();
    if (!(Date.now() - Number(hit.headers.get(USED)) < DAY_MS)) await store(cache, key, blob); // shown again: still wanted
    return URL.createObjectURL(blob);
  }
  const run = chain.then(() => (signal.aborted ? null : render(f, fonts, key, signal))); // withdrawn while waiting: skipped
  chain = run.catch(() => null);
  const blob = await run;
  if (!blob || signal.aborted) return null;
  if (cache) await store(cache, key, blob);
  return URL.createObjectURL(blob);
}

export type Preview = { key: string; url: string; release: (drop?: boolean) => void };
type Entry = { users: number; ctl: AbortController; job: Promise<string | null> };
const entries = new Map<string, Entry>();

// A film's clip, from Cache Storage or rendered in its turn. Whoever shows it holds it until
// release(): once nobody does, its URL is revoked (and with drop, the cached copy is deleted
// too, for a version of the film that's gone). Aborting `signal` before it resolves withdraws
// the request, and a render nobody is waiting for any more is cancelled. Failures aren't kept,
// so a later request tries again (unless the film was found unfit).
export function previewUrl(f: Film, fonts: Fonts, signal?: AbortSignal): Promise<Preview | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const key = previewKey(f);
  if (verdicts()[key]) return Promise.resolve(null);
  let entry = entries.get(key);
  if (!entry) {
    const ctl = new AbortController();
    const job = load(key, f, fonts, ctl.signal).catch(() => null);
    const e: Entry = (entry = { users: 0, ctl, job });
    entries.set(key, e);
    void job.then((url) => {
      if (!url && entries.get(key) === e) entries.delete(key);
    });
  }
  const e = entry;
  e.users++;
  let held = true;
  const release = (drop = false) => {
    if (!held) return;
    held = false;
    signal?.removeEventListener("abort", withdraw);
    if (--e.users > 0) return;
    if (entries.get(key) === e) entries.delete(key);
    e.ctl.abort();
    void e.job.then((url) => url && URL.revokeObjectURL(url));
    if (drop)
      void openCache()
        .then((c) => c?.delete(request(key)))
        .catch(() => {});
  };
  const withdraw = () => release();
  signal?.addEventListener("abort", withdraw, { once: true });
  return e.job.then((url) => {
    signal?.removeEventListener("abort", withdraw);
    if (!url || !held || signal?.aborted) {
      release();
      return null;
    }
    return { key, url, release };
  });
}

// Deletes clips nobody has shown for a while (see USED). `now` is for tests.
export async function evictPreviews(now = Date.now()) {
  const cache = await openCache();
  if (!cache) return;
  const clips: { req: Request; key: string | null; used: number }[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    clips.push({ req, key: keyOf(req), used: Number(res?.headers.get(USED)) || 0 });
  }
  clips.sort((a, b) => b.used - a.used);
  for (const [i, c] of clips.entries())
    if ((i >= MAX_CLIPS || now - c.used > KEEP_MS) && !(c.key && entries.has(c.key))) await cache.delete(c.req);
}

// Forgets cached clips of films that are gone (deleted, or edited into new versions) right away.
// Pass every film the library holds, once it has really loaded; clips this page is showing or
// rendering are kept either way.
export async function prunePreviews(films: Film[]) {
  const cache = await openCache();
  if (!cache) return;
  const keep = new Set(films.map(previewKey));
  for (const r of await cache.keys()) {
    const key = keyOf(r);
    if (!key || (!keep.has(key) && !entries.has(key))) await cache.delete(r);
  }
}

// ── stills ──
// A single still for the tile while its clip renders (or when it can't). Stills draw one per
// task, so a library full of films never holds the page in one go; a newer still for the same
// canvas replaces a waiting one. Returns a cancel for a still that hasn't drawn yet.
const stills = new Map<HTMLCanvasElement, () => void>();
let pumping = false;

export function drawStill(canvas: HTMLCanvasElement, f: Film, fonts: Fonts): () => void {
  const job = () => paintStill(canvas, f, fonts);
  stills.set(canvas, job);
  if (!pumping) {
    pumping = true;
    setTimeout(pump, 0);
  }
  return () => {
    if (stills.get(canvas) === job) stills.delete(canvas);
  };
}

function pump() {
  const next = stills.entries().next();
  if (next.done) {
    pumping = false;
    return;
  }
  const [canvas, job] = next.value;
  stills.delete(canvas);
  job();
  setTimeout(pump, 0);
}

function paintStill(canvas: HTMLCanvasElement, f: Film, fonts: Fonts) {
  const [W, H] = PREVIEW_SIZE[f.aspect];
  canvas.width = W;
  canvas.height = H;
  const key = previewKey(f);
  if (verdicts()[key] === "frozen") return;
  const ctx = canvas.getContext("2d")!;
  try {
    guarded(() => previewScene(f, fonts), key)(ctx, W, H, f.duration * 0.6, f.duration, 0.6, makeKit(W, H, fonts), EMPTY);
  } catch {}
}
