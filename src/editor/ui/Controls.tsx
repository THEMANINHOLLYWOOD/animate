"use client";
// A film's own panel: the controls its scene declares (lib.controls in its code), built into fields,
// sliders, swatches, switches, choices and points to drag. Every film's panel is different, because
// every film declares what can be played with about it. What's set is kept on the film's code layer
// (props.controls) and can be keyed like any property.

import { useRef } from "react";
import { useStore } from "zustand";
import { controlKey, controlPath, controlValue, shuffled, type ControlDef } from "@/lib/controls";
import { propAt } from "../doc/interpolate";
import { addKeyframe, keyAt, removeKeyframes, setProp, type Op } from "../doc/ops";
import type { Doc, Layer, Value } from "../doc/schema";
import { controlsOf } from "../extract/parts";
import type { createEditorStore } from "../store/store";

type Store = ReturnType<typeof createEditorStore>;

// The code layers that declare controls, with them.
export const controlled = (doc: Doc) => doc.layers.filter((l) => l.type === "code").map((layer) => ({ layer, defs: controlsOf(layer) })).filter((x) => x.defs.length);

// What a control is set to on this frame (its default when untouched).
const shown = (layer: Layer, d: ControlDef, t: number) => controlValue(d, propAt(layer, controlPath(d.name), t));
// Whether it has been changed from what the scene declares.
const touched = (layer: Layer, d: ControlDef) => !!layer.anim[controlPath(d.name)]?.length || (layer.props.controls as Record<string, unknown> | undefined)?.[controlKey(d.name)] !== undefined;

// What's kept: numbers, strings and pairs (a switch as 1 or 0).
const stored = (v: unknown): Value => (typeof v === "boolean" ? (v ? 1 : 0) : (v as Value));

const reset =
  (layerId: string, names: string[]): Op =>
  (doc) => {
    const l = doc.layers.find((x) => x.id === layerId);
    if (!l) return;
    const set = { ...((l.props.controls as Record<string, unknown> | undefined) ?? {}) };
    for (const n of names) {
      delete set[controlKey(n)];
      delete l.anim[controlPath(n)];
    }
    if (Object.keys(set).length) l.props.controls = set;
    else delete l.props.controls;
  };

const KEYABLE = new Set<ControlDef["kind"]>(["number", "color", "point"]);

