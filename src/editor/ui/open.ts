// Opening a film in the editor: the film as the library keeps it (getFilm: the latest saved version,
// whether an example, a guest's film in this browser or a signed-in film in the cloud), with the
// images it draws and its soundtrack, as a doc whose text is split into editable text layers.

import { loadFontFiles } from "@/lib/intake";
import { getFilm, loadGuestMedia, type FilmWhere, type LibraryFilm } from "@/lib/library";
import { loadFonts, type Assets } from "@/lib/engine";
import { makeKit } from "@/lib/kit";
import { Doc } from "../doc/schema";
import { codeHash } from "../extract/codeHash";
import { withParts } from "../extract/parts";
import { withFree } from "../extract/textFree";
import { splitDocText } from "../extract/splitText";
import { pickDoc, type SavedRec } from "./session";

// ── What the editor keeps in this browser ──
// IndexedDB ('animate.editor', store 'docs', keyed by film id; the library's dropEditorDoc deletes a
// deleted film's): a film's split, so reopening skips the split, or edits that haven't reached the
// film yet. A split is made again when the film changes, or when splitting itself does (SPLIT_VERSION).
export const SPLIT_VERSION = 2;

let docsDb: Promise<IDBDatabase> | null = null;
function openDocs() {
  if (!docsDb) {
    docsDb = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("animate.editor", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("docs");
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          docsDb = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("Couldn't open this browser's storage."));
    });
    docsDb.catch(() => (docsDb = null));
  }
  return docsDb;
}
async function docs<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDocs();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("docs", mode);
    const req = run(tx.objectStore("docs"));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error("This browser's storage refused the save."));
  });
}
export const readSaved = (id: string) => docs<SavedRec | undefined>("readonly", (s) => s.get(id));
export const writeSaved = (id: string, rec: SavedRec) => docs("readwrite", (s) => s.put(rec, id));
export const dropSaved = (id: string) => docs("readwrite", (s) => s.delete(id));

// Where the first editor kept docs (localStorage). Nothing reads them any more; one found is cleared.
function dropLegacy(id: string) {
  try {
    localStorage.removeItem(`animate.editor.v1.${id}`);
  } catch {}
}

// ── Examples made your own ──
// An example's first save forks it into a film of your own, and the library sends this page's later
// saves of the example to that fork. So opening the example again in this page (Back to an editor
// entry, or a link that still names it) opens the fork: what's shown is what saves land on.
const forked = new Map<string, string>();
export const rememberFork = (from: string, to: string) => void forked.set(from, to);
export const forkOf = (id: string) => forked.get(id) ?? id;

// Points the address at film `to` while it still names `from` (the editor is still showing it), so a
// reload opens `to`. Null state, as Next's docs do it: its router keeps its own state and follows the URL.
export function showFilmUrl(from: string, to: string) {
  try {
    if (decodeURIComponent(window.location.pathname) !== `/editor/${from}`) return;
    window.history.replaceState(null, "", `/editor/${encodeURIComponent(to)}${window.location.search}${window.location.hash}`);
  } catch {}
}

// ── The film as a doc ──

// A film that is only code, as a doc of one code layer. Throws for a film with nothing to edit yet.
export function codeDoc(film: LibraryFilm): Doc {
  if (!film.code?.trim()) throw new Error("This film didn't finish, so there's nothing to edit yet. Delete it and make it again.");
  const [w, h] = film.aspect === "9:16" ? [1080, 1920] : film.aspect === "1:1" ? [1080, 1080] : [1920, 1080];
  return Doc.parse({
    meta: { id: film.id, title: film.title, size: { w, h }, duration: film.duration },
    layers: [{ id: "scene", name: "Scene (code)", type: "code", start: 0, end: film.duration, props: { code: film.code } }],
  });
}

const parse = (u: unknown) => {
  const r = Doc.safeParse(u);
  return r.success ? r.data : null;
};

// ── Images and sound ──

const mediaUrl = (pathname: string) => `/api/media?p=${encodeURIComponent(pathname)}`;

function loadImage(url: string, ms = 15_000) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    img.onload = () => {
      clearTimeout(t);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("couldn't load"));
    };
    img.src = url;
  });
}

