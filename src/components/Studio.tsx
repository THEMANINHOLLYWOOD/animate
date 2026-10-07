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
  assets?: { name: string; pathname: string }[];
  videos?: Render[];
  builtin?: boolean;
  favorite?: boolean;
  share?: { id: string; createdAt: number };
  createdAt: number;
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
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const code = blocks.sort((a, b) => b.length - a.length)[0];
  return { title, code };
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
      else if (ev.type === "error") throw new Error(ev.message);
    }
  }
  return text;
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
      return { fn: compileScene(project.code), err: null };
    } catch (e) {
      return { fn: null, err: (e as Error).message };
    }
  }, [project.code]);

  const assets = useMemo<Assets>(() => {
    const byName: Record<string, HTMLImageElement> = project.assets?.length ? { ...projectImgs } : {};
    for (const f of files) if (f.img && f.asset) byName[f.name] = f.img;
    return { images: Object.entries(byName).map(([name, img]) => ({ name, img })), byName };
  }, [files, projectImgs, project.assets]);

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
      if (playingRef.current) tRef.current = (tRef.current + dt) % T;
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
      const brief = prompt.trim() || (recreating ? "Recreate the attached video as closely as possible." : "Make a film from the attached files.");
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
      const brief = enhanced?.brief ?? (prompt.trim() || (recreating ? "Recreate the attached video as closely as possible." : "Make a film from the attached files."));
      // Small edits go straight to the animator; new films always get a treatment first.
      const treatment = enhanced ? prompt.trim() : editing ? undefined : await direct(ac.signal, brief, payloadFiles, false, film);

      phase(editing ? "Revising the animation" : "Animating the scene");
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
      };
      let reply = parseScene(await streamStage(base, ac.signal, onText, undefined, think));
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
      if (problem) {
        note(problem);
        phase("Fixing a runtime error");
        const fixed = parseScene(await streamStage({ ...base, previousCode: reply.code, error: problem, files: [] }, ac.signal, onText, undefined, think));
        if (fixed.code) reply = { title: reply.title, code: fixed.code };
      }

      const id = editing && !project.builtin ? project.id : uid();
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

      const p: Project = {
        ...(prev ?? {}),
        id,
        title: reply.title || prev?.title || brief.slice(0, 40) || "Untitled",
        code: reply.code,
        duration: film.duration,
        aspect: film.aspect,
        prompt: brief,
        treatment: treatment ?? prev?.treatment,
        assets: assetRefs,
        videos: prev?.videos ?? [],
        builtin: false,
        createdAt: prev?.createdAt ?? Date.now(),
      };
      upsert(p, true);
      setCurrentId(p.id);
      setMode("edit");
      setPrompt("");
      setEnhanced(null);
      tRef.current = 0;
      setPlaying(true);
      ok = true;
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      finishSteps(ok);
      setBusy(null);
      abortRef.current = null;
    }
  }

  // ── export (+ save to library) ──
  async function doExport() {
    if (!compiled.fn || !fonts) return;
    setExporting({ label: "Rendering", k: 0 });
    setError(null);
    try {
      const { blob, ext } = await exportVideo({
        scene: compiled.fn,
        fonts,
        assets,
        W,
        H,
        T: project.duration,
        fps,
        onProgress: (k) => setExporting({ label: "Rendering", k }),
      });
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
    updateProject({ duration: d });
  };

  const seek = (t: number) => {
    tRef.current = t;
    setTime(t);
  };

  const select = (id: string) => {
    setCurrentId(id);
    tRef.current = 0;
    setPlaying(true);
    setShowCode(false);
    setMode(id === "gaia" ? "new" : "edit");
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

  const animateButton = !isSignedIn ? (
    <SignIn>
      <button className="primary">Sign in to animate</button>
    </SignIn>
  ) : (
    <button className="primary" onClick={generate} disabled={!!busy || !canAsk || !fonts}>
      {busy ? "Working…" : recreate || enhanced?.recreate ? "Recreate video" : mode === "new" ? "Animate" : "Apply changes"}
    </button>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark" />
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
          <h1 className="headline">
            Describe it. Drop in your files. <em>Get a film.</em>
          </h1>

          <div className="seg">
            <button className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
              New animation
            </button>
            <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>
              Edit this one
            </button>
          </div>

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
                  ? "Paste a company link, or describe your film: a launch film for our app, start on the logo, three features, end on the URL…"
                  : "Make the intro slower, swap the accent to olive, add our logo at the end…"
              }
            />
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