export default function Controls({ store, doc, onEdit }: { store: Store; doc: Doc; onEdit: () => void }) {
  const time = useStore(store, (s) => s.time);
  const films = controlled(doc);
  if (!films.length) return null;
  const apply = store.getState().apply;

  return (
    <div className="ctl" data-doc-fields onFocusCapture={onEdit}>
      {films.map(({ layer, defs }) => {
        const set = (d: ControlDef, v: unknown) => apply(setProp(layer.id, controlPath(d.name), stored(v), time), `Set ${d.name}`, { coalesce: `ctl-${layer.id}-${d.name}` });
        const groups: { title: string; defs: ControlDef[] }[] = [];
        for (const d of defs) {
          const title = d.group ?? "";
          const g = groups.find((x) => x.title === title);
          if (g) g.defs.push(d);
          else groups.push({ title, defs: [d] });
        }
        const changed = defs.filter((d) => touched(layer, d));
        const shuffle = () => {
          const st = store.getState();
          onEdit();
          st.beginGesture();
          for (const d of defs) if (d.kind !== "text" && d.kind !== "point") st.apply(setProp(layer.id, controlPath(d.name), stored(shuffled(d, Math.random)), st.time), "Shuffle controls");
          st.endGesture();
        };
        return (
          <section key={layer.id} className="ctl-film">
            <header className="ctl-head">
              <div>
                <b>{doc.meta.title}</b>
                <span>
                  {defs.length} control{defs.length > 1 ? "s" : ""} made for this film
                </span>
              </div>
              <div className="ctl-head-actions">
                <button className="ctl-btn" onClick={shuffle} title="Try a random setting of every slider, switch, choice and colour (undo brings yours back)">
                  Shuffle
                </button>
                <button className="ctl-btn" disabled={!changed.length} onClick={() => apply(reset(layer.id, changed.map((d) => d.name)), "Reset controls")} title="Back to how the film was made">
                  Reset
                </button>
              </div>
            </header>
            {groups.map((g) => (
              <div className="ctl-group" key={g.title}>
                {g.title && <h4>{g.title}</h4>}
                {g.defs.map((d) => (
                  <Row key={d.name} d={d} layer={layer} time={time} fps={doc.meta.fps} size={doc.meta.size} set={(v) => set(d, v)} apply={apply} onEdit={onEdit} />
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Row({
  d,
  layer,
  time,
  fps,
  size,
  set,
  apply,
  onEdit,
}: {
  d: ControlDef;
  layer: Layer;
  time: number;
  fps: number;
  size: { w: number; h: number };
  set: (v: unknown) => void;
  apply: (op: Op, label: string, opts?: { coalesce?: string }) => void;
  onEdit: () => void;
}) {
  const v = shown(layer, d, time);
  const path = controlPath(d.name);
  const dirty = touched(layer, d);
  const keys = layer.anim[path];
  const onKey = !!keyAt(keys, time - layer.start, fps);
  const toggleKey = () => {
    const k = keyAt(keys, time - layer.start, fps);
    if (k) apply(removeKeyframes([{ layerId: layer.id, path, keyId: k.id }], time), "Remove keyframe");
    else apply(addKeyframe(layer.id, path, time - layer.start, stored(v)), "Add keyframe");
  };
  return (
    <div className={`ctl-row k-${d.kind}${dirty ? " dirty" : ""}`}>
      <div className="ctl-label">
        {KEYABLE.has(d.kind) && (
          <button className={`ed-stopwatch${keys?.length ? " on" : ""}${onKey ? " key" : ""}`} onClick={toggleKey} title={onKey ? "Remove keyframe here" : "Animate this control: add a keyframe here"}>
            ◆
          </button>
        )}
        <span title={d.name}>{d.name}</span>
        {dirty && (
          <button className="ctl-reset" onClick={() => apply(reset(layer.id, [d.name]), `Reset ${d.name}`)} title="Back to how the film was made">
            ↺
          </button>
        )}
      </div>
      {d.kind === "number" ? (
        <div className="ctl-slider">
          <input
            type="range"
            min={d.min}
            max={d.max}
            step={d.step}
            value={v}
            style={{ ["--fill" as string]: `${((v - d.min) / (d.max - d.min)) * 100}%` }}
            onChange={(e) => set(+e.target.value)}
            aria-label={d.name}
          />
          <input type="number" min={d.min} max={d.max} step={d.step} value={+Number(v).toFixed(4)} onChange={(e) => e.target.value !== "" && Number.isFinite(+e.target.value) && set(+e.target.value)} aria-label={`${d.name} value`} />
        </div>
      ) : d.kind === "color" ? (
        <div className="ctl-color">
          <label className="ctl-swatch" style={{ background: v }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"} onChange={(e) => set(e.target.value)} aria-label={d.name} />
          </label>
          <input value={v} onChange={(e) => set(e.target.value)} spellCheck={false} aria-label={`${d.name} hex`} />
        </div>
      ) : d.kind === "text" ? (
        String(d.value).length > 30 || /\n/.test(String(v)) ? (
          <textarea value={v} onChange={(e) => set(e.target.value)} rows={2} aria-label={d.name} />
        ) : (
          <input className="ctl-text" value={v} onChange={(e) => set(e.target.value)} aria-label={d.name} />
        )
      ) : d.kind === "toggle" ? (
        <button className={`ctl-switch${v ? " on" : ""}`} role="switch" aria-checked={!!v} aria-label={d.name} onClick={() => set(!v)}>
          <i />
        </button>
      ) : d.kind === "select" ? (
        <div className="ctl-choice">
          {d.options.map((o) => (
            <button key={o} className={o === v ? "on" : ""} onClick={() => set(o)}>
              {o}
            </button>
          ))}
        </div>
      ) : (
        <Pad value={v as [number, number]} aspect={size.w / size.h} set={set} onEdit={onEdit} name={d.name} />
      )}
    </div>
  );
}

// A place in the frame: a small picture of the frame with a dot to drag.
function Pad({ value, aspect, set, onEdit, name }: { value: [number, number]; aspect: number; set: (v: unknown) => void; onEdit: () => void; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    onEdit();
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);
    const to = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      set([Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * 1000) / 1000, Math.round(Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) * 1000) / 1000]);
    };
    to(e);
    const move = (ev: PointerEvent) => to(ev);
    const stop = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
  };
  return (
    <div className="ctl-pad" ref={ref} style={{ aspectRatio: String(aspect) }} onPointerDown={drag} role="slider" aria-label={name} aria-valuenow={Math.round(value[0] * 100)} aria-valuetext={`${Math.round(value[0] * 100)}% across, ${Math.round(value[1] * 100)}% down`}>
      <i style={{ left: `${value[0] * 100}%`, top: `${value[1] * 100}%` }} />
    </div>
  );
}

// The film's points, as handles to drag on the canvas itself.
export function PointHandles({ store, doc, onEdit }: { store: Store; doc: Doc; onEdit: () => void }) {
  const time = useStore(store, (s) => s.time);
  const points = controlled(doc).flatMap(({ layer, defs }) => defs.filter((d) => d.kind === "point").map((d) => ({ layer, d })));
  if (!points.length) return null;
  const drag = (e: React.PointerEvent<HTMLButtonElement>, layer: Layer, d: ControlDef) => {
    e.preventDefault();
    e.stopPropagation();
    onEdit();
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const st = store.getState();
    const t = st.time;
    e.currentTarget.setPointerCapture(e.pointerId);
    st.beginGesture();
    const move = (ev: PointerEvent) => {
      const x = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)), y = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
      store.getState().apply(setProp(layer.id, controlPath(d.name), [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000], t), `Move ${d.name}`);
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
  return (
    <>
      {points.map(({ layer, d }) => {
        const [x, y] = shown(layer, d, time) as [number, number];
        return (
          <button key={`${layer.id}-${d.name}`} className="ctl-handle" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onPointerDown={(e) => drag(e, layer, d)} title={`Drag: ${d.name}`}>
            <span>{d.name}</span>
          </button>
        );
      })}
    </>
  );
}
