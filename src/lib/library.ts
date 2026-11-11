// The film library's storage rules, kept free of React so they can be tested.
// Guest films live in one localStorage list that every open tab shares, so a save
// merges one film into what's stored instead of writing this tab's copy of the
// whole list. A film being built carries a heartbeat so another tab, or the next
// page load, can tell a live build from one whose page went away: buildingAt on
// the film, refreshed in the cloud, and for guest films a small key of its own
// (rewriting it doesn't rewrite the shared list).
//
// One film, one source of truth: the Studio and the editor read and write the same film
// record (getFilm, saveFilmDoc). Examples come from SHOWCASE and fork into a film of your
// own on their first save; guests' films live in localStorage (FILMS_KEY), signed-in films
// in the cloud (/api/projects). A guest film's sound, images and fonts, which have nowhere else to
// live, are kept in this browser's IndexedDB so they survive leaving the page.

import { produce } from "immer";
import { Doc, type Doc as DocT, Layer as LayerSchema, newId } from "@/editor/doc/schema";
import type { AudioClip } from "./audio";
import type { Aspect } from "./engine";
import { SHOWCASE } from "./presets/showcase";

type Film = { id: string; code?: string; doc?: unknown; building?: string; buildingAt?: number; failed?: string };

// The guests' film list in localStorage.
export const FILMS_KEY = "animate.projects.v1";

// A film as the library keeps it: what the Studio and the editor both read. Whatever else the
// Studio stores on a film (its thread, renders, favorite…) rides along untouched.
export type LibraryFilm = {
  id: string;
  title: string;
  code: string;
  duration: number;
  aspect: Aspect;
  // Films made of layers (recreations, and every film once edited in the editor). When there is
  // one, it is what plays, previews, exports and gets chat-edited.
  doc?: DocT;
  // Signed-in films' images (private Blob paths, drawn by name); a guest's are in loadGuestMedia.
  assets?: { name: string; pathname: string }[];
  // The soundtrack. Saved clips carry a Blob `pathname`; a guest's clips load from loadGuestMedia.
  audio?: AudioClip[];
  prompt?: string;
  thread?: unknown[];
  builtin?: boolean;
  building?: string;
  buildingAt?: number;
  failed?: string;
  createdAt: number;
  updatedAt?: number;
};

// How often a running build refreshes its heartbeat (in the cloud, where each beat is a storage
// write, less often), and how old one gets before the build counts as dead. Generous, because
// browsers wake hidden tabs' timers only about once a minute.
export const HEARTBEAT_MS = 10_000;
export const CLOUD_HEARTBEAT_MS = 30_000;
export const STALE_MS = 90_000;
export const INTERRUPTED = "This build was interrupted: the page was closed or reloaded before it finished.";

// Clear building marks whose heartbeat went stale and that no run in this page owns;
// a film such a build never produced says why. Returns the same list when nothing changed.
export function settleBuilds<T extends Film>(
  list: T[],
  now: number,
  live: (runId: string) => boolean = () => false,
  beatOf: (id: string) => number | undefined = () => undefined,
): T[] {
  let changed = false;
  const out = list.map((p) => {
    const at = Math.max(p.buildingAt ?? -Infinity, beatOf(p.id) ?? -Infinity);
    if (!p.building || live(p.building) || now - at <= STALE_MS) return p;
    changed = true;
    return { ...p, building: undefined, buildingAt: undefined, ...(p.code || p.doc ? {} : { failed: p.failed ?? INTERRUPTED }) };
  });
  return changed ? out : list;
}

