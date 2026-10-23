import { describe, expect, it, vi } from "vitest";
import type { LibraryFilm, SaveFilmOpts, SaveFilmResult } from "@/lib/library";
import { Doc } from "../doc/schema";
import { createSaver, type FilmRef, type SaveStatus } from "./saver";

const docOf = (title: string) => Doc.parse({ meta: { id: "f", title, size: { w: 100, h: 100 }, duration: 5 }, layers: [] });
const filmOf = (id: string, title = "F"): LibraryFilm => ({ id, title, code: "", duration: 5, aspect: "16:9", createdAt: 0 });

// A saver over a fake library: `answer` decides each save's result.
function setup(o: { start?: Partial<FilmRef>; saved?: Doc | null; answer?: (id: string, doc: Doc, opts: SaveFilmOpts, n: number) => SaveFilmResult | Promise<SaveFilmResult> } = {}) {
  let doc = docOf("a");
  const calls: { id: string; doc: Doc; opts: SaveFilmOpts }[] = [];
  const statuses: SaveStatus[] = [];
  const kept: { id: string; source: string }[] = [];
  const cleared: string[] = [];
  const forks: string[] = [];
  const answer = o.answer ?? ((id) => ({ status: "saved", id, forked: false, film: filmOf(id), version: `v${calls.length + 1}` }) as SaveFilmResult);
  const saver = createSaver(
    { id: "f", where: "local", cloud: false, version: "v1", ...o.start },
    o.saved === undefined ? doc : o.saved,
    {
      getDoc: () => doc,
      save: async (id, d, opts) => {
        calls.push({ id, doc: d, opts });
        return answer(id, d, opts, calls.length);
      },
      keepLocal: (id, _d, source) => void kept.push({ id, source }),
      clearLocal: (id) => void cleared.push(id),
      onStatus: (s) => statuses.push(s),
      onForked: (from, to, f, d) => {
        forks.push(`${from}->${to}`);
        const held = { ...d, meta: { ...d.meta, id: to, title: f.title } };
        doc = held;
        return held;
      },
      delay: 5,
    },
  );
  return { saver, calls, statuses, kept, cleared, forks, edit: (t: string) => (doc = docOf(t)), doc: () => doc };
}

