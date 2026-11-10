"use client";

import { AccountButton, SignIn, useAccount } from "@/components/Account";
import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Fonts } from "@/lib/kit";
import {
  type Aspect,
  type Assets,
  type SceneFn,
  compileScene,
  exportVideo,
  loadFonts,
  probeScene,
  Renderer,
  SIZES,
} from "@/lib/engine";
import { SHOWCASE } from "@/lib/presets/showcase";
import { STYLES } from "@/lib/styles";
import Progress, { type Step } from "@/components/Progress";
import AudioStrip from "@/components/AudioStrip";
import Thumb from "@/components/Thumb";
import { useFilmAudio } from "@/components/useFilmAudio";
import { type AudioClip, decodeAudio, fittedWav, renderMix, speechWav, subtractAligned, toWav, trimAudio } from "@/lib/audio";
import { produce } from "immer";
import { Doc, type Doc as DocT } from "@/editor/doc/schema";
import { retime } from "@/editor/doc/ops";
import { docScene } from "@/editor/render/renderDoc";
import { elementsSummary, elementsToDoc, type ElementsPlan } from "@/lib/elements";
import { cuesFromClips, toSrt } from "@/lib/captions";
import { contactSheet } from "@/lib/engine";
import { bedBeats, renderBed, specFromPlan } from "@/lib/synth";
import { detectBeats, snapToGrid } from "@/lib/beats";
import type { BrandKit } from "@/lib/brand";
import { isXStatus, xStatusId, type XVideoRef } from "@/lib/xvideo";
import { aspectFor, fitFrames, probeVideo, sampleFrames, type VideoRef } from "@/lib/videoref";
import {
  adoptFilm,
  adoptStoredFilms,
  announceFilm,
  beat,
  CLOUD_HEARTBEAT_MS,
  codeLayerOf,
  dropEditorDoc,
  dropEditorSaves,
  dropFilm,
  dropGuestMedia,
  endBeat,
  FILMS_KEY,
  HEARTBEAT_MS,
  isQuotaError,
  keepGuestMedia,
  keepsOwnCopy,
  lastBeat,
  loadGuestMedia,
  mergeFilms,
  onFilmSaved,
  patchStoredFilm,
  pruneGuestMedia,
  readFilmsIfValid,
  sameDoc,
  saveFilm,
  sceneCodeOf,
  settleBuilds,
  STALE_MS,
  withSceneCode,
} from "@/lib/library";
import { prunePreviews } from "@/lib/preview";

type Render = { pathname: string; fps: number; w: number; h: number; duration: number; size: number; createdAt: number; shareId?: string };

type Project = {
  id: string;
  title: string;
  code: string;
  duration: number;
  aspect: Aspect;
  prompt?: string;
  treatment?: string;
  // The conversation with this film: every brief / edit and what changed.
  thread?: Msg[];
  assets?: { name: string; pathname: string }[];
  videos?: Render[];
  audio?: AudioClip[];
  // Films stripped into elements are documents: layers + keyframes, with code only for leftovers.
  doc?: DocT;
  // Set while a run is building this film (the run id); the tile shows progress.
  building?: string;
  // The building run's heartbeat (ms): another tab, or the next load, treats a stale one as a dead build.
  buildingAt?: number;
  // Why a new film never got made (its build failed or was interrupted).
  failed?: string;
  builtin?: boolean;
  favorite?: boolean;
  // The animation style it was made in (src/lib/styles.ts); edits keep it.
  style?: string;
  share?: { id: string; createdAt: number };
  createdAt: number;
  // When it was last saved to the cloud (set by the server).
  updatedAt?: number;
};

// One generation in flight (or finished): its own steps, stream and stop button.
type Run = {
  id: string;
  projectId: string;
  kind: "new" | "edit" | "enhance" | "score";
  title: string;
  steps: Step[];
  stream: string;
  status: "running" | "done" | "error";
  error?: string;
  abort: AbortController;
  startedAt: number;
  endedAt?: number;
};
type RunApi = { id: string; signal: AbortSignal; phase: (label: string) => void; note: (n: string) => void; think: (d: string) => void; stream: (s: string) => void; finish: (ok: boolean, error?: string) => void };
// Sound pulled from a reference video (recreate mode); each run keeps its own until the film exists.
type Stems = { clips: AudioClip[]; blobs: Record<string, Blob>; transcript?: string; separated?: boolean };

// ElevenLabs allows a handful of concurrent requests; share that budget across runs.
const elSlots = { active: 0, queue: [] as (() => void)[] };
const elFetch = async (input: RequestInfo, init?: RequestInit) => {
  if (elSlots.active >= 3) await new Promise<void>((res) => elSlots.queue.push(res));
  elSlots.active++;
  try {
    return await fetch(input, init);
  } finally {
    elSlots.active--;
    elSlots.queue.shift()?.();
  }
};

// What a film looks like while it's being built.
const buildingScene = (brief: string): SceneFn => (ctx, W, H, t, _T, _p, lib) => {
  const { C, u } = lib;
  lib.bg(ctx, W, H, C.ivory);
  const r = 46 * u;
  lib.ring(ctx, W / 2, H / 2 - 40 * u, r, 0.28, { color: C.clay, width: 3 * u, start: (t * 140) % 360 });
  lib.ring(ctx, W / 2, H / 2 - 40 * u, r, 1, { color: C.cloud, width: 1.5 * u });
  lib.text(ctx, "Building", W / 2, H / 2 + 60 * u, { size: 30 * u, family: "mono", color: C.stone, align: "center", tracking: 0.12 });
  lib.text(ctx, brief, W / 2, H / 2 + 120 * u, { size: 34 * u, family: "sans", color: C.slate, align: "center", maxWidth: W * 0.6, lineHeight: 1.4 });
};

// What a film that never got made shows instead.
const failedScene = (reason: string): SceneFn => (ctx, W, H, _t, _T, _p, lib) => {
  const { C, u } = lib;
  lib.bg(ctx, W, H, C.ivory);
  lib.text(ctx, "Didn't finish", W / 2, H / 2 - 30 * u, { size: 30 * u, family: "mono", color: C.clay, align: "center", tracking: 0.12 });
  lib.text(ctx, reason, W / 2, H / 2 + 30 * u, { size: 32 * u, family: "sans", color: C.slate, align: "center", maxWidth: W * 0.7, lineHeight: 1.4 });
  lib.text(ctx, "Delete it and try again.", W / 2, H / 2 + 170 * u, { size: 26 * u, family: "sans", color: C.stone, align: "center" });
};

type Msg = { id: string; role: "user" | "assistant"; text: string; at: number; codeBefore?: string; docBefore?: DocT };

// A thread with new messages at the end (again, if they're already there), keeping only the
// last few version snapshots: five code versions and three element docs can be restored.
const withMessages = (thread: Msg[] = [], msgs: Msg[]) => {
  const next = [...thread.filter((m) => !msgs.some((x) => x.id === m.id)), ...msgs];
  const keepCode = next.filter((m) => m.codeBefore).slice(-5);
  const keepDoc = next.filter((m) => m.docBefore).slice(-3);
  return next.map((m) =>
    (m.codeBefore && !keepCode.includes(m)) || (m.docBefore && !keepDoc.includes(m))
      ? { ...m, codeBefore: keepCode.includes(m) ? m.codeBefore : undefined, docBefore: keepDoc.includes(m) ? m.docBefore : undefined }
      : m,
  );
};

type Attached = {
  id: string;
  name: string;
  kind: "image" | "pdf" | "text";
  file: File;
  url?: string;
  img?: HTMLImageElement;
  asset: boolean;
};

// Example films everyone starts with: ten deliberately opposite styles.
const EXAMPLES: Project[] = SHOWCASE.map((f, i) => ({ ...f, builtin: true, createdAt: i }));
const FIRST = EXAMPLES[0];
const isExample = (id: string) => EXAMPLES.some((p) => p.id === id);

const LOCAL = FILMS_KEY;
// Browser storage, or the fallback where it's blocked (some private modes).
const local = <T,>(f: (s: Storage) => T, fallback: T): T => {
  try {
    return f(localStorage);
  } catch {
    return fallback;
  }
};
const guestBeat = (id: string) => local((s) => lastBeat(s, id), undefined);
// A film another page is building, brought up to date from its saved copy: the same build still marked
// there keeps the newer heartbeat; one that ended there (or made way for another) is what was saved.
const fromCloud = (p: Project, saved: Project | undefined): Project => {
  if (!saved) return p;
  if (saved.building !== p.building) return saved;
  const at = Math.max(p.buildingAt ?? 0, saved.buildingAt ?? 0);
  return at === (p.buildingAt ?? 0) ? p : { ...p, buildingAt: at };
};
// Bytes of attachments per request (reference frames, images, PDFs, text); the rest of the 4.5 MB
// request limit is brief, treatment and transcript. With a video, the frames keep at least FRAME_FLOOR.
const ATTACH_BUDGET = 3_300_000;
const FRAME_FLOOR = 900_000;
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
// What an attachment adds to a request body: base64 data or UTF-8 text.
const sizeOf = (f: unknown) => {
  const x = f as { data?: string; text?: string };
  return (x.data?.length ?? 0) + (x.text ? new TextEncoder().encode(x.text).length : 0);
};
const uid = () => Math.random().toString(36).slice(2, 12);
const friendlyError = (m: string) =>
  /credit balance/i.test(m) ? "The Anthropic account is out of credits. Add credits at console.anthropic.com → Plans & Billing, then try again." : m;
const nowMs = () => Date.now();
// A stopped run: fetches reject with an AbortError, but a Blob upload stopped mid-PUT throws its own
// (plainly named) error, so the run's signal decides.
const isStop = (e: unknown, signal: AbortSignal) => signal.aborted || (e as Error | null)?.name === "AbortError";
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};
const media = (pathname: string, dl = false) => `/api/media?p=${encodeURIComponent(pathname)}${dl ? "&dl=1" : ""}`;
const safeName = (s: string) => s.replace(/[^\w.\-]+/g, "_").slice(0, 80);

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+|\b(?:[a-z0-9-]+\.)+(?:com|io|ai|app|co|org|net|dev|so|xyz|tech|studio|design)\b(?:\/[^\s<>()"']*)?/gi;
const linksIn = (s: string) =>
  [...new Set((s.match(URL_RE) ?? []).map((u) => (u.startsWith("http") ? u : `https://${u}`).replace(/[.,;:!?]+$/, "")))].slice(0, 3);
// The prompt minus links to posts whose video is already attached as a reference.
function withoutVideoLinks(prompt: string, videos: { url?: string }[]) {
  const attached = new Set(videos.map((v) => (v.url && isXStatus(v.url) ? xStatusId(v.url) : null)).filter(Boolean));
  if (!attached.size) return prompt.trim();
  return prompt
    .replace(URL_RE, (u) => (isXStatus(u) && attached.has(xStatusId(u)) ? "" : u))
    .replace(/\s+/g, " ")
    .trim();
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|html|css|js|jsx|ts|tsx|py|yaml|yml|xml|srt|vtt)$/i;

const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name);

function kindOf(f: File): Attached["kind"] | null {
  if (f.type.startsWith("image/")) return "image";
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  if (f.type.startsWith("text/") || TEXT_EXT.test(f.name)) return "text";
  return null;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

const b64 = async (blob: Blob) => {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};

// Downscale to the model's preferred input size; keep PNG for transparency. An image over maxBytes
// of base64 is re-encoded smaller (PNG first, then JPEG on white) until it fits, or as small as it goes.
function imagePayload(img: HTMLImageElement, type: string, maxBytes = Infinity) {
  const png = type === "image/png" || type === "image/svg+xml" || type === "image/webp" || type === "image/gif";
  const tries: [number, "image/png" | "image/jpeg", number][] = png
    ? [[1568, "image/png", 1], [1024, "image/png", 1], [768, "image/png", 1], [1024, "image/jpeg", 0.85], [768, "image/jpeg", 0.8], [512, "image/jpeg", 0.8], [384, "image/jpeg", 0.75]]
    : [[1568, "image/jpeg", 0.9], [1024, "image/jpeg", 0.85], [768, "image/jpeg", 0.8], [512, "image/jpeg", 0.8], [384, "image/jpeg", 0.75]];
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  let out = { mediaType: "", data: "" };
  for (const [max, mediaType, q] of tries) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    g.fillStyle = "#fff";
    if (mediaType === "image/jpeg") g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    out = { mediaType, data: c.toDataURL(mediaType, q).split(",")[1] };
    if (out.data.length <= maxBytes) break;
  }
  return out;
}

function parseScene(text: string) {
  const title = text.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  const note = text.match(/<note>([\s\S]*?)<\/note>/)?.[1]?.trim();
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const code = blocks.sort((a, b) => b.length - a.length)[0];
  return { title, note, code };
}

// A readable reason for a failed API response: the server's own JSON error when it sent one, else
// what the status means (a platform error page for a body over the limit, or a timeout), else the status.
async function failure(res: Response, tooLarge = "The reference was too large to send. Try a shorter video.") {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    if (j?.error) return String(j.error);
  } catch {}
  if (res.status === 413) return tooLarge;
  if (res.status === 504) return "The server timed out. Try again, or use a shorter video.";
  return `Request failed (${res.status})${text && text.length < 160 ? `: ${text}` : ""}`;
}

// JSON from an API response, or a thrown readable error.
async function jsonOf<T = Record<string, unknown>>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await failure(res));
  return res.json();
}