export function readFilms<T>(storage: Storage, key: string): T[] {
  try {
    const list = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// The stored list when it can be trusted to say what's stored: null when it's there but unreadable (corrupt
// JSON, not a list), so nothing is pruned or dropped on the strength of an empty answer. Storage errors
// (blocked in some private modes) are thrown for the caller to treat the same way.
export function readFilmsIfValid<T>(storage: Storage, key: string): T[] | null {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

// Read-merge-write one film: replace it where it is, or add it at the end. Throws when storage is full.
export function saveFilm<T extends { id: string }>(storage: Storage, key: string, film: T) {
  const list = readFilms<T>(storage, key);
  const at = list.findIndex((x) => x.id === film.id);
  storage.setItem(key, JSON.stringify(at >= 0 ? list.map((x, i) => (i === at ? film : x)) : [...list, film]));
}

// Merge a change into a stored film, only while it's still stored (deleted stays deleted).
export function patchStoredFilm<T extends { id: string }>(storage: Storage, key: string, id: string, patch: (cur: T) => Partial<T> | null): T | null {
  const cur = readFilms<T>(storage, key).find((x) => x.id === id);
  const delta = cur && patch(cur);
  if (!cur || !delta) return null;
  const next = { ...cur, ...delta };
  saveFilm(storage, key, next);
  return next;
}

export function dropFilm(storage: Storage, key: string, id: string) {
  const list = readFilms<{ id: string }>(storage, key);
  if (list.some((x) => x.id === id)) storage.setItem(key, JSON.stringify(list.filter((x) => x.id !== id)));
}

// A guest build's heartbeat key.
const beatKey = (id: string) => `animate.beat.v1.${id}`;
export const beat = (storage: Storage, id: string, at: number) => storage.setItem(beatKey(id), String(at));
export const endBeat = (storage: Storage, id: string) => storage.removeItem(beatKey(id));
export function lastBeat(storage: Storage, id: string): number | undefined {
  const v = Number(storage.getItem(beatKey(id)));
  return v > 0 ? v : undefined;
}

// Everything the editor autosaved for a film (`animate.editor.<version>.<id>`).
export function dropEditorSaves(storage: Storage, id: string) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith("animate.editor.") && k.endsWith(`.${id}`)) keys.push(k);
  }
  for (const k of keys) storage.removeItem(k);
}

export const isQuotaError = (e: unknown) =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);

// ── Merging what another page saved ──

// `next` (the stored copy) as an update of `cur` (this page's copy): `cur` itself when nothing but
// the save time differs, else `next` reusing `cur`'s value for every field whose content is the
// same, so an unchanged scene or doc keeps its identity (nothing recompiles or re-renders).
export function adoptFilm<T extends object>(cur: T, next: T): T {
  const a = cur as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const same = (k: string) => a[k] === b[k] || JSON.stringify(a[k]) === JSON.stringify(b[k]);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("updatedAt");
  if ([...keys].every(same)) return cur;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(b)) out[k] = k !== "updatedAt" && same(k) ? a[k] : b[k];
  return out as T;
}

// What a page knows of its own saves of one film, to tell whether its copy is newer than a stored one.
export type OwnSaves = {
  // A save of it is waiting or on its way (cloud), or it couldn't be stored at all (a guest's full browser).
  pending: boolean;
  // When this page last changed it (ms).
  touchedAt?: number;
  // Its latest cloud save failed…
  failed?: boolean;
  // …and the save time (updatedAt) of the stored copy this page's copy was last in step with: read,
  // adopted, or the one its last save that landed made.
  synced?: number;
};

// Whether this page's copy of a film stays over the copy read from storage at `readAt` (`stored`, when
// the film was there). It does while a save of it is pending, and when this page changed it after the read
// began: that change's save may still be queued in a state update, so what was read is older. After a save
// failed, it stays only while the stored copy is the one that save failed to replace: once another page
// (the editor, say) saved the film, the stored copy is newer, and this page's next saves build on it.
export function keepsOwnCopy(own: OwnSaves, readAt: number, stored?: { updatedAt?: number }): boolean {
  if (own.pending || (own.touchedAt ?? -Infinity) >= readAt) return true;
  return !!own.failed && !(stored && (stored.updatedAt ?? 0) > (own.synced ?? -Infinity));
}

// A stored list brought into this page's list: changed films are adopted, new ones added at the end.
// `mine(id)` keeps this page's copy (a save of it is still on its way, or it changed since the list
// was read); a film this page is building keeps its building mark. Films missing from `stored` stay
// (a save that failed must not take the film off screen). The same list when nothing changed.
export function mergeFilms<T extends Film & { builtin?: boolean }>(
  list: T[],
  stored: T[],
  mine: (id: string) => boolean = () => false,
  live: (runId: string) => boolean = () => false,
): T[] {
  const byId = new Map(stored.map((f) => [f.id, f]));
  let changed = false;
  const out = list.map((cur) => {
    const s = byId.get(cur.id);
    if (!s || cur.builtin || mine(cur.id)) return cur;
    const own = cur.building && live(cur.building) ? { ...s, building: cur.building, buildingAt: cur.buildingAt } : s;
    const next = adoptFilm(cur, own);
    if (next !== cur) changed = true;
    return next;
  });
  const have = new Set(list.map((p) => p.id));
  const added = stored.filter((s) => !have.has(s.id));
  return changed || added.length ? [...out, ...added] : list;
}

