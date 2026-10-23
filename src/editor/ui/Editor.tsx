"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useAccount } from "@/components/Account";
import { useFilmAudio } from "@/components/useFilmAudio";
import { decodeAudio, renderMix, type AudioClip } from "@/lib/audio";
import { cuesFromClips } from "@/lib/captions";
import { exportVideo, loadFonts, type SceneFn } from "@/lib/engine";
import { makeKit, type Fonts } from "@/lib/kit";
import { FilmGone, getFilm, onFilmSaved, saveFilmDoc } from "@/lib/library";
import { propAt } from "../doc/interpolate";
import { addKeyframe, keyAt, offsetPropTo, removeKeyframes, removeLayers, renameLayer, setLayerFlags, setProp, setText, unlinkLayer } from "../doc/ops";
import type { Doc, Layer, Value } from "../doc/schema";
import { linkedLayers, splitChildren, splitOwner, splitStatus } from "../doc/split";
import { renderDoc, type Bounds } from "../render/renderDoc";
import { createEditorStore } from "../store/store";
import { splitLive } from "../extract/codeHash";
import { fromUnchecked } from "../extract/legacy";
import { applySplit, splitCodeLayer } from "../extract/splitText";
import AgentPanel from "./AgentPanel";
import { dropLegacy, dropSaved, forkOf, openFilm, rememberFork, showFilmUrl, SPLIT_VERSION, writeSaved, type Session } from "./open";
import { createSaver, type SaveStatus } from "./saver";
import { isTextField, liveKeys, liveSelection, ownsKey, spanTime, unlocked, unlockedKeys, wordsOf, type KeySel } from "./session";
import Timeline from "./Timeline";
import "./editor.css";

type Store = ReturnType<typeof createEditorStore>;

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
// Split text keeps a recording of what its code drew; where it is and how big moves as a whole track.
const MOVES_TRACK = new Set(["transform.x", "transform.y", "transform.rotation", "transform.opacity", "props.size"]);

const fmtTime = (t: number, fps: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * fps);
  return `${m}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
};
const message = (e: unknown) => (e as Error)?.message || String(e);
// A sound clip as playback loads it: from this browser (a guest's), else from its saved file.
async function loadClip(clip: AudioClip, blobs: Record<string, Blob>): Promise<AudioBuffer | undefined> {
  let blob = blobs[clip.id];
  if (!blob && clip.pathname) {
    const r = await fetch(`/api/media?p=${encodeURIComponent(clip.pathname)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    blob = await r.blob();
  }
  return blob ? decodeAudio(blob) : undefined;
}
// A checkbox clicked with the mouse hands the keyboard back to the editor (Space plays, ⌘Z undoes);
// one reached with Tab keeps it.
const handBackKeys = (e: React.FocusEvent<HTMLElement>) => {
  try {
    if (!e.currentTarget.matches(":focus-visible")) e.currentTarget.blur();
  } catch {}
};

