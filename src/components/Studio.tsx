"use client";

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

type Project = {
  id: string;
  title: string;
  code: string;
  duration: number;
  aspect: Aspect;
  prompt?: string;
  builtin?: boolean;
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

const STORE = "animate.projects.v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|html|css|js|jsx|ts|tsx|py|yaml|yml|xml|srt|vtt)$/i;

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

function parseReply(text: string) {
  const title = text.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
  const blocks = [...text.matchAll(/```(?:js|javascript)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const code = blocks.sort((a, b) => b.length - a.length)[0];
  return { title, code };
}

export default function Studio() {
  const [projects, setProjects] = useState<Project[]>([GAIA]);
  const [currentId, setCurrentId] = useState("gaia");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"new" | "edit">("new");
  const [files, setFiles] = useState<Attached[]>([]);
  const [fps, setFps] = useState(30);
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [busy, setBusy] = useState<null | { label: string; stream: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [draftCode, setDraftCode] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tRef = useRef(0);
  const playingRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const project = projects.find((p) => p.id === currentId) ?? GAIA;
  const [W, H] = SIZES[project.aspect];

  // ── persistence ──
  useEffect(() => {
    loadFonts().then((f) => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORE) || "[]") as Project[];
        if (saved.length) setProjects([GAIA, ...saved]);
      } catch {}
      setFonts(f);
    });
  }, []);

  const persist = useCallback((list: Project[]) => {
    try {
      localStorage.setItem(STORE, JSON.stringify(list.filter((p) => !p.builtin)));
    } catch {}
  }, []);

  const updateProject = useCallback(
    (patch: Partial<Project>) => {
      setProjects((list) => {
        const next = list.map((p) => (p.id === currentId ? { ...p, ...patch } : p));
        persist(next);
        return next;
      });
    },
    [currentId, persist],
  );

  // ── scene ──
  const compiled = useMemo<{ fn: SceneFn | null; err: string | null }>(() => {
    try {
      return { fn: compileScene(project.code), err: null };
    } catch (e) {
      return { fn: null, err: (e as Error).message };
    }
  }, [project.code]);

  const assets = useMemo<Assets>(() => {
    const images = files.filter((f) => f.img && f.asset).map((f) => ({ name: f.name, img: f.img! }));
    return { images, byName: Object.fromEntries(images.map((i) => [i.name, i.img])) };
  }, [files]);

  // Fit the canvas inside the stage for any aspect ratio.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const pad = 48;
      const aw = el.clientWidth - pad;
      const ah = el.clientHeight - pad;
      const s = Math.min(aw / W, ah / H);
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
    setError(compiled.err);
    raf = requestAnimationFrame(frame);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [compiled, fonts, W, H, project.duration, assets]);

  // ── files ──
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const added: Attached[] = [];
    const skipped: string[] = [];
    for (const file of Array.from(list)) {
      const kind = kindOf(file);
      if (!kind) {
        skipped.push(file.name);
        continue;
      }
      const a: Attached = { id: uid(), name: file.name, kind, file, asset: kind === "image" };
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
    if (skipped.length) setError(`Skipped unsupported files: ${skipped.join(", ")}. Use images, PDFs or text.`);
  }, []);

  const removeFile = (id: string) =>
    setFiles((list) => {
      const f = list.find((x) => x.id === id);
      if (f?.url) URL.revokeObjectURL(f.url);
      return list.filter((x) => x.id !== id);
    });

  // ── generation ──
  async function requestScene(payload: object, signal: AbortSignal, onText: (s: string) => void) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
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
        } else if (ev.type === "error") throw new Error(ev.message);
      }
    }
    return text;
  }

  async function generate() {
    if (!prompt.trim() && !files.length) return;
    const editing = mode === "edit";
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setBusy({ label: editing ? "Revising your animation" : "Composing your animation", stream: "" });
    try {
      const payloadFiles = await Promise.all(
        files.map(async (f) => {
          if (f.kind === "image") return { kind: "image", name: f.name, asset: f.asset, ...imagePayload(f.img!, f.file.type) };
          if (f.kind === "pdf") return { kind: "pdf", name: f.name, data: await b64(f.file) };
          return { kind: "text", name: f.name, text: (await f.file.text()).slice(0, 200_000) };
        }),
      );
      const base = {
        prompt: prompt.trim() || "Make an animation from the attached files.",
        duration: project.duration,
        aspect: project.aspect,
        files: payloadFiles,
        previousCode: editing ? project.code : undefined,
      };
      const onText = (s: string) => setBusy((b) => b && { ...b, stream: s });
      let reply = parseReply(await requestScene(base, ac.signal, onText));
      if (!reply.code) throw new Error("Claude didn't return a scene. Try rephrasing the brief.");

      // Dry-run the scene across the timeline; ask for one repair if it throws.
      const [w, h] = SIZES[project.aspect];
      const check = (code: string) => {
        try {
          return probeScene(compileScene(code), fonts!, w, h, assets, project.duration);
        } catch (e) {
          return `Syntax error: ${(e as Error).message}`;
        }
      };
      const problem = check(reply.code);
      if (problem) {
        setBusy({ label: "Fixing a runtime error", stream: "" });
        const fixed = parseReply(
          await requestScene({ ...base, previousCode: reply.code, error: problem, files: [] }, ac.signal, onText),
        );
        if (fixed.code) reply = { title: reply.title, code: fixed.code };
      }

      const p: Project = {
        id: editing && !project.builtin ? project.id : uid(),
        title: reply.title || (editing ? project.title : prompt.trim().slice(0, 40) || "Untitled"),
        code: reply.code,
        duration: project.duration,
        aspect: project.aspect,
        prompt: base.prompt,
        createdAt: Date.now(),
      };
      setProjects((list) => {
        const next = list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
        persist(next);
        return next;
      });
      setCurrentId(p.id);
      setMode("edit");
      setPrompt("");
      tRef.current = 0;
      setPlaying(true);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  // ── export ──
  async function doExport() {
    if (!compiled.fn || !fonts) return;
    setExporting(0);
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
        onProgress: setExporting,
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${project.title.replace(/[^\w\- ]+/g, "").trim() || "animation"}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setExporting(null);
    }
  }

  const setDuration = (d: number) => {
    const p = tRef.current / project.duration;
    tRef.current = p * d;
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
    setMode("edit");
  };

  const remove = (id: string) => {
    setProjects((list) => {
      const next = list.filter((p) => p.id !== id);
      persist(next);
      return next;
    });
    if (id === currentId) setCurrentId("gaia");
  };

  // keyboard: space toggles playback outside of inputs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === "Space" && tag !== "TEXTAREA" && tag !== "INPUT") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const streamTail = busy?.stream ? busy.stream.split("\n").slice(-14).join("\n") : "";
  const durFill = `${((project.duration - 3) / (90 - 3)) * 100}%`;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark" />
          animate
        </div>
        <div className="top-meta">{project.title}</div>
      </header>

      <main className="main">
        <section className="stage-wrap">
          <div ref={stageRef} className={`stage${busy ? " busy" : ""}`}>
            <canvas
              ref={canvasRef}
              style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }}
              onClick={() => setPlaying((p) => !p)}
            />
            {busy && (
              <>
                <div className="status">
                  <span className="dot" />
                  {busy.label}
                  {busy.stream && <span style={{ color: "var(--stone)" }}>· {busy.stream.length.toLocaleString()} chars</span>}
                  <button className="linkish" onClick={() => abortRef.current?.abort()}>
                    cancel
                  </button>
                </div>
                <div className="stream">{streamTail}</div>
              </>
            )}
            {error && !busy && (
              <div className="error-card">
                <span>{error}</span>
                <button className="linkish" onClick={() => setError(null)}>
                  dismiss
                </button>
              </div>
            )}
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

          <div className="library">
            {projects.map((p) => (
              <button key={p.id} className={`lib-item${p.id === currentId ? " on" : ""}`} onClick={() => select(p.id)}>
                <div className="lib-title">{p.title}</div>
                <div className="lib-meta">
                  {p.aspect} · {p.duration}s{p.builtin ? " · example" : ""}
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
        </section>

        <aside className="panel">
          <h1 className="headline">
            Describe it. Drop in your files. <em>Get a film.</em>
          </h1>

          <div className="field">
            <div className="seg">
              <button className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
                New animation
              </button>
              <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>
                Edit this one
              </button>
            </div>
          </div>

          <div
            className={`composer${drag ? " drag" : ""}`}
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
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
              }}
              placeholder={
                mode === "new"
                  ? "A launch film for our app: start on the logo, three features, end on the URL…"
                  : "Make the intro slower, swap the accent to olive, add our logo at the end…"
              }
            />
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
                Files & references
              </button>
              <span className="hint">⌘↵</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept="image/*,application/pdf,text/*,.md,.json,.csv"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <button className="primary" onClick={generate} disabled={!!busy || (!prompt.trim() && !files.length) || !fonts}>
            {busy ? "Animating…" : mode === "new" ? "Animate" : "Apply changes"}
          </button>

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
            {exporting !== null && <span className="progress-fill" style={{ width: `${exporting * 100}%` }} />}
            <span>{exporting !== null ? `Rendering ${Math.round(exporting * 100)}%` : `Export MP4 · ${W}×${H}`}</span>
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
            {project.builtin && <span className="hint">Example · edits save as a copy</span>}
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
                      setProjects((l) => {
                        const next = [...l, p];
                        persist(next);
                        return next;
                      });
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