// Guests: this page's list after reading the browser's list, which says what exists. Stored films are
// adopted (as mergeFilms does), except `mine` ones: this page holds a newer copy it couldn't store (or
// hasn't yet), so it stays as it is (never the older stored one, say a build's placeholder now settled as interrupted).
// This page's live builds missing from the list are `kept` while `beating` (another tab saved over them at
// that moment: save them back) and `lost` otherwise (another tab deleted them: stop them). A `mine` film
// missing from it was never stored for another tab to delete: it stays, and its build goes on. Examples stay first.
export function adoptStoredFilms<T extends Film & { builtin?: boolean }>(
  list: T[],
  stored: T[],
  mine: (id: string) => boolean,
  live: (runId: string) => boolean,
  beating: (id: string) => boolean,
): { films: T[]; kept: T[]; lost: T[] } {
  const byId = new Map(list.map((p) => [p.id, p]));
  const isStored = new Set(stored.map((s) => s.id));
  const next = stored.map((s) => {
    const cur = byId.get(s.id);
    if (!cur) return s;
    if (mine(s.id)) return cur;
    const own = cur.building && live(cur.building) ? { ...s, building: cur.building, buildingAt: cur.buildingAt } : s;
    return adoptFilm(cur, own);
  });
  const missing = list.filter((p) => !p.builtin && !isStored.has(p.id));
  const unstored = missing.filter((p) => mine(p.id));
  const building = missing.filter((p) => !mine(p.id) && p.building && live(p.building));
  const kept = building.filter((p) => beating(p.id));
  const lost = building.filter((p) => !beating(p.id));
  return { films: [...list.filter((p) => p.builtin), ...next, ...kept, ...unstored], kept, lost };
}

// ── One film, one source of truth: the editor and the Studio share these ──

export type FilmWhere = "example" | "local" | "cloud";
// `version` identifies what the film draws (format, length, doc or code): pass it to saveFilmDoc as
// `base`, and the save refuses to land on a film that changed elsewhere in the meantime.
export type OpenedFilm = { film: LibraryFilm; where: FilmWhere; cloud: boolean; version: string };

export type SaveFilmOpts = {
  // The version the doc was made from: OpenedFilm.version, then each save's version.
  base?: string;
  // Save over a film that changed elsewhere (after the person chose to keep their edits).
  force?: boolean;
  // Signed in (useAccount().isSignedIn): where a forked example goes. Asked of the server when left out.
  cloud?: boolean;
  // Where the film lives (OpenedFilm.where); found again when left out.
  where?: FilmWhere;
  // Also rename the film.
  title?: string;
  // Tests: the storage guests' films live in.
  storage?: Storage | null;
};

export type SaveFilmResult =
  // Saved. `id` differs from the one asked for when an example was forked into a film of your own.
  | { status: "saved"; id: string; forked: boolean; film: LibraryFilm; version: string }
  // Not saved: the film changed elsewhere since `base` (the Studio, another tab). `film` is it now.
  | { status: "conflict"; film: LibraryFilm; version: string }
  // Not saved: the film was deleted.
  | { status: "gone" };

// The film no longer exists (deleted, or never did).
export class FilmGone extends Error {
  constructor() {
    super("Couldn't find that film. It may have been deleted.");
  }
}

// FNV-1a over UTF-16 units, plus the length.
function hashOf(s: string) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  return `${s.length.toString(36)}.${(x >>> 0).toString(36)}`;
}

// What a film draws, fingerprinted. The server computes the same over the stored JSON (/api/projects PATCH).
export const filmVersion = (f: { aspect?: string; duration?: number; code?: string; doc?: unknown }) =>
  hashOf(`${f.aspect ?? ""}|${f.duration ?? ""}|${f.doc ? JSON.stringify(f.doc) : (f.code ?? "")}`);