// The images a film draws (by name, as the Studio has them) and a guest film's sound kept in this
// browser (by clip id; saved clips load from their Blob path). An image that won't load is left out.
async function loadMedia(film: LibraryFilm, where: FilmWhere): Promise<{ assets: Assets; audioBlobs: Record<string, Blob> }> {
  const byName: Record<string, HTMLImageElement> = {};
  let audioBlobs: Record<string, Blob> = {};
  // A signed-in film's own typefaces, registered under their family names before anything is measured or drawn.
  if (where === "cloud" && film.fonts?.length) {
    const files = await Promise.all(film.fonts.map(async (f) => ({ name: f.name, blob: await (await fetch(mediaUrl(f.pathname))).blob() })).map((p) => p.catch(() => null)));
    await loadFontFiles(files.filter((f) => f !== null)).catch(() => []);
  }
  if (where === "local") {
    const kept = await loadGuestMedia(film.id);
    audioBlobs = kept.audio;
    // Its brand fonts, registered under their family names before anything is measured or drawn.
    await loadFontFiles(Object.entries(kept.fonts).map(([name, blob]) => ({ name, blob })));
    await Promise.all(
      Object.entries(kept.images).map(async ([name, blob]) => {
        // A loaded image keeps drawing after its URL is let go.
        const url = URL.createObjectURL(blob);
        try {
          byName[name] = await loadImage(url);
        } catch {
        } finally {
          URL.revokeObjectURL(url);
        }
      }),
    );
  }
  await Promise.all(
    (film.assets ?? []).map(async (a) => {
      if (byName[a.name]) return;
      try {
        byName[a.name] = await loadImage(mediaUrl(a.pathname));
      } catch {}
    }),
  );
  return { assets: { images: Object.entries(byName).map(([name, img]) => ({ name, img })), byName }, audioBlobs };
}

// ── Opening ──

export type Session = {
  film: LibraryFilm; // as read (an example's own id until it's forked)
  where: FilmWhere;
  cloud: boolean;
  version: string; // what saves are checked against
  doc: Doc; // what opens, its text split
  // The film's own doc, split: what opened, or (edits brought back) what the film holds.
  filmDoc: Doc | null;
  // Edits from this browser that never reached the film (see pickDoc).
  restored: null | "same" | "conflict";
  assets: Assets;
  audioBlobs: Record<string, Blob>;
};

export async function openFilm(id: string, cloud: boolean, onProgress: (k: number) => void, signal: AbortSignal): Promise<Session> {
  const o = await getFilm(id, { cloud });
  const filmDoc = o.film.doc ?? codeDoc(o.film);
  const [saved, media] = await Promise.all([readSaved(id).catch(() => undefined), loadMedia(o.film, o.where)]);
  // Earlier editors fingerprinted the film by its doc; today's by its version.
  const picked = pickDoc({ film: filmDoc, sources: [o.version, codeHash(JSON.stringify(filmDoc))], saved, splitVersion: SPLIT_VERSION, parse });
  if (picked.dropSaved) void dropSaved(id).catch(() => {});
  dropLegacy(id);
  if (signal.aborted) throw new DOMException("Closed", "AbortError");
  const fonts = await loadFonts();
  const { w, h } = picked.doc.meta.size;
  // Splits whatever code layers aren't split yet (none, when the film was edited here before).
  const kit = makeKit(w, h, fonts);
  // …and gives each object its code draws (lib.layer) a layer of its own.
  // …and notes which of its controls leave its split text alone.
  const doc = await withFree(await withParts(await splitDocText(picked.doc, kit, media.assets, { onProgress, signal }), kit, media.assets, signal), kit, media.assets, signal);
  if (!picked.restored && doc !== picked.doc) void writeSaved(id, { v: SPLIT_VERSION, doc, edited: false, source: o.version }).catch(() => {});
  return {
    film: o.film,
    where: o.where,
    cloud: o.cloud,
    version: o.version,
    doc,
    filmDoc: picked.restored ? null : doc,
    restored: picked.restored,
    ...media,
  };
}
