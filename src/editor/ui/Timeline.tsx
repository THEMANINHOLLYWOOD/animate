"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { moveKeyframes, moveLayerTime, setLayerFlags, trimLayer } from "../doc/ops";
import type { Layer } from "../doc/schema";
import { isStoodDown } from "../doc/split";
import type { createEditorStore } from "../store/store";
import { followX, liveKeys, scrollToShow, type KeySel } from "./session";

type Store = ReturnType<typeof createEditorStore>;
export type { KeySel };

const ROW_H = 28;
const PROP_H = 22;
const RULER_H = 42;
const SNAP_PX = 6;

const prettyPath = (p: string) =>
  ({
    "transform.x": "Position X",
    "transform.y": "Position Y",
    "transform.opacity": "Opacity",
    "transform.rotation": "Rotation",
    "transform.scale": "Scale",
  })[p] ?? p.replace(/^props\./, "").replace(/^./, (c) => c.toUpperCase());

const TYPE_GLYPH: Record<string, string> = { text: "T", shape: "◻", globe: "◍", waveform: "≋", image: "▣", video: "▶", code: "</>", group: "▤" };

const STOOD_DOWN = "Stood down: its code changed after its text was split, so the code draws this text. Select it to split the text again.";

type Props = {
  store: Store;
  keySel: KeySel[];
  setKeySel: (k: KeySel[]) => void;
  // Select a layer (moving the playhead into it when it isn't on screen).
  onSelect: (id: string) => void;
  // An edit is starting (playback pauses first).
  onEdit: () => void;
  // Layers whose drawing threw, with why.
  errors: Record<string, string>;
};

// Everything one layer row needs; rows re-render only when theirs changes (not on every frame).
type RowProps = {
  l: Layer;
  open: boolean;
  sel: boolean;
  selKeys: string; // its selected keyframe ids, joined
  pps: number;
  trackW: number;
  stood: boolean;
  links: number; // linked copies, itself included
  error?: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onClip: (e: React.PointerEvent, l: Layer, mode: "move" | "start" | "end") => void;
  onKey: (e: React.PointerEvent, k: KeySel, locked: boolean) => void;
  onScrub: (e: React.PointerEvent) => void;
  onFlag: (l: Layer, flag: "hidden" | "locked") => void;
};