// Whether two copies of a film's doc are the same doc (the same object, or equal as saved): a change made
// to one (a chat edit, an Apply) may land on the other without losing anything saved meanwhile.
export const sameDoc = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ── What draws a film ──
// A doc film's code layer: what draws everything that isn't an element (the first, if there are several).
export const codeLayerOf = (doc?: DocT) => doc?.layers.find((l) => l.type === "code");
// The code that draws a film: a doc film's code layer (that's what plays; none when it's all elements),
// else its scene code.
export const sceneCodeOf = (p: { code: string; doc?: DocT }) => {
  if (!p.doc) return p.code;
  const layer = codeLayerOf(p.doc);
  return layer ? String(layer.props.code ?? "") : "";
};
// The change that makes a film draw `code`: a doc film's code layer gets it (a doc without one gets one,
// underneath everything), any other film's scene code. Text split out of a code layer stands down once
// its code changes (the code draws it again), until the editor splits it again.
export const withSceneCode = (p: { code: string; doc?: DocT }, code: string): { code?: string; doc?: DocT } => {
  if (!p.doc) return { code };
  if (!codeLayerOf(p.doc) && !code.trim()) return {};
  return {
    doc: produce(p.doc, (d) => {
      const layer = d.layers.find((l) => l.type === "code");
      if (layer) layer.props.code = code;
      else d.layers.unshift(LayerSchema.parse({ id: newId("code"), name: "Scene (code)", type: "code", start: 0, end: d.meta.duration, props: { code } }));
    }),
  };
};

// An example film as the Studio shows it.
export function exampleFilm(id: string): LibraryFilm | null {
  const i = SHOWCASE.findIndex((x) => x.id === id);
  return i < 0 ? null : { ...SHOWCASE[i], builtin: true, createdAt: i };
}

const browserStorage = (): Storage | null => {
  try {
    return localStorage;
  } catch {
    return null;
  }
};

const OUT_OF_SPACE = "This browser is out of space, so the edit wasn't saved. Sign in to keep your films in the cloud, or delete some films.";

// A readable reason for a failed response: the server's JSON error, else the status.
async function errorOf(r: Response) {
  const text = await r.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    if (j?.error) return String(j.error);
  } catch {}
  return `Request failed (${r.status})`;
}

// Whether this browser is signed in (null: animate couldn't be reached).
async function signedIn(): Promise<boolean | null> {
  try {
    const r = await fetch("/api/projects", { method: "HEAD", cache: "no-store" });
    return r.status !== 401;
  } catch {
    return null;
  }
}

const newFilmId = () => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 12);
  let s = "";
  while (s.length < 12) s += Math.random().toString(36).slice(2);
  return s.slice(0, 12);
};

const issueText = (e: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const i = e.issues[0];
  return i ? `${i.path.map(String).join(".") || "doc"}: ${i.message}` : "invalid document";
};

// A stored film as opened: its version taken from it as stored (what saves are checked against),
// its doc read with the schema's defaults filled in.
function opened(film: LibraryFilm, where: FilmWhere, cloud: boolean): OpenedFilm {
  const version = filmVersion(film);
  if (!film.doc) return { film, where, cloud, version };
  const doc = Doc.safeParse(film.doc);
  if (!doc.success) throw new Error(`This film's layers couldn't be read (${issueText(doc.error)}).`);
  return { film: { ...film, doc: doc.data }, where, cloud, version };
}

// A film by id, wherever it lives, with its assets and audio refs. Pass `cloud` when known
// (useAccount().isSignedIn); left out, a film found in this browser opens from here and anything
// else is looked for in the cloud. Throws FilmGone when it doesn't exist.
export async function getFilm(id: string, opts: { cloud?: boolean; storage?: Storage | null } = {}): Promise<OpenedFilm> {
  const ex = exampleFilm(id);
  if (ex) return opened(ex, "example", opts.cloud ?? !!(await signedIn()));
  const storage = opts.storage !== undefined ? opts.storage : browserStorage();
  const local = storage ? readFilms<LibraryFilm>(storage, FILMS_KEY).find((x) => x.id === id) : undefined;
  if (local && opts.cloud !== true) return opened(local, "local", false);
  let unreachable: string | null = null;
  if (opts.cloud !== false) {
    try {
      const r = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (r.ok) return opened((await r.json()).project as LibraryFilm, "cloud", true);
      if (![400, 401, 404].includes(r.status)) unreachable = await errorOf(r);
    } catch (e) {
      unreachable = (e as Error).message;
    }
  }
  if (local) return opened(local, "local", !!opts.cloud);
  if (unreachable) throw new Error(`Couldn't reach your library (${unreachable}).`);
  throw new FilmGone();
}