describe("createSaver", () => {
  it("saves an edit once edits pause, checked against the version it was made from", async () => {
    const s = setup();
    expect(s.saver.busy()).toBe(false);
    s.edit("b");
    s.saver.changed();
    s.edit("c");
    s.saver.changed();
    expect(s.saver.busy()).toBe(true);
    await vi.waitFor(() => expect(s.saver.status.kind).toBe("saved"));
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].doc.meta.title).toBe("c");
    expect(s.calls[0].opts).toMatchObject({ base: "v1", force: false, where: "local" });
    expect(s.saver.busy()).toBe(false);
    // The next save builds on the version this one made.
    s.edit("d");
    await s.saver.flush();
    expect(s.calls[1].opts.base).toBe("v2");
  });

  it("saves edits made while a save is on its way after it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({
      answer: async (id, _d, _o, n) => {
        if (n === 1) await gate;
        return { status: "saved", id, forked: false, film: filmOf(id), version: `v${n + 1}` };
      },
    });
    s.edit("b");
    const first = s.saver.flush();
    await Promise.resolve();
    s.edit("c");
    const second = s.saver.flush();
    release();
    await Promise.all([first, second]);
    expect(s.calls.map((c) => c.doc.meta.title)).toEqual(["b", "c"]);
    expect(s.saver.busy()).toBe(false);
  });

  it("stops at a film that changed elsewhere, keeps the edits here, and saves over it only when asked", async () => {
    const s = setup({ answer: (id, _d, opts) => (opts.force ? { status: "saved", id, forked: false, film: filmOf(id), version: "v9" } : { status: "conflict", film: filmOf(id, "theirs"), version: "v5" }) });
    s.edit("b");
    await s.saver.flush();
    expect(s.saver.status).toMatchObject({ kind: "conflict", version: "v5" });
    expect(s.kept).toEqual([{ id: "f", source: "v1" }]);
    // Further edits wait for the person's choice.
    s.edit("c");
    s.saver.changed();
    await s.saver.flush();
    expect(s.calls).toHaveLength(1);
    await s.saver.keepMine();
    expect(s.calls[1].opts.force).toBe(true);
    expect(s.saver.status.kind).toBe("saved");
    expect(s.cleared).toEqual(["f"]);
  });

  it("keeps a failed save's edits in this browser and tries again on the next edit", async () => {
    let fail = true;
    const s = setup({
      answer: (id) => {
        if (fail) throw new Error("offline");
        return { status: "saved", id, forked: false, film: filmOf(id), version: "v2" };
      },
    });
    s.edit("b");
    await s.saver.flush();
    expect(s.saver.status).toEqual({ kind: "error", message: "offline" });
    expect(s.kept).toHaveLength(1);
    fail = false;
    s.edit("c");
    s.saver.changed();
    await vi.waitFor(() => expect(s.saver.status.kind).toBe("saved"));
    expect(s.cleared).toEqual(["f"]);
  });

  it("follows an example into the film of your own its first save makes", async () => {
    const s = setup({
      start: { id: "ex", where: "example", cloud: true },
      answer: (id, _d, _o, n) => (n === 1 ? { status: "saved", id: "mine", forked: true, film: filmOf("mine", "Ex (edited)"), version: "m1" } : { status: "saved", id, forked: false, film: filmOf(id), version: `m${n}` }),
    });
    s.edit("b");
    await s.saver.flush();
    expect(s.calls[0]).toMatchObject({ id: "ex", opts: { where: undefined, cloud: true } });
    expect(s.forks).toEqual(["ex->mine"]);
    expect(s.saver.film).toMatchObject({ id: "mine", where: "cloud", version: "m1" });
    expect(s.saver.status).toEqual({ kind: "saved", forked: "Ex (edited)" });
    // The renamed doc it holds counts as saved.
    expect(s.saver.busy()).toBe(false);
    s.edit("c");
    await s.saver.flush();
    expect(s.calls[1]).toMatchObject({ id: "mine", opts: { base: "m1", where: "cloud" } });
  });

  it("saves edits brought back from this browser, then forgets them there", async () => {
    const s = setup({ saved: null });
    s.saver.keptAt("f");
    expect(s.saver.busy()).toBe(true);
    await s.saver.flush();
    expect(s.calls).toHaveLength(1);
    expect(s.cleared).toEqual(["f"]);
  });

  it("stops saving a deleted film, and saves nothing once its edits are discarded", async () => {
    const gone = setup({ answer: () => ({ status: "gone" }) });
    gone.edit("b");
    await gone.saver.flush();
    expect(gone.saver.status.kind).toBe("gone");
    expect(gone.kept).toHaveLength(0);
    expect(gone.saver.busy()).toBe(false);

    const s = setup();
    s.edit("b");
    s.saver.discard();
    expect(s.saver.busy()).toBe(false);
    await s.saver.flush();
    s.saver.stash();
    expect(s.calls).toHaveLength(0);
    expect(s.kept).toHaveLength(0);
  });

  it("flags a film saved elsewhere at another version", () => {
    const s = setup();
    s.saver.changedElsewhere(filmOf("f"), "v1");
    expect(s.saver.status.kind).toBe("idle");
    s.saver.changedElsewhere(filmOf("f", "theirs"), "v7");
    expect(s.saver.status).toMatchObject({ kind: "conflict", version: "v7" });
    // Nothing was edited here: there are no edits of its own to keep over the new version.
    expect(s.saver.unsaved()).toBe(false);
    s.edit("b");
    expect(s.saver.unsaved()).toBe(true);
  });

  it("reads the film again when its own save lands while it's being read, rather than flag its older version", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({ answer: (id) => ({ status: "saved", id, forked: false, film: filmOf(id), version: "v2" }) });
    // The other page's read started before this editor's save, and returns the film as it was then (v1).
    const reads: string[] = [];
    let stored = "v1";
    const read = async (id: string) => {
      const v = stored;
      reads.push(v);
      if (reads.length === 1) await gate;
      return { film: filmOf(id), version: v };
    };
    const check = s.saver.checkElsewhere(read);
    await Promise.resolve();
    s.edit("b");
    const saving = s.saver.flush();
    stored = "v2";
    await saving;
    release();
    await check;
    expect(reads).toEqual(["v1", "v2"]);
    expect(s.saver.status.kind).toBe("saved");
  });

  it("waits for a save on its way before reading, so a conflict it finds isn't overwritten by that save", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({
      answer: async (id) => {
        await gate;
        return { status: "saved", id, forked: false, film: filmOf(id), version: "v2" };
      },
    });
    s.edit("b");
    const saving = s.saver.flush();
    let read = 0;
    const check = s.saver.checkElsewhere(async (id) => {
      read++;
      return { film: filmOf(id, "theirs"), version: "v3" };
    });
    await Promise.resolve();
    expect(read).toBe(0);
    release();
    await Promise.all([saving, check]);
    expect(read).toBe(1);
    expect(s.saver.status).toMatchObject({ kind: "conflict", version: "v3" });
  });

  it("passes on a failed read only when no save of its own got in the way", async () => {
    const s = setup();
    await expect(s.saver.checkElsewhere(() => Promise.reject(new Error("gone")))).rejects.toThrow("gone");
    expect(s.saver.status.kind).toBe("idle");
  });
});
