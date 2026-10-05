import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { create } from "zustand";
import type { Op } from "../doc/ops";
import type { Doc } from "../doc/schema";

enablePatches();

type Step = { label: string; redo: Patch[]; undo: Patch[]; at: number; coalesce?: string };

export type EditorState = {
  doc: Doc;
  past: Step[];
  future: Step[];
  time: number;
  selection: string[];
  apply: (op: Op, label: string, opts?: { coalesce?: string }) => void;
  undo: () => void;
  redo: () => void;
  load: (doc: Doc) => void;
  setTime: (t: number) => void;
  select: (ids: string[]) => void;
};

const COALESCE_MS = 600;
const MAX_HISTORY = 300;

export const createEditorStore = (initial: Doc) =>
  create<EditorState>((set, get) => ({
    doc: initial,
    past: [],
    future: [],
    time: 0,
    selection: [],

    // Run an op, record patches. Consecutive ops sharing a coalesce key
    // (one drag gesture) merge into a single undo step.
    apply(op, label, opts) {
      const [next, redo, undo] = produceWithPatches(get().doc, op);
      if (!redo.length) return;
      const past = get().past;
      const prev = past[past.length - 1];
      const now = Date.now();
      if (opts?.coalesce && prev?.coalesce === opts.coalesce && now - prev.at < COALESCE_MS) {
        const merged: Step = { ...prev, redo: [...prev.redo, ...redo], undo: [...undo, ...prev.undo], at: now };
        set({ doc: next, past: [...past.slice(0, -1), merged], future: [] });
      } else {
        const step: Step = { label, redo, undo, at: now, coalesce: opts?.coalesce };
        set({ doc: next, past: [...past, step].slice(-MAX_HISTORY), future: [] });
      }
    },

    undo() {
      const { past, future, doc } = get();
      const step = past[past.length - 1];
      if (!step) return;
      set({ doc: applyPatches(doc, step.undo), past: past.slice(0, -1), future: [step, ...future] });
    },

    redo() {
      const { past, future, doc } = get();
      const step = future[0];
      if (!step) return;
      set({ doc: applyPatches(doc, step.redo), past: [...past, step], future: future.slice(1) });
    },

    load(doc) {
      set({ doc, past: [], future: [], selection: [], time: 0 });
    },

    setTime(t) {
      set({ time: Math.max(0, Math.min(t, get().doc.meta.duration)) });
    },

    select(ids) {
      set({ selection: ids });
    },
  }));