// Examples forked by this page (example id → the fork's id), so later saves of the same example land on the fork.
const forks = new Map<string, Promise<string>>();

// Writes an edited doc onto its film, through the same storage the Studio uses: read-merge-write of
// the guest list, or a PATCH of the cloud film (doc, duration and the save time only, so nothing
// else the Studio saved is overwritten). An example is first forked into a film of your own (the
// result's id). Throws, with a readable message, when the save fails (storage full, offline…).
export async function saveFilmDoc(id: string, doc: DocT, opts: SaveFilmOpts = {}): Promise<SaveFilmResult> {
  const parsed = Doc.safeParse(doc);
  if (!parsed.success) throw new Error(`This edit can't be saved (${issueText(parsed.error)}).`);
  const next = parsed.data;
  const storage = opts.storage !== undefined ? opts.storage : browserStorage();
  const ex = exampleFilm(id);
  if (ex) {
    // Already forked by this page (or being forked: looked up before any wait, so two quick saves make
    // one fork): the save lands on the fork. A base taken from the example is this same edit session
    // carrying on (the fork holds its earlier save), so it doesn't count as a conflict.
    const pending = forks.get(id);
    const to = pending && (await pending.catch(() => null));
    if (to) return saveFilmDoc(to, next, { ...opts, where: undefined, base: opts.base === filmVersion(ex) ? undefined : opts.base });
    return forkExample(ex, next, opts, storage);
  }
  const local = opts.where === "local" || (!opts.where && !!storage && readFilms<LibraryFilm>(storage, FILMS_KEY).some((x) => x.id === id));
  return local ? saveLocalDoc(storage, id, next, opts) : saveCloudDoc(id, next, opts);
}

const withDoc = (cur: LibraryFilm, doc: DocT, title?: string): LibraryFilm => ({
  ...cur,
  doc,
  duration: doc.meta.duration,
  ...(title?.trim() ? { title: title.trim() } : {}),
  updatedAt: Date.now(),
});

function saveLocalDoc(storage: Storage | null, id: string, doc: DocT, opts: SaveFilmOpts): SaveFilmResult {
  if (!storage) throw new Error("This browser's storage is blocked, so edits can't be saved here. Sign in to keep your films in the cloud.");
  const cur = readFilms<LibraryFilm>(storage, FILMS_KEY).find((x) => x.id === id);
  if (!cur) return { status: "gone" };
  if (opts.base && !opts.force && filmVersion(cur) !== opts.base) return { status: "conflict", film: cur, version: filmVersion(cur) };
  const film = withDoc(cur, doc, opts.title);
  try {
    saveFilm(storage, FILMS_KEY, film);
  } catch (e) {
    throw isQuotaError(e) ? new Error(OUT_OF_SPACE) : e;
  }
  announceFilm(id);
  return { status: "saved", id, forked: false, film, version: filmVersion(film) };
}

async function saveCloudDoc(id: string, doc: DocT, opts: SaveFilmOpts): Promise<SaveFilmResult> {
  let r: Response;
  try {
    r = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, doc, duration: doc.meta.duration, base: opts.force ? undefined : opts.base, title: opts.title?.trim() || undefined }),
    });
  } catch (e) {
    throw new Error(`Couldn't reach your library, so the edit wasn't saved (${(e as Error).message}).`);
  }
  if (r.ok) {
    const film = (await r.json()).project as LibraryFilm;
    announceFilm(id);
    return { status: "saved", id, forked: false, film, version: filmVersion(film) };
  }
  if (r.status === 409) {
    const j = await r.json().catch(() => null);
    if (j?.project) return { status: "conflict", film: j.project, version: filmVersion(j.project) };
    throw new Error(j?.error ?? "This film is being changed elsewhere. Try again.");
  }
  if (r.status === 404) return { status: "gone" };
  // Not in this browser and not in a library you're signed in to: gone, unless it's known to be a cloud film (the session ended).
  if (r.status === 401) {
    if (opts.where === "cloud" || opts.cloud) throw new Error("You were signed out. Sign in again to keep saving this film.");
    return { status: "gone" };
  }
  if (r.status === 413) throw new Error("This film is too large to save to your library.");
  throw new Error(await errorOf(r));
}