export default function Timeline({ store, keySel, setKeySel, onSelect, onEdit, errors }: Props) {
  const doc = useStore(store, (s) => s.doc);
  const selection = useStore(store, (s) => s.selection);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Phones start zoomed in so clips are big enough to grab; scroll sideways to move.
  const [zoom, setZoom] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? 3 : 1));
  const [width, setWidth] = useState(800);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const D = doc.meta.duration;
  const labelW = width < 640 ? 132 : 240; // narrower layer column on phones
  const pps = ((width - labelW - 24) / D) * zoom; // pixels per second
  const X = (t: number) => t * pps;
  const rows = useMemo(() => [...doc.layers].reverse(), [doc.layers]); // top of stack first, like AE / Premiere

  // What handlers read when they run, so they stay the same functions (and rows stay memoized).
  const live = useRef({ pps, keySel });
  useLayoutEffect(() => {
    live.current = { pps, keySel };
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ⌥/ctrl + wheel zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey && !e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(40, Math.max(1, z * (e.deltaY > 0 ? 0.9 : 1.1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // The playhead moves with the store's time without re-rendering anything, and the view keeps it in
  // sight: a page on as playback runs off the right, back when it loops or jumps out of view.
  const scrubbing = useRef(false);
  useLayoutEffect(() => {
    const place = (t: number) => {
      const x = labelW + t * pps;
      const el = scrollRef.current;
      // Read the view before moving anything, so following costs no extra layout per frame.
      const to = el && !scrubbing.current ? followX(x, el.scrollLeft, el.clientWidth, labelW) : null;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      if (el && to !== null) el.scrollLeft = to;
    };
    place(store.getState().time);
    return store.subscribe((s, p) => {
      if (s.time !== p.time) place(s.time);
    });
  }, [store, pps, labelW]);

  // A layer selected anywhere (on the canvas, say) scrolls its row into view.
  const selId = selection[0];
  useEffect(() => {
    const el = scrollRef.current;
    const row = selId ? el?.querySelector<HTMLElement>(`[data-layer="${CSS.escape(selId)}"]`) : null;
    if (!el || !row) return;
    const to = scrollToShow(row.offsetTop, ROW_H, el.scrollTop, el.clientHeight, RULER_H);
    if (to !== null) el.scrollTop = to;
  }, [selId]);

  // Snap targets: playhead, markers, every clip edge.
  const snap = useCallback(
    (t: number, ignore?: string) => {
      const { doc: d, time } = store.getState();
      const targets = [time, 0, d.meta.duration, ...d.markers.map((m) => m.t)];
      for (const l of d.layers) if (l.id !== ignore) targets.push(l.start, l.end);
      let best = t;
      let bestD = SNAP_PX / live.current.pps;
      for (const s of targets) {
        if (Math.abs(s - t) < bestD) {
          best = s;
          bestD = Math.abs(s - t);
        }
      }
      return best;
    },
    [store],
  );

  // Pointer listeners for one drag, ended by pointerup or pointercancel.
  const track = useCallback((move: (ev: PointerEvent) => void, end?: () => void) => {
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      end?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, []);

  // Scrub on the ruler (or an empty stretch of track).
  const scrub = useCallback(
    (e: React.PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      const at = (cx: number) => {
        const r = el.getBoundingClientRect();
        const st = store.getState();
        st.setTime(Math.max(0, Math.min(st.doc.meta.duration, (cx - r.left) / live.current.pps)));
      };
      scrubbing.current = true;
      at(e.clientX);
      track(
        (ev) => at(ev.clientX),
        () => (scrubbing.current = false),
      );
    },
    [store, track],
  );

  // Drag a clip: move it, or trim either edge. One undo step per drag. A locked clip only selects.
  const dragClip = useCallback(
    (e: React.PointerEvent, l: Layer, mode: "move" | "start" | "end") => {
      e.stopPropagation();
      onSelect(l.id);
      setKeySel([]);
      if (l.locked) return;
      onEdit();
      const x0 = e.clientX;
      const { start: s0, end: e0 } = l;
      const st0 = store.getState();
      st0.beginGesture();
      const move = (ev: PointerEvent) => {
        const dt = (ev.clientX - x0) / live.current.pps;
        const st = store.getState();
        const cur = st.doc.layers.find((x) => x.id === l.id);
        if (!cur || cur.locked) return;
        if (mode === "move") {
          let ns = Math.max(0, s0 + dt);
          const snappedStart = snap(ns, l.id);
          const snappedEnd = snap(ns + (e0 - s0), l.id);
          ns = snappedStart !== ns ? snappedStart : snappedEnd !== ns + (e0 - s0) ? snappedEnd - (e0 - s0) : ns;
          st.apply(moveLayerTime([l.id], ns - cur.start), "Move clip");
        } else if (mode === "start") {
          st.apply(trimLayer(l.id, Math.min(snap(s0 + dt, l.id), cur.end - 0.05), cur.end), "Trim clip");
        } else {
          st.apply(trimLayer(l.id, cur.start, Math.max(snap(e0 + dt, l.id), cur.start + 0.05)), "Trim clip");
        }
      };
      track(move, () => store.getState().endGesture());
    },
    [store, onSelect, onEdit, setKeySel, snap, track],
  );

  // Drag keyframes (the clicked one, plus the rest of the selection), quantised to frames. One undo step.
  const dragKey = useCallback(
    (e: React.PointerEvent, k: KeySel, locked: boolean) => {
      e.stopPropagation();
      const cur = live.current.keySel;
      const isSel = cur.some((s) => s.keyId === k.keyId);
      const sel = e.shiftKey ? (isSel ? cur.filter((s) => s.keyId !== k.keyId) : [...cur, k]) : isSel ? cur : [k];
      setKeySel(sel);
      const st0 = store.getState();
      if (!st0.selection.includes(k.layerId) || st0.selection.length !== 1) st0.select([k.layerId]);
      if (locked) return;
      const layers = new Map(st0.doc.layers.map((l) => [l.id, l]));
      const moving = sel.filter((s) => !layers.get(s.layerId)?.locked);
      if (!moving.length) return;
      onEdit();
      const x0 = e.clientX;
      let applied = 0;
      st0.beginGesture();
      const move = (ev: PointerEvent) => {
        const fps = store.getState().doc.meta.fps;
        const dt = Math.round(((ev.clientX - x0) / live.current.pps) * fps) / fps;
        if (dt === applied) return;
        // Keys an undo took away mid-drag stay where they went.
        const ks = liveKeys(store.getState().doc, moving);
        if (ks.length) store.getState().apply(moveKeyframes(ks, dt - applied), "Move keyframes");
        applied = dt;
      };
      track(move, () => store.getState().endGesture());
    },
    [store, onEdit, setKeySel, track],
  );

  const toggle = useCallback(
    (id: string) =>
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  const selectRow = useCallback(
    (id: string) => {
      onSelect(id);
      setKeySel([]);
    },
    [onSelect, setKeySel],
  );

  const flag = useCallback(
    (l: Layer, f: "hidden" | "locked") =>
      store.getState().apply(setLayerFlags(l.id, { [f]: !l[f] }), f === "hidden" ? "Toggle visibility" : "Toggle lock"),
    [store],
  );

  // Per-row facts that change only when the doc (or the keyframe selection) does.
  const stood = useMemo(() => new Set(doc.layers.filter((l) => isStoodDown(doc, l)).map((l) => l.id)), [doc]);
  const linkCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of doc.layers) if (typeof l.props.linkId === "string") n.set(l.props.linkId, (n.get(l.props.linkId) ?? 0) + 1);
    return n;
  }, [doc.layers]);
  const keysByLayer = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const k of keySel) m.set(k.layerId, [...(m.get(k.layerId) ?? []), k.keyId]);
    return m;
  }, [keySel]);

  // Ruler ticks adapt to zoom.
  const tickStep = pps > 120 ? 0.5 : pps > 50 ? 1 : pps > 20 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= D + 1e-6; t += tickStep) ticks.push(+t.toFixed(3));
  const trackW = X(D) + 24;

  return (
    <div className="tl">
      <div className="tl-toolbar">
        <span>Timeline</span>
        <div className="tl-zoom">
          <button onClick={() => setZoom((z) => Math.max(1, z / 1.5))} aria-label="Zoom out">
            −
          </button>
          {/* Let go of with the mouse, it hands the arrow keys back to stepping frames (Tab to it keeps them). */}
          <input type="range" min={1} max={40} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} onPointerUp={(e) => e.currentTarget.blur()} aria-label="Zoom" />
          <button onClick={() => setZoom((z) => Math.min(40, z * 1.5))} aria-label="Zoom in">
            +
          </button>
          <button onClick={() => setZoom(1)}>Fit</button>
        </div>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: labelW + trackW, ["--label-w" as string]: `${labelW}px` }}>
          {/* Ruler */}
          <div className="tl-row tl-ruler-row">
            <div className="tl-label tl-corner">{doc.layers.length} layers</div>
            <div className="tl-ruler" style={{ width: trackW }} onPointerDown={scrub}>
              <div className="tl-marker-lane">
                {doc.markers.map((m, i) => {
                  const next = doc.markers[i + 1];
                  const room = (next ? X(next.t) : trackW) - X(m.t) - 8;
                  return (
                    <div key={m.id} className="tl-marker" style={{ left: X(m.t) }} title={m.label}>
                      {room > 18 && <span style={{ maxWidth: room }}>{m.label}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="tl-tick-lane">
                {ticks.map((t) => (
                  <div key={t} className={`tl-tick${Number.isInteger(t) ? "" : " minor"}`} style={{ left: X(t) }}>
                    {Number.isInteger(t) && <span>{t}s</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Layers */}
          {rows.map((l) => (
            <LayerRow
              key={l.id}
              l={l}
              open={expanded.has(l.id)}
              sel={selection.includes(l.id)}
              selKeys={keysByLayer.get(l.id)?.join(",") ?? ""}
              pps={pps}
              trackW={trackW}
              stood={stood.has(l.id)}
              links={typeof l.props.linkId === "string" ? (linkCount.get(l.props.linkId) ?? 1) : 1}
              error={errors[l.id]}
              onToggle={toggle}
              onSelect={selectRow}
              onClip={dragClip}
              onKey={dragKey}
              onScrub={scrub}
              onFlag={flag}
            />
          ))}

          {/* Playhead (placed by the store's time, not by rendering) */}
          <div ref={playheadRef} className="tl-playhead" />
        </div>
      </div>
    </div>
  );
}

const LayerRow = memo(function LayerRow({ l, open, sel, selKeys, pps, trackW, stood, links, error, onToggle, onSelect, onClip, onKey, onScrub, onFlag }: RowProps) {
  const X = (t: number) => t * pps;
  const paths = Object.keys(l.anim).filter((p) => l.anim[p].length);
  const keyIds = selKeys ? new Set(selKeys.split(",")) : null;
  const w = Math.max(4, X(l.end - l.start));
  const dots = open ? [] : [...new Set(paths.flatMap((p) => l.anim[p].map((k) => Math.round(k.t * 100) / 100)))].filter((t) => t >= 0 && t <= l.end - l.start);
  return (
    <div data-layer={l.id} className={`tl-layer${sel ? " sel" : ""}${l.hidden ? " hidden" : ""}${l.locked ? " locked" : ""}${stood ? " stood" : ""}`}>
      <div className="tl-row" style={{ height: ROW_H }}>
        <div className="tl-label" onClick={() => onSelect(l.id)} title={stood ? STOOD_DOWN : undefined}>
          <button className={`tl-chev${open ? " open" : ""}`} onClick={(e) => (e.stopPropagation(), onToggle(l.id))} disabled={!paths.length} aria-label="Show keyframes">
            ▸
          </button>
          <span className="tl-glyph">{TYPE_GLYPH[l.type] ?? "•"}</span>
          <span className="tl-name" title={l.name}>
            {l.name}
          </span>
          {error && (
            <span className="tl-badge err" title={`This layer couldn't draw: ${error}`}>
              !
            </span>
          )}
          {stood && (
            <span className="tl-badge" title={STOOD_DOWN}>
              off
            </span>
          )}
          {links > 1 && (
            <span className="tl-badge" title={`${links} linked copies: their words and size change together`}>
              ×{links}
            </span>
          )}
          <button className={`tl-flag${l.hidden ? " off" : ""}`} title={l.hidden ? "Show" : "Hide"} onClick={(e) => (e.stopPropagation(), onFlag(l, "hidden"))}>
            <Icon name={l.hidden ? "eye-off" : "eye"} />
          </button>
          <button className={`tl-flag tl-lock${l.locked ? " on" : ""}`} title={l.locked ? "Unlock" : "Lock"} onClick={(e) => (e.stopPropagation(), onFlag(l, "locked"))}>
            <Icon name={l.locked ? "lock" : "unlock"} />
          </button>
        </div>
        <div className="tl-track" style={{ width: trackW }} onPointerDown={onScrub}>
          <div className={`tl-clip t-${l.type}`} style={{ left: X(l.start), width: w }} onPointerDown={(e) => onClip(e, l, "move")}>
            {!l.locked && <span className="tl-handle left" onPointerDown={(e) => onClip(e, l, "start")} />}
            <span className="tl-clip-name">{l.name}</span>
            {!l.locked && <span className="tl-handle right" onPointerDown={(e) => onClip(e, l, "end")} />}
            {!open && (
              <span className="tl-dots">
                {dots.map((t) => (
                  <span key={t} className="tl-dot" style={{ left: Math.min(w - 6, Math.max(6, X(t))) }} />
                ))}
              </span>
            )}
          </div>
        </div>
      </div>

      {open &&
        paths.map((p) => (
          <div className="tl-row tl-prop" key={p} style={{ height: PROP_H }}>
            <div className="tl-label tl-prop-label">{prettyPath(p)}</div>
            <div className="tl-track" style={{ width: trackW }} onPointerDown={onScrub}>
              <div className="tl-span" style={{ left: X(l.start), width: X(l.end - l.start) }} />
              {l.anim[p].map((k) => {
                const shape = k.ease === "hold" ? "hold" : k.ease === "linear" ? "linear" : "ease";
                return (
                  <span
                    key={k.id}
                    className={`tl-key ${shape}${keyIds?.has(k.id) ? " on" : ""}`}
                    style={{ left: X(l.start + k.t) }}
                    title={`${(l.start + k.t).toFixed(2)}s · ${JSON.stringify(k.v)}`}
                    onPointerDown={(e) => onKey(e, { layerId: l.id, path: p, keyId: k.id }, l.locked)}
                  />
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
});

function Icon({ name }: { name: "eye" | "eye-off" | "lock" | "unlock" }) {
  const common = { width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "eye" || name === "eye-off")
    return (
      <svg {...common}>
        <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
        <circle cx="8" cy="8" r="1.8" />
        {name === "eye-off" && <path d="M2.5 13.5l11-11" />}
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d={name === "lock" ? "M5 7V5a3 3 0 0 1 6 0v2" : "M5 7V5a3 3 0 0 1 5.6-1.5"} />
    </svg>
  );
}