export default function Editor({ id }: { id: string }) {
  const { isLoaded, isSignedIn } = useAccount();
  // The film to open, and how many times one was: "use the Studio's version" opens it again.
  const [want, setWant] = useState({ id, n: 0 });
  const [opened, setOpened] = useState<{ store: Store; session: Session; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  // Read when opening, so signing in elsewhere doesn't reopen (and drop) what's being edited.
  const signedIn = useRef(isSignedIn);
  useEffect(() => {
    signedIn.current = isSignedIn;
  }, [isSignedIn]);

  useEffect(() => {
    if (!isLoaded) return;
    // Aborted when the page goes away, which also stops a split in progress.
    const ac = new AbortController();
    // An example this page already made your own (Back to its editor, or a link still naming it) opens
    // as your film: that's where its saves land.
    const to = forkOf(want.id);
    if (to !== want.id) showFilmUrl(want.id, to);
    openFilm(to, signedIn.current, (k) => setProgress(Math.floor(k * 100)), ac.signal)
      .then((session) => {
        if (ac.signal.aborted) return;
        const st = createEditorStore(session.doc);
        // Open on a meaningful frame rather than the (often empty) first one.
        st.getState().setTime(Math.min(3, session.doc.meta.duration * 0.1));
        setOpened({ store: st, session, note: to !== want.id ? "You made this example your own film when you edited it, so that's what opened." : undefined });
      })
      .catch((e) => !ac.signal.aborted && setError(e instanceof FilmGone ? e.message : message(e)));
    return () => ac.abort();
  }, [want, isLoaded]);

  const reopen = useCallback((to: string) => {
    setOpened(null);
    setError(null);
    setProgress(null);
    setWant((w) => ({ id: to, n: w.n + 1 }));
  }, []);

  if (error)
    return (
      <div className="ed-empty">
        {error} <Link href="/">Back to animate</Link>
      </div>
    );
  if (!opened)
    return (
      <div className="ed-empty">
        {progress === null ? (
          "Opening the editor…"
        ) : (
          <div className="ed-loading" role="status">
            Making text editable… {progress}%
            <span className="ed-progress">
              <i style={{ width: `${progress}%` }} />
            </span>
          </div>
        )}
      </div>
    );
  return <EditorInner key={want.n} store={opened.store} session={opened.session} note={opened.note} onReopen={reopen} />;
}

function EditorInner({ store, session, note, onReopen }: { store: Store; session: Session; note?: string; onReopen: (id: string) => void }) {
  const router = useRouter();
  const doc = useStore(store, (s) => s.doc);
  const selection = useStore(store, (s) => s.selection);
  const canUndo = useStore(store, (s) => s.past.length > 0);
  const canRedo = useStore(store, (s) => s.future.length > 0);
  const [fonts, setFonts] = useState<Fonts | null>(null);
  const [playing, setPlaying] = useState(false);
  const [keySel, setKeySel] = useState<KeySel[]>([]);
  const [exporting, setExporting] = useState<number | null>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [panel, setPanel] = useState<"inspect" | "agent">("inspect");
  const [notice, setNotice] = useState<string | null>(note ?? null);
  const [resplitting, setResplitting] = useState<number | null>(null);
  const [earlier, setEarlier] = useState(session.earlier);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [burnCaptions, setBurnCaptions] = useState(true);
  // The film being edited: an example becomes a film of your own on its first save.
  const [film, setFilm] = useState({ id: session.film.id, title: session.film.title });
  const [save, setSave] = useState<SaveStatus>(() => (session.restored === "conflict" ? { kind: "conflict", film: session.film, version: session.version } : { kind: "idle" }));

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boundsRef = useRef<Record<string, Bounds>>({});
  const selBoxRef = useRef<HTMLDivElement>(null);
  const hoverBoxRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(false);
  const hoverRef = useRef<string | null>(null);
  const resplitAbort = useRef<AbortController | null>(null);

  const { w: W, h: H } = doc.meta.size;
  const { assets } = session;
  const kit = useMemo(() => (fonts ? makeKit(W, H, fonts) : null), [fonts, W, H]);
  const selected = doc.layers.find((l) => l.id === selection[0]) ?? null;
  // The keyframe selection, short of keys an undo, the agent or a re-split took away.
  const keys = useMemo(() => liveKeys(doc, keySel), [doc, keySel]);
  const keysRef = useRef(keys);

  // The film's soundtrack: heard while playing, and mixed into the export as the Studio mixes it.
  const clips = useMemo(() => session.film.audio ?? [], [session]);
  const { loaded: loadedAudio, mixer } = useFilmAudio(clips, session.audioBlobs);
  const cues = useMemo(() => cuesFromClips(clips), [clips]);
  const mixerRef = useRef(mixer);

  useEffect(() => {
    loadFonts().then(setFonts);
  }, []);

  useEffect(() => {
    playingRef.current = playing;
    keysRef.current = keys;
    mixerRef.current = mixer;
  }, [playing, keys, mixer]);

  const pause = useCallback(() => setPlaying(false), []);

  // ── Saving onto the film ──
  // Edits are saved to the film itself (where the Studio reads it), a moment after they pause.
  const [saver] = useState(() => {
    const s = createSaver(
      { id: session.film.id, where: session.where, cloud: session.cloud, version: session.version },
      session.filmDoc,
      {
        getDoc: () => store.getState().doc,
        save: saveFilmDoc,
        keepLocal: (fid, d, source) => writeSaved(fid, { v: SPLIT_VERSION, doc: d, edited: true, source }).then(() => {}),
        clearLocal: (fid) => {
          if (session.fromLegacy && fid === session.film.id) dropLegacy(fid);
          // An example's record goes back to being its split, so reopening it skips the split.
          if (fid === session.film.id && session.where === "example" && session.filmDoc)
            return writeSaved(fid, { v: SPLIT_VERSION, doc: session.filmDoc, edited: false, source: session.version }).then(() => {});
          return dropSaved(fid);
        },
        onStatus: setSave,
        onForked: (from, to, f, d) => {
          const named = (m: Doc["meta"]) => ({ ...m, id: to, title: f.doc?.meta.title ?? f.title });
          const held = { ...d, meta: named(d.meta) };
          const cur = store.getState().doc;
          store.setState({ doc: cur === d ? held : { ...cur, meta: named(cur.meta) } });
          // Opening the example again in this page opens your copy (and so does a reload: see below).
          rememberFork(from, to);
          setFilm({ id: to, title: f.title });
          return held;
        },
      },
      session.restored === "conflict" ? { kind: "conflict", film: session.film, version: session.version } : { kind: "idle" },
    );
    // Edits brought back from this browser stay kept there until they reach the film.
    if (session.restored) s.keptAt(session.film.id);
    return s;
  });

  // The address follows the film, so a reload opens your copy of an example (no navigation: nothing
  // reloads). Only while the editor is shown: a save landing after it was left leaves the address be.
  useEffect(() => {
    if (film.id !== session.film.id) showFilmUrl(session.film.id, film.id);
  }, [film.id, session]);

  useEffect(
    () =>
      store.subscribe((s, p) => {
        if (s.doc === p.doc) return;
        saver.changed();
        // Selection follows what's still there (after an undo, an agent edit or a re-split).
        const sel = liveSelection(s.doc, s.selection);
        if (sel !== s.selection) store.getState().select(sel);
        // An edit (yours, an undo, the agent's) stops playback: it lands on the frame you see.
        if (playingRef.current && (s.past !== p.past || s.future !== p.future)) setPlaying(false);
      }),
    [store, saver],
  );

  // Edits brought back from this browser on top of the film as it is now: saved to it right away.
  useEffect(() => {
    if (session.restored === "same") void saver.flush();
  }, [saver, session]);

  // Leaving or hiding the page saves now, and keeps what hasn't landed in this browser meanwhile.
  useEffect(() => {
    const hide = () => {
      if (!saver.busy()) return;
      saver.stash();
      void saver.flush();
    };
    const onVisibility = () => document.visibilityState === "hidden" && hide();
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!saver.busy()) return;
      hide();
      e.preventDefault();
      e.returnValue = "";
    };
    const onOnline = () => saver.status.kind === "error" && void saver.flush();
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("online", onOnline);
      hide();
    };
  }, [saver]);

  // The Studio (or another tab) saved this film while it's open here: say so, rather than let
  // either version silently overwrite the other. Checked again whenever the page comes back into view,
  // since a film saved on another device (or in a browser without BroadcastChannel) sends no word.
  useEffect(() => {
    const check = () => void saver.checkElsewhere((id) => getFilm(id, { cloud: saver.film.cloud })).catch((e) => e instanceof FilmGone && saver.gone());
    const onVisible = () => document.visibilityState === "visible" && check();
    const off = onFilmSaved((fid) => fid === saver.film.id && check());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [saver]);

  const keepMine = () => void saver.keepMine();
  const takeNew = () => {
    if (saver.busy() && !confirm("Use the film as the Studio saved it? Your edits here that it doesn't have are dropped.")) return;
    saver.discard();
    void dropSaved(saver.film.id).catch(() => {});
    if (session.fromLegacy) dropLegacy(session.film.id);
    onReopen(saver.film.id);
  };

  // Back to the Studio, on this film, once its edits are saved.
  const back = `/?film=${encodeURIComponent(film.id)}`;
  const leave = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !saver.busy()) return;
    e.preventDefault();
    await Promise.race([saver.flush(), new Promise((r) => setTimeout(r, 8000))]);
    const s = saver.status;
    if (saver.busy() || s.kind === "error" || s.kind === "conflict") {
      const why = s.kind === "error" ? `Your latest edits couldn't be saved (${s.message}).` : s.kind === "conflict" ? "This film changed in the Studio, so your edits weren't saved to it." : "Your latest edits are still saving.";
      if (!confirm(`${why} Leave anyway? They're kept in this browser, and come back when you open this film here again.`)) return;
      saver.stash();
    }
    // Named after the save: an example's first one makes it a film of your own.
    router.push(`/?film=${encodeURIComponent(saver.film.id)}`);
  };

  // ── Code layers whose code changed after their text was split: the code paints all its own text
  // again and their text layers stand down, until the text is split anew ──
  const stale = useMemo(() => doc.layers.filter((l) => l.type === "code" && l.props.skipText && !splitLive(l.props)), [doc.layers]);
  useEffect(() => () => resplitAbort.current?.abort(), []);
  const resplit = async (ids: string[]) => {
    if (!kit || resplitting !== null || !ids.length) return;
    const old = store.getState().doc.layers.filter((l) => ids.includes(String(l.props.splitFrom))).length;
    if (old && !confirm(`This replaces the ${old} text layers made from the old code, along with any edits to them. Undo brings them back.`)) return;
    pause();
    const ac = new AbortController();
    resplitAbort.current = ac;
    setResplitting(0);
    try {
      for (const [n, lid] of ids.entries()) {
        const layer = store.getState().doc.layers.find((l) => l.id === lid);
        if (!layer) continue;
        const code = String(layer.props.code ?? "");
        const r = await splitCodeLayer(store.getState().doc, layer, kit, assets, {
          signal: ac.signal,
          onProgress: (k) => setResplitting(Math.floor(((n + k) / ids.length) * 100)),
        });
        store.getState().apply(applySplit(lid, code, r), "Re-split text");
      }
    } catch (e) {
      if (!ac.signal.aborted) setNotice(`Couldn't split the text again: ${message(e)}`);
    } finally {
      setResplitting(null);
    }
  };

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

  // Render loop: reads the store directly so playback never waits on React. Sound follows the
  // playhead: it starts and stops with playback, and starts over on a seek or a loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !kit) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let heard: number | null = null; // the time the sound was last left at, while playing
    // Layers that couldn't draw: kept until they draw again, and shown (published only when that changes).
    const failing = new Map<string, string>();
    let shown = "";
    const onError = (l: Layer, e: unknown) => failing.set(l.id, message(e));
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
        if (heard !== t) mixerRef.current?.play(t);
        t = t + dt >= st.doc.meta.duration ? 0 : t + dt;
        if (t === 0) mixerRef.current?.play(0);
        st.setTime(t);
        heard = t;
      } else if (heard !== null) {
        mixerRef.current?.stop();
        heard = null;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      boundsRef.current = renderDoc(ctx, st.doc, t, kit, assets, { onError });
      for (const lid of Object.keys(boundsRef.current)) failing.delete(lid);
      const sig = [...failing].join("|");
      if (sig !== shown) {
        shown = sig;
        setErrors(Object.fromEntries(failing));
      }
      place(selBoxRef.current, st.selection[0] ? boundsRef.current[st.selection[0]] : undefined);
      place(hoverBoxRef.current, hoverRef.current && hoverRef.current !== st.selection[0] ? boundsRef.current[hoverRef.current] : undefined);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      mixerRef.current?.stop();
    };
  }, [kit, store, W, H, assets]);

  // ── Selecting: a layer that isn't on screen at the playhead brings the playhead into it ──
  const reveal = useCallback(
    (lid: string) => {
      const st = store.getState();
      if (st.selection.length !== 1 || st.selection[0] !== lid) st.select([lid]);
      const l = st.doc.layers.find((x) => x.id === lid);
      if (!l) return;
      const t = spanTime(st.doc, l, st.time);
      if (Math.abs(t - st.time) > 1e-9) st.setTime(t);
    },
    [store],
  );

  // ── Canvas: click to select, drag to move (one undo step per drag) ──
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
    // What's pressed on is about to be moved: on the frame it's seen on.
    pause();
    const st = store.getState();
    const layer = st.doc.layers.find((l) => l.id === hit)!;
    const t = st.time;
    const ox = Number(propAt(layer, "transform.x", t) ?? 0);
    const oy = Number(propAt(layer, "transform.y", t) ?? 0);
    // Split text's position is a recording of what its code drew: a drag moves the whole track.
    const recorded = typeof layer.props.splitFrom === "string";
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    st.beginGesture();
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      moved = true;
      const r = canvasRef.current!.getBoundingClientRect();
      const nx = Math.round(ox + ((ev.clientX - e.clientX) / r.width) * W);
      const ny = Math.round(oy + ((ev.clientY - e.clientY) / r.height) * H);
      const cur = store.getState().doc.layers.find((l) => l.id === hit);
      if (!cur || cur.locked) return; // undone, deleted or locked mid-drag
      store.getState().apply((d) => {
        if (recorded) {
          offsetPropTo(hit, "transform.x", nx, t)(d);
          offsetPropTo(hit, "transform.y", ny, t)(d);
        } else {
          setProp(hit, "transform.x", nx, t)(d);
          setProp(hit, "transform.y", ny, t)(d);
        }
      }, "Move layer");
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      store.getState().endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = toCanvas(e);
    hoverRef.current = hitTest(x, y);
  };

  // ── Keyboard ──
  const step = useCallback(
    (dt: number) => {
      const st = store.getState();
      st.setTime(Math.round((st.time + dt) * st.doc.meta.fps) / st.doc.meta.fps);
    },
    [store],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const st = store.getState();
      const mod = e.metaKey || e.ctrlKey;
      const undo = mod && e.key.toLowerCase() === "z";
      // Typing: shortcuts stay out of the way, except undo in a field that edits the doc as you type
      // (the inspector's), or in an empty one (the agent's box once a request is sent): the doc's.
      if (el && isTextField(el)) {
        if (e.key === "Escape") el.blur();
        else if (undo && (el.closest("[data-doc-fields]") || !(el as HTMLInputElement).value)) {
          e.preventDefault();
          if (e.shiftKey) st.redo();
          else st.undo();
        }
        return;
      }
      // A checkbox or slider reached with Tab keeps its own keys (Space toggles it, arrows move it), and
      // a color swatch keeps Space/Enter (open its picker) and Delete (never the layer it colors).
      if (ownsKey(el, e.key)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (undo) {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (e.key === "ArrowRight") step(e.shiftKey ? 1 : 1 / st.doc.meta.fps);
      else if (e.key === "ArrowLeft") step(e.shiftKey ? -1 : -1 / st.doc.meta.fps);
      else if (e.key === "Home") st.setTime(0);
      else if (e.key === "End") st.setTime(st.doc.meta.duration);
      else if (e.key === "Escape") {
        st.select([]);
        setKeySel([]);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        const sel = keysRef.current;
        if (sel.length) {
          // Keyframes, not their layers. A property that loses its last key keeps its value here.
          const ks = unlockedKeys(st.doc, sel);
          if (ks.length) {
            e.preventDefault();
            pause();
            st.apply(removeKeyframes(ks, st.time), "Delete keyframes");
          } else setNotice("Those keyframes are on a locked layer. Unlock it to change them.");
          setKeySel([]);
          return;
        }
        const live = liveSelection(st.doc, st.selection);
        const ids = unlocked(st.doc, live);
        if (ids.length) {
          e.preventDefault();
          pause();
          st.apply(removeLayers(ids), "Delete layer");
          st.select(live.filter((x) => !ids.includes(x)));
        } else if (live.length) setNotice("Locked layers can't be deleted. Unlock them first.");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, step, pause]);

  // ── Export: the film's images and soundtrack, mixed and captioned as the Studio exports it ──
  // The soundtrack: what playback has loaded, and any clip it's still loading, loaded now (an export
  // started right away has all of it). Only a clip that can't load is left out.
  const soundtrack = async () => {
    const have = new Map(loadedAudio.map((l) => [l.clip.id, l.buffer]));
    const got = await Promise.all(
      clips.map(async (clip) => {
        const buffer = have.get(clip.id) ?? (clip.muted ? undefined : await loadClip(clip, session.audioBlobs).catch(() => undefined));
        return buffer ? { clip, buffer } : null;
      }),
    );
    return got.filter((l) => l !== null);
  };
  const doExport = async () => {
    if (!fonts) return;
    pause();
    setExporting(0);
    setNotice(null);
    try {
      const d = store.getState().doc;
      const sound = await soundtrack();
      const mix = sound.length ? await renderMix(sound, d.meta.duration) : null;
      // Drawn as the editor shows it: a layer that can't draw is left out of a frame, not the end of the export.
      const broken = new Set<string>();
      const scene: SceneFn = (ctx, _W, _H, t, _T, _p, lib, a) => {
        renderDoc(ctx, d, t, lib, a, { onError: (l) => broken.add(l.name) });
      };
      const { blob, ext, audioIncluded } = await exportVideo({
        scene,
        fonts,
        assets,
        W: d.meta.size.w,
        H: d.meta.size.h,
        T: d.meta.duration,
        fps: d.meta.fps,
        audio: mix,
        captions: burnCaptions && cues.length ? cues : undefined,
        onProgress: setExporting,
      });
      const missing = clips.filter((c) => !c.muted).length - sound.filter((l) => !l.clip.muted).length;
      if (mix && !audioIncluded) setNotice("Exported without sound: this browser can't encode audio into MP4. Chrome can.");
      else if (missing > 0) setNotice(`Exported without ${missing} sound clip${missing === 1 ? "" : "s"} that couldn't load.`);
      else if (broken.size) setNotice(`Exported, but ${[...broken].slice(0, 3).join(", ")}${broken.size > 3 ? "…" : ""} couldn't draw on some frames, so they're missing there.`);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${film.title.replace(/[^\w\- ]+/g, "").trim() || "animation"}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setNotice(`Couldn't export: ${message(e)}`);
    } finally {
      setExporting(null);
    }
  };

  // The doc an earlier editor kept, set aside on open: put in place of this one (an undoable edit,
  // saved to the film like any other), or deleted.
  const openEarlier = () => {
    if (!earlier) return;
    if (!confirm("Open the version from the earlier editor in place of this one? Its text was split without being checked, so some may sit above art that should cover it. Undo brings this one back.")) return;
    pause();
    const from = fromUnchecked(earlier);
    store.getState().apply((d) => {
      Object.assign(d, { ...from, meta: { ...from.meta, id: d.meta.id, title: d.meta.title } });
    }, "Open earlier version");
    dropLegacy(session.film.id);
    setEarlier(null);
  };
  const deleteEarlier = () => {
    if (!confirm("Delete the version from the earlier editor? This can't be undone.")) return;
    dropLegacy(session.film.id);
    setEarlier(null);
  };

  // Everything since the editor opened, undone as one step (which undo brings back).
  const revert = () => {
    const opened = session.filmDoc;
    if (!opened || !confirm("Undo every change since you opened the editor? Undo brings them back.")) return;
    pause();
    store.getState().apply((d) => {
      Object.assign(d, { ...opened, meta: { ...opened.meta, id: d.meta.id, title: d.meta.title } });
    }, "Revert");
  };

  // The agent's panel re-renders on its own (its messages), not on every edit or drag step.
  const agent = useMemo(() => <AgentPanel store={store} />, [store]);

  const counts = useMemo(
    () => ({ layers: doc.layers.length, keys: doc.layers.reduce((n, l) => n + Object.values(l.anim).reduce((m, k) => m + k.length, 0), 0) }),
    [doc.layers],
  );

  // Edits here the changed film doesn't have, which "Keep my edits" would save over it.
  const mine = save.kind === "conflict" && saver.unsaved();
  const saveNote =
    save.kind === "pending" ? "Saving…"
    : save.kind === "saved" ? (save.forked ? `Saved as your own film, “${save.forked}”` : saver.film.where === "cloud" ? "Saved to your library" : "Saved in this browser")
    : save.kind === "gone" ? "This film was deleted elsewhere, so edits aren't saved."
    : null;

  return (
    <div className="ed">
      <header className="ed-top">
        <div className="ed-top-left">
          <Link href={back} className="brand" onClick={leave} title="Back to the Studio">
            animate
          </Link>
          <span className="ed-title">{film.title}</span>
          {saveNote && (
            <span className={`ed-save${save.kind === "gone" ? " err" : ""}`} role="status">
              {saveNote}
            </span>
          )}
          {save.kind === "error" && (
            <span className="ed-save err" role="alert" title={save.message}>
              Not saved: {save.message}{" "}
              <button className="ed-link" onClick={() => void saver.flush()}>
                Try again
              </button>
            </span>
          )}
          {save.kind === "conflict" && (
            <span className="ed-conflict" role="alert">
              <span>
                {save.film !== session.film || session.restored !== "conflict"
                  ? "This film changed in the Studio while it was open here."
                  : session.fromLegacy
                    ? "Edits made in the earlier editor were never saved to this film."
                    : "Edits made here earlier never reached this film, and it has changed since."}
              </span>
              {/* Nothing edited here since the last save: there's only the new version to take. */}
              {mine && (
                <button className="ed-link" onClick={keepMine} title="Save this version over the film's changes">
                  Keep my edits
                </button>
              )}
              <button className="ed-link" onClick={takeNew}>
                {mine ? "Use the Studio’s version" : "Open the new version"}
              </button>
            </span>
          )}
          {notice && (
            <span className="ed-notice" role="alert" title={notice}>
              {notice}{" "}
              <button className="ed-link" onClick={() => setNotice(null)} aria-label="Dismiss">
                ×
              </button>
            </span>
          )}
          {earlier && (
            <span className="ed-earlier" role="status">
              <span title="This film has a version saved by an earlier editor, which split its text without checking it against the film. It was set aside, and this one split afresh.">
                A version from the earlier editor was set aside.
              </span>
              <button className="ed-link" onClick={openEarlier}>
                Open it
              </button>
              <button className="ed-link" onClick={deleteEarlier}>
                Delete it
              </button>
            </span>
          )}
        </div>
        <div className="ed-top-right">
          {(stale.length > 0 || resplitting !== null) && (
            <button
              className="ed-btn"
              disabled={resplitting !== null || !kit}
              onClick={() => resplit(stale.map((l) => l.id))}
              title="The code changed since its text was split, so the code draws all of its text. Split it into editable text layers again."
            >
              {resplitting !== null ? `Splitting text… ${resplitting}%` : "Re-split text"}
            </button>
          )}
          <button className="ed-btn" disabled={!canUndo} onClick={() => store.getState().undo()} title="Undo (⌘Z)">
            Undo
          </button>
          <button className="ed-btn" disabled={!canRedo} onClick={() => store.getState().redo()} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <button className="ed-btn agent-btn" onClick={() => setPanel((p) => (p === "agent" ? "inspect" : "agent"))}>
            ✦ Ask Claude
          </button>
          {session.filmDoc && (
            <button className="ed-btn" onClick={revert} disabled={doc === session.filmDoc} title="Undo every change since the editor opened">
              Revert
            </button>
          )}
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
            {agent}
          </div>
          {/* Editing a field pauses playback first, so the edit lands on the frame you see. */}
          <div className="ed-panel-body" hidden={panel !== "inspect"} onFocusCapture={pause}>
            {selected ? (
              <Inspector
                store={store}
                doc={doc}
                layer={selected}
                error={errors[selected.id]}
                resplitting={resplitting}
                onResplit={resplit}
                onSelect={reveal}
              />
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
                  <li>
                    <kbd>Esc</kbd> leave a field · deselect
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
        <Timecode store={store} />
        <span className="ed-meta">
          {counts.layers} layers · {counts.keys} keyframes · {doc.meta.fps} fps
          {clips.length > 0 && ` · ${clips.length} sound clip${clips.length === 1 ? "" : "s"}`}
        </span>
        {cues.length > 0 && (
          <label className="ed-meta ed-captions">
            <input type="checkbox" checked={burnCaptions} onFocus={handBackKeys} onChange={(e) => setBurnCaptions(e.target.checked)} /> Burn captions into the export
          </label>
        )}
      </div>

      <Timeline store={store} keySel={keys} setKeySel={setKeySel} onSelect={reveal} onEdit={pause} errors={errors} />
    </div>
  );
}

// The playhead's time, re-rendered on its own as playback runs (nothing else is).
function Timecode({ store }: { store: Store }) {
  const time = useStore(store, (s) => s.time);
  const fps = useStore(store, (s) => s.doc.meta.fps);
  const duration = useStore(store, (s) => s.doc.meta.duration);
  return (
    <span className="ed-tc">
      {fmtTime(time, fps)} <span>/ {fmtTime(duration, fps)}</span>
    </span>
  );
}

// How a code layer's text stands: split into layers, drawn by changed code, or kept in code.
function SplitNote({ doc, layer, resplitting, onResplit }: { doc: Doc; layer: Layer; resplitting: number | null; onResplit: (ids: string[]) => void }) {
  if (layer.props.skipText && splitLive(layer.props))
    return <p className="ed-note">Its text is in {splitChildren(doc, layer.id).length} editable text layers. Changing the code draws the text from the code again.</p>;
  if (layer.props.skipText)
    return (
      <p className="ed-note">
        The code changed, so it draws all of its text again, and its text layers stand down.{" "}
        <button className="ed-link" disabled={resplitting !== null} onClick={() => onResplit([layer.id])}>
          {resplitting !== null ? `Splitting text… ${resplitting}%` : "Re-split text"}
        </button>
      </p>
    );
  if (layer.props.textSplit === false) return <p className="ed-note">Its text stays in the code.</p>;
  return null;
}

function Inspector({
  store,
  doc,
  layer,
  error,
  resplitting,
  onResplit,
  onSelect,
}: {
  store: Store;
  doc: Doc;
  layer: Layer;
  error?: string;
  resplitting: number | null;
  onResplit: (ids: string[]) => void;
  onSelect: (id: string) => void;
}) {
  const time = useStore(store, (s) => s.time);
  const fields = [...TRANSFORM, ...(BY_TYPE[layer.type] ?? [])];
  const apply = store.getState().apply;
  const fps = doc.meta.fps;
  const localT = time - layer.start;
  const owner = splitOwner(doc, layer);
  const status = splitStatus(doc, layer, time);
  const copies = linkedLayers(doc, layer.id);
  const recorded = typeof layer.props.splitFrom === "string";

  const toggleKey = (f: Field) => {
    const existing = keyAt(layer.anim[f.path], localT, fps);
    if (existing) apply(removeKeyframes([{ layerId: layer.id, path: f.path, keyId: existing.id }], time), "Remove keyframe");
    else {
      const v = propAt(layer, f.path, time) as Value | undefined;
      apply(addKeyframe(layer.id, f.path, localT, v ?? (f.kind === "color" ? "#141413" : f.kind === "number" ? 0 : "")), "Add keyframe");
    }
  };

  // Words change for the whole clip (and every linked copy); on split text, where it is and how big
  // moves its whole recorded track; anything else is set (or keyed) at the playhead.
  const set = (f: Field, v: Value) => {
    const op =
      f.path === "props.text" && typeof v === "string" ? setText(layer.id, v, time)
      : recorded && MOVES_TRACK.has(f.path) && typeof v === "number" ? offsetPropTo(layer.id, f.path, v, time)
      : setProp(layer.id, f.path, v, time);
    apply(op, `Edit ${f.label}`, { coalesce: `edit-${layer.id}-${f.path}` });
  };

  return (
    <div className={`ed-insp${status === "code-changed" ? " stood" : ""}`} data-doc-fields>
      <input
        className="ed-name"
        value={layer.name}
        disabled={layer.locked}
        title={layer.props.autoName ? "Named after its words, and renamed when they change. Rename it to keep a name of your own." : undefined}
        onChange={(e) => apply(renameLayer(layer.id, e.target.value), "Rename", { coalesce: `rename-${layer.id}` })}
      />
      <div className="ed-type">
        {layer.type} · {layer.start.toFixed(2)}s → {layer.end.toFixed(2)}s
      </div>
      {layer.locked && (
        <p className="ed-note">
          Locked: it can&apos;t be moved, edited or deleted.{" "}
          <button className="ed-link" onClick={() => apply(setLayerFlags(layer.id, { locked: false }), "Toggle lock")}>
            Unlock
          </button>
        </p>
      )}
      {error && <p className="ed-note err">It couldn&apos;t draw: {error}</p>}
      {status === "code-changed" && owner && (
        <p className="ed-note">
          Stood down: the code of “{owner.name}” changed after this text was split, so the code draws it, and edits here don&apos;t show.{" "}
          <button className="ed-link" disabled={resplitting !== null} onClick={() => onResplit([owner.id])}>
            {resplitting !== null ? `Splitting text… ${resplitting}%` : "Re-split text"}
          </button>
        </p>
      )}
      {status === "owner-hidden" && owner && (
        <p className="ed-note">
          Hidden with its code layer,{" "}
          <button className="ed-link" onClick={() => onSelect(owner.id)}>
            {owner.name}
          </button>
          .
        </p>
      )}
      {status === "outside-owner" && owner && <p className="ed-note">Not on screen now: its code layer, {owner.name}, isn&apos;t on at the playhead.</p>}
      {copies.length > 1 && (
        <p className="ed-note">
          {copies.length} linked copies: their words, size and face change together.{" "}
          <button className="ed-link" disabled={layer.locked} onClick={() => apply(unlinkLayer(layer.id), "Unlink copy")}>
            Unlink this one
          </button>
        </p>
      )}
      {layer.type === "code" && <SplitNote doc={doc} layer={layer} resplitting={resplitting} onResplit={onResplit} />}
      <fieldset className="ed-fields" disabled={layer.locked}>
        {fields.map((f) => {
          const fallback = f.kind === "color" && (f.path === "props.color" || f.path === "props.fill") ? "#141413" : undefined;
          // Typed text shows its whole words: an edit changes them for the whole clip.
          const raw = f.path === "props.text" ? wordsOf(layer, time) : (propAt(layer, f.path, time) ?? fallback);
          if (raw === undefined && f.path === "props.number") return null;
          const animated = !!layer.anim[f.path]?.length;
          const onKey = !!keyAt(layer.anim[f.path], localT, fps);
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
                <textarea value={String(raw ?? "")} onChange={(e) => set(f, e.target.value)} spellCheck={f.path !== "props.code"} />
              ) : f.kind === "color" ? (
                <span className="ed-color">
                  <input type="color" value={/^#[0-9a-f]{6}$/i.test(String(raw)) ? String(raw) : "#000000"} onChange={(e) => set(f, e.target.value)} />
                  <input value={String(raw ?? "")} onChange={(e) => set(f, e.target.value)} />
                </span>
              ) : f.kind === "number" ? (
                <input
                  type="number"
                  step={f.step ?? 1}
                  value={typeof raw === "number" ? +raw.toFixed(3) : ""}
                  onChange={(e) => e.target.value !== "" && Number.isFinite(+e.target.value) && set(f, +e.target.value)}
                />
              ) : (
                <input value={String(raw ?? "")} onChange={(e) => set(f, e.target.value)} />
              )}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
