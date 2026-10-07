"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { exportVideo, loadFonts } from "@/lib/engine";
import { makeKit, type Fonts } from "@/lib/kit";
import { propAt } from "../doc/interpolate";
import { addKeyframe, removeKeyframes, removeLayers, renameLayer, setProp } from "../doc/ops";
import { Doc, type Layer, type Value } from "../doc/schema";
import { buildGaiaDoc } from "../presets/gaiaDoc";
import { docScene, renderDoc, type Bounds } from "../render/renderDoc";
import { createEditorStore } from "../store/store";
import AgentPanel from "./AgentPanel";
import Timeline, { type KeySel } from "./Timeline";
import "./editor.css";

type Store = ReturnType<typeof createEditorStore>;
const EMPTY_ASSETS = { images: [], byName: {} };
const SAVE_KEY = (id: string) => `animate.editor.v1.${id}`;

// ── Loading a doc: Gaia is native; any other saved film opens as one code layer ──
async function loadDoc(id: string): Promise<Doc> {
  try {
    const saved = localStorage.getItem(SAVE_KEY(id));
    if (saved) return Doc.parse(JSON.parse(saved));
  } catch {}
  if (id === "gaia") return buildGaiaDoc();
  type P = { id: string; title: string; code: string; duration: number; aspect: string };
  let projects: P[] = [];
  try {
    const r = await fetch("/api/projects");
    if (r.ok) projects = (await r.json()).projects;
  } catch {}
  if (!projects.length) {
    try {
      projects = JSON.parse(localStorage.getItem("animate.projects.v1") || "[]");
    } catch {}
  }
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error("Couldn't find that film.");
  const [w, h] = p.aspect === "9:16" ? [1080, 1920] : p.aspect === "1:1" ? [1080, 1080] : [1920, 1080];
  return Doc.parse({
    meta: { id: p.id, title: p.title, size: { w, h }, duration: p.duration },
    layers: [{ id: "scene", name: "Scene (code)", type: "code", start: 0, end: p.duration, props: { code: p.code } }],
  });
}

// ── Inspector field descriptors per layer type ──
type Field = { label: string; path: string; kind: "number" | "text" | "color" | "textarea"; step?: number };
const TRANSFORM: Field[] = [
  { label: "X", path: "transform.x", kind: "number" },
  { label: "Y", path: "transform.y", kind: "number" },
  { label: "Rotation", path: "transform.rotation", kind: "number" },
  { label: "Opacity", path: "transform.opacity", kind: "number", step: 0.05 },
];
const BY_TYPE: Partial<Record<Layer["type"], Field[]>> = {
  text: [
    { label: "Text", path: "props.text", kind: "textarea" },
    { label: "Size", path: "props.size", kind: "number" },
    { label: "Color", path: "props.color", kind: "color" },
    { label: "Reveal", path: "props.reveal", kind: "number", step: 0.05 },
    { label: "Number", path: "props.number", kind: "number" },
  ],
  shape: [
    { label: "Width", path: "props.w", kind: "number" },
    { label: "Height", path: "props.h", kind: "number" },
    { label: "Fill", path: "props.fill", kind: "color" },
    { label: "Stroke", path: "props.stroke", kind: "color" },
    { label: "Draw", path: "props.trim", kind: "number", step: 0.05 },
  ],
  globe: [
    { label: "Radius", path: "props.R", kind: "number" },
    { label: "Longitude", path: "props.rot", kind: "number" },
    { label: "Tilt", path: "props.tilt", kind: "number" },
    { label: "Draw", path: "props.draw", kind: "number", step: 0.05 },
  ],
  waveform: [
    { label: "Width", path: "props.w", kind: "number" },
    { label: "Height", path: "props.h", kind: "number" },
    { label: "Color", path: "props.color", kind: "color" },
  ],
  code: [{ label: "Code", path: "props.code", kind: "textarea" }],
};

