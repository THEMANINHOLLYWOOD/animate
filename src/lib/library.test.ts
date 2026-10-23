import { afterEach, describe, expect, it, vi } from "vitest";
import { Doc } from "@/editor/doc/schema";
import {
  adoptFilm,
  adoptStoredFilms,
  announceFilm,
  beat,
  codeLayerOf,
  dropEditorSaves,
  dropFilm,
  endBeat,
  FilmGone,
  FILMS_KEY,
  filmVersion,
  getFilm,
  INTERRUPTED,
  isQuotaError,
  keepsOwnCopy,
  lastBeat,
  type LibraryFilm,
  MEDIA_GRACE_MS,
  mergeFilms,
  onFilmSaved,
  patchStoredFilm,
  readFilms,
  readFilmsIfValid,
  sameDoc,
  saveFilm,
  saveFilmDoc,
  sceneCodeOf,
  settleBuilds,
  STALE_MS,
  staleMedia,
  withSceneCode,
} from "./library";
import { SHOWCASE } from "./presets/showcase";

// A Map-backed stand-in for localStorage; `limit` makes setItem throw like a full quota.
function memoryStorage(limit = Infinity): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > limit) throw new DOMException("full", "QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

type F = { id: string; code?: string; title?: string; building?: string; buildingAt?: number; failed?: string };
const KEY = "animate.projects.v1";

describe("settleBuilds", () => {
  const now = 1_000_000;

  it("keeps a build whose heartbeat is fresh (another tab is still on it)", () => {
    const list: F[] = [{ id: "a", code: "", building: "r1", buildingAt: now - 20_000 }];
    expect(settleBuilds(list, now)).toBe(list);
  });

  it("marks a stale build without a scene as interrupted, and keeps finished code", () => {
    const list: F[] = [
      { id: "a", code: "", building: "r1", buildingAt: now - STALE_MS - 1 },
      { id: "b", code: "scene()", building: "r2" },
    ];
    const out = settleBuilds(list, now);
    expect(out[0]).toMatchObject({ building: undefined, buildingAt: undefined, failed: INTERRUPTED });
    expect(out[1]).toMatchObject({ building: undefined, code: "scene()" });
    expect(out[1].failed).toBeUndefined();
  });

  it("never touches a build this page is running", () => {
    const list: F[] = [{ id: "a", code: "", building: "mine", buildingAt: 0 }];
    expect(settleBuilds(list, now, (r) => r === "mine")).toBe(list);
  });

  it("counts a guest build's separate heartbeat key, and old marks with no heartbeat as dead", () => {
    const s = memoryStorage();
    const list: F[] = [
      { id: "a", code: "", building: "r1", buildingAt: now - 10 * STALE_MS },
      { id: "b", code: "", building: "r2" },
    ];
    beat(s, "a", now - 5_000);
    const out = settleBuilds(list, now, undefined, (id) => lastBeat(s, id));
    expect(out[0]).toBe(list[0]);
    expect(out[1].failed).toBe(INTERRUPTED);
    endBeat(s, "a");
    expect(lastBeat(s, "a")).toBeUndefined();
    expect(settleBuilds(list, now, undefined, (id) => lastBeat(s, id))[0].building).toBeUndefined();
  });
});

describe("guest storage", () => {
  it("merges one film into what's stored instead of overwriting other films", () => {
    const s = memoryStorage();
    s.setItem(KEY, JSON.stringify([{ id: "g1" }, { id: "g2" }]));
    saveFilm<F>(s, KEY, { id: "new", title: "New" });
    saveFilm<F>(s, KEY, { id: "g1", title: "Renamed" });
    expect(readFilms<F>(s, KEY)).toEqual([{ id: "g1", title: "Renamed" }, { id: "g2" }, { id: "new", title: "New" }]);
  });

  it("patches a stored film, but never brings back a deleted one", () => {
    const s = memoryStorage();
    saveFilm<F>(s, KEY, { id: "a", code: "", building: "r1" });
    expect(patchStoredFilm<F>(s, KEY, "a", () => ({ code: "x", building: undefined }))).toMatchObject({ code: "x" });
    dropFilm(s, KEY, "a");
    expect(patchStoredFilm<F>(s, KEY, "a", () => ({ code: "y" }))).toBeNull();
    expect(readFilms(s, KEY)).toEqual([]);
  });

  it("reads garbage as an empty list", () => {
    const s = memoryStorage();
    s.setItem(KEY, "{not json");
    expect(readFilms(s, KEY)).toEqual([]);
  });

  it("tells an unreadable list apart from an empty one, so nothing is pruned on its word", () => {
    const s = memoryStorage();
    expect(readFilmsIfValid(s, KEY)).toEqual([]);
    s.setItem(KEY, JSON.stringify([{ id: "a" }]));
    expect(readFilmsIfValid(s, KEY)).toEqual([{ id: "a" }]);
    s.setItem(KEY, "{not json");
    expect(readFilmsIfValid(s, KEY)).toBeNull();
    s.setItem(KEY, JSON.stringify({ id: "a" }));
    expect(readFilmsIfValid(s, KEY)).toBeNull();
  });

  it("tells a doc saved elsewhere from the same doc", () => {
    const doc = { meta: { id: "a", duration: 4 }, layers: [{ id: "l1" }] };
    expect(sameDoc(doc, doc)).toBe(true);
    expect(sameDoc(doc, JSON.parse(JSON.stringify(doc)))).toBe(true);
    expect(sameDoc(undefined, undefined)).toBe(true);
    expect(sameDoc(doc, { ...doc, layers: [] })).toBe(false);
    expect(sameDoc(doc, undefined)).toBe(false);
  });

  it("removes the editor's autosaves for a deleted film only", () => {
    const s = memoryStorage();
    s.setItem("animate.editor.v1.abc", "{}");
    s.setItem("animate.editor.v2.abc", "{}");
    s.setItem("animate.editor.v1.xabc", "{}");
    s.setItem(KEY, "[]");
    dropEditorSaves(s, "abc");
    expect([0, 1].map((i) => s.key(i)).sort()).toEqual(["animate.editor.v1.xabc", KEY].sort());
  });

  it("surfaces a full quota as a quota error", () => {
    const s = memoryStorage(10);
    let caught: unknown;
    try {
      saveFilm<F>(s, KEY, { id: "a", title: "far too long to fit" });
    } catch (e) {
      caught = e;
    }
    expect(isQuotaError(caught)).toBe(true);
    expect(isQuotaError(new Error("other"))).toBe(false);
  });
});

// ── One film, one source of truth ──

const docOf = (id: string, duration = 5, text = "Hello") =>
  Doc.parse({
    meta: { id, title: "T", size: { w: 1920, h: 1080 }, duration },
    layers: [
      { id: "scene", name: "Scene (code)", type: "code", start: 0, end: duration, props: { code: "lib.bg(ctx, W, H, C.ivory)" } },
      { id: "t1", name: "Title", type: "text", start: 0, end: duration, props: { text } },
    ],
  });

const guestFilm = (id: string, extra: Partial<LibraryFilm> = {}): LibraryFilm => ({ id, title: "Mine", code: "scene()", duration: 5, aspect: "16:9", createdAt: 1, ...extra });

describe("filmVersion", () => {
  it("changes with what the film draws, not with its title, thread or favorite", () => {
    const f = guestFilm("a");
    const renamed: LibraryFilm = { ...f, title: "Other", thread: [{}] };
    expect(filmVersion(renamed)).toBe(filmVersion(f));
    expect(filmVersion({ ...f, code: "other()" })).not.toBe(filmVersion(f));
    expect(filmVersion({ ...f, duration: 6 })).not.toBe(filmVersion(f));
    expect(filmVersion({ ...f, aspect: "1:1" })).not.toBe(filmVersion(f));
    const withDoc = { ...f, doc: docOf("a") };
    expect(filmVersion(withDoc)).not.toBe(filmVersion(f));
    // A doc film's version is its doc's: the leftover scene code doesn't count.
    expect(filmVersion({ ...withDoc, code: "other()" })).toBe(filmVersion(withDoc));
  });
});

describe("merging another page's saves", () => {
  it("keeps this page's copy when nothing but the save time differs", () => {
    const cur = { id: "a", code: "x", doc: { big: [1, 2] }, updatedAt: 1 };
    expect(adoptFilm(cur, { ...cur, doc: { big: [1, 2] }, updatedAt: 2 })).toBe(cur);
  });

  it("takes the stored copy, reusing every unchanged field's value", () => {
    const doc = { big: [1, 2] };
    const cur = { id: "a", title: "Old", doc };
    const next = adoptFilm(cur, { id: "a", title: "New", doc: { big: [1, 2] } });
    expect(next).not.toBe(cur);
    expect(next.title).toBe("New");
    expect(next.doc).toBe(doc);
  });

  it("adopts changed films, adds new ones, and keeps this page's own copies, builds and examples", () => {
    const list = [
      { id: "ex", code: "e", builtin: true },
      { id: "a", code: "a1" },
      { id: "b", code: "b1" },
      { id: "c", code: "c1", building: "run1", buildingAt: 5 },
      { id: "gone", code: "g" },
    ];
    const stored = [
      { id: "ex", code: "changed" },
      { id: "a", code: "a2" },
      { id: "b", code: "b2" },
      { id: "c", code: "c2" },
      { id: "new", code: "n" },
    ];
    const out = mergeFilms(list, stored, (id) => id === "b", (run) => run === "run1");
    expect(out.map((f) => [f.id, f.code])).toEqual([
      ["ex", "e"],
      ["a", "a2"],
      ["b", "b1"],
      ["c", "c2"],
      // A film missing from what's stored stays (a save that failed mustn't take it off screen).
      ["gone", "g"],
      ["new", "n"],
    ]);
    expect(out[3]).toMatchObject({ building: "run1", buildingAt: 5 });
    expect(out[0]).toBe(list[0]);
    expect(mergeFilms(list, list)).toBe(list);
  });

  it("keeps a film whose last save failed over the older stored copy (a placeholder settling as interrupted)", () => {
    const built: F = { id: "a", code: "scene" };
    const stored = settleBuilds<F>([{ id: "a", code: "", building: "run1", buildingAt: 0 }], STALE_MS + 1);
    expect(stored[0].failed).toBe(INTERRUPTED);
    expect(mergeFilms([built], stored, (id) => id === "a")[0]).toBe(built);
    expect(adoptStoredFilms([built], stored, (id) => id === "a", () => false, () => false).films).toEqual([built]);
    expect(adoptStoredFilms([built], stored, () => false, () => false, () => false).films[0].failed).toBe(INTERRUPTED);
  });
});

describe("whose copy of a film is newer", () => {
  const readAt = 1_000;

  it("this page's, while a save of it is pending or it changed after the read began", () => {
    expect(keepsOwnCopy({ pending: true }, readAt, { updatedAt: 9 })).toBe(true);
    // Its save is still queued in a state update: what was read can't hold it yet.
    expect(keepsOwnCopy({ pending: false, touchedAt: readAt }, readAt, { updatedAt: 9 })).toBe(true);
    expect(keepsOwnCopy({ pending: false, touchedAt: readAt - 1 }, readAt, { updatedAt: 9 })).toBe(false);
    expect(keepsOwnCopy({ pending: false }, readAt)).toBe(false);
  });

  it("after a failed save, this page's until another page saves the film", () => {
    const failed = { pending: false, touchedAt: 10, failed: true, synced: 500 };
    // The stored copy is the one the save failed to replace (or older, or gone): this page's is newer.
    expect(keepsOwnCopy(failed, readAt, { updatedAt: 500 })).toBe(true);
    expect(keepsOwnCopy(failed, readAt, { updatedAt: 400 })).toBe(true);
    expect(keepsOwnCopy(failed, readAt)).toBe(true);
    // The editor saved it since: its copy is shown.
    expect(keepsOwnCopy(failed, readAt, { updatedAt: 501 })).toBe(false);
    // Never saved from here at all: any stored copy was saved elsewhere.
    expect(keepsOwnCopy({ pending: false, failed: true }, readAt, { updatedAt: 1 })).toBe(false);
  });

  it("keeps a guest page's queued change over the older stored copy it was read with", () => {
    const list = [{ id: "a", code: "built", thread: ["brief"] }];
    const stored = [{ id: "a", code: "" }];
    const touched: Record<string, number> = { a: readAt + 5 };
    const mine = (id: string) => keepsOwnCopy({ pending: false, touchedAt: touched[id] }, readAt);
    expect(adoptStoredFilms(list, stored, mine, () => false, () => false).films[0]).toBe(list[0]);
    touched.a = readAt - 5;
    expect(adoptStoredFilms(list, stored, mine, () => false, () => false).films[0]).toEqual(stored[0]);
  });
});

describe("a guest page reading the browser's list", () => {
  const none = () => false;

  it("takes what's stored as what exists, keeping examples first and this page's live builds' marks", () => {
    const list = [
      { id: "ex", code: "e", builtin: true },
      { id: "a", code: "a1" },
      { id: "b", code: "", building: "run1", buildingAt: 5 },
      { id: "gone", code: "g" },
    ];
    const stored = [
      { id: "b", code: "b2" },
      { id: "a", code: "a2" },
      { id: "new", code: "n" },
    ];
    const { films, kept, lost } = adoptStoredFilms(list, stored, none, (run) => run === "run1", none);
    expect(films.map((f) => [f.id, f.code])).toEqual([
      ["ex", "e"],
      ["b", "b2"],
      ["a", "a2"],
      ["new", "n"],
    ]);
    expect(films[1]).toMatchObject({ building: "run1", buildingAt: 5 });
    expect(kept).toEqual([]);
    expect(lost).toEqual([]);
  });

  it("keeps a live build another tab saved over (still beating) and stops one another tab deleted", () => {
    const list = [
      { id: "over", code: "", building: "r1" },
      { id: "deleted", code: "", building: "r2" },
      { id: "theirs", code: "", building: "other-tab" },
    ];
    const { films, kept, lost } = adoptStoredFilms(list, [], none, (run) => run !== "other-tab", (id) => id === "over");
    expect(films.map((f) => f.id)).toEqual(["over"]);
    expect(kept.map((f) => f.id)).toEqual(["over"]);
    expect(lost.map((f) => f.id)).toEqual(["deleted"]);
  });

  it("leaves films this page couldn't store as they are, stored or not, and never stops their builds", () => {
    const list = [
      { id: "a", code: "built" },
      { id: "b", code: "", building: "r1" },
    ];
    const stored = [{ id: "a", code: "", failed: INTERRUPTED }];
    const { films, kept, lost } = adoptStoredFilms(list, stored, () => true, () => true, none);
    expect(films).toEqual(list);
    expect(films[0]).toBe(list[0]);
    expect(kept).toEqual([]);
    expect(lost).toEqual([]);
  });
});

describe("getFilm", () => {
  it("opens an example without asking the cloud", async () => {
    const ex = SHOWCASE[0];
    const o = await getFilm(ex.id, { cloud: false, storage: memoryStorage() });
    expect(o).toMatchObject({ where: "example", cloud: false, film: { id: ex.id, code: ex.code, builtin: true } });
    expect(o.version).toBe(filmVersion(ex));
  });

  it("opens a guest film with its doc read, and its version as stored", async () => {
    const s = memoryStorage();
    const raw = JSON.parse(JSON.stringify({ ...guestFilm("g1"), doc: { meta: { id: "g1", title: "T", size: { w: 1920, h: 1080 }, duration: 5 }, layers: [] } }));
    s.setItem(FILMS_KEY, JSON.stringify([raw]));
    const o = await getFilm("g1", { cloud: false, storage: s });
    expect(o.where).toBe("local");
    expect(o.version).toBe(filmVersion(raw));
    // Defaults filled in by the schema.
    expect(o.film.doc?.meta.fps).toBe(30);
    expect(o.film.doc?.markers).toEqual([]);
  });

  it("says a film that doesn't exist is gone", async () => {
    await expect(getFilm("nope1234", { cloud: false, storage: memoryStorage() })).rejects.toBeInstanceOf(FilmGone);
  });
});

describe("saveFilmDoc", () => {
  it("writes the doc and its length onto a guest film, leaving everything else the Studio saved", async () => {
    const s = memoryStorage();
    saveFilm(s, FILMS_KEY, guestFilm("g1", { favorite: true, audio: [] } as Partial<LibraryFilm>));
    saveFilm(s, FILMS_KEY, guestFilm("g2"));
    const { version } = await getFilm("g1", { cloud: false, storage: s });
    const r = await saveFilmDoc("g1", docOf("g1", 7), { base: version, storage: s });
    expect(r).toMatchObject({ status: "saved", id: "g1", forked: false });
    const stored = readFilms<LibraryFilm & { favorite?: boolean }>(s, FILMS_KEY);
    expect(stored.map((f) => f.id)).toEqual(["g1", "g2"]);
    expect(stored[0]).toMatchObject({ duration: 7, favorite: true, code: "scene()", doc: { meta: { duration: 7 } } });
    expect(r.status === "saved" && r.version).toBe(filmVersion(stored[0]));
  });

  it("refuses to save over a film that changed elsewhere, unless forced", async () => {
    const s = memoryStorage();
    saveFilm(s, FILMS_KEY, guestFilm("g1"));
    const { version } = await getFilm("g1", { cloud: false, storage: s });
    // The Studio retimes the film meanwhile.
    patchStoredFilm<LibraryFilm>(s, FILMS_KEY, "g1", () => ({ duration: 9 }));
    const r = await saveFilmDoc("g1", docOf("g1"), { base: version, storage: s });
    expect(r).toMatchObject({ status: "conflict", film: { duration: 9 } });
    expect(readFilms<LibraryFilm>(s, FILMS_KEY)[0].doc).toBeUndefined();
    expect(await saveFilmDoc("g1", docOf("g1"), { base: version, force: true, storage: s })).toMatchObject({ status: "saved" });
    // A title change elsewhere isn't a conflict: it isn't what the film draws.
    const now = await getFilm("g1", { cloud: false, storage: s });
    patchStoredFilm<LibraryFilm>(s, FILMS_KEY, "g1", () => ({ title: "Renamed" }));
    expect(await saveFilmDoc("g1", docOf("g1", 5, "Hi"), { base: now.version, storage: s })).toMatchObject({ status: "saved", film: { title: "Renamed" } });
  });

  it("reports a deleted film as gone, and an invalid doc as unsaveable", async () => {
    const s = memoryStorage();
    expect(await saveFilmDoc("g1", docOf("g1"), { where: "local", storage: s })).toEqual({ status: "gone" });
    await expect(saveFilmDoc("g1", { meta: {} } as never, { storage: s })).rejects.toThrow(/can't be saved/);
  });

  it("forks an example into a film of your own on its first save, and later saves land on the fork", async () => {
    const s = memoryStorage();
    const ex = SHOWCASE[1];
    const opened = await getFilm(ex.id, { cloud: false, storage: s });
    const first = await saveFilmDoc(ex.id, docOf(ex.id, ex.duration), { base: opened.version, cloud: false, storage: s });
    expect(first).toMatchObject({ status: "saved", forked: true });
    if (first.status !== "saved") return;
    expect(first.id).not.toBe(ex.id);
    expect(first.film).toMatchObject({ title: `${ex.title} (edited)`, code: ex.code, aspect: ex.aspect, builtin: false, doc: { meta: { id: first.id } } });
    // The editor still holds the example's version: this same session carrying on, not a conflict.
    const second = await saveFilmDoc(ex.id, docOf(ex.id, ex.duration, "Changed"), { base: opened.version, cloud: false, storage: s });
    expect(second).toMatchObject({ status: "saved", id: first.id, forked: false });
    const stored = readFilms<LibraryFilm>(s, FILMS_KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0].doc?.layers[1].props.text).toBe("Changed");
  });
});

describe("saveFilmDoc, signed in", () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("sends only the doc, its length and the base version, and takes the film the server saved", async () => {
    const calls: { method?: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ method: init.method, body });
      return json({ project: { ...guestFilm("c1"), doc: body.doc, duration: body.duration, updatedAt: 5 } });
    });
    const r = await saveFilmDoc("c1", docOf("c1", 8), { where: "cloud", base: "v1", storage: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(Object.keys(calls[0].body).sort()).toEqual(["base", "doc", "duration", "id"]);
    expect(calls[0].body).toMatchObject({ id: "c1", duration: 8, base: "v1" });
    expect(r).toMatchObject({ status: "saved", id: "c1", film: { duration: 8 } });
  });

  it("reports a 409 as a conflict carrying the film as it is now, and a 404 as gone", async () => {
    const now = guestFilm("c1", { duration: 9 });
    vi.stubGlobal("fetch", async () => json({ error: "changed", project: now }, 409));
    expect(await saveFilmDoc("c1", docOf("c1"), { where: "cloud", base: "v1", storage: null })).toEqual({ status: "conflict", film: now, version: filmVersion(now) });
    vi.stubGlobal("fetch", async () => json({ error: "deleted" }, 404));
    expect(await saveFilmDoc("c1", docOf("c1"), { where: "cloud", storage: null })).toEqual({ status: "gone" });
  });

  it("shows the server's own error, and says a signed-out cloud film needs signing in", async () => {
    vi.stubGlobal("fetch", async () => json({ error: "Storage is down." }, 500));
    await expect(saveFilmDoc("c1", docOf("c1"), { where: "cloud", storage: null })).rejects.toThrow("Storage is down.");
    vi.stubGlobal("fetch", async () => json({ error: "Unauthorized" }, 401));
    await expect(saveFilmDoc("c1", docOf("c1"), { where: "cloud", storage: null })).rejects.toThrow(/signed out/);
  });
});