async function streamStage(
  payload: object,
  signal: AbortSignal,
  onText: (s: string) => void,
  onStatus?: (s: string) => void,
  onThinking?: (delta: string) => void,
) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  // A refusal (a limit reached, a request too large, a bad request) is the server's answer, shown as it
  // is and never retried; anything else (a 5xx, a platform timeout) may be a passing failure.
  if (res.status >= 400 && res.status < 500) throw new StageError(await failure(res));
  if (!res.ok || !res.body) throw new Error(await failure(res));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "delta") {
          text += ev.text;
          onText(text);
        } else if (ev.type === "reset") {
          text = "";
          onText(text);
        } else if (ev.type === "status") onStatus?.(ev.text);
        else if (ev.type === "thinking") onThinking?.(ev.text);
        else if (ev.type === "partial") throw new PartialOutput(ev.text);
        else if (ev.type === "timeout") throw new StillThinking(ev.effort);
        else if (ev.type === "retry") throw new Upstream();
        else if (ev.type === "done") finished = true;
        else if (ev.type === "error") throw new StageError(ev.message);
      }
    }
  } catch (e) {
    if (e instanceof PartialOutput || e instanceof StillThinking || e instanceof StageError || signal.aborted) throw e;
    // The connection dropped. A complete answer is kept; anything less is continued from where it stopped.
    const complete = /```[\s\S]*```\s*$/.test(text.trim()) || (text.length > 400 && !/```/.test(text));
    if (!finished && !complete) throw text.trim() ? new PartialOutput(text) : new Error(`The connection dropped (${(e as Error).message}).`);
  }
  if (!finished && !text.trim()) throw new Error("The connection closed before anything came back.");
  return text;
}

// A run the function time limit cut short; the text so far is resumable.
class PartialOutput extends Error {
  constructor(public text: string) {
    super("partial");
  }
}
// A run still thinking when the time limit came; retried at lower effort.
class StillThinking extends Error {
  constructor(public effort?: string) {
    super("still thinking");
  }
}
// The server's own message (a refusal, credits, a bad request): shown as is.
class StageError extends Error {}
const CHANGED_ELSEWHERE = "This film was changed in the editor while the edit ran, so the edit wasn't applied. Ask again to edit the latest version.";
// A passing failure upstream before any text: retried after a pause.
class Upstream extends Error {
  constructor() {
    super("Claude's servers were busy");
  }
}

// What the progress panel says when a stage carries on past one request.
const resumeNote = (n: number, why: "continue" | "lighter" | "retry" | "busy") =>
  why === "continue"
    ? `Cut short (time limit or a server hiccup); continuing from where it stopped (part ${n + 1})`
    : why === "lighter"
      ? "Still thinking at the time limit; trying again with a lighter pass"
      : why === "busy"
        ? "Claude's servers were busy; trying again"
        : "The connection dropped; trying again";

// Effort steps down a rung per run that was still thinking at the limit; the last rung ("none")
// is low effort told to start writing at once, tried twice.
const LOWER: Record<string, "medium" | "low" | "none"> = { high: "medium", medium: "low", low: "none", none: "none" };

// Every generation stage runs through here, so no single request's time limit ever ends a film:
// text cut off by the limit is continued from where it stopped (up to 8 parts, enough for long
// films), a run still thinking at the limit is retried at lower effort, and a dropped
// connection is retried once.
async function runStage(
  payload: Record<string, unknown>,
  signal: AbortSignal,
  onText: (s: string) => void,
  onThinking?: (d: string) => void,
  onResume?: (n: number, why: "continue" | "lighter" | "retry" | "busy") => void,
  onStatus?: (s: string) => void,
) {
  let sofar = "";
  let effortCap: string | undefined;
  let parts = 0, lighter = 0, retries = 0, hurried = 0, busy = 0;
  for (;;) {
    try {
      const rest = await streamStage({ ...payload, continuation: sofar || undefined, effortCap }, signal, (s) => onText(sofar + s), onStatus, onThinking);
      return sofar + rest;
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") throw e;
      if (e instanceof PartialOutput && parts < 8) {
        sofar += e.text;
        onResume?.(++parts, "continue");
        continue;
      }
      if (e instanceof Upstream && busy < 3) {
        await new Promise((res) => setTimeout(res, [3000, 8000, 20000][busy++]));
        onResume?.(busy, "busy");
        continue;
      }
      if (e instanceof StillThinking && (effortCap !== "none" || hurried < 2)) {
        if (effortCap === "none") hurried++;
        effortCap = LOWER[effortCap ?? e.effort ?? "high"];
        onResume?.(++lighter, "lighter");
        continue;
      }
      if (!(e instanceof StageError) && !(e instanceof PartialOutput) && !(e instanceof StillThinking) && !(e instanceof Upstream) && retries < 1) {
        onResume?.(++retries, "retry");
        continue;
      }
      if (e instanceof Upstream) throw new Error("Claude's servers are busy right now. Try again in a minute.");
      if (e instanceof PartialOutput || e instanceof StillThinking) throw new Error("This film is too long to finish within the time limit, even in parts. Try a shorter length or a simpler brief.");
      throw e;
    }
  }
}

export default function Studio() {
  const { isLoaded, isSignedIn, userId } = useAccount();
  const [projects, setProjects] = useState<Project[]>(EXAMPLES);
  const [currentId, setCurrentId] = useState(FIRST.id);
  const [prompt, setPrompt] = useState("");
  const [enhanced, setEnhanced] = useState<null | { brief: string; recreate?: boolean }>(null);
  const [modeState, setMode] = useState<"new" | "edit">("new");
  // A format picked for the next new film while the selected film's own can't change (its doc is laid out for it).
  const [newFormat, setNewFormat] = useState<{ film: string; aspect: Aspect } | null>(null);
  const [newLength, setNewLength] = useState<{ film: string; duration: number } | null>(null);
  const [files, setFiles] = useState<Attached[]>([]);
  const [brands, setBrands] = useState<BrandKit[]>([]);
  const [reading, setReading] = useState<string[]>([]);
  const [videos, setVideos] = useState<(VideoRef & { status: string })[]>([]);
  const triedLinks = useRef(new Set<string>());
  const [projectImgs, setProjectImgs] = useState<Record<string, HTMLImageElement>>({});
  const [fps, setFps] = useState(30);
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [error, setError] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [audioBlobs, setAudioBlobs] = useState<Record<string, Blob>>({});
  const [audioBusy, setAudioBusy] = useState<string | null>(null);
  const [burnCaptions, setBurnCaptions] = useState(true);
  // Explainer brief: who it's for, what they believe, what they should be able to do after.
  const [explainer, setExplainer] = useState<null | { audience: string; believe: string; outcome: string }>(null);
  // The animation style for the next new film ("" = the default house style).
  const [style, setStyle] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | { label: string; k: number }>(null);
  const [drag, setDrag] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [draftCode, setDraftCode] = useState("");
  // The scene code the draft started from, to tell whether it was changed elsewhere (the editor) since.
  const [draftBase, setDraftBase] = useState("");
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const plusMenu = useRef<HTMLDetailsElement>(null);
  const tRef = useRef(0);
  const playingRef = useRef(true);
  // A cloud save waiting out its debounce: its timer, and the save itself (run early before leaving for the editor).
  const saveTimers = useRef<Record<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<unknown> }>>({});
  // Each film's cloud saves go out one at a time, so an older copy can never land after a newer one (or a delete).
  const saveChain = useRef<Record<string, Promise<unknown>>>({});
  // Cloud saves of a film waiting or on their way, and when this page last changed it: while either is
  // recent, this page's copy is newer than any list read from the cloud.
  const unsaved = useRef<Record<string, number>>({});
  const touched = useRef<Record<string, number>>({});
  // Films whose latest cloud save failed: this page's copy stays newer than the cloud's until a save lands,
  // or until another page saves the film (then the cloud's copy is newer: its save time passed `synced`).
  const saveFailed = useRef(new Set<string>());
  // The cloud's save time (updatedAt) of the copy of each film this page's copy was last in step with:
  // the one loaded or adopted, or the one this page's last save that landed made.
  const synced = useRef<Record<string, number>>({});
  // Guests' blobs being written to this browser's storage (waited for before leaving for the editor).
  const mediaWrites = useRef(new Set<Promise<unknown>>());
  // The library really loaded (not an unreachable cloud read as empty): only then may cached previews be pruned.
  const libraryLoaded = useRef(false);
  // A film asked for by the address (/?film=<id>, e.g. coming back from the editor), selected once the library loads.
  const wantFilm = useRef<string | null>(null);
  // Films deleted in this page: a run that finishes later must not bring them back.
  const deleted = useRef(new Set<string>());
  const runsRef = useRef(runs);
  const projectsRef = useRef(projects);
  // Guests have no cloud storage: images drawn in their films live here, and are kept in this browser
  // (keepGuestMedia) so they come back after leaving the page.
  const [guestImgs, setGuestImgs] = useState<Record<string, Record<string, HTMLImageElement>>>({});
  // Guest films whose kept images have been read back this session.
  const guestImgsRead = useRef(new Set<string>());
  // Guest films this page couldn't write to the browser's list (it was full): they stay on screen anyway.
  const notStored = useRef(new Set<string>());

  const project = projects.find((p) => p.id === currentId) ?? FIRST;
  // A doc is laid out in its own pixels: it plays, and exports, at that size.
  const [W, H] = project.doc ? [project.doc.meta.size.w, project.doc.meta.size.h] : SIZES[project.aspect];
  const cloud = !!isSignedIn;
  // An example can't be edited in place: while one is open, the composer always makes a new film.
  const mode = project.builtin ? "new" : modeState;
  // The brief without the links that became reference videos: pasting just a post's link is a
  // request to recreate its video, not a brief that happens to contain a URL.
  const briefText = withoutVideoLinks(prompt, videos);
  // No brief + a reference video = recreate that video as closely as possible.
  const recreate = mode === "new" && !briefText && videos.length > 0;
  // The format a new film gets: the selected film's, or the one picked for it while that film's is fixed.
  const fixedFormat = !!project.doc;
  // Composing a new film with one of your own open, the format and length picked are the new film's
  // alone: the open film (which may still be building) keeps its own. An example just previews them.
  const ownNew = mode === "new" && !project.builtin;
  const newAspect = mode === "new" && (fixedFormat || ownNew) && newFormat?.film === project.id ? newFormat.aspect : project.aspect;
  const newDuration = ownNew && newLength?.film === project.id ? newLength.duration : project.duration;

  // ── load fonts + library ──
  useEffect(() => {
    loadFonts().then(setFonts);
  }, []);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);
  // Builds this page is running: their marks are live whatever their heartbeat says.
  const liveRun = (runId: string) => runsRef.current[runId]?.status === "running";

  // The film the address asks for (/?film=<id>), taken once; the address is then tidied back to "/".
  useEffect(() => {
    const url = new URL(location.href);
    const want = url.searchParams.get("film");
    if (!want) return;
    wantFilm.current = want;
    url.searchParams.delete("film");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    (async () => {
      let list: Project[] = [];
      let ok = !isSignedIn;
      if (isSignedIn) {
        try {
          const r = await fetch("/api/projects");
          if (r.ok) {
            list = (await r.json()).projects;
            ok = true;
            for (const p of list) synced.current[p.id] = p.updatedAt ?? 0;
          }
        } catch {}
      } else {
        // Storage that can't be read (blocked, or a corrupt list) says nothing about what's stored, so
        // nothing that belongs to films is pruned on its word.
        const read = local<Project[] | null>((s) => readFilmsIfValid<Project>(s, LOCAL), null);
        list = read ?? [];
        ok = read !== null;
      }
      if (cancelled) return;
      // A film still marked as building with a stale heartbeat was cut off by a reload or a closed tab.
      // A fresher mark may be one too (a reload mid-build): the sweeps below settle it once it goes stale.
      list = settleBuilds(list, nowMs(), liveRun, isSignedIn ? undefined : guestBeat).filter((p) => !deleted.current.has(p.id));
      setProjects([...EXAMPLES, ...list]);
      const want = wantFilm.current;
      const has = (id: string) => isExample(id) || list.some((p) => p.id === id);
      if (want && has(want)) {
        wantFilm.current = null;
        setCurrentId(want);
        setMode(isExample(want) ? "new" : "edit");
        tRef.current = 0;
      } else setCurrentId((id) => (has(id) ? id : FIRST.id));
      libraryLoaded.current = ok;
      // Forget what belonged to films that are gone: their cached preview clips, and (guests) their kept sound and images.
      if (ok) void prunePreviews([...EXAMPLES, ...list]).catch(() => {});
      if (ok && !isSignedIn) void pruneGuestMedia(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  // ── persistence: cloud when signed in, this browser otherwise ──
  // Saves run inside state updaters, so the warning is posted afterwards.
  const outOfSpace = useCallback(
    (title?: string) =>
      queueMicrotask(() => setError(`This browser is out of space, so ${title ? `“${title}”` : "a film"} wasn't saved. Sign in to keep your films in the cloud, or delete some here.`)),
    [],
  );
  // Guests: merge just this film into the browser's list. Never write this page's copy of the
  // whole list: it can miss other tabs' films, or hold cloud films after signing in.
  const saveLocal = useCallback(
    (p: Project) => {
      try {
        saveFilm(localStorage, LOCAL, p);
        notStored.current.delete(p.id);
      } catch (e) {
        if (isQuotaError(e)) {
          notStored.current.add(p.id);
          outOfSpace(p.title);
        }
      }
    },
    [outOfSpace],
  );

  const inOrder = useCallback((id: string, send: () => Promise<unknown>) => {
    const next = (saveChain.current[id] ?? Promise.resolve()).then(send).catch(() => {});
    saveChain.current[id] = next;
    return next;
  }, []);

  // `toCloud` is the library the film belongs to: a run saves where it started, even if the guest signs in meanwhile.
  // Every save tells other pages (another Studio tab, an open editor) the film changed.
  const persist = useCallback(
    (p: Project, immediate = false, toCloud = cloud) => {
      if (p.builtin || deleted.current.has(p.id)) return;
      touched.current[p.id] = nowMs();
      if (!toCloud) {
        saveLocal(p);
        announceFilm(p.id);
        return;
      }
      // A save already waiting is replaced (it counts as this one); otherwise one more is unsaved.
      const waiting = saveTimers.current[p.id];
      if (waiting) clearTimeout(waiting.timer);
      else unsaved.current[p.id] = (unsaved.current[p.id] ?? 0) + 1;
      const run = () => {
        delete saveTimers.current[p.id];
        return inOrder(p.id, () =>
          fetch("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) })
            .then(async (r) => {
              if (!r.ok) throw new Error(r.status === 413 ? "it's too large (over 4.5 MB)" : await failure(r));
              const saved = (await r.json().catch(() => null))?.project as Project | undefined;
              if (saved?.updatedAt !== undefined) synced.current[p.id] = saved.updatedAt;
              saveFailed.current.delete(p.id);
              announceFilm(p.id);
            })
            .catch((e) => {
              saveFailed.current.add(p.id);
              setError(e instanceof TypeError ? "Couldn't save to your library. Check your connection." : `Couldn't save “${p.title}” to your library: ${(e as Error).message}`);
            }),
        ).then(() => {
          unsaved.current[p.id] = Math.max(0, (unsaved.current[p.id] ?? 1) - 1);
        });
      };
      if (immediate) return run();
      saveTimers.current[p.id] = { timer: setTimeout(run, 700), run };
    },
    [cloud, saveLocal, inOrder],
  );

  // Before leaving for the editor: a film's waiting cloud save goes out now and every save of it lands,
  // along with (guests) any sound or images still being written to this browser.
  const flushFilm = useCallback(
    async (id: string) => {
      const waiting = saveTimers.current[id];
      if (waiting) {
        clearTimeout(waiting.timer);
        void waiting.run();
      }
      await Promise.all([saveChain.current[id], ...mediaWrites.current]);
    },
    [],
  );
  // "Open in editor": the editor reads the film from storage, so it opens on what's saved. A plain click
  // waits for this film's saves first; one that opens a new tab starts them and lets the browser go on.
  const openEditor = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const flushed = flushFilm(id);
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = e.currentTarget.href;
    void flushed.finally(() => location.assign(href));
  };

  // Guests: keep a blob of a film in this browser, so its sound and images survive leaving the page.
  const keepMedia = useCallback((filmId: string, kind: "audio" | "image", name: string, blob: Blob) => {
    const w = keepGuestMedia(filmId, kind, name, blob).then((ok) => {
      if (!ok) setNotice("This browser couldn't keep this film's sound or images, so they last only while this page is open.");
    });
    mediaWrites.current.add(w);
    void w.finally(() => mediaWrites.current.delete(w));
  }, []);

  const upsert = useCallback(
    (p: Project, immediate = false) => {
      setProjects((list) => {
        if (deleted.current.has(p.id)) return list;
        const next = list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
        persist(p, immediate);
        return next;
      });
    },
    [persist],
  );

  // What a run saves lands on the film as it is now, not on the snapshot the run started from, and only
  // while the film exists: one deleted mid-run stays deleted. A guest film missing from the list because the
  // library was swapped out (the guest signed in mid-run) is updated where it's stored, if it still is.
  // Patch functions must be idempotent (React may run updaters twice); returning null skips.
  const patchFilm = useCallback(
    (id: string, patch: Partial<Project> | ((cur: Project) => Partial<Project> | null), toCloud: boolean, immediate = true) => {
      if (deleted.current.has(id)) return;
      const delta = (cur: Project) => (typeof patch === "function" ? patch(cur) : patch);
      setProjects((list) => {
        const cur = list.find((x) => x.id === id);
        if (!cur) {
          if (!toCloud) {
            try {
              patchStoredFilm<Project>(localStorage, LOCAL, id, delta);
            } catch (e) {
              if (isQuotaError(e)) outOfSpace();
            }
          }
          return list;
        }
        const d = delta(cur);
        if (!d) return list;
        const p = { ...cur, ...d };
        persist(p, immediate, toCloud);
        return list.map((x) => (x.id === id ? p : x));
      });
    },
    [persist, outOfSpace],
  );

  const updateProject = useCallback(
    (patch: Partial<Project>) => {
      setProjects((list) => {
        const cur = list.find((x) => x.id === currentId);
        if (!cur) return list;
        const p = { ...cur, ...patch };
        persist(p);
        return list.map((x) => (x.id === p.id ? p : x));
      });
    },
    [currentId, persist],
  );

  // Guests: other tabs (another Studio, the editor) save films into the same browser list; show what they
  // wrote, heartbeats included, as soon as they write it ('storage') and whenever this tab comes back
  // into view. A build whose heartbeat then goes stale (its tab closed) stops showing as building.
  useEffect(() => {
    if (!isLoaded || cloud) return;
    const refresh = () => {
      const readAt = nowMs();
      // Storage that can't be read (blocked in some private modes) says nothing about what's stored.
      const read = local<Project[] | null>((s) => readFilmsIfValid<Project>(s, LOCAL), null);
      if (!read) return;
      const stored = settleBuilds(read, nowMs(), liveRun, guestBeat).filter((p) => !deleted.current.has(p.id));
      // Films this page couldn't store are newer here than anything stored (a build's placeholder, say,
      // that would now settle as interrupted), and so are films it changed after the read began: their
      // saves run in state updates still queued ahead of this one, so they weren't written when it read.
      const mine = (id: string) => keepsOwnCopy({ pending: notStored.current.has(id), touchedAt: touched.current[id] }, readAt);
      setProjects((list) => {
        // Unchanged parts of the rest keep their identity, so an unchanged scene isn't recompiled or its
        // tile re-rendered; this page's own builds keep their mark.
        const { films, kept, lost } = adoptStoredFilms(list, stored, mine, liveRun, (id) => guestBeat(id) !== undefined);
        queueMicrotask(() => {
          for (const p of kept) saveLocal(p);
          for (const p of lost) runsRef.current[p.building!]?.abort.abort();
        });
        return films;
      });
      const building = (id: string) => Object.values(runsRef.current).some((r) => r.status === "running" && r.projectId === id) && guestBeat(id) !== undefined;
      // (The film list's updates run before the selection's in a render, so a film created in a queued update counts as touched here.)
      setCurrentId((id) => (isExample(id) || stored.some((p) => p.id === id) || building(id) || mine(id) ? id : FIRST.id));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL || e.key === null) refresh();
    };
    const onShow = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const sweep = setInterval(() => setProjects((list) => settleBuilds(list, nowMs(), liveRun, guestBeat)), 30_000);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onShow);
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onShow);
      clearInterval(sweep);
    };
  }, [isLoaded, cloud, saveLocal]);

  // Signed in: edits made elsewhere (the editor, another tab or device) show up here. The library is read
  // again whenever this tab comes back into view, and a film another page of this browser says it saved
  // or deleted is read again at once. This page's own changes win while a save of them is waiting or on
  // its way, when they were made after the read began, or after one failed, until another page saves the
  // film (the editor, say: then its copy is shown, and this page's next saves build on it rather than
  // overwrite it); a film this page is building keeps its mark.
  useEffect(() => {
    if (!isLoaded || !cloud) return;
    let cancelled = false;
    let lastFull = 0;
    const mine = (since: number, stored = new Map<string, Project>()) => (id: string) =>
      keepsOwnCopy(
        {
          pending: !!saveTimers.current[id] || (unsaved.current[id] ?? 0) > 0,
          touchedAt: touched.current[id],
          failed: saveFailed.current.has(id),
          synced: synced.current[id],
        },
        since,
        stored.get(id),
      );
    const adopt = (stored: Project[], since: number) => {
      const fresh = stored.filter((p) => !deleted.current.has(p.id));
      const byId = new Map(fresh.map((p) => [p.id, p]));
      setProjects((list) => {
        const own = mine(since, byId);
        const next = mergeFilms(list, fresh, own, liveRun);
        // What was taken is the cloud's copy now: nothing of it is left unsaved here. Changes whose save
        // failed are dropped for the newer copy saved elsewhere, which is said.
        const dropped: string[] = [];
        for (const s of fresh) {
          if (own(s.id)) continue;
          synced.current[s.id] = s.updatedAt ?? 0;
          const cur = list.find((p) => p.id === s.id);
          if (saveFailed.current.delete(s.id) && cur && adoptFilm(cur, s) !== cur) dropped.push(`“${cur.title}”`);
        }
        const one = dropped.length === 1;
        if (dropped.length)
          queueMicrotask(() => setNotice(`${dropped.join(", ")} changed elsewhere after ${one ? "its" : "their"} last save here failed, so ${one ? "that newer version is" : "those newer versions are"} shown.`));
        return next;
      });
    };
    const pullAll = async () => {
      const since = nowMs();
      // Focus, visibility and pageshow often fire together.
      if (since - lastFull < 2000) return;
      lastFull = since;
      try {
        const r = await fetch("/api/projects", { cache: "no-store" });
        if (r.ok && !cancelled) adopt((await r.json()).projects as Project[], since);
      } catch {}
    };
    const pullOne = async (id: string) => {
      if (isExample(id) || deleted.current.has(id)) return;
      const since = nowMs();
      try {
        const r = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (cancelled) return;
        if (r.ok) adopt([(await r.json()).project as Project], since);
        else if (r.status === 404 && !mine(since)(id)) {
          // Deleted in another page: it goes here too (unless this page is building it).
          setProjects((list) => list.filter((p) => p.id !== id || p.builtin || (!!p.building && liveRun(p.building))));
          setCurrentId((cur) => (cur === id && !projectsRef.current.some((p) => p.id === id && p.building && liveRun(p.building)) ? FIRST.id : cur));
        }
      } catch {}
    };
    const onShow = () => {
      if (document.visibilityState === "visible") void pullAll();
    };
    const stop = onFilmSaved((id) => void pullOne(id));
    window.addEventListener("focus", onShow);
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("focus", onShow);
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [isLoaded, cloud]);

  // Signed in: other tabs' (and devices') saves aren't pushed here, so a film marked as building by a run
  // this page doesn't own (a reload cut it off, or another tab is building it) is re-read from the cloud once
  // its heartbeat here goes stale. Still beating there, it stays; ended there, it's what was saved; neither,
  // it was cut off and settles. Unreadable, it settles too: it must never stay "building" for good.
  useEffect(() => {
    if (!isLoaded || !cloud) return;
    let cancelled = false;
    let busy = false;
    const foreign = (p: Project) => !!p.building && !liveRun(p.building);
    const check = async () => {
      if (busy || !projectsRef.current.some((p) => foreign(p) && nowMs() - (p.buildingAt ?? -Infinity) > STALE_MS)) return;
      busy = true;
      let saved = new Map<string, Project>();
      try {
        const r = await fetch("/api/projects");
        if (r.ok) saved = new Map(((await r.json()).projects as Project[]).map((p) => [p.id, p]));
      } catch {}
      busy = false;
      if (cancelled) return;
      const now = nowMs();
      setProjects((list) => {
        const next = list.map((p) => (foreign(p) ? fromCloud(p, saved.get(p.id)) : p));
        const settled = settleBuilds(next, now, liveRun);
        return settled === next && next.every((p, i) => p === list[i]) ? list : settled;
      });
    };
    const timer = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isLoaded, cloud]);

  // ── images that belong to the current project ──
  useEffect(() => {
    const list = project.assets ?? [];
    if (!cloud || !list.length) return;
    let cancelled = false;
    Promise.all(list.map((a) => loadImage(media(a.pathname)).then((img) => [a.name, img] as const).catch(() => null))).then((pairs) => {
      if (!cancelled) setProjectImgs(Object.fromEntries(pairs.filter(Boolean) as [string, HTMLImageElement][]));
    });
    return () => {
      cancelled = true;
    };
  }, [project.assets, cloud]);

  // Guests: a film's sound and images kept in this browser come back when it's opened (after a reload,
  // or coming back from the editor). What this page already holds wins over what was kept.
  useEffect(() => {
    if (!isLoaded || cloud || project.builtin || guestImgsRead.current.has(project.id)) return;
    const id = project.id;
    guestImgsRead.current.add(id);
    void loadGuestMedia(id).then(async ({ audio, images }) => {
      if (Object.keys(audio).length) setAudioBlobs((m) => ({ ...audio, ...m }));
      const pairs = await Promise.all(
        Object.entries(images).map(async ([name, blob]) => {
          // A loaded image keeps drawing after its URL is let go (as attachments' do).
          const url = URL.createObjectURL(blob);
          try {
            return [name, await loadImage(url)] as const;
          } catch {
            return null;
          } finally {
            URL.revokeObjectURL(url);
          }
        }),
      );
      const imgs = Object.fromEntries(pairs.filter((x) => x !== null));
      if (Object.keys(imgs).length && !deleted.current.has(id)) setGuestImgs((m) => ({ ...m, [id]: { ...imgs, ...m[id] } }));
    });
  }, [isLoaded, cloud, project.id, project.builtin]);

  // ── scene ──
  const compiled = useMemo<{ fn: SceneFn | null; err: string | null }>(() => {
    try {
      // A film being built shows that until it has something of its own to show.
      if (project.building && !project.code && !project.doc) return { fn: buildingScene(project.title), err: null };
      if (!project.code && !project.doc) return { fn: failedScene(project.failed ?? "This film has no scene yet."), err: null };
      if (project.doc) return { fn: docScene(project.doc), err: null };
      return { fn: compileScene(project.code), err: null };
    } catch (e) {
      return { fn: null, err: (e as Error).message };
    }
  }, [project.code, project.doc, project.building, project.title, project.failed]);

  const assets = useMemo<Assets>(() => {
    const byName: Record<string, HTMLImageElement> = { ...guestImgs[project.id], ...(project.assets?.length ? projectImgs : {}) };
    for (const f of files) if (f.img && f.asset) byName[f.name] = f.img;
    return { images: Object.entries(byName).map(([name, img]) => ({ name, img })), byName };
  }, [files, projectImgs, project.assets, project.id, guestImgs]);

  const clips = useMemo(() => project.audio ?? [], [project.audio]);
  const { loaded: loadedAudio, mixer } = useFilmAudio(clips, audioBlobs);
  const cues = useMemo(() => cuesFromClips(clips), [clips]);
  const mixerRef = useRef(mixer);
  useEffect(() => {
    mixerRef.current = mixer;
  }, [mixer]);

  // Keep sound locked to the picture: (re)start the mix on play, stop on pause.
  useEffect(() => {
    if (playing) mixer?.play(tRef.current);
    else mixer?.stop();
  }, [playing, mixer]);

  // ── fit canvas inside the stage ──
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) * 2 || 48;
      const s = Math.max(0.01, Math.min((el.clientWidth - pad) / W, (el.clientHeight - pad) / H));
      setFit({ w: Math.floor(W * s), h: Math.floor(H * s) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // ── playback loop ──
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fonts || !compiled.fn) return;
    canvas.width = W;
    canvas.height = H;
    const r = new Renderer(canvas.getContext("2d")!, W, H, fonts);
    const T = project.duration;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let dead = false;
    const frame = (now: number) => {
      if (dead) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        const next = tRef.current + dt;
        if (next >= T) mixerRef.current?.play(0);
        tRef.current = next % T;
      }
      tRef.current = Math.min(tRef.current, T);
      try {
        r.draw(compiled.fn!, tRef.current, T, assets);
      } catch (e) {
        setError(`Runtime error: ${(e as Error).message}`);
        setPlaying(false);
        playingRef.current = false;
        return;
      }
      if (now - lastUi > 50) {
        setTime(tRef.current);
        lastUi = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [compiled, fonts, W, H, project.duration, assets]);

  const shownError = error ?? compiled.err;

  // ── files ──
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const added: Attached[] = [];
    const skipped: string[] = [];
    for (const file of Array.from(list)) {
      if (isVideoFile(file)) {
        const blobUrl = URL.createObjectURL(file);
        try {
          const info = await probeVideo(blobUrl);
          setVideos((v) => [...v, { id: uid(), source: "file", name: file.name, blobUrl, ...info, status: "Ready" }]);
        } catch (e) {
          URL.revokeObjectURL(blobUrl);
          skipped.push(`${file.name} (${(e as Error).message})`);
        }
        continue;
      }
      const kind = kindOf(file);
      if (!kind) {
        skipped.push(file.name);
        continue;
      }
      const a: Attached = { id: uid(), name: safeName(file.name), kind, file, asset: kind === "image" };
      if (kind === "image") {
        a.url = URL.createObjectURL(file);
        try {
          a.img = await loadImage(a.url);
        } catch {
          skipped.push(file.name);
          continue;
        }
      }
      added.push(a);
    }
    setFiles((f) => [...f, ...added]);
    if (skipped.length) setError(`Skipped: ${skipped.join(", ")}. Use images, videos, PDFs or text.`);
  }, []);

  const removeFile = (id: string) =>
    setFiles((list) => {
      const f = list.find((x) => x.id === id);
      if (f?.url) URL.revokeObjectURL(f.url);
      return list.filter((x) => x.id !== id);
    });

  // Attachments for a request. They share ATTACH_BUDGET (less FRAME_FLOOR when a video's frames come too):
  // images are re-encoded to share what PDFs and text leave, and anything that still can't fit is named.
  const filePayload = async (withFrames: boolean) => {
    const room = ATTACH_BUDGET - (withFrames ? FRAME_FLOOR : 0);
    const docs = new Map<string, { kind: string; name: string; data?: string; text?: string }>();
    for (const f of files) {
      if (f.kind === "pdf") docs.set(f.id, { kind: "pdf", name: f.name, data: await b64(f.file) });
      else if (f.kind === "text") docs.set(f.id, { kind: "text", name: f.name, text: (await f.file.text()).slice(0, 200_000) });
    }
    for (const d of docs.values())
      if (d.kind === "pdf" && sizeOf(d) > room)
        throw new Error(`“${d.name}” is too large to send (${mb(sizeOf(d))} encoded; about ${mb(room)} fits${withFrames ? " beside the video frames" : ""}). Use a smaller PDF, or paste the text you need.`);
    const docBytes = [...docs.values()].reduce((n, d) => n + sizeOf(d), 0);
    const images = files.length - docs.size;
    const perImage = Math.max(150_000, Math.min(900_000, Math.floor((room - docBytes) / Math.max(1, images))));
    const out = files.map((f) => docs.get(f.id) ?? { kind: "image", name: f.name, asset: f.asset, ...imagePayload(f.img!, f.file.type, perImage) });
    const total = out.reduce((n, x) => n + sizeOf(x), 0);
    if (total > room) {
      const largest = out.map((x) => ({ name: x.name, size: sizeOf(x) })).sort((a, b) => b.size - a.size).slice(0, 3);
      throw new Error(
        `The attachments are too large to send together (${mb(total)}; about ${mb(room)} fits${withFrames ? " beside the video frames" : ""}). Largest: ${largest.map((x) => `${x.name} (${mb(x.size)})`).join(", ")}. Remove some and try again.`,
      );
    }
    return out;
  };

  // ── paste a link: read the brand kit, attach the logo and preview image ──
  const importImage = useCallback(
    async (src: string, name: string, asset: boolean) => {
      const r = await fetch(`/api/brand?image=${encodeURIComponent(src)}`);
      if (!r.ok) return;
      const blob = await r.blob();
      const ext = blob.type.split("/")[1]?.replace("svg+xml", "svg").replace("jpeg", "jpg") || "png";
      const file = new File([blob], `${name}.${ext}`, { type: blob.type });
      await addFiles([file]);
      if (!asset) setFiles((l) => l.map((f) => (f.name === safeName(file.name) ? { ...f, asset: false } : f)));
    },
    [addFiles],
  );

  // ── paste an X post with a video: download it as a reference video ──
  const grabXVideo = useCallback(async (link: string) => {
    const id = xStatusId(link)!;
    const label = `x.com post ${id}`;
    setReading((r) => [...r, label]);
    try {
      const r = await fetch(`/api/reference?x=${encodeURIComponent(link)}`);
      const meta = await r.json();
      if (!r.ok) throw new Error(meta.error ?? "Couldn't read that post.");
      const ref = meta as XVideoRef;
      const vr = await fetch(`/api/reference?media=${encodeURIComponent(ref.video)}`);
      if (!vr.ok) throw new Error("Couldn't download that video.");
      const blobUrl = URL.createObjectURL(await vr.blob());
      const info = await probeVideo(blobUrl);
      setVideos((v) => [
        ...v.filter((x) => x.id !== `x-${id}`),
        {
          id: `x-${id}`,
          source: "x",
          name: `${ref.author || "X post"} (@${ref.handle})`,
          blobUrl,
          ...info,
          poster: ref.poster ? `/api/reference?media=${encodeURIComponent(ref.poster)}` : info.poster,
          url: ref.url,
          author: ref.author,
          handle: ref.handle,
          text: ref.text,
          download: `/api/reference?media=${encodeURIComponent(ref.video)}&dl=1&name=x-${id}`,
          status: "Ready",
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading((rd) => rd.filter((h) => h !== label));
    }
  }, []);

  // After a build, the brief's attachments have done their job.
  const clearAttachments = () => {
    setExplainer(null);
    setFiles((list) => {
      for (const f of list) if (f.url) URL.revokeObjectURL(f.url);
      return [];
    });
    setVideos((list) => {
      for (const v of list) URL.revokeObjectURL(v.blobUrl);
      return [];
    });
    setBrands([]);
    triedLinks.current.clear();
  };

  const removeVideo = (id: string) =>
    setVideos((list) => {
      const v = list.find((x) => x.id === id);
      if (v) URL.revokeObjectURL(v.blobUrl);
      return list.filter((x) => x.id !== id);
    });

  // Frames from reference videos, as image attachments plus a note with timestamps.
  // Recreate mode samples densely (~2 fps, up to 32 per film) so motion can be matched.
  // `room` is what the other attachments leave of the request budget.
  const videoPayload = async (recreate: boolean, room: number) => {
    const out: unknown[] = [];
    const budget = recreate ? 32 : 8;
    for (const v of videos) {
      const n = recreate ? Math.max(8, Math.min(Math.ceil(v.duration * 2), Math.floor(budget / videos.length))) : Math.max(4, Math.floor(budget / videos.length));
      setVideos((l) => l.map((x) => (x.id === v.id ? { ...x, status: "Sampling frames…" } : x)));
      // Every request that carries the frames (treatment, elements, animation) must stay under 4.5 MB.
      const frames = await fitFrames(
        await sampleFrames(v.blobUrl, n, 768, (i) => setVideos((l) => l.map((x) => (x.id === v.id ? { ...x, status: `Sampling frames ${i}/${n}` } : x)))),
        room / videos.length,
      );
      setVideos((l) => l.map((x) => (x.id === v.id ? { ...x, status: `${frames.length} frames sent` } : x)));
      const tag = v.id.replace(/[^\w-]/g, "");
      out.push({
        kind: "text",
        name: `${tag}-reference.txt`,
        text: [
          `Reference video: ${v.source === "x" ? v.url : v.name}`,
          v.author && `Posted by ${v.author} (@${v.handle})`,
          v.text && `Post text: ${v.text}`,
          `Length ${v.duration.toFixed(2)}s · ${v.w}×${v.h} (${aspectFor(v.w, v.h)}).`,
          `Frames follow in order, each named with its timestamp: ${frames.map((f) => `${f.t.toFixed(2)}s`).join(", ")}.`,
          recreate
            ? "RECREATE this video as closely as possible: same shots, timing, layout, colours, type and motion."
            : "Use this video as a style and motion reference; make an original film in its spirit, without copying its footage, logos or characters.",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      for (const f of frames) out.push({ kind: "image", name: `${tag}-${f.t.toFixed(2)}s.jpg`, asset: false, mediaType: "image/jpeg", data: f.data });
    }
    return out;
  };

  useEffect(() => {
    const keyOf = (u: string) => (isXStatus(u) ? `x:${xStatusId(u)}` : hostOf(u));
    const fresh = linksIn(prompt).filter((u) => !triedLinks.current.has(keyOf(u)));
    if (!fresh.length) return;
    const t = setTimeout(() => {
      for (const u of fresh) {
        if (isXStatus(u)) {
          if (triedLinks.current.has(keyOf(u))) continue;
          triedLinks.current.add(keyOf(u));
          grabXVideo(u);
          continue;
        }
        if (/^(x|twitter)\.com$/.test(hostOf(u))) continue;
        const host = hostOf(u);
        if (triedLinks.current.has(host)) continue;
        triedLinks.current.add(host);
        setReading((r) => [...r, host]);
        fetch(`/api/brand?url=${encodeURIComponent(u)}`)
          .then(async (r) => {
            if (!r.ok) return;
            const kit = (await r.json()) as BrandKit;
            setBrands((b) => [...b.filter((x) => x.host !== kit.host), kit]);
            const logo = kit.logo ?? kit.icon;
            await Promise.all([
              logo && importImage(logo, `${kit.host}-logo`, true),
              kit.ogImage && importImage(kit.ogImage, `${kit.host}-preview`, false),
            ]);
          })
          .catch(() => {})
          .finally(() => setReading((r) => r.filter((h) => h !== host)));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [prompt, importImage, grabXVideo]);

  // ── Runs: every generation has its own steps, stream and stop button ──
  const patchRun = (id: string, f: (r: Run) => Run) => setRuns((rs) => (rs[id] ? { ...rs, [id]: f(rs[id]) } : rs));
  const runApi = (id: string, abort: AbortController): RunApi => ({
    id,
    signal: abort.signal,
    phase: (label) => {
      const at = nowMs();
      patchRun(id, (r) => ({
        ...r,
        stream: "",
        steps: [...r.steps.map((x) => (x.status === "active" ? { ...x, status: "done" as const, endedAt: at } : x)), { id: uid(), label, status: "active", startedAt: at, thinking: "", notes: [] }],
      }));
    },
    note: (n) => patchRun(id, (r) => ({ ...r, steps: r.steps.map((x, i) => (i === r.steps.length - 1 ? { ...x, notes: [...x.notes, n] } : x)) })),
    think: (d) => patchRun(id, (r) => ({ ...r, steps: r.steps.map((x, i) => (i === r.steps.length - 1 ? { ...x, thinking: x.thinking + d } : x)) })),
    stream: (text) => patchRun(id, (r) => ({ ...r, stream: text })),
    finish: (ok, error) => {
      const at = nowMs();
      patchRun(id, (r) => ({
        ...r,
        status: ok ? "done" : "error",
        error,
        endedAt: at,
        steps: r.steps.map((x) => (x.status === "active" ? { ...x, status: ok ? ("done" as const) : ("error" as const), endedAt: at } : x)),
      }));
    },
  });
  const startRun = (projectId: string, kind: Run["kind"], title: string) => {
    const id = uid();
    const abort = new AbortController();
    setRuns((rs) => ({ ...rs, [id]: { id, projectId, kind, title, steps: [], stream: "", status: "running", abort, startedAt: nowMs() } }));
    return runApi(id, abort);
  };
  const runsFor = (projectId: string) => Object.values(runs).filter((r) => r.projectId === projectId).sort((a, b) => a.startedAt - b.startedAt);
  const currentRun = runsFor(currentId).at(-1) ?? null;
  const isBuilding = !!project.building || currentRun?.status === "running";
  const dismissRun = (id: string) => setRuns((rs) => Object.fromEntries(Object.entries(rs).filter(([k]) => k !== id)));

  // ── stage 1: direct (also the ✦ Enhance button) ──
  async function direct(
    R: RunApi,
    brief: string,
    payloadFiles: unknown[],
    editing: boolean,
    film: { duration: number; aspect: Aspect; recreate: boolean } = { duration: project.duration, aspect: project.aspect, recreate: false },
  ) {
    const researching = !film.recreate && (brands.length > 0 || linksIn(brief).length > 0);
    R.phase(film.recreate ? "Breaking the video down shot by shot" : researching ? "Researching the company" : "Writing the creative treatment");
    let writing = !researching;
    return runStage(
      {
        stage: "direct",
        prompt: brief,
        duration: film.duration,
        aspect: film.aspect,
        recreate: film.recreate,
        files: payloadFiles,
        brands,
        previousCode: editing ? sceneCodeOf(project) || undefined : undefined,
        style: editing ? project.style : style || undefined,
      },
      R.signal,
      (s) => {
        if (!writing && s.trim()) {
          writing = true;
          R.phase("Writing the creative treatment");
        }
        R.stream(s);
      },
      R.think,
      (n, why) => R.note(resumeNote(n, why)),
      R.note,
    );
  }

  // Explainer films carry the audience, their current belief and the outcome into the brief.
  const withExplainer = (brief: string) => {
    if (!explainer || mode !== "new") return brief;
    const lines = [
      `Topic: ${brief}`,
      explainer.audience && `Audience: ${explainer.audience}`,
      explainer.believe && `What they already believe: ${explainer.believe}`,
      explainer.outcome && `After watching they can: ${explainer.outcome}`,
      "This is an explainer: leave the viewer with one new understanding. Use the explainer arc.",
    ].filter(Boolean);
    return lines.join("\n");
  };

  // Recreate mode: a reference video and no brief means "copy this video".
  const filmFor = (recreating: boolean) => {
    const v = videos[0];
    return recreating && v
      ? { duration: Math.min(90, Math.max(3, Math.round(v.duration * 10) / 10)), aspect: aspectFor(v.w, v.h), recreate: true }
      : { duration: newDuration, aspect: newAspect, recreate: false };
  };
  // The request's attachments, plus (recreating) the reference video's sound for this run alone.
  const collectFiles = async (R: RunApi, recreating: boolean): Promise<{ files: unknown[]; stems: Stems | null }> => {
    // Other attachments first: the frames get whatever room they leave.
    const attached = await filePayload(videos.length > 0);
    if (videos.length) R.phase(recreating ? "Sampling the video frame by frame" : "Sampling the reference video");
    const vids = await videoPayload(recreating, ATTACH_BUDGET - attached.reduce((n, x) => n + sizeOf(x), 0));
    let stems: Stems | null = null;
    if (recreating && videos[0]) {
      R.phase("Pulling the sound apart");
      try {
        stems = await extractStems(R, videos[0].blobUrl, filmFor(true).duration);
        if (stems?.transcript) vids.push({ kind: "text", name: "reference-audio-transcript.txt", text: `Transcript of the reference video's voice, with word start times in seconds:\n${stems.transcript}` });
        if (!stems) R.note("The video has no audio track");
      } catch (e) {
        R.signal.throwIfAborted();
        R.note(`Sound: ${(e as Error).message}`);
      }
    }
    if (videos.length) R.note(`${vids.filter((x) => (x as { kind: string }).kind === "image").length} frames from ${videos.length} video${videos.length > 1 ? "s" : ""}`);
    return { files: [...attached, ...vids], stems };
  };

  async function enhance() {
    if (!prompt.trim() && !files.length && !videos.length) return;
    const R = startRun(project.id, "enhance", "Treatment");
    setError(null);
    try {
      const recreating = recreate;
      const brief = withExplainer(briefText || (recreating ? "Recreate the attached video as closely as possible." : "Make a film from the attached files."));
      const film = filmFor(recreating);
      const treatment = await direct(R, brief, (await collectFiles(R, recreating)).files, mode === "edit" && !project.builtin, film);
      setPrompt(treatment.trim());
      setEnhanced({ brief, recreate: recreating });
      R.finish(true);
    } catch (e) {
      if (isStop(e, R.signal)) R.finish(false, "Stopped.");
      else {
        setError((e as Error).message);
        R.finish(false, (e as Error).message);
      }
    }
  }

  // ── chat edits for element-based films: the editing agent changes layers and keyframes ──
  const agentEdit = async (R: RunApi, target: Project, request: string, toCloud: boolean) => {
    if (!target.doc) return;
    R.phase("Editing the elements");
    const history = [...(target.thread ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text })), { role: "user" as const, text: request }];
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: target.doc, time: tRef.current, selection: [], messages: history }),
      signal: R.signal,
    });
    // A failed request (a limit reached, the doc too large to send, a server error) is shown as such,
    // never read as an answer that changed nothing.
    if (!res.ok || !res.body)
      throw new StageError(res.status === 401 ? "Sign in to edit films." : await failure(res, "This film is too large to send to the editing agent. Make the change in the editor instead."));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let result: { doc?: DocT; changes?: number; seek?: number } | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "text") {
          text += ev.text;
          R.stream(text);
        } else if (ev.type === "thinking") R.think(ev.text);
        else if (ev.type === "progress") R.note(ev.text.trim().slice(0, 140));
        else if (ev.type === "action") R.note(ev.label);
        else if (ev.type === "done") result = ev;
        else if (ev.type === "error") {
          if (ev.doc) result = { doc: ev.doc, changes: 1 };
          else throw new StageError(ev.message);
        }
      }
    }
    if (!result) throw new Error("The connection closed before the edit finished. Try again.");
    const now = nowMs();
    const userMsg: Msg = { id: uid(), role: "user", text: request, at: now };
    const changed = !!result.doc && (result.changes ?? 0) > 0;
    const botMsg: Msg = { id: uid(), role: "assistant", text: text.trim() || (changed ? "Updated the film." : "No change was needed."), at: now + 1, docBefore: changed ? target.doc : undefined };
    const nextDoc = changed ? Doc.parse(result.doc) : target.doc!;
    // The edit was made to the doc as it was when it started: if it was saved elsewhere meanwhile (the
    // editor in another tab), that save stands and this edit is refused rather than written over it.
    const stale = (cur: Project | undefined) => changed && !!cur && !sameDoc(cur.doc, target.doc);
    if (stale(projectsRef.current.find((p) => p.id === target.id))) throw new StageError(CHANGED_ELSEWHERE);
    patchFilm(
      target.id,
      (cur) => {
        if (stale(cur)) {
          queueMicrotask(() => setError(CHANGED_ELSEWHERE));
          return { building: undefined, buildingAt: undefined };
        }
        // An edit that changed nothing leaves the doc alone (it may be newer than the one sent).
        return { ...(changed ? { doc: nextDoc, duration: nextDoc.meta.duration } : {}), thread: withMessages(cur.thread, [userMsg, botMsg]), building: undefined, buildingAt: undefined };
      },
      toCloud,
    );
    if (result?.seek !== undefined) tRef.current = Math.min(result.seek, nextDoc.meta.duration);
  };

  // ── stage 2: animate ──
  async function generate() {
    if (!prompt.trim() && !files.length && !videos.length) return;
    const editing = mode === "edit" && !project.builtin;
    const target = project; // snapshot: the user can move on while this runs
    // The library the film lives in, fixed for the run: signing in midway doesn't move a guest's film.
    const toCloud = cloud;
    const request = briefText;
    const briefShown = request || (videos.length ? "Recreating a video" : "New film");
    // A readable working title: the first few words of the brief.
    const workingTitle = briefShown.split(/\s+/).slice(0, 6).join(" ").replace(/[,:;.!?]+$/, "") + (briefShown.split(/\s+/).length > 6 ? "…" : "");
    // A new film gets its id and a placeholder tile right away, so it shows up in the library while it builds.
    const id = editing ? target.id : uid();
    const R = startRun(id, editing ? "edit" : "new", briefShown.slice(0, 60));
    if (!editing) {
      upsert({ id, title: workingTitle, code: "", duration: filmFor(enhanced?.recreate ?? recreate).duration, aspect: filmFor(enhanced?.recreate ?? recreate).aspect, building: R.id, buildingAt: nowMs(), thread: [], createdAt: nowMs() });
      setCurrentId(id);
      setMode("edit");
      tRef.current = 0;
    } else patchFilm(id, { building: R.id, buildingAt: nowMs() }, toCloud, false);
    // Other tabs (and the next page load) tell a live build from a dead one by its heartbeat: buildingAt
    // on the saved film in the cloud; for a guest, a key of its own, so beats don't rewrite the shared list.
    const pulse = () =>
      toCloud ? patchFilm(id, (cur) => (cur.building === R.id ? { buildingAt: nowMs() } : null), true, false) : local((s) => beat(s, id, nowMs()), undefined);
    if (!toCloud) pulse();
    const heartbeat = setInterval(pulse, toCloud ? CLOUD_HEARTBEAT_MS : HEARTBEAT_MS);
    // The composer is free immediately; attachments are released once they've been read.
    setPrompt("");
    setEnhanced(null);
    setExplainer(null);
    setError(null);
    let ok = false;
    let failed = false;
    try {
      const recreating = enhanced?.recreate ?? recreate;
      const film = filmFor(recreating);
      const [fw, fh] = SIZES[film.aspect];
      const { files: payloadFiles, stems } = await collectFiles(R, recreating);
      clearAttachments();
      const brief = enhanced?.brief ?? withExplainer(request || (recreating ? "Recreate the attached video as closely as possible." : "Make a film from the attached files."));
      // Small edits go straight to the animator; new films always get a treatment first.
      // Chat edits on an element-based film go through the editing agent (layers + keyframes), not the code animator.
      if (editing && target.doc) {
        await agentEdit(R, target, request, toCloud);
        ok = true;
        return;
      }
      const treatment = enhanced ? prompt.trim() : editing ? undefined : await direct(R, brief, payloadFiles, false, film);

      // Recreations are stripped into editable elements; the animator then draws only the leftovers.
      let elementsPlan: ElementsPlan | null = null;
      if (film.recreate && !editing && treatment) {
        R.phase("Stripping the video into elements");
        const er = await fetch("/api/elements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ breakdown: treatment, duration: film.duration, aspect: film.aspect, w: fw, h: fh, files: payloadFiles.filter((f) => (f as { kind: string }).kind === "image") }),
          signal: R.signal,
        });
        const ej = await jsonOf<ElementsPlan & { error?: string }>(er).catch((e) => ({ error: (e as Error).message }) as ElementsPlan & { error?: string });
        if (ej.elements) {
          elementsPlan = ej as ElementsPlan;
          R.note(`${elementsPlan.elements.length} elements: ${elementsPlan.elements.slice(0, 6).map((e) => e.name).join(", ")}${elementsPlan.elements.length > 6 ? "…" : ""}`);
        } else R.note(`Elements: ${ej.error ?? "unavailable"}; building as one scene`);
      }

      R.phase(editing ? "Revising the animation" : elementsPlan ? "Drawing what's left by code" : "Animating the scene");
      const onText = (s: string) => R.stream(s);
      const base = {
        stage: "animate",
        prompt: brief,
        treatment,
        brands,
        recreate: film.recreate,
        duration: film.duration,
        aspect: film.aspect,
        files: payloadFiles,
        previousCode: editing ? target.code : undefined,
        history: editing ? (target.thread ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text })) : undefined,
        notes: elementsPlan ? elementsSummary(elementsPlan) : undefined,
        style: editing ? target.style : style || undefined,
      };
      const resumed = (n: number, why: "continue" | "lighter" | "retry" | "busy") => R.note(resumeNote(n, why));
      let reply = parseScene(await runStage(base, R.signal, onText, R.think, resumed));
      if (!reply.code) throw new Error("Claude didn't return a scene. Try rephrasing the brief.");

      // Dry-run across the timeline; ask for one repair if it throws.
      const check = (code: string) => {
        try {
          return probeScene(compileScene(code), fonts!, fw, fh, assets, film.duration);
        } catch (e) {
          return `Syntax error: ${(e as Error).message}`;
        }
      };
      R.phase("Checking every frame");
      const problem = check(reply.code);
      const docFor = (code: string) => (elementsPlan ? elementsToDoc(elementsPlan, { id, title: reply.title || "Recreation", w: fw, h: fh, duration: film.duration, code }) : undefined);
      if (problem) {
        R.note(problem);
        R.phase("Fixing a runtime error");
        const fixed = parseScene(await runStage({ ...base, previousCode: reply.code, error: problem, files: [] }, R.signal, onText, R.think, resumed));
        if (fixed.code) reply = { ...reply, code: fixed.code };
      }

      // A first draft that runs is already a film: saved now (still marked as building), so stopping,
      // leaving the page or a failure during the review below keeps it.
      if (!editing && (!problem || !check(reply.code)))
        patchFilm(
          id,
          (cur) =>
            cur.building === R.id
              ? { title: reply.title || cur.title, doc: docFor(reply.code), code: reply.code, prompt: brief, treatment, builtin: false, style: style || undefined }
              : null,
          toCloud,
        );

      // Claude watches its own frames: score the stills, fix the worst problems, up to two rounds.
      if (!editing) {
        const sceneOf = (code: string) => (elementsPlan ? docScene(docFor(code)!) : compileScene(code));
        for (let round = 1; round <= 2; round++) {
          R.phase(round === 1 ? "Looking at its own frames" : "Looking again");
          const n = Math.min(24, Math.max(8, Math.round(film.duration)));
          const times = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * film.duration);
          const scene = sceneOf(reply.code);
          const sheet = contactSheet(scene, fonts!, fw, fh, assets, film.duration, times, 320, 4);
          const phone = contactSheet(scene, fonts!, fw, fh, assets, film.duration, times.filter((_, i) => i % 2 === 0), 200, 6);
          const cr = await fetch("/api/critique", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ images: [{ name: "Contact sheet (in order)", data: sheet }, { name: "Phone-width strip", data: phone }], treatment, duration: film.duration, aspect: film.aspect }),
            signal: R.signal,
          });
          const cj = await jsonOf(cr).catch((e) => ({ error: (e as Error).message, failed: true }));
          if ("failed" in cj) {
            R.note(`Review skipped: ${cj.error}`);
            break;
          }
          const scores = cj.scores as Record<string, number>;
          R.note(`Scores · ${Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
          const worst = (cj.problems as { t: number; issue: string; fix: string }[]).slice(0, 3);
          const low = Math.min(...Object.entries(scores).filter(([k]) => k !== "sound").map(([, v]) => v));
          if (low >= 8 || !worst.length) {
            R.note(String(cj.verdict));
            break;
          }
          worst.forEach((p) => R.note(`${p.t.toFixed(1)}s · ${p.issue}`));
          R.phase(`Fixing the ${worst.length} worst problem${worst.length > 1 ? "s" : ""}`);
          try {
            const fixed = parseScene(
              await runStage(
                { ...base, previousCode: reply.code, critique: worst.map((p) => `- at ${p.t.toFixed(1)}s: ${p.issue} → ${p.fix}`).join("\n"), files: [] },
                R.signal,
                onText,
                R.think,
                resumed,
              ),
            );
            if (fixed.code && !check(fixed.code)) reply = { ...reply, code: fixed.code };
            else R.note("The fix didn't pass the frame check; keeping the previous version");
          } catch (e) {
            if (isStop(e, R.signal)) throw e;
            // A failed fix never costs the film.
            R.note(`Fix pass failed (${(e as Error).message.slice(0, 80)}); keeping the previous version`);
            break;
          }
        }
      }

      const prev = editing ? target : null;
      const assetFiles = files.filter((f) => f.kind === "image" && f.asset);
      let assetRefs = prev?.assets ?? [];
      if (cloud && userId && assetFiles.length) {
        R.phase("Saving your images");
        const up = await Promise.all(
          assetFiles.map((f) =>
            upload(`users/${userId}/assets/${id}/${f.name}`, f.file, { access: "private", handleUploadUrl: "/api/upload", abortSignal: R.signal }).then(
              (b) => ({ name: f.name, pathname: b.pathname }),
            ),
          ),
        );
        assetRefs = [...assetRefs.filter((a) => !up.some((u) => u.name === a.name)), ...up];
      } else if (assetFiles.length) {
        const drawn = assetFiles.filter((f) => f.img);
        setGuestImgs((m) => ({ ...m, [id]: { ...m[id], ...Object.fromEntries(drawn.map((f) => [f.name, f.img!])) } }));
        // Kept in this browser too, so they're still drawn after leaving the page (the editor, a reload).
        for (const f of drawn) keepMedia(id, "image", f.name, f.file);
      }

      const title = reply.title || prev?.title || brief.slice(0, 40) || "Untitled";
      const now = nowMs();
      const userMsg: Msg = { id: uid(), role: "user", text: request || brief, at: now };
      const botMsg: Msg = {
        id: uid(),
        role: "assistant",
        text: reply.note || (editing ? "Updated the film." : `Built “${title}”.`),
        at: now + 1,
        codeBefore: prev?.code,
      };

      // The result, applied to the film as it is by now (a favorite starred meanwhile, say, stays).
      const result: Partial<Project> = {
        title,
        doc: docFor(reply.code) ?? (editing ? prev?.doc : undefined),
        code: reply.code,
        duration: film.duration,
        aspect: film.aspect,
        prompt: brief,
        treatment: treatment ?? prev?.treatment,
        assets: assetRefs,
        builtin: false,
        building: undefined,
        style: editing ? prev?.style : style || undefined,
        buildingAt: undefined,
        failed: undefined,
      };
      const withThread = (cur: Project) => ({ ...result, thread: withMessages(cur.thread, [userMsg, botMsg]) });
      // What scoring reads (it saves the sound it makes as its own patch).
      const built: Project = { ...(prev ?? { id, createdAt: nowMs() }), ...result } as Project;
      if (film.recreate && stems) {
        R.phase("Saving the original's sound elements");
        setAudioBlobs((m) => ({ ...m, ...stems.blobs }));
        const stored = await Promise.all(stems.clips.map((c) => storeClipBlob(id, c, stems.blobs[c.id], R.signal)));
        patchFilm(id, (cur) => ({ ...withThread(cur), audio: stored }), toCloud);
        ok = true;
        // Rebuild the original's sound effects on top of its stems.
        // Separated stems are rebuilt in ElevenLabs; an isolated voice + background keep the original and add effects.
        await scoreFilm(R, { ...built, audio: stored }, { recreate: true, transcript: stems.transcript, hasBackground: stored.some((c) => c.kind === "background"), rebuild: !!stems.separated });
      } else {
        patchFilm(id, withThread, toCloud);
        ok = true;
        // Every new film gets a soundtrack; edits keep the one they have.
        if (!editing) await scoreFilm(R, built);
      }
    } catch (e) {
      failed = true;
      const stopped = isStop(e, R.signal);
      const message = stopped ? "Stopped." : (e as Error).message;
      if (!stopped && currentId === id) setError(friendlyError(message));
      R.finish(false, message);
      // Clear the building mark (saved too, or the tile spins forever after a reload).
      // A failed new film keeps its tile, with the reason, until it's deleted.
      patchFilm(
        id,
        (x) => (x.building === R.id ? { building: undefined, buildingAt: undefined, ...(x.code || x.doc ? {} : { title: `${x.title} (failed)`, failed: message }) } : null),
        toCloud,
      );
    } finally {
      clearInterval(heartbeat);
      if (!toCloud) local((s) => endBeat(s, id), undefined);
      // Every way out of a run that didn't fail (the agent edit returns early) finishes it here.
      if (!failed) {
        R.finish(ok);
        setProjects((list) => list.map((x) => (x.id === id && x.building === R.id ? { ...x, building: undefined, buildingAt: undefined } : x)));
      }
    }
  }

  // ── sound: clips, uploads, stems, scoring ──
  const audioExt = (type: string) => (type.includes("wav") ? "wav" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : type.includes("ogg") ? "ogg" : type.includes("webm") ? "webm" : "m4a");

  // Persist a clip's audio: a private Blob when signed in; for a guest, this browser's storage (so the
  // soundtrack is still there after leaving the page, for the editor or a reload).
  const storeClipBlob = async (projectId: string, clip: AudioClip, blob: Blob, signal?: AbortSignal): Promise<AudioClip> => {
    setAudioBlobs((m) => ({ ...m, [clip.id]: blob }));
    if (!cloud || !userId) {
      keepMedia(projectId, "audio", clip.id, blob);
      return clip;
    }
    const res = await upload(`users/${userId}/audio/${projectId}/${clip.id}.${audioExt(blob.type)}`, blob, { access: "private", handleUploadUrl: "/api/upload", contentType: blob.type || "audio/mpeg", abortSignal: signal });
    return { ...clip, pathname: res.pathname };
  };

  const updateClip = (id: string, patch: Partial<AudioClip>) => upsert({ ...project, audio: clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeClip = (id: string) => upsert({ ...project, audio: clips.filter((c) => c.id !== id) }, true);

  const addAudioFiles = async (list: FileList | File[]) => {
    if (project.builtin) return setNotice("Make your own film first; the example can't be changed.");
    setAudioBusy("Adding audio…");
    try {
      const added: AudioClip[] = [];
      for (const file of Array.from(list)) {
        const buf = await decodeAudio(file);
        const kind: AudioClip["kind"] = /voice|vo\b|speech|narration/i.test(file.name) ? "voice" : /sfx|fx|whoosh|hit/i.test(file.name) ? "sfx" : "music";
        const clip: AudioClip = { id: uid(), kind, label: file.name.replace(/\.[^.]+$/, ""), start: 0, duration: Math.min(buf.duration, project.duration), gain: 1, muted: false, source: "upload" };
        if (kind === "music") {
          setAudioBusy(`Finding the beat in ${file.name}…`);
          try {
            clip.beats = detectBeats(buf);
            clip.label += ` · ${Math.round(clip.beats.bpm)} BPM`;
          } catch {}
        }
        if (kind === "voice") {
          // Word timings give the track captions and let the bed duck under it.
          setAudioBusy(`Transcribing ${file.name}…`);
          const f = new FormData();
          f.append("action", "transcribe");
          // Only the part the film plays, at speech quality, so the upload fits a request.
          f.append("audio", await speechWav(trimAudio(buf, project.duration)), "voice.wav");
          const r = await elFetch("/api/audio", { method: "POST", body: f });
          const j = r.ok ? await r.json().catch(() => null) : null;
          if (j?.words?.length) {
            clip.words = j.words;
            clip.text = j.text;
          } else setNotice(`Couldn't transcribe ${file.name} (${r.ok ? "no speech found" : await failure(r)}), so it has no captions.`);
        }
        added.push(await storeClipBlob(project.id, clip, file));
      }
      // Onto the film as it is now: something else may have changed it while this was transcribing.
      patchFilm(project.id, (cur) => ({ audio: [...(cur.audio ?? []).filter((c) => !added.some((a) => a.id === c.id)), ...added] }), cloud);
    } catch (e) {
      setError(`Couldn't read that audio: ${(e as Error).message}`);
    } finally {
      setAudioBusy(null);
    }
  };

  // SAM Audio (via /api/separate): speech, music and effects as separate stems, plus a transcript.
  const SAM_STEMS = [
    { prompt: "speech", kind: "voice", label: "Original voice" },
    { prompt: "music", kind: "music", label: "Original music" },
    { prompt: "sound effects", kind: "sfx", label: "Original effects" },
  ] as const;
  const separateStems = async (R: RunApi, original: AudioBuffer, duration: number) => {
    R.note("Splitting voice, music and effects with SAM Audio");
    const fd = new FormData();
    fd.append("audio", await fittedWav(original, 3_600_000, 32000, true), "audio.wav");
    fd.append("prompts", JSON.stringify(SAM_STEMS.map((s) => s.prompt)));
    const sfd = new FormData();
    sfd.append("action", "transcribe");
    sfd.append("audio", await speechWav(original), "audio.wav");
    const [sepRes, sttRes] = await Promise.all([fetch("/api/separate", { method: "POST", body: fd, signal: R.signal }), elFetch("/api/audio", { method: "POST", body: sfd, signal: R.signal })]);
    const sep = await jsonOf<{ stems: { prompt: string; url?: string; error?: string }[] }>(sepRes);
    const stt = sttRes.ok ? await sttRes.json() : { text: "", words: [] };
    const len = Math.min(original.duration, duration);
    const blobs: Record<string, Blob> = {};
    const out: AudioClip[] = [];
    const wav = toWav(original, original.numberOfChannels === 1);
    const origClip: AudioClip = { id: uid(), kind: "original", label: "Original mix", start: 0, duration: len, gain: 1, muted: true, source: "original" };
    blobs[origClip.id] = wav;
    out.push(origClip);
    const words = (stt.words as { w: string; s: number; e: number }[]) ?? [];
    for (const def of SAM_STEMS) {
      const got = sep.stems.find((x) => x.prompt === def.prompt);
      if (!got?.url) {
        R.note(`${def.label}: ${got?.error ?? "missing"}`);
        continue;
      }
      const blob = await (await fetch(got.url, { signal: R.signal })).blob();
      const buf = await decodeAudio(blob);
      // A stem that's essentially silent (no music in the video, say) isn't worth a lane.
      const d = buf.getChannelData(0);
      let e = 0;
      for (let i = 0; i < d.length; i += 64) e += d[i] * d[i];
      if (Math.sqrt(e / Math.ceil(d.length / 64)) < 0.004) {
        R.note(`${def.label}: silent, skipped`);
        continue;
      }
      const clip: AudioClip = { id: uid(), kind: def.kind, label: def.label, start: 0, duration: Math.min(buf.duration, len), gain: 1, muted: false, source: "original", separated: true };
      if (def.kind === "voice" && stt.text?.trim()) Object.assign(clip, { text: stt.text, words: words.length ? words : undefined });
      // Tempo from the music, hit times from the effects: the rebuilt versions line up with both.
      if (def.kind !== "voice") clip.beats = detectBeats(buf);
      blobs[clip.id] = blob;
      out.push(clip);
    }
    if (out.length === 1) throw new Error("no stems came back");
    R.note(`${out.length - 1} stems: ${out.slice(1).map((c) => c.label.replace("Original ", "")).join(", ")}${words.length ? ` · ${words.length} words transcribed` : ""}`);
    const transcript = words.length ? words.map((w) => `${w.w}[${w.s.toFixed(2)}]`).join(" ") : stt.text || undefined;
    return { clips: out, blobs, transcript, separated: true };
  };

  // Pull the audio out of a reference video: original, isolated voice, background (= original − voice), transcript.
  // `duration` is the film's length: only that much of the soundtrack is kept, or sent anywhere.
  const extractStems = async (R: RunApi, videoBlobUrl: string, duration: number): Promise<Stems | null> => {
    const blob = await (await fetch(videoBlobUrl, { signal: R.signal })).blob();
    let original: AudioBuffer;
    try {
      original = trimAudio(await decodeAudio(blob), duration);
    } catch {
      return null; // no audio track
    }
    if (original.duration < 0.5) return null;
    // With SAM Audio available, split into real voice / music / effects stems.
    const sam = await fetch("/api/separate", { signal: R.signal })
      .then((r) => r.json())
      .then((j) => !!j.available)
      .catch(() => false);
    R.signal.throwIfAborted();
    if (sam) {
      const split = await separateStems(R, original, duration).catch((e) => {
        // Stopping isn't a failure: never fall back to (paid) voice isolation for a stopped run.
        R.signal.throwIfAborted();
        R.note(`Stem separation failed (${(e as Error).message}); using voice isolation instead`);
        return null;
      });
      if (split) return split;
    }
    const wav = toWav(original, original.numberOfChannels === 1);
    // Full quality stays here as the "original mix" stem; the speech services get a copy that fits a request.
    const speech = await speechWav(original);
    const fd = (action: string) => {
      const f = new FormData();
      f.append("action", action);
      f.append("audio", speech, "audio.wav");
      return f;
    };
    R.note("Separating voice from background");
    const [isoRes, sttRes] = await Promise.all([
      elFetch("/api/audio", { method: "POST", body: fd("isolate"), signal: R.signal }),
      elFetch("/api/audio", { method: "POST", body: fd("transcribe"), signal: R.signal }),
    ]);
    const stt = sttRes.ok ? await sttRes.json() : { text: "", words: [] };
    const blobs: Record<string, Blob> = {};
    const out: AudioClip[] = [];
    const len = Math.min(original.duration, duration);
    const origClip: AudioClip = { id: uid(), kind: "original", label: "Original mix", start: 0, duration: len, gain: 1, muted: true, source: "original" };
    blobs[origClip.id] = wav;
    out.push(origClip);
    if (isoRes.ok) {
      const voiceBlob = await isoRes.blob();
      const voiceBuf = await decodeAudio(voiceBlob);
      const words = (stt.words as { w: string; s: number; e: number }[]) ?? [];
      const hasSpeech = !!stt.text?.trim();
      const v: AudioClip = { id: uid(), kind: "voice", label: "Original voice", start: 0, duration: len, gain: 1, muted: !hasSpeech, source: "original", text: stt.text || undefined, words: words.length ? words : undefined };
      blobs[v.id] = voiceBlob;
      out.push(v);
      R.note(hasSpeech ? `Transcribed ${words.length} words` : "No speech found");
      const bg = await subtractAligned(original, voiceBuf);
      if (bg) {
        const b: AudioClip = { id: uid(), kind: "background", label: "Original background (music + ambience)", start: 0, duration: len, gain: 1, muted: false, source: "original" };
        blobs[b.id] = toWav(bg);
        out.push(b);
        R.note("Background stem ready");
      }
    } else {
      origClip.muted = false;
      R.note("Voice separation unavailable; keeping the original mix");
    }
    const transcript = (stt.words as { w: string; s: number; e: number }[])?.length
      ? (stt.words as { w: string; s: number; e: number }[]).map((w) => `${w.w}[${w.s.toFixed(2)}]`).join(" ")
      : stt.text || undefined;
    return { clips: out, blobs, transcript };
  };

  // Score the film: plan with Claude, then generate voice / sfx / music with ElevenLabs.
  const scoreFilm = async (Rin: RunApi | null, target: Project = project, opts: { recreate?: boolean; transcript?: string; hasBackground?: boolean; rebuild?: boolean } = {}) => {
    if (target.builtin) return setNotice("Make your own film first; the example can't be changed.");
    const own = !Rin;
    const R = Rin ?? startRun(target.id, "score", "Sound");
    const { signal } = R;
    // A film built from a reference video keeps the original's voice and background; re-scoring only redoes the effects.
    const stems = (target.audio ?? []).filter((c) => c.source === "original");
    if (stems.length && !opts.recreate) {
      const voice = stems.find((c) => c.kind === "voice");
      opts = {
        recreate: true,
        transcript: voice?.words?.length ? voice.words.map((w) => `${w.w}[${w.s.toFixed(2)}]`).join(" ") : voice?.text,
        hasBackground: stems.some((c) => c.kind === "background"),
        // SAM-separated stems are always rebuilt (older films without the flag: they're the ones with music or effects stems).
        rebuild: stems.some((c) => c.separated || c.kind === "music" || c.kind === "sfx"),
      };
    }
    let failure: string | undefined;
    // Rebuilding separated stems: match the original music's tempo and the effects' hit times.
    const origMusic = stems.find((c) => c.kind === "music" && c.beats);
    const origFx = stems.find((c) => c.kind === "sfx" && c.beats);
    setAudioBusy("Planning the sound…");
    R.phase("Planning the sound design");
    try {
      const r = await fetch("/api/audio-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: target.prompt,
          treatment: target.treatment,
          duration: target.duration,
          aspect: target.aspect,
          recreate: !!opts.recreate,
          transcript: opts.transcript,
          hasBackground: !!opts.hasBackground,
          rebuild: opts.rebuild
            ? `REBUILD: the original's ${stems.map((c) => c.kind).filter((k) => k !== "original").join(", ")} stems were separated. Write new versions of each: voice lines from the transcript at their original timings${origMusic?.beats ? `; music matching the original's tempo (about ${Math.round(origMusic.beats.bpm)} BPM), mood and structure` : ""}; effects at the moments the original has them${origFx?.beats?.hits.length ? ` (hits near ${origFx.beats.hits.slice(0, 24).map((t) => t.toFixed(2)).join(", ")}s)` : ""}.`
            : undefined,
          grid: (() => {
            const m = (target.audio ?? []).find((c) => c.kind === "music" && c.beats);
            return m?.beats ? `Music grid: ${Math.round(m.beats.bpm)} BPM; downbeats at ${m.beats.downbeats.slice(0, 16).map((t) => (t + m.start).toFixed(2)).join(", ")}s. Place cues on beats or downbeats.` : undefined;
          })(),
        }),
        signal,
      });
      let plan = await r.json();
      if (!r.ok) throw new Error(plan.error ?? "Couldn't plan the sound.");
      // A degenerate plan (no cues, placeholder notes) is worth one more try.
      if (!plan.sfx?.length && !plan.voice?.length) {
        R.note("Plan came back empty; trying again");
        const r2 = await fetch("/api/audio-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief: target.prompt, treatment: target.treatment, duration: target.duration, aspect: target.aspect, recreate: !!opts.recreate, transcript: opts.transcript, hasBackground: !!opts.hasBackground }),
          signal,
        });
        if (r2.ok) plan = await r2.json();
      }
      R.note(plan.notes);
      if (plan.musicGuess) {
        const q = encodeURIComponent(`${plan.musicGuess.title} ${plan.musicGuess.artist}`);
        R.note(`Music sounds like “${plan.musicGuess.title}” by ${plan.musicGuess.artist} (${plan.musicGuess.confidence} confidence) · youtube.com/results?search_query=${q}`);
      }
      const T = target.duration;
      const made: AudioClip[] = [];
      const blobsNew: Record<string, Blob> = {};
      const b64blob = (b64: string, type: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

      // Voice, line by line (skipped in recreate mode when the original voice is kept as is).
      const voiceLines = opts.recreate && opts.transcript && !opts.rebuild ? [] : (plan.voice as { p: number; text: string }[]);
      for (let i = 0; i < voiceLines.length; i++) {
        const line = voiceLines[i];
        setAudioBusy(`Voicing line ${i + 1} of ${voiceLines.length}…`);
        const vr = await elFetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tts", text: line.text }), signal });
        const vj = await vr.json();
        if (!vr.ok) {
          R.note(`Voice: ${vj.error}`);
          break;
        }
        const blob = b64blob(vj.audio, "audio/mpeg");
        const buf = await decodeAudio(blob);
        const start = Math.max(0, Math.min(T - 0.1, line.p * T));
        const clip: AudioClip = { id: uid(), kind: "voice", label: `VO ${i + 1}`, start, duration: buf.duration, gain: 1, muted: false, source: "generated", text: line.text, words: (vj.words as { w: string; s: number; e: number }[]).map((w) => ({ w: w.w, s: start + w.s, e: start + w.e })) };
        blobsNew[clip.id] = blob;
        made.push(clip);
      }
      if (voiceLines.length) R.note(`${made.length} voice line${made.length === 1 ? "" : "s"}`);

      // Sound effects, a few at a time (ElevenLabs allows 4 concurrent requests on small plans).
      const cues = plan.sfx as { p: number; prompt: string; seconds: number; gain: number }[];
      setAudioBusy(`Making ${cues.length} sound effects…`);
      const sfx: (AudioClip | null)[] = new Array(cues.length).fill(null);
      let cursor = 0;
      const worker = async () => {
        while (cursor < cues.length) {
          const i = cursor++;
          const cue = cues[i];
          const ask = () => elFetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sfx", prompt: cue.prompt, seconds: Math.min(6, Math.max(0.5, cue.seconds)) }), signal });
          let sr = await ask();
          for (let attempt = 0; !sr.ok && attempt < 2; attempt++) {
            await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
            sr = await ask();
          }
          if (!sr.ok) {
            R.note(`SFX ${i + 1} failed: ${(await sr.json().catch(() => ({}))).error ?? sr.status}`);
            continue;
          }
          const blob = await sr.blob();
          const buf = await decodeAudio(blob);
          const clip: AudioClip = { id: uid(), kind: "sfx", label: `SFX ${i + 1}`, start: Math.max(0, Math.min(T - 0.1, cue.p * T)), duration: buf.duration, gain: Math.max(0.1, Math.min(1.5, cue.gain)), muted: false, source: "generated", prompt: cue.prompt };
          blobsNew[clip.id] = blob;
          sfx[i] = clip;
          setAudioBusy(`Making sound effects ${sfx.filter(Boolean).length}/${cues.length}…`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const fx = sfx.filter(Boolean) as AudioClip[];
      made.push(...fx);
      R.note(`${fx.length} sound effects`);

      // Music (paid ElevenLabs plans). Skipped in recreate mode when the original background is kept.
      if (plan.music && (opts.rebuild || !(opts.recreate && opts.hasBackground))) {
        setAudioBusy("Composing music…");
        const mr = await elFetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "music", prompt: plan.music.prompt, seconds: T }), signal });
        if (mr.ok) {
          const blob = await mr.blob();
          const buf = await decodeAudio(blob);
          const clip: AudioClip = { id: uid(), kind: "music", label: "Music", start: 0, duration: Math.min(buf.duration, T), gain: voiceLines.length ? 0.55 : 0.8, muted: false, source: "generated", prompt: plan.music.prompt };
          blobsNew[clip.id] = blob;
          made.push(clip);
          R.note("Music composed");
        } else {
          const mj = await mr.json().catch(() => ({}));
          R.note(`Music: ${mj.error ?? "unavailable"}; composing a synthesized bed instead`);
          setAudioBusy("Synthesizing a music bed…");
          const spec = specFromPlan(plan.music.prompt, plan.music.energy ?? "medium", target.id.split("").reduce((a, c) => a + c.charCodeAt(0), 7));
          const buf = await renderBed(spec, T);
          const blob = toWav(buf);
          const grid = bedBeats(spec, T);
          const clip: AudioClip = { id: uid(), kind: "music", label: `Synth bed · ${spec.bpm} BPM`, start: 0, duration: T, gain: voiceLines.length ? 0.5 : 0.7, muted: false, source: "generated", prompt: plan.music.prompt, beats: { ...grid, hits: grid.downbeats } };
          blobsNew[clip.id] = blob;
          made.push(clip);
          R.note(`Synth bed at ${spec.bpm} BPM, ${spec.mode}`);
        }
      }

      // Rebuilt effects land on the original's hits; otherwise snap to the music's beat grid.
      if (origFx?.beats?.hits.length) {
        let snapped = 0;
        for (const c of made) {
          if (c.kind !== "sfx") continue;
          const t = snapToGrid(c.start, origFx.beats.hits, 0.3);
          if (t !== c.start) [c.start, snapped] = [t, snapped + 1];
        }
        if (snapped) R.note(`${snapped} effect${snapped === 1 ? "" : "s"} placed on the original's hits`);
      }
      const gridClip = origFx ? null : [...made, ...(target.audio ?? [])].find((c) => c.kind === "music" && c.beats && !c.muted && c.source !== "original");
      if (gridClip?.beats) {
        const grid = [...gridClip.beats.beats, ...gridClip.beats.hits].map((t) => t + gridClip.start);
        let snapped = 0;
        for (const c of made) {
          if (c.kind !== "sfx") continue;
          const t = snapToGrid(c.start, grid, 0.15);
          if (t !== c.start) {
            c.start = t;
            snapped++;
          }
        }
        if (snapped) R.note(`${snapped} cue${snapped === 1 ? "" : "s"} snapped to the beat`);
      }

      setAudioBusy("Saving sound…");
      setAudioBlobs((m) => ({ ...m, ...blobsNew }));
      const stored = await Promise.all(made.map((c) => storeClipBlob(target.id, c, blobsNew[c.id], signal)));
      // A rebuilt stem replaces its original in the mix; the original stays, muted, for comparison. The old
      // generated clips all go, so an original whose stem wasn't rebuilt this time plays again.
      const rebuilt = new Set(made.map((c) => c.kind));
      const keepOld = (audio: AudioClip[] = []) =>
        audio
          .filter((c) => c.source !== "generated")
          .map((c) => (opts.rebuild && c.source === "original" && (c.kind === "voice" || c.kind === "music" || c.kind === "sfx") ? { ...c, muted: rebuilt.has(c.kind) } : c));
      patchFilm(target.id, (cur) => ({ audio: [...keepOld(cur.audio), ...stored] }), cloud);
      setNotice(`Scored: ${stored.length} sound element${stored.length === 1 ? "" : "s"} added.`);
    } catch (e) {
      if (isStop(e, signal)) {
        // Part of a bigger run: that run reports the stop.
        if (!own) throw e;
        failure = "Stopped.";
      } else {
        failure = friendlyError((e as Error).message);
        setError(failure);
      }
    } finally {
      setAudioBusy(null);
      if (own) R.finish(!failure, failure);
    }
  };

  const regenerateClip = async (id: string) => {
    const c = clips.find((x) => x.id === id);
    if (!c) return;
    setAudioBusy(`Regenerating ${c.label}…`);
    try {
      const body = c.kind === "voice" ? { action: "tts", text: c.text } : c.kind === "music" ? { action: "music", prompt: c.prompt, seconds: project.duration } : { action: "sfx", prompt: c.prompt, seconds: Math.min(6, c.duration) };
      const r = await fetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Couldn't regenerate.");
      const blob = c.kind === "voice" ? new Blob([Uint8Array.from(atob((await r.json()).audio), (ch) => ch.charCodeAt(0))], { type: "audio/mpeg" }) : await r.blob();
      const buf = await decodeAudio(blob);
      const fresh: AudioClip = { ...c, id: uid(), duration: c.kind === "music" ? Math.min(buf.duration, project.duration) : buf.duration };
      const stored = await storeClipBlob(project.id, fresh, blob);
      patchFilm(project.id, (cur) => ({ audio: (cur.audio ?? []).map((x) => (x.id === id ? stored : x)) }), cloud);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAudioBusy(null);
    }
  };

  // ── export (+ save to library) ──
  async function doExport() {
    if (!compiled.fn || !fonts) return;
    setExporting({ label: "Rendering", k: 0 });
    setError(null);
    try {
      const mix = loadedAudio.length ? await renderMix(loadedAudio, project.duration) : null;
      const { blob, ext, audioIncluded } = await exportVideo({
        scene: compiled.fn,
        fonts,
        assets,
        W,
        H,
        T: project.duration,
        fps,
        audio: mix,
        captions: burnCaptions ? cues : undefined,
        onProgress: (k) => setExporting({ label: "Rendering", k }),
      });
      if (mix && !audioIncluded) setNotice("Exported without sound: this browser can't encode audio into MP4. Chrome can.");
      const name = `${project.title.replace(/[^\w\- ]+/g, "").trim() || "animation"}.${ext}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);

      if (cloud && userId && !project.builtin) {
        setExporting({ label: "Saving to your library", k: 0 });
        const ts = Date.now();
        const res = await upload(`users/${userId}/videos/${project.id}/${ts}.${ext}`, blob, {
          access: "private",
          handleUploadUrl: "/api/upload",
          contentType: blob.type,
          multipart: blob.size > 8 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => setExporting({ label: "Saving to your library", k: percentage / 100 }),
        });
        const render: Render = { pathname: res.pathname, fps, w: W, h: H, duration: project.duration, size: blob.size, createdAt: ts };
        patchFilm(project.id, (cur) => ({ videos: [render, ...(cur.videos ?? []).filter((v) => v.pathname !== render.pathname)] }), cloud);
        setNotice("Saved to your library.");
      } else if (cloud && project.builtin) {
        setNotice("Downloaded. Examples aren't saved to your library; edit it to make your own copy.");
      } else {
        setNotice("Downloaded. Sign in to keep your videos in your library.");
      }
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  const setDuration = (d: number) => {
    tRef.current = (tRef.current / project.duration) * d;
    updateProject(project.doc ? { duration: d, doc: produce(project.doc, retime(d)) } : { duration: d });
  };

  const seek = (t: number) => {
    tRef.current = t;
    setTime(t);
    if (playingRef.current) mixer?.play(t);
  };

  const select = (id: string) => {
    setCurrentId(id);
    tRef.current = 0;
    setPlaying(true);
    setShowCode(false);
    setMode(isExample(id) ? "new" : "edit");
    setEnhanced(null);
    setProjectImgs({});
    setError(null);
  };

  const remove = async (id: string, silent = false) => {
    if (!silent && !confirm("Delete this animation and its saved videos?")) return;
    deleted.current.add(id);
    notStored.current.delete(id);
    saveFailed.current.delete(id);
    delete synced.current[id];
    // Stop anything still building or scoring it: it would spend credits, then save the film back.
    for (const r of Object.values(runs)) if (r.projectId === id && r.status === "running") r.abort.abort();
    // A save still waiting out its debounce never goes.
    const waiting = saveTimers.current[id];
    if (waiting) {
      clearTimeout(waiting.timer);
      delete saveTimers.current[id];
    }
    if (!projects.some((p) => p.favorite && p.id !== id)) setFavOnly(false);
    const left = projects.filter((p) => p.id !== id);
    setProjects((list) => list.filter((p) => p.id !== id));
    setGuestImgs((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    if (id === currentId) select(FIRST.id);
    // Everything this browser kept for it: the editor's saved doc (and its older autosaves), and its
    // cached preview clip.
    void dropEditorDoc(id);
    try {
      dropEditorSaves(localStorage, id);
      // The heartbeat first: a tab still building it reads its absence as "deleted", not "saved over".
      if (!cloud) {
        endBeat(localStorage, id);
        dropFilm(localStorage, LOCAL, id);
      }
    } catch {}
    if (libraryLoaded.current) void prunePreviews(left).catch(() => {});
    if (!cloud) {
      void dropGuestMedia(id);
      announceFilm(id);
      return;
    }
    const gone = projects.find((p) => p.id === id);
    await Promise.all((gone?.videos ?? []).filter((v) => v.shareId).map((v) => fetch(`/api/share?id=${v.shareId}`, { method: "DELETE" }).catch(() => {})));
    // After any save still on its way, so that save can't recreate the film.
    await inOrder(id, async () => {
      const r = await fetch(`/api/projects?id=${id}`, { method: "DELETE" }).catch(() => null);
      if (r?.ok) announceFilm(id);
      else setError(`Couldn't delete “${gone?.title ?? "that film"}” from your library${r ? ` (${await failure(r)})` : ". Check your connection"}. It'll be back after a reload.`);
    });
  };

  // ── Share: a public page for a rendered MP4 (never scene code) ──
  const shareRender = async (v: Render) => {
    try {
      let id = v.shareId;
      if (!id) {
        const r = await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname: v.pathname, title: project.title, w: v.w, h: v.h, duration: v.duration }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Couldn't create a share link.");
        id = j.id as string;
        upsert({ ...project, videos: (project.videos ?? []).map((x) => (x.pathname === v.pathname ? { ...x, shareId: id } : x)) }, true);
      }
      const url = `${location.origin}/watch/${id}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      setNotice(`Share link copied: ${url}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unshareRender = async (v: Render) => {
    if (!v.shareId) return;
    await fetch(`/api/share?id=${v.shareId}`, { method: "DELETE" });
    upsert({ ...project, videos: (project.videos ?? []).map((x) => (x.pathname === v.pathname ? { ...x, shareId: undefined } : x)) }, true);
    setNotice("Link turned off.");
  };

  const deleteRender = (pathname: string) => {
    const shared = project.videos?.find((v) => v.pathname === pathname)?.shareId;
    if (shared) fetch(`/api/share?id=${shared}`, { method: "DELETE" }).catch(() => {});
    upsert({ ...project, videos: (project.videos ?? []).filter((v) => v.pathname !== pathname) }, true);
  };

  // Paste anywhere: files/images become attachments; text or links pasted
  // outside an input are added to the brief (links then get researched).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const pasted = Array.from(cd.files);
      if (pasted.length) {
        e.preventDefault();
        addFiles(pasted).then(() => setNotice(`Added ${pasted.length} file${pasted.length > 1 ? "s" : ""} to your references.`));
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const text = cd.getData("text/plain").trim();
      if (!text) return;
      e.preventDefault();
      setPrompt((p) => (p ? `${p}\n${text}` : text));
      setNotice(linksIn(text).length ? "Link added. Reading the site…" : "Added to your brief.");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // Runs live in this page: leaving mid-build would cut them off.
  const anyRunning = Object.values(runs).some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [anyRunning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === "Space" && tag !== "TEXTAREA" && tag !== "INPUT") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const canAsk = !!prompt.trim() || files.length > 0 || videos.length > 0;

  // Your films first (favorites on top), then the examples. With no favorites left the filter can't apply
  // (its toggle is hidden then), so the whole library shows.
  const favFilter = favOnly && projects.some((p) => p.favorite);
  const ownFilms = projects.filter((p) => !p.builtin && (!favFilter || p.favorite)).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  const tile = (p: Project) => (
    <button key={p.id} className={`lib-item${p.id === currentId ? " on" : ""}${p.favorite ? " fav" : ""}${p.building ? " building" : ""}`} onClick={() => select(p.id)} title={p.title}>
      <Thumb film={p} fonts={fonts} />
      {p.building && runs[p.building]?.status === "running" && (
        <span className="lib-building">
          <span className="dot" /> {runs[p.building].steps.at(-1)?.label ?? "Starting"}
        </span>
      )}
      <div className="lib-title">
        {!p.builtin && (
          <span
            className={`lib-star${p.favorite ? " on" : ""}`}
            role="button"
            aria-label={p.favorite ? "Remove from favorites" : "Add to favorites"}
            title={p.favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={(e) => {
              e.stopPropagation();
              if (p.favorite && !projects.some((x) => x.favorite && x.id !== p.id)) setFavOnly(false);
              upsert({ ...p, favorite: !p.favorite }, true);
            }}
          >
            {p.favorite ? "★" : "☆"}
          </span>
        )}
        {p.title}
      </div>
      {!p.builtin && (
        <span
          className="lib-del"
          role="button"
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation();
            remove(p.id);
          }}
        >
          ×
        </span>
      )}
    </button>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          animate
        </div>
        <div className="top-right">
          <span className="top-meta">{project.title}</span>
          {isLoaded &&
            (isSignedIn ? (
              <AccountButton />
            ) : (
              <SignIn>
                <button className="pill">Sign in</button>
              </SignIn>
            ))}
        </div>
      </header>

      <main className="main">
        <section className="stage-wrap">
          <div ref={stageRef} className={`stage${currentRun?.status === "running" ? " busy" : ""}`}>
            <canvas
              ref={canvasRef}
              style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }}
              onClick={() => setPlaying((p) => !p)}
            />
            {currentRun && (
              <Progress
                steps={currentRun.steps}
                running={currentRun.status === "running"}
                output={currentRun.stream}
                onCancel={() => currentRun.abort.abort()}
                onDismiss={() => {
                  dismissRun(currentRun.id);
                  if (project.building && !project.code) remove(project.id, true);
                }}
              />
            )}
            {shownError && currentRun?.status !== "running" && (
              <div className="error-card">
                <span>{shownError}</span>
                <button className="linkish" onClick={() => setError(null)}>
                  dismiss
                </button>
              </div>
            )}
            {notice && !shownError && currentRun?.status !== "running" && <div className="notice">{notice}</div>}
          </div>

          <div className="transport">
            <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
              {playing ? (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <rect x="2" y="1" width="3" height="10" rx="1" fill="currentColor" />
                  <rect x="7" y="1" width="3" height="10" rx="1" fill="currentColor" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
                </svg>
              )}
            </button>
            <input
              className="scrub"
              type="range"
              min={0}
              max={project.duration}
              step={0.01}
              value={time}
              style={{ ["--fill" as string]: `${(time / project.duration) * 100}%` }}
              onChange={(e) => seek(+e.target.value)}
              aria-label="Scrub timeline"
            />
            <span className="time">
              {fmt(time)} / {fmt(project.duration)}
            </span>
          </div>

          {ownFilms.length > 0 && (
          <div className="section-label lib-head">
            <span className="lib-head-title">
              {cloud ? "Your library" : "On this device"}
              {!cloud && isLoaded && <span> · sign in to keep animations and videos in the cloud</span>}
            </span>
            {projects.some((p) => p.favorite) && (
              <span className="lib-filter">
                <button className={favFilter ? "" : "on"} onClick={() => setFavOnly(false)}>
                  All
                </button>
                <button className={favFilter ? "on" : ""} onClick={() => setFavOnly(true)}>
                  ★ Favorites
                </button>
              </span>
            )}
          </div>
          )}
          {ownFilms.length > 0 && <div className="library">{ownFilms.map(tile)}</div>}
          {!favFilter && (
            <>
              <div className="section-label lib-head">
                <span className="lib-head-title">
                  Examples<span> · open one, or describe your own</span>
                </span>
              </div>
              <div className="library">{EXAMPLES.map((e) => tile(projects.find((p) => p.id === e.id) ?? e))}</div>
            </>
          )}

          {project.doc && (
            <div className="elements">
              <div className="section-label lib-head">
                <span>Elements · {project.doc.layers.filter((l) => l.type !== "code").length}</span>
                <a className="linkish" href={`/editor/${project.id}`} onClick={(e) => openEditor(e, project.id)}>
                  Edit every element →
                </a>
              </div>
              <div className="elements-list">
                {project.doc.layers
                  .filter((l) => l.type !== "code")
                  .map((l) => (
                    <span className={`element t-${l.type}`} key={l.id} title={`${l.start.toFixed(2)}–${l.end.toFixed(2)}s`}>
                      <i>{l.type === "text" ? "T" : l.type === "image" ? "▣" : "◻"}</i>
                      {l.name}
                    </span>
                  ))}
                {project.doc.layers.some((l) => l.type === "code") && (
                  <span className="element t-code" title="Everything that isn't a flat element, drawn by code underneath">
                    <i>{"</>"}</i>Drawn by code
                  </span>
                )}
              </div>
            </div>
          )}

          {(!project.builtin || clips.length > 0) && (
            <AudioStrip
              clips={clips}
              duration={project.duration}
              busyLabel={audioBusy}
              onChange={updateClip}
              onRemove={removeClip}
              onUpload={addAudioFiles}
              onScore={() => scoreFilm(null)}
              onRegenerate={regenerateClip}
              canScore={!project.builtin}
            />
          )}
          {cues.length > 0 && (
            <div className="captions-row">
              <label className="caption-toggle">
                <input type="checkbox" checked={burnCaptions} onChange={(e) => setBurnCaptions(e.target.checked)} /> Burn captions into the export ({cues.length} lines)
              </label>
              <a
                className="linkish"
                href={`data:text/plain;charset=utf-8,${encodeURIComponent(toSrt(cues))}`}
                download={`${project.title.replace(/[^\w\- ]+/g, "").trim() || "captions"}.srt`}
              >
                Download .srt
              </a>
            </div>
          )}

          {!!project.videos?.length && (
            <>
              <div className="section-label">Saved videos</div>
              <div className="renders">
                {project.videos.map((v) => (
                  <div className="render" key={v.pathname}>
                    <video src={media(v.pathname)} preload="metadata" muted playsInline controls />
                    <div className="render-meta">
                      <span>
                        {new Date(v.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span>
                        {v.w}×{v.h} · {v.fps}fps · {(v.size / 1e6).toFixed(1)} MB
                      </span>
                    </div>
                    <div className="render-actions">
                      <a className="linkish" href={media(v.pathname, true)}>
                        Download
                      </a>
                      <button className="linkish" onClick={() => shareRender(v)}>
                        {v.shareId ? "Copy link" : "Share"}
                      </button>
                      {v.shareId && (
                        <button className="linkish" onClick={() => unshareRender(v)}>
                          Stop sharing
                        </button>
                      )}
                      <button className="linkish" onClick={() => deleteRender(v.pathname)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <aside className="panel">
          {mode === "edit" && !project.builtin ? (
            <div className="thread-head">
              <h1 className="headline small">{project.title}</h1>
              <button className="linkish" onClick={() => setMode("new")}>
                ＋ New film
              </button>
            </div>
          ) : (
            <div className="thread-head">
              <h1 className="headline">
                Describe it. Drop in your files. <em>Get a film.</em>
              </h1>
              {!project.builtin && (
                <button className="linkish" onClick={() => setMode("edit")}>
                  ← back to “{project.title}”
                </button>
              )}
            </div>
          )}

          {mode === "edit" && !project.builtin && (
            <div className="thread">
              {(project.thread ?? []).length === 0 && <p className="hint">Tell animate what to change. Every reply is a new version you can go back to.</p>}
              {(project.thread ?? []).map((m) => (
                <div key={m.id} className={`thread-msg ${m.role}`}>
                  <span>{m.text}</span>
                  {m.role === "assistant" && (m.codeBefore || m.docBefore) && (
                    <button
                      className="linkish"
                      title="Go back to the version before this change"
                      onClick={() => {
                        const back: Msg = { id: uid(), role: "assistant", text: "Went back to the earlier version.", at: nowMs(), codeBefore: m.codeBefore ? project.code : undefined, docBefore: m.docBefore ? project.doc : undefined };
                        upsert(
                          {
                            ...project,
                            code: m.codeBefore ?? project.code,
                            doc: m.docBefore ?? project.doc,
                            duration: m.docBefore?.meta.duration ?? project.duration,
                            thread: [...(project.thread ?? []), back],
                          },
                          true,
                        );
                        tRef.current = 0;
                      }}
                    >
                      revert
                    </button>
                  )}
                </div>
              ))}
              {currentRun?.status === "running" && (
                <div className="thread-msg assistant working">
                  <span className="dot" /> {currentRun.steps.at(-1)?.label ?? "Starting"} · you can start another film meanwhile
                </div>
              )}
            </div>
          )}

          <div
            className={`composer${drag ? " drag" : ""}${enhanced ? " enhanced" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            {enhanced && (
              <div className="enhanced-tag">
                <span>✦ Treatment ready. Edit it freely, then animate.</span>
                <button
                  className="linkish"
                  onClick={() => {
                    setPrompt(enhanced.brief);
                    setEnhanced(null);
                  }}
                >
                  undo
                </button>
              </div>
            )}
            {(videos.length > 0 || reading.length > 0 || brands.length > 0 || files.length > 0) && (
              <div className="attachments">
                {videos.map((v) => (
                  <div className="att" key={v.id} title={v.text ?? v.name}>
                    <span className="att-thumb">
                      {v.poster && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={v.poster} alt="" />
                      )}
                      <i>{v.duration.toFixed(0)}s</i>
                    </span>
                    <span className="att-text">
                      <b>{v.name}</b>
                      <span>
                        {recreate ? "Recreating" : "Style reference"} · {v.w}×{v.h}
                        {v.status !== "Ready" ? ` · ${v.status}` : ""}
                        {v.download && (
                          <>
                            {" · "}
                            <a href={v.download} title="Download the original video">
                              save
                            </a>
                          </>
                        )}
                      </span>
                    </span>
                    <button className="chip-x" aria-label="Remove video" onClick={() => removeVideo(v.id)}>
                      ×
                    </button>
                  </div>
                ))}
                {reading.map((h) => (
                  <div className="att loading" key={`r-${h}`}>
                    <span className="dot" />
                    <span className="att-text">
                      <b>{h}</b>
                      <span>Reading the brand…</span>
                    </span>
                  </div>
                ))}
                {brands.map((b) => (
                  <div className="att" key={b.host} title={b.description}>
                    <span className="att-thumb swatches">
                      {(b.themeColor ? [b.themeColor, ...b.colors] : b.colors).slice(0, 4).map((c, i) => (
                        <span key={c + i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="att-text">
                      <b>{b.name}</b>
                      <span>{b.host}</span>
                    </span>
                    <button className="chip-x" aria-label={`Remove ${b.name}`} onClick={() => setBrands((l) => l.filter((x) => x.host !== b.host))}>
                      ×
                    </button>
                  </div>
                ))}
                {files.map((f) => (
                  <div className="att" key={f.id}>
                    <span className="att-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {f.url ? <img src={f.url} alt="" /> : <i className="ficon">{f.kind === "pdf" ? "PDF" : "TXT"}</i>}
                    </span>
                    <span className="att-text">
                      <b title={f.name}>{f.name}</b>
                      {f.kind === "image" ? (
                        <button
                          className={`chip-role${f.asset ? " asset" : ""}`}
                          title="Toggle: draw this image in the video, or use it only as a style reference"
                          onClick={() => setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, asset: !x.asset } : x)))}
                        >
                          {f.asset ? "In the film" : "Reference"}
                        </button>
                      ) : (
                        <span>{f.kind === "pdf" ? "PDF" : "Text"}</span>
                      )}
                    </span>
                    <button className="chip-x" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, as in a chat; Shift+Enter is a new line (and a long treatment needs ⌘/Ctrl+Enter)
                if (e.key !== "Enter" || e.nativeEvent.isComposing || e.shiftKey) return;
                if (enhanced && !(e.metaKey || e.ctrlKey)) return;
                e.preventDefault();
                if (canAsk && fonts && !(mode === "edit" && isBuilding)) generate();
              }}
              style={enhanced ? { minHeight: 300 } : undefined}
              placeholder={
                mode === "new"
                  ? "Describe a film, paste a link, or drop in a video to recreate…"
                  : "Make the intro slower, swap the accent to olive, add our logo at the end…"
              }
            />
            {mode === "new" && explainer && (
              <div className="explainer">
                <div className="explainer-head">
                  <span>Explainer brief</span>
                  <button className="linkish" onClick={() => setExplainer(null)}>
                    remove
                  </button>
                </div>
                <input value={explainer.audience} onChange={(e) => setExplainer({ ...explainer, audience: e.target.value })} placeholder="Who is it for? e.g. first-time founders" />
                <input value={explainer.believe} onChange={(e) => setExplainer({ ...explainer, believe: e.target.value })} placeholder="What do they believe today that's wrong or incomplete?" />
                <input value={explainer.outcome} onChange={(e) => setExplainer({ ...explainer, outcome: e.target.value })} placeholder="After watching they can… (one sentence)" />
              </div>
            )}
            <div className="composer-bar">
              <details className="plus-menu" ref={plusMenu}>
                <summary aria-label="More options" title="Files and more">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </summary>
                <div className="plus-items" onClick={() => plusMenu.current?.removeAttribute("open")}>
                  <button onClick={() => fileInput.current?.click()}>Add files, a video or a PDF</button>
                  {mode === "new" && (
                    <button onClick={() => setExplainer(explainer ? null : { audience: "", believe: "", outcome: "" })}>
                      {explainer ? "Remove explainer brief" : "Make it an explainer"}
                    </button>
                  )}
                  {!enhanced && (
                    <button onClick={enhance} disabled={!canAsk} title="Expand your brief into a full creative treatment you can edit">
                      ✦ Enhance my brief
                    </button>
                  )}
                </div>
              </details>
              {mode === "new" && !recreate && (
                <select className="pill-select shrink" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Animation style" title="Animation style">
                  <option value="">Any style</option>
                  {STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              {/* Recreating, the video sets the format and length (the hint below says which). */}
              {!(recreate || enhanced?.recreate) && (
                <>
                  {/* A doc film's elements are laid out at its doc's size: its format is set there (in the editor), not here.
                      Composing a new film with one selected, the format picked is the new film's alone. */}
                  <select
                    className="pill-select"
                    value={newAspect}
                    aria-label="Format"
                    title={fixedFormat && mode !== "new" ? "This film's elements are laid out for its format, so it can't be changed here." : "Format"}
                    onChange={(e) => {
                      const a = e.target.value as Aspect;
                      if (fixedFormat || ownNew) setNewFormat({ film: project.id, aspect: a });
                      else updateProject({ aspect: a });
                    }}
                  >
                    {(["16:9", "9:16", "1:1"] as Aspect[]).map((a) => (
                      <option key={a} value={a} disabled={fixedFormat && mode !== "new" && project.aspect !== a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <select
                    className="pill-select"
                    value={newDuration}
                    aria-label="Length in seconds"
                    title={ownNew ? "Length of the new film" : "Length (re-times the whole film, no regeneration needed)"}
                    onChange={(e) => (ownNew ? setNewLength({ film: project.id, duration: +e.target.value }) : setDuration(+e.target.value))}
                  >
                    {[...new Set([5, 10, 15, 20, 30, 45, 60, 90, newDuration])]
                      .sort((a, b) => a - b)
                      .map((d) => (
                        <option key={d} value={d}>
                          {d}s
                        </option>
                      ))}
                  </select>
                </>
              )}
              <button
                className={`send${recreate || enhanced?.recreate ? " wide" : ""}`}
                onClick={generate}
                disabled={!canAsk || !fonts || (mode === "edit" && isBuilding)}
                aria-label={recreate || enhanced?.recreate ? "Recreate video" : mode === "new" ? "Animate" : "Send"}
                title={recreate || enhanced?.recreate ? "Recreate video" : mode === "new" ? "Animate" : "Send"}
              >
                {(recreate || enhanced?.recreate) && <span>Recreate</span>}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept="image/*,video/*,application/pdf,text/*,.md,.json,.csv"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {(recreate || enhanced?.recreate) && videos[0] && (
            <p className="hint recreate-hint">
              Recreating this video as closely as possible ({filmFor(true).duration}s · {filmFor(true).aspect}). Add a brief to use it as a style
              reference instead. Make sure you have the rights to publish a copy.
            </p>
          )}

          <div className="film-actions">
            <button className="export" onClick={doExport} disabled={exporting !== null || !compiled.fn || isBuilding}>
              {exporting && <span className="progress-fill" style={{ width: `${exporting.k * 100}%` }} />}
              <span>
                {exporting
                  ? `${exporting.label} ${Math.round(exporting.k * 100)}%`
                  : `Export MP4${cloud && !project.builtin ? " · saves to library" : ""}`}
              </span>
            </button>
            <select className="pill-select" value={fps} onChange={(e) => setFps(+e.target.value)} aria-label="Frame rate" title={`Exports at ${W}×${H}`}>
              {[30, 60].map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
            <span className="film-links">
              <button
                className="linkish"
                onClick={() => {
                  setDraftCode(sceneCodeOf(project));
                  setDraftBase(sceneCodeOf(project));
                  setShowCode((s) => !s);
                }}
              >
                {showCode ? "Hide code" : "Code"}
              </button>
              {project.treatment && (
                <button
                  className="linkish"
                  onClick={() => {
                    setPrompt(project.treatment!);
                    setEnhanced({ brief: project.prompt ?? "" });
                    setMode("new");
                  }}
                >
                  Reuse treatment
                </button>
              )}
              <a className="linkish" href={`/editor/${project.id}`} onClick={(e) => openEditor(e, project.id)}>
                Editor →
              </a>
            </span>
          </div>

          {showCode && (
            <div className="code">
              <textarea value={draftCode} onChange={(e) => setDraftCode(e.target.value)} spellCheck={false} />
              <div className="code-bar">
                <span className="hint">
                  {project.doc
                    ? codeLayerOf(project.doc)
                      ? "What draws everything that isn't an element. Pure function of t. Runs every frame."
                      : "This film is all elements. Code applied here draws underneath them."
                    : "Pure function of t. Runs every frame."}
                </span>
                <button
                  className="linkish"
                  onClick={() => {
                    // Scene code changed elsewhere since the draft was opened (the editor, say) isn't replaced
                    // unasked: the first Apply says so, a second one replaces it.
                    const latest = sceneCodeOf(project);
                    if (latest !== draftBase && latest !== draftCode) {
                      setDraftBase(latest);
                      setError("This film's scene code was changed in the editor since you opened it. Apply again to replace it with yours, or reopen “View scene code” to start from the latest.");
                      return;
                    }
                    // A doc film plays its doc, so the code goes into the doc's code layer.
                    if (project.builtin) {
                      const change = withSceneCode(project, draftCode);
                      const id = uid();
                      const copy = { ...project, ...change, id, builtin: false, title: project.title + " (copy)", createdAt: Date.now() };
                      upsert(copy.doc ? { ...copy, doc: { ...copy.doc, meta: { ...copy.doc.meta, id, title: copy.title } } } : copy, true);
                      setCurrentId(id);
                      setMode("edit");
                    } else {
                      // Applied to the film as it is now, so the rest of a doc saved meanwhile is kept.
                      setDraftBase(draftCode);
                      patchFilm(
                        project.id,
                        (cur) => {
                          const change = withSceneCode(cur, draftCode);
                          return change.code !== undefined || change.doc ? change : null;
                        },
                        cloud,
                        false,
                      );
                    }
                  }}
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
