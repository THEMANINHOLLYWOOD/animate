"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { moveKeyframes, moveLayerTime, setLayerFlags, trimLayer } from "../doc/ops";
import type { Layer } from "../doc/schema";
import type { createEditorStore } from "../store/store";

type Store = ReturnType<typeof createEditorStore>;
export type KeySel = { layerId: string; path: string; keyId: string };

const LABEL_W = 240;
const ROW_H = 28;
const PROP_H = 22;
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

export default function Timeline({ store, keySel, setKeySel }: { store: Store; keySel: KeySel[]; setKeySel: (k: KeySel[]) => void }) {
  const doc = useStore(store, (s) => s.doc);
  const time = useStore(store, (s) => s.time);
  const selection = useStore(store, (s) => s.selection);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(800);
  const scrollRef = useRef<HTMLDivElement>(null);

  const D = doc.meta.duration;
  const pps = ((width - LABEL_W - 24) / D) * zoom; // pixels per second
  const X = (t: number) => t * pps;
  const rows = [...doc.layers].reverse(); // top of stack first, like AE / Premiere

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

  // Snap targets: playhead, markers, every clip edge.
  const snap = (t: number, ignore?: string) => {
    const targets = [time, 0, D, ...doc.markers.map((m) => m.t)];
    for (const l of doc.layers) if (l.id !== ignore) targets.push(l.start, l.end);
    let best = t;
    let bestD = SNAP_PX / pps;
    for (const s of targets) {
      if (Math.abs(s - t) < bestD) {
        best = s;
        bestD = Math.abs(s - t);
      }
    }
    return best;
  };

  // Scrub on the ruler.
  const scrub = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const at = (cx: number) => {
      const r = el.getBoundingClientRect();
      store.getState().setTime(Math.max(0, Math.min(D, (cx - r.left) / pps)));
    };
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag a clip: move it, or trim either edge.
  const dragClip = (e: React.PointerEvent, l: Layer, mode: "move" | "start" | "end") => {
    e.stopPropagation();
    if (l.locked) return;
    store.getState().select([l.id]);
    setKeySel([]);
    const x0 = e.clientX;
    const { start: s0, end: e0 } = l;
    const gesture = `clip-${mode}-${l.id}-${e.timeStamp}`;
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps;
      const st = store.getState();
      const cur = st.doc.layers.find((x) => x.id === l.id);
      if (!cur) return;
      if (mode === "move") {
        let ns = Math.max(0, s0 + dt);
        const snappedStart = snap(ns, l.id);
        const snappedEnd = snap(ns + (e0 - s0), l.id);
        ns = snappedStart !== ns ? snappedStart : snappedEnd !== ns + (e0 - s0) ? snappedEnd - (e0 - s0) : ns;
        st.apply(moveLayerTime([l.id], ns - cur.start), "Move clip", { coalesce: gesture });
      } else if (mode === "start") {
        st.apply(trimLayer(l.id, Math.min(snap(s0 + dt, l.id), cur.end - 0.05), cur.end), "Trim clip", { coalesce: gesture });
      } else {
        st.apply(trimLayer(l.id, cur.start, Math.max(snap(e0 + dt, l.id), cur.start + 0.05)), "Trim clip", { coalesce: gesture });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag keyframes (the clicked one, plus the rest of the selection).
  const dragKey = (e: React.PointerEvent, k: KeySel) => {
    e.stopPropagation();
    const isSel = keySel.some((s) => s.keyId === k.keyId);
    const sel = e.shiftKey ? (isSel ? keySel.filter((s) => s.keyId !== k.keyId) : [...keySel, k]) : isSel ? keySel : [k];
    setKeySel(sel);
    store.getState().select([k.layerId]);
    const x0 = e.clientX;
    let applied = 0;
    const gesture = `keys-${e.timeStamp}`;
    const move = (ev: PointerEvent) => {
      // Quantise to frames.
      const fps = store.getState().doc.meta.fps;
      const dt = Math.round(((ev.clientX - x0) / pps) * fps) / fps;
      if (dt === applied) return;
      store.getState().apply(moveKeyframes(sel, dt - applied), "Move keyframes", { coalesce: gesture });
      applied = dt;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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
          <input type="range" min={1} max={40} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} aria-label="Zoom" />
          <button onClick={() => setZoom((z) => Math.min(40, z * 1.5))} aria-label="Zoom in">
            +
          </button>
          <button onClick={() => setZoom(1)}>Fit</button>
        </div>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: LABEL_W + trackW }}>
          {/* Ruler */}
          <div className="tl-row tl-ruler-row">
            <div className="tl-label tl-corner">{doc.layers.length} layers</div>
            <div className="tl-ruler" style={{ width: trackW }} onPointerDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className={`tl-tick${Number.isInteger(t) ? "" : " minor"}`} style={{ left: X(t) }}>
                  {Number.isInteger(t) && <span>{t}s</span>}
                </div>
              ))}
              {doc.markers.map((m) => (
                <div key={m.id} className="tl-marker" style={{ left: X(m.t) }} title={m.label}>
                  <span>{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Layers */}
          {rows.map((l) => {
            const open = expanded.has(l.id);
            const paths = Object.keys(l.anim).filter((p) => l.anim[p].length);
            const allKeys = paths.flatMap((p) => l.anim[p].map((k) => ({ p, k })));
            const isSel = selection.includes(l.id);
            return (
              <div key={l.id} className={`tl-layer${isSel ? " sel" : ""}${l.hidden ? " hidden" : ""}`}>
                <div className="tl-row" style={{ height: ROW_H }}>
                  <div className="tl-label" onClick={() => (store.getState().select([l.id]), setKeySel([]))}>
                    <button className={`tl-chev${open ? " open" : ""}`} onClick={(e) => (e.stopPropagation(), toggle(l.id))} disabled={!paths.length} aria-label="Show keyframes">
                      ▸
                    </button>
                    <span className="tl-glyph">{TYPE_GLYPH[l.type] ?? "•"}</span>
                    <span className="tl-name" title={l.name}>
                      {l.name}
                    </span>
                    <button
                      className={`tl-flag${l.hidden ? " off" : ""}`}
                      title={l.hidden ? "Show" : "Hide"}
                      onClick={(e) => (e.stopPropagation(), store.getState().apply(setLayerFlags(l.id, { hidden: !l.hidden }), "Toggle visibility"))}
                    >
                      {l.hidden ? "◌" : "●"}
                    </button>
                    <button
                      className={`tl-flag${l.locked ? " on" : ""}`}
                      title={l.locked ? "Unlock" : "Lock"}
                      onClick={(e) => (e.stopPropagation(), store.getState().apply(setLayerFlags(l.id, { locked: !l.locked }), "Toggle lock"))}
                    >
                      {l.locked ? "🔒" : "🔓"}
                    </button>
                  </div>
                  <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
                    <div className={`tl-clip t-${l.type}`} style={{ left: X(l.start), width: Math.max(4, X(l.end - l.start)) }} onPointerDown={(e) => dragClip(e, l, "move")}>
                      <span className="tl-handle left" onPointerDown={(e) => dragClip(e, l, "start")} />
                      <span className="tl-clip-name">{l.name}</span>
                      <span className="tl-handle right" onPointerDown={(e) => dragClip(e, l, "end")} />
                      {!open &&
                        allKeys.map(({ p, k }) => (
                          <span key={p + k.id} className="tl-dot" style={{ left: X(l.start + k.t - l.start) }} />
                        ))}
                    </div>
                  </div>
                </div>

                {open &&
                  paths.map((p) => (
                    <div className="tl-row tl-prop" key={p} style={{ height: PROP_H }}>
                      <div className="tl-label tl-prop-label">{prettyPath(p)}</div>
                      <div className="tl-track" style={{ width: trackW }} onPointerDown={scrub}>
                        <div className="tl-span" style={{ left: X(l.start), width: X(l.end - l.start) }} />
                        {l.anim[p].map((k) => {
                          const ks = { layerId: l.id, path: p, keyId: k.id };
                          const on = keySel.some((s) => s.keyId === k.id);
                          const shape = k.ease === "hold" ? "hold" : k.ease === "linear" ? "linear" : "ease";
                          return (
                            <span
                              key={k.id}
                              className={`tl-key ${shape}${on ? " on" : ""}`}
                              style={{ left: X(l.start + k.t) }}
                              title={`${(l.start + k.t).toFixed(2)}s · ${JSON.stringify(k.v)}`}
                              onPointerDown={(e) => dragKey(e, ks)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}

          {/* Playhead */}
          <div className="tl-playhead" style={{ left: LABEL_W + X(time) }} />
        </div>
      </div>
    </div>
  );
}