const fmtTime = (t: number, fps: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * fps);
  return `${m}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
};

export default function Editor({ id }: { id: string }) {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDoc(id)
      .then((doc) => {
        if (cancelled) return;
        const st = createEditorStore(doc);
        // Open on a meaningful frame rather than the (often empty) first one.
        st.getState().setTime(Math.min(3, doc.meta.duration * 0.1));
        setStore(() => st);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error)
    return (
      <div className="ed-empty">
        {error} <Link href="/">Back to animate</Link>
      </div>
    );
  if (!store) return <div className="ed-empty">Opening the editor…</div>;
  return <EditorInner store={store} id={id} />;
}

function EditorInner({ store, id }: { store: Store; id: string }) {
  const doc = useStore(store, (s) => s.doc);
  const time = useStore(store, (s) => s.time);
  const selection = useStore(store, (s) => s.selection);
  const canUndo = useStore(store, (s) => s.past.length > 0);
  const canRedo = useStore(store, (s) => s.future.length > 0);
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [playing, setPlaying] = useState(false);
  const [keySel, setKeySel] = useState<KeySel[]>([]);
  const [exporting, setExporting] = useState<number | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [panel, setPanel] = useState<"inspect" | "agent">("inspect");

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boundsRef = useRef<Record<string, Bounds>>({});
  const selBoxRef = useRef<HTMLDivElement>(null);
  const hoverBoxRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(false);
  const hoverRef = useRef<string | null>(null);

  const { w: W, h: H } = doc.meta.size;
  const kit = useMemo(() => (fonts ? makeKit(W, H, fonts) : null), [fonts, W, H]);
  const selected = doc.layers.find((l) => l.id === selection[0]) ?? null;

  useEffect(() => {
    loadFonts().then(setFonts);
  }, []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Autosave locally.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(SAVE_KEY(id), JSON.stringify(doc));
      } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [doc, id]);

  // Fit the canvas in the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = Math.min((el.clientWidth - 40) / W, (el.clientHeight - 40) / H);
      setFit({ w: Math.floor(W * s), h: Math.floor(H * s) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // Render loop: reads the store directly so playback never waits on React.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !kit) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    const place = (el: HTMLDivElement | null, b?: Bounds) => {
      if (!el) return;
      if (!b) {
        el.style.display = "none";
        return;
      }
      const s = canvas.clientWidth / W;
      el.style.display = "block";
      el.style.transform = `translate(${b.x * s}px, ${b.y * s}px)`;
      el.style.width = `${b.w * s}px`;
      el.style.height = `${b.h * s}px`;
    };
    const frame = (now: number) => {
      const st = store.getState();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let t = st.time;
      if (playingRef.current) {
        t = t + dt >= st.doc.meta.duration ? 0 : t + dt;
        st.setTime(t);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      try {
        boundsRef.current = renderDoc(ctx, st.doc, t, kit, EMPTY_ASSETS);
      } catch {
        /* a broken code layer shouldn't stop the editor */
      }
      place(selBoxRef.current, st.selection[0] ? boundsRef.current[st.selection[0]] : undefined);
      place(hoverBoxRef.current, hoverRef.current && hoverRef.current !== st.selection[0] ? boundsRef.current[hoverRef.current] : undefined);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [kit, store, W, H]);

  // ── Canvas: click to select, drag to move ──
  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const hitTest = (x: number, y: number) => {
    const { doc: d } = store.getState();
    for (let i = d.layers.length - 1; i >= 0; i--) {
      const l = d.layers[i];
      const b = boundsRef.current[l.id];
      if (!b || l.locked || l.type === "code") continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return l.id;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const [x, y] = toCanvas(e);
    const hit = hitTest(x, y);
    store.getState().select(hit ? [hit] : []);
    setKeySel([]);
    if (!hit) return;
    const st = store.getState();
    const layer = st.doc.layers.find((l) => l.id === hit)!;
    const ox = propAt(layer, "transform.x", st.time) as number;
    const oy = propAt(layer, "transform.y", st.time) as number;
    const gesture = `move-${hit}-${e.timeStamp}`;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = canvasRef.current!.getBoundingClientRect();
      const nx = ox + ((ev.clientX - e.clientX) / r.width) * W;
      const ny = oy + ((ev.clientY - e.clientY) / r.height) * H;
      const t = store.getState().time;
      store.getState().apply(
        (d) => {
          setProp(hit, "transform.x", Math.round(nx), t)(d);
          setProp(hit, "transform.y", Math.round(ny), t)(d);
        },
        "Move layer",
        { coalesce: gesture },
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = toCanvas(e);
    hoverRef.current = hitTest(x, y);
  };

  // ── Keyboard ──
  const step = useCallback((dt: number) => {
    const st = store.getState();
    st.setTime(Math.round((st.time + dt) * st.doc.meta.fps) / st.doc.meta.fps);
  }, [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const st = store.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (e.key === "ArrowRight") step(e.shiftKey ? 1 : 1 / st.doc.meta.fps);
      else if (e.key === "ArrowLeft") step(e.shiftKey ? -1 : -1 / st.doc.meta.fps);
      else if (e.key === "Home") st.setTime(0);
      else if (e.key === "End") st.setTime(st.doc.meta.duration);
      else if (e.key === "Backspace" || e.key === "Delete") {
        if (keySel.length) {
          st.apply(removeKeyframes(keySel), "Delete keyframes");
          setKeySel([]);
        } else if (st.selection.length) {
          st.apply(removeLayers(st.selection), "Delete layer");
          st.select([]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, keySel, step]);

  // ── Export ──
  const doExport = async () => {
    if (!fonts) return;
    setExporting(0);
    try {
      const { blob, ext } = await exportVideo({
        scene: docScene(store.getState().doc),
        fonts,
        assets: EMPTY_ASSETS,
        W,
        H,
        T: doc.meta.duration,
        fps: doc.meta.fps,
        onProgress: setExporting,
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${doc.meta.title.replace(/[^\w\- ]+/g, "").trim() || "animation"}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally {
      setExporting(null);
    }
  };

  const reset = () => {
    if (!confirm("Discard your edits and restore the original?")) return;
    localStorage.removeItem(SAVE_KEY(id));
    location.reload();
  };

  return (
    <div className="ed">
      <header className="ed-top">
        <div className="ed-top-left">
          <Link href="/" className="brand">
            animate
          </Link>
          <span className="ed-title">{doc.meta.title}</span>
        </div>
        <div className="ed-top-right">
          <button className="ed-btn" disabled={!canUndo} onClick={() => store.getState().undo()} title="Undo (⌘Z)">
            Undo
          </button>
          <button className="ed-btn" disabled={!canRedo} onClick={() => store.getState().redo()} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <button className="ed-btn agent-btn" onClick={() => setPanel((p) => (p === "agent" ? "inspect" : "agent"))}>
            ✦ Ask Claude
          </button>
          <button className="ed-btn" onClick={reset}>
            Reset
          </button>
          <button className="ed-btn primary" onClick={doExport} disabled={exporting !== null || !fonts}>
            {exporting !== null ? `Rendering ${Math.round(exporting * 100)}%` : "Export MP4"}
          </button>
        </div>
      </header>

      <div className="ed-main">
        <div className="ed-stage" ref={stageRef}>
          <div className="ed-canvas-wrap" style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }}>
            <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => (hoverRef.current = null)} />
            <div ref={hoverBoxRef} className="ed-box hover" />
            <div ref={selBoxRef} className="ed-box sel" />
          </div>
        </div>

        <aside className={`ed-inspector${selected || panel === "agent" ? " open" : ""}`}>
          <div className="ed-tabs">
            <button className={panel === "inspect" ? "on" : ""} onClick={() => setPanel("inspect")}>
              Inspect
            </button>
            <button className={panel === "agent" ? "on" : ""} onClick={() => setPanel("agent")}>
              ✦ Agent
            </button>
            <button
              className="ed-sheet-close"
              onClick={() => {
                setPanel("inspect");
                store.getState().select([]);
              }}
            >
              Close
            </button>
          </div>
          <div className="ed-panel-body" hidden={panel !== "agent"}>
            <AgentPanel store={store} />
          </div>
          <div className="ed-panel-body" hidden={panel !== "inspect"}>
          {selected ? (
            <Inspector store={store} layer={selected} time={time} />
          ) : (
            <div className="ed-hint">
              <b>Select something</b>
              <p>Click any element on the canvas or a layer in the timeline.</p>
              <ul>
                <li>
                  <kbd>Space</kbd> play / pause
                </li>
                <li>
                  <kbd>←</kbd> <kbd>→</kbd> step a frame (<kbd>⇧</kbd> one second)
                </li>
                <li>
                  <kbd>⌘Z</kbd> undo · <kbd>⇧⌘Z</kbd> redo
                </li>
                <li>
                  <kbd>⌫</kbd> delete keyframes or layer
                </li>
                <li>Drag clip bars to move · drag their edges to trim · drag ◆ to retime</li>
              </ul>
            </div>
          )}
          </div>
        </aside>
      </div>

      <div className="ed-transport">
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
        <span className="ed-tc">
          {fmtTime(time, doc.meta.fps)} <span>/ {fmtTime(doc.meta.duration, doc.meta.fps)}</span>
        </span>
        <span className="ed-meta">
          {doc.layers.length} layers · {doc.layers.reduce((n, l) => n + Object.values(l.anim).reduce((m, k) => m + k.length, 0), 0)} keyframes · {doc.meta.fps} fps
        </span>
      </div>

      <Timeline store={store} keySel={keySel} setKeySel={setKeySel} />
    </div>
  );
}

function Inspector({ store, layer, time }: { store: Store; layer: Layer; time: number }) {
  const fields = [...TRANSFORM, ...(BY_TYPE[layer.type] ?? [])];
  const apply = store.getState().apply;
  const localT = time - layer.start;

  const keyAt = (path: string) => layer.anim[path]?.find((k) => Math.abs(k.t - localT) < 1 / 120);

  const toggleKey = (f: Field) => {
    const existing = keyAt(f.path);
    if (existing) apply(removeKeyframes([{ layerId: layer.id, path: f.path, keyId: existing.id }]), "Remove keyframe");
    else {
      const v = propAt(layer, f.path, time) as Value;
      apply(addKeyframe(layer.id, f.path, localT, v ?? 0), "Add keyframe");
    }
  };

  return (
    <div className="ed-insp">
      <input
        className="ed-name"
        value={layer.name}
        onChange={(e) => apply(renameLayer(layer.id, e.target.value), "Rename", { coalesce: `rename-${layer.id}` })}
      />
      <div className="ed-type">
        {layer.type} · {layer.start.toFixed(2)}s → {layer.end.toFixed(2)}s
      </div>
      {fields.map((f) => {
        const fallback = f.kind === "color" && (f.path === "props.color" || f.path === "props.fill") ? "#141413" : undefined;
        const raw = propAt(layer, f.path, time) ?? fallback;
        if (raw === undefined && f.path === "props.number") return null;
        const animated = !!layer.anim[f.path]?.length;
        const onKey = !!keyAt(f.path);
        const set = (v: Value) => apply(setProp(layer.id, f.path, v, time), `Edit ${f.label}`, { coalesce: `edit-${layer.id}-${f.path}` });
        return (
          <label className={`ed-field ${f.kind}`} key={f.path}>
            <span className="ed-field-label">
              <button
                className={`ed-stopwatch${animated ? " on" : ""}${onKey ? " key" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  toggleKey(f);
                }}
                title={onKey ? "Remove keyframe here" : "Add keyframe here"}
              >
                ◆
              </button>
              {f.label}
            </span>
            {f.kind === "textarea" ? (
              <textarea value={String(raw ?? "")} onChange={(e) => set(e.target.value)} spellCheck={f.path !== "props.code"} />
            ) : f.kind === "color" ? (
              <span className="ed-color">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(String(raw)) ? String(raw) : "#000000"} onChange={(e) => set(e.target.value)} />
                <input value={String(raw ?? "")} onChange={(e) => set(e.target.value)} />
              </span>
            ) : f.kind === "number" ? (
              <input
                type="number"
                step={f.step ?? 1}
                value={typeof raw === "number" ? +raw.toFixed(3) : ""}
                onChange={(e) => e.target.value !== "" && set(+e.target.value)}
              />
            ) : (
              <input value={String(raw ?? "")} onChange={(e) => set(e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}