describe("what draws a film", () => {
  const codeFilm = guestFilm("a", { code: "draw()" });

  it("reads a code film's scene code, and a doc film's code layer", () => {
    expect(sceneCodeOf(codeFilm)).toBe("draw()");
    expect(sceneCodeOf({ ...codeFilm, doc: docOf("a") })).toBe("lib.bg(ctx, W, H, C.ivory)");
    const allElements = Doc.parse({ ...docOf("a"), layers: docOf("a").layers.filter((l) => l.type !== "code") });
    expect(codeLayerOf(allElements)).toBeUndefined();
    expect(sceneCodeOf({ ...codeFilm, doc: allElements })).toBe("");
  });

  it("applies code to a doc film's code layer, never to the scene code it no longer plays", () => {
    const doc = docOf("a");
    const change = withSceneCode({ ...codeFilm, doc }, "other()");
    expect(change.code).toBeUndefined();
    expect(codeLayerOf(change.doc)?.props.code).toBe("other()");
    expect(change.doc?.layers.map((l) => l.id)).toEqual(doc.layers.map((l) => l.id));
    expect(codeLayerOf(doc)?.props.code).toBe("lib.bg(ctx, W, H, C.ivory)");
    expect(withSceneCode(codeFilm, "other()")).toEqual({ code: "other()" });
  });

  it("gives an all-elements doc a code layer underneath everything, only when there is code", () => {
    const doc = Doc.parse({ ...docOf("a"), layers: docOf("a").layers.filter((l) => l.type !== "code") });
    expect(withSceneCode({ ...codeFilm, doc }, "  ")).toEqual({});
    const change = withSceneCode({ ...codeFilm, doc }, "under()");
    expect(change.doc?.layers[0]).toMatchObject({ type: "code", start: 0, end: 5, props: { code: "under()" } });
    expect(change.doc?.layers).toHaveLength(doc.layers.length + 1);
  });
});

describe("guest media", () => {
  const films = new Map([["f1", new Set(["clip1"])]]);
  const now = 10 * MEDIA_GRACE_MS;

  it("keeps what a stored film uses, and anything kept within the grace period", () => {
    expect(staleMedia(["f1", "audio", "clip1"], 0, films, now)).toBe(false);
    expect(staleMedia(["f1", "image", "logo.png"], 0, films, now)).toBe(false);
    expect(staleMedia(["gone", "audio", "x"], now - 1000, films, now)).toBe(false);
  });

  it("drops a deleted film's media and clips its film no longer lists", () => {
    expect(staleMedia(["gone", "image", "logo.png"], 0, films, now)).toBe(true);
    expect(staleMedia(["f1", "audio", "old"], 0, films, now)).toBe(true);
  });
});

describe("announcements", () => {
  it("never tells a page about its own saves", async () => {
    const heard: string[] = [];
    const stop = onFilmSaved((id) => heard.push(id));
    announceFilm("abc");
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(heard).toEqual([]);
  });
});
