import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { create } from "zustand";
import type { Op } from "../doc/ops";
import type { Doc } from "../doc/schema";

enablePatches();

type Step = { label: string; redo: Patch[]; undo: Patch[]; at: number; coalesce?: string; gesture?: number };

export type EditorState = {
  doc: Doc;
  past: Step[];
  future: Step[];
  time: number;
  selection: string[];
  apply: (op: Op, label: string, opts?: { coalesce?: string }) => void;
  // A change that follows from the last one (the layers of a scene's objects, after its code changed):
  // it joins that step, so one undo takes both back, and what was undone can still be redone.
  amend: (op: Op) => void;
  // Everything applied between beginGesture and endGesture (a drag, from pointerdown to pointerup)
  // is one undo step, however long it pauses. Gestures nest; the outermost one counts.
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  setTime: (t: number) => void;
  select: (ids: string[]) => void;
};

const COALESCE_MS = 600;
const MAX_HISTORY = 300;

export const createEditorStore = (initial: Doc) => {
  // The open gesture (an id, so a step knows which gesture made it), and how deeply it's nested.
  let gesture = 0;
  let depth = 0;
  let gestures = 0;
  const close = () => {
    depth = 0;
    gesture = 0;
  };

  return create<EditorState>((set, get) => ({
    doc: initial,
    past: [],
    future: [],
    time: 0,
    selection: [],

    // Run an op, record patches. Ops in one open gesture merge into a single undo step, and so do
    // consecutive ops sharing a coalesce key (typing in a field) within COALESCE_MS of each other.
    apply(op, label, opts) {
      const [next, redo, undo] = produceWithPatches(get().doc, op);
      if (!redo.length) return;
      const past = get().past;
      const prev = past[past.length - 1];
      const now = Date.now();
      const merge = gesture ? prev?.gesture === gesture : !!opts?.coalesce && prev?.coalesce === opts.coalesce && !prev.gesture && now - prev.at < COALESCE_MS;
      if (merge) {
        const merged: Step = { ...prev, redo: [...prev.redo, ...redo], undo: [...undo, ...prev.undo], at: now };
        set({ doc: next, past: [...past.slice(0, -1), merged], future: [] });
      } else {
        const step: Step = { label, redo, undo, at: now, coalesce: opts?.coalesce, gesture: gesture || undefined };
        set({ doc: next, past: [...past, step].slice(-MAX_HISTORY), future: [] });
      }
    },

    amend(op) {
      const [next, redo, undo] = produceWithPatches(get().doc, op);
      if (!redo.length) return;
      const past = get().past;
      const prev = past[past.length - 1];
      // In place: whoever holds the step (the agent's reply tracks its own) still holds it, and the
      // history list is the same list, so this doesn't read as a new edit (which stops playback).
      if (prev) {
        prev.redo = [...prev.redo, ...redo];
        prev.undo = [...undo, ...prev.undo];
      }
      set({ doc: next });
    },

    beginGesture() {
      if (depth++ === 0) gesture = ++gestures;
    },

    endGesture() {
      if (depth > 0 && --depth === 0) gesture = 0;
    },

    undo() {
      close();
      const { past, future, doc } = get();
      const step = past[past.length - 1];
      if (!step) return;
      set({ doc: applyPatches(doc, step.undo), past: past.slice(0, -1), future: [step, ...future] });
    },

    redo() {
      close();
      const { past, future, doc } = get();
      const step = future[0];
      if (!step) return;
      set({ doc: applyPatches(doc, step.redo), past: [...past, step], future: future.slice(1) });
    },

    setTime(t) {
      set({ time: Math.max(0, Math.min(t, get().doc.meta.duration)) });
    },

    select(ids) {
      set({ selection: ids });
    },
  }));
};
