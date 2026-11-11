// Saving the editor's doc onto its film, kept free of React so it can be tested.
// Edits are saved a moment after they stop (and at once when the page is left or hidden), one save at
// a time, each checked against the film version it was made from. A save that lands on a film the
// Studio (or another tab) changed meanwhile isn't made: the editor says so and the person chooses
// whose version stays. Until an edit reaches the film it's also kept in this browser, so leaving the
// page, going offline or a failed save loses nothing.

import type { FilmWhere, LibraryFilm, SaveFilmOpts, SaveFilmResult } from "@/lib/library";
import type { Doc } from "../doc/schema";

export type FilmRef = { id: string; where: FilmWhere; cloud: boolean; version: string };

export type SaveStatus =
  | { kind: "idle" } // in step with the film
  | { kind: "pending" } // edits waiting, or on their way
  | { kind: "saved"; forked?: string } // saved (forked: an example became this film of your own)
  | { kind: "error"; message: string } // the last save failed; kept in this browser meanwhile
  | { kind: "conflict"; film: LibraryFilm; version: string } // the film changed elsewhere
  | { kind: "gone" }; // the film was deleted

export type SaverDeps = {
  getDoc: () => Doc;
  save: (id: string, doc: Doc, opts: SaveFilmOpts) => Promise<SaveFilmResult>;
  // Keep a doc that hasn't reached the film in this browser, and forget it once it has.
  keepLocal: (id: string, doc: Doc, source: string) => Promise<void> | void;
  clearLocal: (id: string) => Promise<void> | void;
  onStatus: (s: SaveStatus) => void;
  // An example was saved as a film of your own (`to`): returns `doc` as that film holds it (its
  // meta names the new film), which counts as saved.
  onForked: (from: string, to: string, film: LibraryFilm, doc: Doc) => Doc;
  delay?: number;
};

export type Saver = ReturnType<typeof createSaver>;

// `saved`: the doc the film holds, or null when what's open hasn't reached it (edits brought back from this browser).
export function createSaver(start: FilmRef, saved: Doc | null, deps: SaverDeps, initial: SaveStatus = { kind: "idle" }) {
  const film = { ...start };
  let savedDoc = saved;
  let status = initial;
  let job: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Set once the person throws these edits away (for the film's version): nothing more is saved or kept.
  let discarded = false;
  // Films with a copy of unsaved edits kept in this browser.
  const kept = new Set<string>();
  const delay = deps.delay ?? 800;

  const set = (s: SaveStatus) => {
    status = s;
    deps.onStatus(s);
  };
  const blocked = () => status.kind === "conflict" || status.kind === "gone";
  const dirty = () => !discarded && deps.getDoc() !== savedDoc;

  // Keep what hasn't reached the film in this browser (the page may be going away, or the save failed).
  const stash = () => {
    if (!dirty() || status.kind === "gone") return;
    kept.add(film.id);
    void Promise.resolve(deps.keepLocal(film.id, deps.getDoc(), film.version)).catch(() => {});
  };

  async function run(force: boolean) {
    const doc = deps.getDoc();
    if (doc === savedDoc) return;
    const from = { ...film };
    set({ kind: "pending" });
    let r: SaveFilmResult;
    try {
      r = await deps.save(from.id, doc, { base: from.version, force, cloud: from.cloud, where: from.where === "example" ? undefined : from.where });
    } catch (e) {
      set({ kind: "error", message: (e as Error)?.message || String(e) });
      stash();
      return;
    }
    if (r.status === "gone") {
      set({ kind: "gone" });
      return;
    }
    if (r.status === "conflict") {
      set({ kind: "conflict", film: r.film, version: r.version });
      stash();
      return;
    }
    let held = doc;
    if (r.id !== from.id) {
      film.id = r.id;
      film.where = from.cloud ? "cloud" : "local";
      held = deps.onForked(from.id, r.id, r.film, doc);
    }
    film.version = r.version;
    savedDoc = held;
    set({ kind: "saved", forked: r.forked ? r.film.title : undefined });
    if (dirty()) {
      // Newer edits came meanwhile: what's kept here is them, against the version just saved.
      if (kept.size) stash();
    } else {
      for (const id of kept) void Promise.resolve(deps.clearLocal(id)).catch(() => {});
      kept.clear();
    }
  }

  // The film changed elsewhere: nothing more is saved until the person chooses whose version stays
  // (with no edits here, there's only the new one to take).
  function changedElsewhere(f: LibraryFilm, version: string) {
    if (version === film.version || status.kind === "gone" || discarded) return;
    set({ kind: "conflict", film: f, version });
    stash();
  }

  const schedule = (ms = delay) => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  // Save now (after any save on its way). `force` saves over a film that changed elsewhere.
  async function flush(force = false): Promise<void> {
    clearTimeout(timer);
    while (job) await job;
    if (!dirty() || (blocked() && !force)) return;
    job = run(force).finally(() => (job = null));
    await job;
    if (dirty() && !blocked() && status.kind !== "error") schedule();
  }

  return {
    // The film being saved to (an example's id until it's forked).
    get film(): Readonly<FilmRef> {
      return film;
    },
    get status() {
      return status;
    },
    // Edits waiting, or a save on its way.
    busy: () => !!job || (dirty() && status.kind !== "gone"),
    // Edits here the film doesn't hold (what "Keep my edits" would save over a changed film).
    unsaved: dirty,
    // The doc changed: save it once edits pause (not while the film's version is in question).
    changed() {
      if (blocked() || !dirty()) return;
      if (status.kind !== "pending") set({ kind: "pending" });
      schedule();
    },
    flush,
    stash,
    // The person chose their version over the film's changed one: it's saved over it, edited or not.
    keepMine() {
      savedDoc = null;
      return flush(true);
    },
    // The person chose the film's version: these edits are neither saved nor kept.
    discard() {
      discarded = true;
      clearTimeout(timer);
    },
    // The film was found changed elsewhere (the Studio saved it while this was open).
    changedElsewhere,
    // Another page said it saved this film: read it as stored (`read`) and flag it if it changed. A
    // save of this editor's that lands while it's read leaves what was read ambiguous (from before
    // that save, or after it), so it's read again once the save is in. Throws what `read` throws.
    async checkElsewhere(read: (id: string) => Promise<{ film: LibraryFilm; version: string }>) {
      for (let tries = 0; tries < 3; tries++) {
        while (job) await job;
        if (status.kind === "gone" || discarded) return;
        const at = { id: film.id, version: film.version };
        let got: { film: LibraryFilm; version: string } | undefined;
        let failed: unknown;
        try {
          got = await read(at.id);
        } catch (e) {
          failed = e;
        }
        if (job || film.id !== at.id || film.version !== at.version) continue;
        if (!got) throw failed;
        changedElsewhere(got.film, got.version);
        return;
      }
    },
    gone() {
      clearTimeout(timer);
      set({ kind: "gone" });
    },
    // Edits brought back from this browser are kept there until they reach the film.
    keptAt(id: string) {
      kept.add(id);
    },
  };
}