async function forkExample(ex: LibraryFilm, doc: DocT, opts: SaveFilmOpts, storage: Storage | null): Promise<SaveFilmResult> {
  const job = (async () => {
    const cloud = opts.cloud ?? (await signedIn());
    if (cloud === null) throw new Error("Couldn't reach animate, so your copy of this example wasn't saved.");
    const id = newFilmId();
    const title = opts.title?.trim() || `${ex.title} (edited)`;
    const film: LibraryFilm = {
      id,
      title,
      code: ex.code,
      prompt: ex.prompt,
      aspect: ex.aspect,
      duration: doc.meta.duration,
      doc: { ...doc, meta: { ...doc.meta, id, title } },
      builtin: false,
      thread: [],
      createdAt: Date.now(),
    };
    if (!cloud) {
      if (!storage) throw new Error("This browser's storage is blocked, so edits can't be saved here. Sign in to keep your films in the cloud.");
      try {
        saveFilm(storage, FILMS_KEY, film);
      } catch (e) {
        throw isQuotaError(e) ? new Error(OUT_OF_SPACE) : e;
      }
      return film;
    }
    let r: Response;
    try {
      r = await fetch("/api/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(film) });
    } catch (e) {
      throw new Error(`Couldn't reach your library, so the edit wasn't saved (${(e as Error).message}).`);
    }
    if (r.status === 413) throw new Error("This film is too large to save to your library.");
    if (!r.ok) throw new Error(await errorOf(r));
    return ((await r.json()).project as LibraryFilm) ?? film;
  })();
  const to = job.then((f) => f.id);
  to.catch(() => forks.delete(ex.id));
  forks.set(ex.id, to);
  const film = await job;
  announceFilm(film.id);
  return { status: "saved", id: film.id, forked: true, film, version: filmVersion(film) };
}

// ── Telling other tabs a film changed ──
// Guests' films also raise 'storage' events; this reaches signed-in pages (and the editor) too.
const CHANNEL = "animate.films";
// This page: its own announcements aren't news to it (every channel object in the page would hear them).
const PAGE = Math.random().toString(36).slice(2);

// Tells every other page of this browser that a film was saved or deleted.
export function announceFilm(id: string) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage({ id, from: PAGE });
    c.close();
  } catch {}
}

// Calls `cb` with the id of every film another page saves or deletes. Returns the unsubscribe.
export function onFilmSaved(cb: (id: string) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const c = new BroadcastChannel(CHANNEL);
  c.onmessage = (e) => {
    const m = e.data as { id?: unknown; from?: unknown } | null;
    if (typeof m?.id === "string" && m.from !== PAGE) cb(m.id);
  };
  return () => c.close();
}

// ── The editor's saved docs ──
// The editor keeps a doc per film in IndexedDB ('animate.editor', store 'docs', keyed by film id).
// This opens that database at whatever version the editor left it, never creating it (a database
// made here, without the editor's store, would break the editor's own open), and deletes the record.
const EDITOR_DB = "animate.editor";
const EDITOR_STORE = "docs";

export function dropEditorDoc(id: string): Promise<void> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(EDITOR_DB);
    } catch {
      return resolve();
    }
    // Only fires when the database doesn't exist: nothing to delete, and nothing gets made.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      const done = () => {
        db.close();
        resolve();
      };
      if (!db.objectStoreNames.contains(EDITOR_STORE)) return done();
      try {
        const tx = db.transaction(EDITOR_STORE, "readwrite");
        tx.objectStore(EDITOR_STORE).delete(id);
        tx.oncomplete = tx.onerror = tx.onabort = done;
      } catch {
        done();
      }
    };
  });
}

