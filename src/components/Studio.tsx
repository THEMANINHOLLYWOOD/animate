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
import { GAIA_SCENE } from "@/lib/presets/gaia";
import Progress, { type Step } from "@/components/Progress";
import AudioStrip from "@/components/AudioStrip";
import { useFilmAudio } from "@/components/useFilmAudio";
import { type AudioClip, decodeAudio, renderMix, subtractAligned, toWav } from "@/lib/audio";
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
import { aspectFor, probeVideo, sampleFrames, type VideoRef } from "@/lib/videoref";

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
  builtin?: boolean;
  favorite?: boolean;
  share?: { id: string; createdAt: number };
  createdAt: number;
};

type Msg = { id: string; role: "user" | "assistant"; text: string; at: number; codeBefore?: string; docBefore?: DocT };

type Attached = {
  id: string;
  name: string;
  kind: "image" | "pdf" | "text";
  file: File;
  url?: string;
  img?: HTMLImageElement;
  asset: boolean;
};

const GAIA: Project = {
  id: "gaia",
  title: "Gaia — Hear the world",
  code: GAIA_SCENE,
  duration: 30,
  aspect: "16:9",
  builtin: true,
  createdAt: 0,
};

const LOCAL = "animate.projects.v1";
const uid = () => Math.random().toString(36).slice(2, 12);
const nowMs = () => Date.now();
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

// Downscale to the model's preferred input size; keep PNG for transparency.
function imagePayload(img: HTMLImageElement, type: string) {
  const max = 1568;
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const png = type === "image/png" || type === "image/svg+xml" || type === "image/webp" || type === "image/gif";
  const mediaType = png ? "image/png" : "image/jpeg";
  return { mediaType, data: c.toDataURL(mediaType, 0.9).split(",")[1] };
}

function parseScene(text: string) {
  const title = text.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  const note = text.match(/<note>([\s\S]*?)<\/note>/)?.[1]?.trim();
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const code = blocks.sort((a, b) => b.length - a.length)[0];
  return { title, note, code };
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
  if (res.status === 401) throw new Error("Sign in to create animations.");
  if (!res.body) throw new Error(`Request failed (${res.status})`);
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
        else if (ev.type === "done") finished = true;
        else if (ev.type === "error") throw new Error(ev.message);
      }
    }
  } catch (e) {
    if (e instanceof PartialOutput || signal.aborted) throw e;
    // The connection dropped. If a complete answer already arrived, keep it.
    const complete = /```[\s\S]*```\s*$/.test(text.trim()) || (text.length > 400 && !/```/.test(text));
    if (!finished && !complete) throw new Error(`The connection dropped mid-way (${(e as Error).message}). Try again.`);
  }
  return text;
}

// A run the function time limit cut short; the text so far is resumable.
class PartialOutput extends Error {
  constructor(public text: string) {
    super("partial");
  }
}

// The animator stage with automatic continuation when the time limit cuts it off.
async function animateStage(payload: Record<string, unknown>, signal: AbortSignal, onText: (s: string) => void, onThinking?: (d: string) => void, onResume?: (n: number) => void) {
  let sofar = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const rest = await streamStage({ ...payload, continuation: sofar || undefined }, signal, (s) => onText(sofar + s), undefined, onThinking);
      return sofar + rest;
    } catch (e) {
      if (e instanceof PartialOutput) {
        if (attempt === 2) throw e;
        sofar += e.text;
        onResume?.(attempt + 1);
        continue;
      }
      if (/connection dropped/.test((e as Error).message) && attempt === 0) continue; // one retry
      throw e;
    }
  }
  return sofar;
}

export default function Studio() {
  const { isLoaded, isSignedIn, userId } = useAccount();
  const [projects, setProjects] = useState<Project[]>([GAIA]);
  const [currentId, setCurrentId] = useState("gaia");
  const [prompt, setPrompt] = useState("");
  const [enhanced, setEnhanced] = useState<null | { brief: string; recreate?: boolean }>(null);
  const [mode, setMode] = useState<"new" | "edit">("new");
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
  const [busy, setBusy] = useState<null | { label: string; stream: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [favOnly, setFavOnly] = useState(false);
  const [audioBlobs, setAudioBlobs] = useState<Record<string, Blob>>({});
  const [audioBusy, setAudioBusy] = useState<string | null>(null);
  const [burnCaptions, setBurnCaptions] = useState(true);
  // Explainer brief: who it's for, what they believe, what they should be able to do after.
  const [explainer, setExplainer] = useState<null | { audience: string; believe: string; outcome: string }>(null);
  // Stems pulled from a reference video (recreate mode), waiting for the film to exist.
  const pendingStems = useRef<{ clips: AudioClip[]; blobs: Record<string, Blob>; transcript?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | { label: string; k: number }>(null);
  const [drag, setDrag] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [draftCode, setDraftCode] = useState("");
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tRef = useRef(0);
  const playingRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const project = projects.find((p) => p.id === currentId) ?? GAIA;
  const [W, H] = SIZES[project.aspect];
  const cloud = !!isSignedIn;
  // No brief + a reference video = recreate that video as closely as possible.
  const recreate = mode === "new" && !prompt.trim() && videos.length > 0;

  // ── load fonts + library ──
  useEffect(() => {
    loadFonts().then(setFonts);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    (async () => {
      let list: Project[] = [];
      if (isSignedIn) {
        try {
          const r = await fetch("/api/projects");
          if (r.ok) list = (await r.json()).projects;
        } catch {}
      } else {
        try {
          list = JSON.parse(localStorage.getItem(LOCAL) || "[]");
        } catch {}
      }
      if (cancelled) return;
      setProjects([GAIA, ...list]);
      setCurrentId((id) => (id === "gaia" || list.some((p) => p.id === id) ? id : "gaia"));
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  // ── persistence: cloud when signed in, this browser otherwise ──
  const persist = useCallback(
    (p: Project, list: Project[], immediate = false) => {
      if (p.builtin) return;
      if (!cloud) {
        try {
          localStorage.setItem(LOCAL, JSON.stringify(list.filter((x) => !x.builtin)));
        } catch {}
        return;
      }
      clearTimeout(saveTimers.current[p.id]);
      const run = () =>
        fetch("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }).catch(
          () => setError("Couldn't save to your library. Check your connection."),
        );
      if (immediate) return run();
      saveTimers.current[p.id] = setTimeout(run, 700);
    },
    [cloud],
  );

  const upsert = useCallback(
    (p: Project, immediate = false) => {
      setProjects((list) => {
        const next = list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
        persist(p, next, immediate);
        return next;
      });
    },
    [persist],
  );

  const updateProject = useCallback(
    (patch: Partial<Project>) => {
      setProjects((list) => {
        const cur = list.find((x) => x.id === currentId);
        if (!cur) return list;
        const p = { ...cur, ...patch };
        const next = list.map((x) => (x.id === p.id ? p : x));
        persist(p, next);
        return next;
      });
    },
    [currentId, persist],
  );

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

  // ── scene ──
  const compiled = useMemo<{ fn: SceneFn | null; err: string | null }>(() => {
    try {
      if (project.doc) return { fn: docScene(project.doc), err: null };
      return { fn: compileScene(project.code), err: null };
    } catch (e) {
      return { fn: null, err: (e as Error).message };
    }
  }, [project.code, project.doc]);

  const assets = useMemo<Assets>(() => {
    const byName: Record<string, HTMLImageElement> = project.assets?.length ? { ...projectImgs } : {};
    for (const f of files) if (f.img && f.asset) byName[f.name] = f.img;
    return { images: Object.entries(byName).map(([name, img]) => ({ name, img })), byName };
  }, [files, projectImgs, project.assets]);

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

  const filePayload = () =>
    Promise.all(
      files.map(async (f) => {
        if (f.kind === "image") return { kind: "image", name: f.name, asset: f.asset, ...imagePayload(f.img!, f.file.type) };
        if (f.kind === "pdf") return { kind: "pdf", name: f.name, data: await b64(f.file) };
        return { kind: "text", name: f.name, text: (await f.file.text()).slice(0, 200_000) };
      }),
    );

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
  const videoPayload = async (recreate: boolean) => {
    const out: unknown[] = [];
    const budget = recreate ? 32 : 8;
    for (const v of videos) {
      const n = recreate ? Math.max(8, Math.min(Math.ceil(v.duration * 2), Math.floor(budget / videos.length))) : Math.max(4, Math.floor(budget / videos.length));
      setVideos((l) => l.map((x) => (x.id === v.id ? { ...x, status: "Sampling frames…" } : x)));
      const frames = await sampleFrames(v.blobUrl, n, 768, (i) =>
        setVideos((l) => l.map((x) => (x.id === v.id ? { ...x, status: `Sampling frames ${i}/${n}` } : x))),
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
    if (!isSignedIn) return;
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
  }, [prompt, isSignedIn, importImage, grabXVideo]);

  // ── Progress steps: what Claude is doing right now, with its reasoning ──
  const phase = (label: string) => {
    const at = Date.now();
    setBusy({ label, stream: "" });
    setSteps((list) => [
      ...list.map((x) => (x.status === "active" ? { ...x, status: "done" as const, endedAt: at } : x)),
      { id: uid(), label, status: "active", startedAt: at, thinking: "", notes: [] },
    ]);
  };
  const note = (n: string) => setSteps((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, notes: [...x.notes, n] } : x)));
  const think = (d: string) => setSteps((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, thinking: x.thinking + d } : x)));
  const finishSteps = (ok: boolean) => {
    const at = Date.now();
    setSteps((l) => l.map((x) => (x.status === "active" ? { ...x, status: ok ? ("done" as const) : ("error" as const), endedAt: at } : x)));
  };

  // ── stage 1: direct (also the ✦ Enhance button) ──
  async function direct(
    signal: AbortSignal,
    brief: string,
    payloadFiles: unknown[],
    editing: boolean,
    film: { duration: number; aspect: Aspect; recreate: boolean } = { duration: project.duration, aspect: project.aspect, recreate: false },
  ) {
    const researching = !film.recreate && (brands.length > 0 || linksIn(brief).length > 0);
    phase(film.recreate ? "Breaking the video down shot by shot" : researching ? "Researching the company" : "Writing the creative treatment");
    let writing = !researching;
    return streamStage(
      {
        stage: "direct",
        prompt: brief,
        duration: film.duration,
        aspect: film.aspect,
        recreate: film.recreate,
        files: payloadFiles,
        brands,
        previousCode: editing ? project.code : undefined,
      },
      signal,
      (s) => {
        if (!writing && s.trim()) {
          writing = true;
          phase("Writing the creative treatment");
        }
        setBusy((b) => b && { ...b, stream: s });
      },
      note,
      think,
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
      : { duration: project.duration, aspect: project.aspect, recreate: false };
  };
  const collectFiles = async (recreating: boolean) => {
    if (videos.length) phase(recreating ? "Sampling the video frame by frame" : "Sampling the reference video");
    const vids = await videoPayload(recreating);
    if (recreating && videos[0]) {
      phase("Pulling the sound apart");
      try {
        const stems = await extractStems(videos[0].blobUrl, videos[0].duration);
        pendingStems.current = stems;
        if (stems?.transcript) vids.push({ kind: "text", name: "reference-audio-transcript.txt", text: `Transcript of the reference video's voice, with word start times in seconds:\n${stems.transcript}` });
        if (!stems) note("The video has no audio track");
      } catch (e) {
        note(`Sound: ${(e as Error).message}`);
        pendingStems.current = null;
      }
    }
    if (videos.length) note(`${vids.filter((x) => (x as { kind: string }).kind === "image").length} frames from ${videos.length} video${videos.length > 1 ? "s" : ""}`);
    return [...(await filePayload()), ...vids];
  };

  async function enhance() {
    if (!prompt.trim() && !files.length && !videos.length) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setSteps([]);
    let ok = false;
    try {
      const recreating = recreate;
      const brief = withExplainer(prompt.trim() || (recreating ? "Recreate the attached video as closely as possible." : "Make a film from the attached files."));
      const film = filmFor(recreating);
      const treatment = await direct(ac.signal, brief, await collectFiles(recreating), mode === "edit" && !project.builtin, film);
      setPrompt(treatment.trim());
      setEnhanced({ brief, recreate: recreating });
      ok = true;
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      finishSteps(ok);
      setBusy(null);
      abortRef.current = null;
    }
  }

  // ── chat edits for element-based films: the editing agent changes layers and keyframes ──
  const agentEdit = async (request: string, signal: AbortSignal) => {
    if (!project.doc) return;
    phase("Editing the elements");
    const history = [...(project.thread ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text })), { role: "user" as const, text: request }];
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: project.doc, time: tRef.current, selection: [], messages: history }),
      signal,
    });
    if (res.status === 401) throw new Error("Sign in to edit films.");
    if (!res.body) throw new Error(`Request failed (${res.status})`);
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
          setBusy((b) => b && { ...b, stream: text });
        } else if (ev.type === "thinking") think(ev.text);
        else if (ev.type === "progress") note(ev.text.trim().slice(0, 140));
        else if (ev.type === "action") note(ev.label);
        else if (ev.type === "done") result = ev;
        else if (ev.type === "error") {
          if (ev.doc) result = { doc: ev.doc, changes: 1 };
          else throw new Error(ev.message);
        }
      }
    }
    const now = nowMs();
    const userMsg: Msg = { id: uid(), role: "user", text: request, at: now };
    const changed = !!result?.doc && (result.changes ?? 0) > 0;
    const botMsg: Msg = { id: uid(), role: "assistant", text: text.trim() || (changed ? "Updated the film." : "No change was needed."), at: now + 1, docBefore: changed ? project.doc : undefined };
    const thread = [...(project.thread ?? []), userMsg, botMsg];
    const keep = thread.filter((m) => m.docBefore).slice(-3);
    for (const m of thread) if (m.docBefore && !keep.includes(m)) delete m.docBefore;
    const nextDoc = changed ? Doc.parse(result!.doc) : project.doc;
    upsert({ ...project, doc: nextDoc, duration: nextDoc.meta.duration, thread }, true);
    if (result?.seek !== undefined) tRef.current = Math.min(result.seek, nextDoc.meta.duration);
    setPrompt("");
  };

  // ── stage 2: animate ──
  async function generate() {
    if (!prompt.trim() && !files.length && !videos.length) return;
    const editing = mode === "edit";
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setSteps([]);
    let ok = false;
    try {
      const recreating = enhanced?.recreate ?? recreate;
      const film = filmFor(recreating);
      const [fw, fh] = SIZES[film.aspect];
      const payloadFiles = await collectFiles(recreating);
      const brief = enhanced?.brief ?? withExplainer(prompt.trim() || (recreating ? "Recreate the attached video as closely as possible." : "Make a film from the attached files."));
      // Small edits go straight to the animator; new films always get a treatment first.
      // Chat edits on an element-based film go through the editing agent (layers + keyframes), not the code animator.
      if (editing && project.doc) {
        await agentEdit(prompt.trim(), ac.signal);
        ok = true;
        return;
      }
      const treatment = enhanced ? prompt.trim() : editing ? undefined : await direct(ac.signal, brief, payloadFiles, false, film);

      // Recreations are stripped into editable elements; the animator then draws only the leftovers.
      let elementsPlan: ElementsPlan | null = null;
      if (film.recreate && !editing && treatment) {
        phase("Stripping the video into elements");
        const er = await fetch("/api/elements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ breakdown: treatment, duration: film.duration, aspect: film.aspect, w: fw, h: fh, files: payloadFiles.filter((f) => (f as { kind: string }).kind === "image") }),
          signal: ac.signal,
        });
        const ej = await er.json();
        if (er.ok && ej.elements) {
          elementsPlan = ej as ElementsPlan;
          note(`${elementsPlan.elements.length} elements: ${elementsPlan.elements.slice(0, 6).map((e) => e.name).join(", ")}${elementsPlan.elements.length > 6 ? "…" : ""}`);
        } else note(`Elements: ${ej.error ?? "unavailable"}; building as one scene`);
      }

      phase(editing ? "Revising the animation" : elementsPlan ? "Drawing what's left by code" : "Animating the scene");
      const onText = (s: string) => setBusy((b) => b && { ...b, stream: s });
      const base = {
        stage: "animate",
        prompt: brief,
        treatment,
        brands,
        recreate: film.recreate,
        duration: film.duration,
        aspect: film.aspect,
        files: payloadFiles,
        previousCode: editing ? project.code : undefined,
        history: editing ? (project.thread ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text })) : undefined,
        notes: elementsPlan ? elementsSummary(elementsPlan) : undefined,
      };
      const resumed = (n: number) => {
        note(`Hit the time limit; continuing from where it stopped (${n})`);
        phase("Continuing the scene");
      };
      let reply = parseScene(await animateStage(base, ac.signal, onText, think, resumed));
      if (!reply.code) throw new Error("Claude didn't return a scene. Try rephrasing the brief.");

      // Dry-run across the timeline; ask for one repair if it throws.
      const check = (code: string) => {
        try {
          return probeScene(compileScene(code), fonts!, fw, fh, assets, film.duration);
        } catch (e) {
          return `Syntax error: ${(e as Error).message}`;
        }
      };
      phase("Checking every frame");
      const problem = check(reply.code);
      const id = editing && !project.builtin ? project.id : uid();
      const docFor = (code: string) => (elementsPlan ? elementsToDoc(elementsPlan, { id, title: reply.title || "Recreation", w: fw, h: fh, duration: film.duration, code }) : undefined);
      if (problem) {
        note(problem);
        phase("Fixing a runtime error");
        const fixed = parseScene(await streamStage({ ...base, previousCode: reply.code, error: problem, files: [] }, ac.signal, onText, undefined, think));
        if (fixed.code) reply = { ...reply, code: fixed.code };
      }

      // Claude watches its own frames: score the stills, fix the worst problems, up to two rounds.
      if (!editing) {
        const sceneOf = (code: string) => (elementsPlan ? docScene(docFor(code)!) : compileScene(code));
        for (let round = 1; round <= 2; round++) {
          phase(round === 1 ? "Looking at its own frames" : "Looking again");
          const n = Math.min(24, Math.max(8, Math.round(film.duration)));
          const times = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * film.duration);
          const scene = sceneOf(reply.code);
          const sheet = contactSheet(scene, fonts!, fw, fh, assets, film.duration, times, 320, 4);
          const phone = contactSheet(scene, fonts!, fw, fh, assets, film.duration, times.filter((_, i) => i % 2 === 0), 200, 6);
          const cr = await fetch("/api/critique", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ images: [{ name: "Contact sheet (in order)", data: sheet }, { name: "Phone-width strip", data: phone }], treatment, duration: film.duration, aspect: film.aspect }),
            signal: ac.signal,
          });
          const cj = await cr.json();
          if (!cr.ok) {
            note(`Review skipped: ${cj.error}`);
            break;
          }
          const scores = cj.scores as Record<string, number>;
          note(`Scores · ${Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
          const worst = (cj.problems as { t: number; issue: string; fix: string }[]).slice(0, 3);
          const low = Math.min(...Object.entries(scores).filter(([k]) => k !== "sound").map(([, v]) => v));
          if (low >= 8 || !worst.length) {
            note(cj.verdict);
            break;
          }
          worst.forEach((p) => note(`${p.t.toFixed(1)}s · ${p.issue}`));
          phase(`Fixing the ${worst.length} worst problem${worst.length > 1 ? "s" : ""}`);
          try {
            const fixed = parseScene(
              await animateStage(
                { ...base, previousCode: reply.code, critique: worst.map((p) => `- at ${p.t.toFixed(1)}s: ${p.issue} → ${p.fix}`).join("\n"), files: [] },
                ac.signal,
                onText,
                think,
                resumed,
              ),
            );
            if (fixed.code && !check(fixed.code)) reply = { ...reply, code: fixed.code };
            else note("The fix didn't pass the frame check; keeping the previous version");
          } catch (e) {
            if ((e as Error).name === "AbortError") throw e;
            // A failed fix never costs the film.
            note(`Fix pass failed (${(e as Error).message.slice(0, 80)}); keeping the previous version`);
            break;
          }
        }
      }

      const prev = editing && !project.builtin ? project : null;
      const assetFiles = files.filter((f) => f.kind === "image" && f.asset);
      let assetRefs = prev?.assets ?? [];
      if (cloud && userId && assetFiles.length) {
        phase("Saving your images");
        const up = await Promise.all(
          assetFiles.map((f) =>
            upload(`users/${userId}/assets/${id}/${f.name}`, f.file, { access: "private", handleUploadUrl: "/api/upload" }).then(
              (b) => ({ name: f.name, pathname: b.pathname }),
            ),
          ),
        );
        assetRefs = [...assetRefs.filter((a) => !up.some((u) => u.name === a.name)), ...up];
      }

      const title = reply.title || prev?.title || brief.slice(0, 40) || "Untitled";
      const now = nowMs();
      const userMsg: Msg = { id: uid(), role: "user", text: prompt.trim() || brief, at: now };
      const botMsg: Msg = {
        id: uid(),
        role: "assistant",
        text: reply.note || (editing ? "Updated the film." : `Built “${title}”.`),
        at: now + 1,
        codeBefore: prev?.code,
      };
      // Keep the last few code snapshots so earlier versions can be restored.
      const thread = [...(prev?.thread ?? []), userMsg, botMsg];
      const keep = thread.filter((m) => m.codeBefore).slice(-5);
      for (const m of thread) if (m.codeBefore && !keep.includes(m)) delete m.codeBefore;

      const p: Project = {
        ...(prev ?? {}),
        id,
        title,
        thread,
        doc: docFor(reply.code) ?? (editing ? prev?.doc : undefined),
        code: reply.code,
        duration: film.duration,
        aspect: film.aspect,
        prompt: brief,
        treatment: treatment ?? prev?.treatment,
        assets: assetRefs,
        videos: prev?.videos ?? [],
        builtin: false,
        createdAt: prev?.createdAt ?? nowMs(),
      };
      let saved = p;
      if (film.recreate && pendingStems.current) {
        phase("Saving the original's sound elements");
        const { clips: stemClips, blobs: stemBlobs, transcript } = pendingStems.current;
        pendingStems.current = null;
        setAudioBlobs((m) => ({ ...m, ...stemBlobs }));
        const stored = await Promise.all(stemClips.map((c) => storeClipBlob(p.id, c, stemBlobs[c.id])));
        saved = { ...p, audio: stored };
        upsert(saved, true);
        setCurrentId(saved.id);
        setMode("edit");
        setPrompt("");
        setEnhanced(null);
        tRef.current = 0;
        setPlaying(true);
        ok = true;
        clearAttachments();
        // Rebuild the original's sound effects on top of its stems.
        await scoreFilm(saved, { recreate: true, transcript, hasBackground: stored.some((c) => c.kind === "background") });
      } else {
        upsert(p, true);
        setCurrentId(p.id);
        setMode("edit");
        setPrompt("");
        setEnhanced(null);
        tRef.current = 0;
        setPlaying(true);
        ok = true;
        clearAttachments();
        // Every new film gets a soundtrack; edits keep the one they have.
        if (!editing && isSignedIn) await scoreFilm(p);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      finishSteps(ok);
      setBusy(null);
      abortRef.current = null;
    }
  }

  // ── sound: clips, uploads, stems, scoring ──
  const audioExt = (type: string) => (type.includes("wav") ? "wav" : type.includes("mpeg") || type.includes("mp3") ? "mp3" : type.includes("ogg") ? "ogg" : type.includes("webm") ? "webm" : "m4a");

  // Persist a clip's audio (private Blob when signed in; memory otherwise).
  const storeClipBlob = async (projectId: string, clip: AudioClip, blob: Blob): Promise<AudioClip> => {
    setAudioBlobs((m) => ({ ...m, [clip.id]: blob }));
    if (!cloud || !userId) return clip;
    const res = await upload(`users/${userId}/audio/${projectId}/${clip.id}.${audioExt(blob.type)}`, blob, { access: "private", handleUploadUrl: "/api/upload", contentType: blob.type || "audio/mpeg" });
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
          f.append("audio", toWav(buf, true), "voice.wav");
          const r = await fetch("/api/audio", { method: "POST", body: f });
          if (r.ok) {
            const j = await r.json();
            if (j.words?.length) {
              clip.words = j.words;
              clip.text = j.text;
            }
          }
        }
        added.push(await storeClipBlob(project.id, clip, file));
      }
      upsert({ ...project, audio: [...clips, ...added] }, true);
    } catch (e) {
      setError(`Couldn't read that audio: ${(e as Error).message}`);
    } finally {
      setAudioBusy(null);
    }
  };

  // Pull the audio out of a reference video: original, isolated voice, background (= original − voice), transcript.
  const extractStems = async (videoBlobUrl: string, duration: number) => {
    const blob = await (await fetch(videoBlobUrl)).blob();
    let original: AudioBuffer;
    try {
      original = await decodeAudio(blob);
    } catch {
      return null; // no audio track
    }
    if (original.duration < 0.5) return null;
    const wav = toWav(original, original.numberOfChannels === 1);
    const fd = (action: string) => {
      const f = new FormData();
      f.append("action", action);
      f.append("audio", wav, "audio.wav");
      return f;
    };
    note("Separating voice from background");
    const [isoRes, sttRes] = await Promise.all([
      fetch("/api/audio", { method: "POST", body: fd("isolate") }),
      fetch("/api/audio", { method: "POST", body: fd("transcribe") }),
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
      note(hasSpeech ? `Transcribed ${words.length} words` : "No speech found");
      const bg = await subtractAligned(original, voiceBuf);
      if (bg) {
        const b: AudioClip = { id: uid(), kind: "background", label: "Original background (music + ambience)", start: 0, duration: len, gain: 1, muted: false, source: "original" };
        blobs[b.id] = toWav(bg);
        out.push(b);
        note("Background stem ready");
      }
    } else {
      origClip.muted = false;
      note("Voice separation unavailable; keeping the original mix");
    }
    const transcript = (stt.words as { w: string; s: number; e: number }[])?.length
      ? (stt.words as { w: string; s: number; e: number }[]).map((w) => `${w.w}[${w.s.toFixed(2)}]`).join(" ")
      : stt.text || undefined;
    return { clips: out, blobs, transcript };
  };

  // Score the film: plan with Claude, then generate voice / sfx / music with ElevenLabs.
  const scoreFilm = async (target: Project = project, opts: { recreate?: boolean; transcript?: string; hasBackground?: boolean } = {}) => {
    if (target.builtin) return setNotice("Make your own film first; the example can't be changed.");
    // A film built from a reference video keeps the original's voice and background; re-scoring only redoes the effects.
    const stems = (target.audio ?? []).filter((c) => c.source === "original");
    if (stems.length && !opts.recreate) {
      const voice = stems.find((c) => c.kind === "voice");
      opts = {
        recreate: true,
        transcript: voice?.words?.length ? voice.words.map((w) => `${w.w}[${w.s.toFixed(2)}]`).join(" ") : voice?.text,
        hasBackground: stems.some((c) => c.kind === "background"),
      };
    }
    setAudioBusy("Planning the sound…");
    phase("Planning the sound design");
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
          grid: (() => {
            const m = (target.audio ?? []).find((c) => c.kind === "music" && c.beats);
            return m?.beats ? `Music grid: ${Math.round(m.beats.bpm)} BPM; downbeats at ${m.beats.downbeats.slice(0, 16).map((t) => (t + m.start).toFixed(2)).join(", ")}s. Place cues on beats or downbeats.` : undefined;
          })(),
        }),
      });
      let plan = await r.json();
      if (!r.ok) throw new Error(plan.error ?? "Couldn't plan the sound.");
      // A degenerate plan (no cues, placeholder notes) is worth one more try.
      if (!plan.sfx?.length && !plan.voice?.length) {
        note("Plan came back empty; trying again");
        const r2 = await fetch("/api/audio-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief: target.prompt, treatment: target.treatment, duration: target.duration, aspect: target.aspect, recreate: !!opts.recreate, transcript: opts.transcript, hasBackground: !!opts.hasBackground }),
        });
        if (r2.ok) plan = await r2.json();
      }
      note(plan.notes);
      if (plan.musicGuess) {
        const q = encodeURIComponent(`${plan.musicGuess.title} ${plan.musicGuess.artist}`);
        note(`Music sounds like “${plan.musicGuess.title}” by ${plan.musicGuess.artist} (${plan.musicGuess.confidence} confidence) · youtube.com/results?search_query=${q}`);
      }
      const T = target.duration;
      const made: AudioClip[] = [];
      const blobsNew: Record<string, Blob> = {};
      const b64blob = (b64: string, type: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

      // Voice, line by line (skipped in recreate mode when the original voice exists).
      const voiceLines = opts.recreate && opts.transcript ? [] : (plan.voice as { p: number; text: string }[]);
      for (let i = 0; i < voiceLines.length; i++) {
        const line = voiceLines[i];
        setAudioBusy(`Voicing line ${i + 1} of ${voiceLines.length}…`);
        const vr = await fetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "tts", text: line.text }) });
        const vj = await vr.json();
        if (!vr.ok) {
          note(`Voice: ${vj.error}`);
          break;
        }
        const blob = b64blob(vj.audio, "audio/mpeg");
        const buf = await decodeAudio(blob);
        const start = Math.max(0, Math.min(T - 0.1, line.p * T));
        const clip: AudioClip = { id: uid(), kind: "voice", label: `VO ${i + 1}`, start, duration: buf.duration, gain: 1, muted: false, source: "generated", text: line.text, words: (vj.words as { w: string; s: number; e: number }[]).map((w) => ({ w: w.w, s: start + w.s, e: start + w.e })) };
        blobsNew[clip.id] = blob;
        made.push(clip);
      }
      if (voiceLines.length) note(`${made.length} voice line${made.length === 1 ? "" : "s"}`);

      // Sound effects, a few at a time (ElevenLabs allows 4 concurrent requests on small plans).
      const cues = plan.sfx as { p: number; prompt: string; seconds: number; gain: number }[];
      setAudioBusy(`Making ${cues.length} sound effects…`);
      const sfx: (AudioClip | null)[] = new Array(cues.length).fill(null);
      let cursor = 0;
      const worker = async () => {
        while (cursor < cues.length) {
          const i = cursor++;
          const cue = cues[i];
          const ask = () => fetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sfx", prompt: cue.prompt, seconds: Math.min(6, Math.max(0.5, cue.seconds)) }) });
          let sr = await ask();
          for (let attempt = 0; !sr.ok && attempt < 2; attempt++) {
            await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
            sr = await ask();
          }
          if (!sr.ok) {
            note(`SFX ${i + 1} failed: ${(await sr.json().catch(() => ({}))).error ?? sr.status}`);
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
      note(`${fx.length} sound effects`);

      // Music (paid ElevenLabs plans). Skipped in recreate mode when the original background exists.
      if (plan.music && !(opts.recreate && opts.hasBackground)) {
        setAudioBusy("Composing music…");
        const mr = await fetch("/api/audio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "music", prompt: plan.music.prompt, seconds: T }) });
        if (mr.ok) {
          const blob = await mr.blob();
          const buf = await decodeAudio(blob);
          const clip: AudioClip = { id: uid(), kind: "music", label: "Music", start: 0, duration: Math.min(buf.duration, T), gain: voiceLines.length ? 0.55 : 0.8, muted: false, source: "generated", prompt: plan.music.prompt };
          blobsNew[clip.id] = blob;
          made.push(clip);
          note("Music composed");
        } else {
          const mj = await mr.json().catch(() => ({}));
          note(`Music: ${mj.error ?? "unavailable"}; composing a synthesized bed instead`);
          setAudioBusy("Synthesizing a music bed…");
          const spec = specFromPlan(plan.music.prompt, plan.music.energy ?? "medium", target.id.split("").reduce((a, c) => a + c.charCodeAt(0), 7));
          const buf = await renderBed(spec, T);
          const blob = toWav(buf);
          const grid = bedBeats(spec, T);
          const clip: AudioClip = { id: uid(), kind: "music", label: `Synth bed · ${spec.bpm} BPM`, start: 0, duration: T, gain: voiceLines.length ? 0.5 : 0.7, muted: false, source: "generated", prompt: plan.music.prompt, beats: { ...grid, hits: grid.downbeats } };
          blobsNew[clip.id] = blob;
          made.push(clip);
          note(`Synth bed at ${spec.bpm} BPM, ${spec.mode}`);
        }
      }

      // Snap effects to the music's beat grid (an uploaded track's detected beats, or the bed's).
      const gridClip = [...made, ...(target.audio ?? [])].find((c) => c.kind === "music" && c.beats && !c.muted);
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
        if (snapped) note(`${snapped} cue${snapped === 1 ? "" : "s"} snapped to the beat`);
      }

      setAudioBusy("Saving sound…");
      setAudioBlobs((m) => ({ ...m, ...blobsNew }));
      const stored = await Promise.all(made.map((c) => storeClipBlob(target.id, c, blobsNew[c.id])));
      const keepOld = (target.audio ?? []).filter((c) => c.source !== "generated");
      upsert({ ...target, audio: [...keepOld, ...stored] }, true);
      setNotice(`Scored: ${stored.length} sound element${stored.length === 1 ? "" : "s"} added.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAudioBusy(null);
      finishSteps(true);
      setBusy(null);
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
      upsert({ ...project, audio: clips.map((x) => (x.id === id ? stored : x)) }, true);
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
        upsert({ ...project, videos: [render, ...(project.videos ?? [])] }, true);
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
    setMode(id === "gaia" ? "new" : "edit");
    setEnhanced(null);
    setProjectImgs({});
    setError(null);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this animation and its saved videos?")) return;
    setProjects((list) => {
      const next = list.filter((p) => p.id !== id);
      if (!cloud) persist({ ...GAIA, builtin: false, id: "_" }, next);
      return next;
    });
    if (cloud) {
      const gone = projects.find((p) => p.id === id);
      await Promise.all((gone?.videos ?? []).filter((v) => v.shareId).map((v) => fetch(`/api/share?id=${v.shareId}`, { method: "DELETE" }).catch(() => {})));
      await fetch(`/api/projects?id=${id}`, { method: "DELETE" });
    }
    if (id === currentId) setCurrentId("gaia");
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

  const durFill = `${((project.duration - 3) / (90 - 3)) * 100}%`;
  const canAsk = !!prompt.trim() || files.length > 0 || videos.length > 0;

  const stopButton = (
    <button className="primary stop" onClick={() => abortRef.current?.abort()}>
      <span className="stop-square" /> Stop
    </button>
  );
  const animateButton = busy ? stopButton : !isSignedIn ? (
    <SignIn>
      <button className="primary">Sign in to animate</button>
    </SignIn>
  ) : (
    <button className="primary" onClick={generate} disabled={!!busy || !canAsk || !fonts}>
      {recreate || enhanced?.recreate ? "Recreate video" : mode === "new" ? "Animate" : "Send"}
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
          <div ref={stageRef} className={`stage${busy ? " busy" : ""}`}>
            <canvas
              ref={canvasRef}
              style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }}
              onClick={() => setPlaying((p) => !p)}
            />
            <Progress
              steps={steps}
              running={!!busy}
              output={busy?.stream ?? ""}
              onCancel={() => abortRef.current?.abort()}
              onDismiss={() => setSteps([])}
            />
            {shownError && !busy && (
              <div className="error-card">
                <span>{shownError}</span>
                <button className="linkish" onClick={() => setError(null)}>
                  dismiss
                </button>
              </div>
            )}
            {notice && !shownError && !busy && <div className="notice">{notice}</div>}
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

          <div className="section-label lib-head">
            <span className="lib-head-title">
              {cloud ? "Your library" : "On this device"}
              {!cloud && isLoaded && <span> · sign in to keep animations and videos in the cloud</span>}
            </span>
            {projects.some((p) => p.favorite) && (
              <span className="lib-filter">
                <button className={favOnly ? "" : "on"} onClick={() => setFavOnly(false)}>
                  All
                </button>
                <button className={favOnly ? "on" : ""} onClick={() => setFavOnly(true)}>
                  ★ Favorites
                </button>
              </span>
            )}
          </div>
          <div className="library">
            {[...projects]
              .filter((p) => !favOnly || p.favorite)
              // Example first, then favorites, then everything else (newest last).
              .sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || Number(!!b.favorite) - Number(!!a.favorite))
              .map((p) => (
              <button key={p.id} className={`lib-item${p.id === currentId ? " on" : ""}${p.favorite ? " fav" : ""}`} onClick={() => select(p.id)}>
                <div className="lib-title">
                  {!p.builtin && (
                    <span
                      className={`lib-star${p.favorite ? " on" : ""}`}
                      role="button"
                      aria-label={p.favorite ? "Remove from favorites" : "Add to favorites"}
                      title={p.favorite ? "Remove from favorites" : "Add to favorites"}
                      onClick={(e) => {
                        e.stopPropagation();
                        upsert({ ...p, favorite: !p.favorite }, true);
                      }}
                    >
                      {p.favorite ? "★" : "☆"}
                    </span>
                  )}
                  {p.title}
                </div>
                <div className="lib-meta">
                  {p.aspect} · {p.duration}s{p.builtin ? " · example" : ""}
                  {p.videos?.length ? ` · ${p.videos.length} video${p.videos.length > 1 ? "s" : ""}` : ""}
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
            ))}
          </div>

          {project.doc && (
            <div className="elements">
              <div className="section-label lib-head">
                <span>Elements · {project.doc.layers.filter((l) => l.type !== "code").length}</span>
                <a className="linkish" href={`/editor/${project.id}`}>
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
              onScore={() => scoreFilm()}
              onRegenerate={regenerateClip}
              canScore={!!isSignedIn && !project.builtin}
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
              {busy && (
                <div className="thread-msg assistant working">
                  <span className="dot" /> {busy.label}
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
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && isSignedIn) generate();
              }}
              style={enhanced ? { minHeight: 300 } : undefined}
              placeholder={
                mode === "new"
                  ? "Paste a company link, drop a video to recreate, or describe your film: a launch film for our app, start on the logo, three features, end on the URL…"
                  : "Make the intro slower, swap the accent to olive, add our logo at the end…"
              }
            />
            {mode === "new" && (
              <div className="explainer">
                {explainer ? (
                  <>
                    <div className="explainer-head">
                      <span>Explainer brief</span>
                      <button className="linkish" onClick={() => setExplainer(null)}>
                        remove
                      </button>
                    </div>
                    <input value={explainer.audience} onChange={(e) => setExplainer({ ...explainer, audience: e.target.value })} placeholder="Who is it for? e.g. first-time founders" />
                    <input value={explainer.believe} onChange={(e) => setExplainer({ ...explainer, believe: e.target.value })} placeholder="What do they believe today that's wrong or incomplete?" />
                    <input value={explainer.outcome} onChange={(e) => setExplainer({ ...explainer, outcome: e.target.value })} placeholder="After watching they can… (one sentence)" />
                  </>
                ) : (
                  <button className="linkish" onClick={() => setExplainer({ audience: "", believe: "", outcome: "" })}>
                    Make it an explainer ▸
                  </button>
                )}
              </div>
            )}
            {(brands.length > 0 || reading.length > 0 || videos.length > 0) && (
              <div className="brands">
                {videos.map((v) => (
                  <div className="brand-card xref" key={v.id} title={v.text ?? v.name}>
                    {v.poster && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={v.poster} alt="" />
                    )}
                    <div className="brand-text">
                      <b>{v.name}</b>
                      <span>
                        {v.duration.toFixed(1)}s · {v.w}×{v.h} · {recreate ? "will be recreated" : "style reference"} · {v.status}
                      </span>
                    </div>
                    {v.download && (
                      <a className="linkish" href={v.download} title="Download the original video">
                        Download
                      </a>
                    )}
                    <button className="chip-x" aria-label="Remove video" onClick={() => removeVideo(v.id)}>
                      ×
                    </button>
                  </div>
                ))}
                {reading.map((h) => (
                  <div className="brand-card loading" key={`r-${h}`}>
                    <span className="dot" /> Reading {h}…
                  </div>
                ))}
                {brands.map((b) => (
                  <div className="brand-card" key={b.host} title={b.description}>
                    <div className="brand-swatches">
                      {(b.themeColor ? [b.themeColor, ...b.colors] : b.colors).slice(0, 6).map((c, i) => (
                        <span key={c + i} style={{ background: c }} />
                      ))}
                    </div>
                    <div className="brand-text">
                      <b>{b.name}</b>
                      <span>{b.host} · Claude will research this</span>
                    </div>
                    <button className="chip-x" aria-label={`Remove ${b.name}`} onClick={() => setBrands((l) => l.filter((x) => x.host !== b.host))}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="chips">
                {files.map((f) => (
                  <span className="chip" key={f.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {f.url ? <img src={f.url} alt="" /> : <span className="ficon">{f.kind === "pdf" ? "PDF" : "TXT"}</span>}
                    <span className="chip-name" title={f.name}>
                      {f.name}
                    </span>
                    {f.kind === "image" && (
                      <button
                        className={`chip-role${f.asset ? " asset" : ""}`}
                        title="Toggle: draw this image in the video, or use it only as a style reference"
                        onClick={() => setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, asset: !x.asset } : x)))}
                      >
                        {f.asset ? "in video" : "reference"}
                      </button>
                    )}
                    <button className="chip-x" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-bar">
              <button className="attach" onClick={() => fileInput.current?.click()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Add, drop or paste files
              </button>
              {isSignedIn && !enhanced && (
                <button
                  className="attach enhance"
                  onClick={enhance}
                  disabled={!!busy || !canAsk}
                  title="Expand your brief into a full creative treatment you can edit"
                >
                  ✦ Enhance
                </button>
              )}
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

          {animateButton}
          {(recreate || enhanced?.recreate) && videos[0] && (
            <p className="hint recreate-hint">
              No brief, so animate will recreate this video as closely as it can: {filmFor(true).duration}s · {filmFor(true).aspect}. Type a brief
              instead to use it only as a style reference. Live footage is approximated with shapes; make sure you have the rights to publish a copy.
            </p>
          )}

          <div className="divider" />

          <div className="field">
            <div className="label">
              Length <b>{project.duration}s</b>
            </div>
            <input
              type="range"
              min={3}
              max={90}
              step={1}
              value={project.duration}
              style={{ ["--fill" as string]: durFill }}
              onChange={(e) => setDuration(+e.target.value)}
              aria-label="Length in seconds"
            />
            <span className="hint">Re-times the whole film, no regeneration needed.</span>
          </div>

          <div className="row">
            <div className="field">
              <div className="label">Format</div>
              <div className="seg">
                {(["16:9", "9:16", "1:1"] as Aspect[]).map((a) => (
                  <button key={a} className={project.aspect === a ? "on" : ""} onClick={() => updateProject({ aspect: a })}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="label">Frame rate</div>
              <div className="seg">
                {[30, 60].map((f) => (
                  <button key={f} className={fps === f ? "on" : ""} onClick={() => setFps(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button className="secondary" onClick={doExport} disabled={exporting !== null || !compiled.fn || !!busy}>
            {exporting && <span className="progress-fill" style={{ width: `${exporting.k * 100}%` }} />}
            <span>
              {exporting
                ? `${exporting.label} ${Math.round(exporting.k * 100)}%`
                : `Export MP4 · ${W}×${H}${cloud && !project.builtin ? " · saves to library" : ""}`}
            </span>
          </button>

          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <button
              className="linkish"
              onClick={() => {
                setDraftCode(project.code);
                setShowCode((s) => !s);
              }}
            >
              {showCode ? "Hide scene code" : "View scene code"}
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
            <a className="linkish" href={`/editor/${project.id}`}>
              Open in editor →
            </a>
          </div>

          {showCode && (
            <div className="code">
              <textarea value={draftCode} onChange={(e) => setDraftCode(e.target.value)} spellCheck={false} />
              <div className="code-bar">
                <span className="hint">Pure function of t. Runs every frame.</span>
                <button
                  className="linkish"
                  onClick={() => {
                    if (project.builtin) {
                      const p = { ...project, id: uid(), builtin: false, title: project.title + " (copy)", code: draftCode, createdAt: Date.now() };
                      upsert(p, true);
                      setCurrentId(p.id);
                    } else updateProject({ code: draftCode });
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