// ── A guest film's sound, images and fonts ──
// Guests have no cloud storage, so the blobs behind their films' audio clips (by clip id), drawn
// images (by asset name) and brand fonts (by file name) are kept in IndexedDB ('animate.media'), keyed [film id, kind, name], and
// survive navigating away (to the editor and back, a reload). Every call fails soft: without
// IndexedDB, a film's media lasts as long as the page, as before.
export type MediaKind = "audio" | "image" | "font";
type MediaKey = [string, MediaKind, string];
type MediaRec = { blob: Blob; at: number };
const MEDIA_DB = "animate.media";
const MEDIA_STORE = "files";
// Unreferenced media younger than this is kept: a clip is stored a moment before the film lists it.
export const MEDIA_GRACE_MS = 60 * 60_000;

let mediaDb: Promise<IDBDatabase> | null = null;
function openMedia() {
  if (!mediaDb) {
    mediaDb = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(MEDIA_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(MEDIA_STORE)) req.result.createObjectStore(MEDIA_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          mediaDb = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("Couldn't open this browser's storage."));
    });
    mediaDb.catch(() => (mediaDb = null));
  }
  return mediaDb;
}

async function inMedia(mode: IDBTransactionMode, run: (s: IDBObjectStore) => void): Promise<void> {
  const db = await openMedia();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, mode);
    run(tx.objectStore(MEDIA_STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("This browser's storage refused the save."));
  });
}

// Every key of one film: arrays sort after strings, so [id, <any string>, …] falls between these.
const filmRange = (filmId: string) => IDBKeyRange.bound([filmId], [filmId, []]);

// Keeps one blob of a guest film. Resolves false when it couldn't be kept.
export async function keepGuestMedia(filmId: string, kind: MediaKind, name: string, blob: Blob): Promise<boolean> {
  try {
    const rec: MediaRec = { blob, at: Date.now() };
    await inMedia("readwrite", (s) => s.put(rec, [filmId, kind, name] satisfies MediaKey));
    return true;
  } catch {
    return false;
  }
}

// A guest film's kept blobs: audio by clip id, images by asset name, fonts by file name.
export async function loadGuestMedia(filmId: string): Promise<{ audio: Record<string, Blob>; images: Record<string, Blob>; fonts: Record<string, Blob> }> {
  const out = { audio: {} as Record<string, Blob>, images: {} as Record<string, Blob>, fonts: {} as Record<string, Blob> };
  try {
    await inMedia("readonly", (s) => {
      const req = s.openCursor(filmRange(filmId));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        const [, kind, name] = c.key as MediaKey;
        const rec = c.value as MediaRec;
        if (rec?.blob instanceof Blob) (kind === "audio" ? out.audio : kind === "font" ? out.fonts : out.images)[name] = rec.blob;
        c.continue();
      };
    });
  } catch {}
  return out;
}

// Forgets everything kept for a film (it was deleted).
export async function dropGuestMedia(filmId: string): Promise<void> {
  try {
    await inMedia("readwrite", (s) => s.delete(filmRange(filmId)));
  } catch {}
}

// Whether a kept blob can go: its film is gone, or it's a clip its film no longer lists, and it
// was kept more than MEDIA_GRACE_MS ago. `films` maps every film still stored to its clip ids.
export function staleMedia(key: MediaKey, at: number, films: Map<string, Set<string>>, now: number) {
  if (now - at < MEDIA_GRACE_MS) return false;
  const clips = films.get(key[0]);
  return !clips || (key[1] === "audio" && !clips.has(key[2]));
}

// Drops kept media nothing uses any more. Pass every guest film, once the guest library has loaded.
export async function pruneGuestMedia(films: { id: string; audio?: { id: string }[] }[], now = Date.now()): Promise<void> {
  const map = new Map(films.map((f) => [f.id, new Set((f.audio ?? []).map((c) => c.id))]));
  try {
    await inMedia("readwrite", (s) => {
      const req = s.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (staleMedia(c.key as MediaKey, (c.value as MediaRec)?.at ?? 0, map, now)) c.delete();
        c.continue();
      };
    });
  } catch {}
}
