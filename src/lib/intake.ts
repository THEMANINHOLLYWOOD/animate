// What a dropped file is, and what can be read out of it before anything is sent anywhere: its kind
// by its first bytes, the text (and pictures) inside Office, OpenDocument, iWork and RTF files, a
// font's family, a GIF's frames, a PSD's flattened picture, an SVG's size, and the facts of a
// soundtrack. Pure functions, so they run in tests; the one that touches the page is at the end.

import { unzipSync, unzlibSync } from "fflate";

// Text attachments are cut here (the generate route refuses longer ones).
export const TEXT_CAP = 200_000;
// Pictures taken out of one document.
export const IMAGE_CAP = 6;
// A plain zip's files taken one by one.
export const ZIP_FILES = 12;
// The largest member read out of an archive, and the most read out of a plain zip in all.
const MEMBER_MAX = 30_000_000;
const ZIP_TOTAL = 60_000_000;

export const extOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name)?.[1].toLowerCase() ?? "";
const stemOf = (name: string) => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "") || "file";
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const starts = (b: Uint8Array, at: number, sig: number[]) => sig.every((v, i) => b[at + i] === v);
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);
const tidy = (s: string) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

// ── What a file is ──

export type Kind = "image" | "video" | "audio" | "pdf" | "text" | "rtf" | "archive" | "font" | "unknown";
// `format` is a short id (png, svg, heic, mp3, utf-16le, zip, woff2, exe…); `why` says, for a file
// nothing can be done with, what it is and what to drop instead ("is a Windows program: …").
export type Sniffed = { kind: Kind; format: string; why?: string };

const AUDIO_EXT = /^(mp3|wav|wave|m4a|m4b|aac|ogg|oga|opus|flac|aif|aiff|aifc|wma|weba|caf|amr|mka)$/;
const VIDEO_EXT = /^(mp4|mov|m4v|webm|avi|mkv|wmv|flv|mpg|mpeg|3gp|ogv|mts|m2ts)$/;
const IMAGE_EXT = /^(png|jpe?g|gif|webp|avif|bmp|ico|svg|heic|heif|tiff?|psd|psb|jxl)$/;
const FONT_EXT = /^(ttf|otf|woff2?|ttc)$/;

// What to drop instead of a file this app can't use, by format.
const INSTEAD: Record<string, string> = {
  empty: "is empty (0 bytes): check that it finished saving or downloading, then drop it again",
  exe: "is a Windows program: there is nothing in it to draw. Drop the images, video, sound or documents you want in the film",
  elf: "is a Linux program: there is nothing in it to draw. Drop the images, video, sound or documents you want in the film",
  macho: "is a macOS program: there is nothing in it to draw. Drop the images, video, sound or documents you want in the film",
  packed: "is a compressed archive this browser can't open: unpack it and drop the files inside (zip archives are opened for you)",
  disk: "is a disk image or installer: open it and drop the files you want from inside",
  ole: "is an old Office file (.doc, .ppt, .xls): in Office choose Save As .docx, .pptx or .xlsx (or PDF) and drop that",
  ps: "is PostScript or EPS artwork: export it as SVG, PDF or PNG and drop that",
  db: "is a database: export the rows you need as CSV and drop that",
  model: "is a 3D model, and films here are drawn in 2D: render a still (PNG) or a turntable video (MP4) and drop that",
  aep: "is an After Effects project: render it to MP4 and drop the video (alone, to recreate it), or export a frame as PNG",
  design: "is a design file this browser can't read: export the frames you want as PNG or SVG (or the whole file as PDF) and drop those",
  midi: "is MIDI (notes, no sound): bounce it to MP3 or WAV and drop that as the soundtrack",
  raw: "is a camera raw photo: export it as JPEG or PNG and drop that",
  jxl: "is a JPEG XL image, which most browsers can't decode: export it as PNG or JPEG",
  ebook: "is a protected e-book format: export it as EPUB or PDF and drop that",
};
const BY_EXT: Record<string, string> = {
  exe: "exe", dll: "exe", msi: "exe", so: "elf", dylib: "macho", app: "macho",
  gz: "packed", tgz: "packed", tar: "packed", "7z": "packed", rar: "packed", bz2: "packed", xz: "packed", zst: "packed",
  dmg: "disk", iso: "disk", pkg: "disk", img: "disk",
  doc: "ole", ppt: "ole", xls: "ole", msg: "ole", pub: "ole", vsd: "ole",
  eps: "ps", ps: "ps",
  sqlite: "db", db: "db", mdb: "db", accdb: "db",
  glb: "model", gltf: "model", obj: "model", fbx: "model", blend: "model", stl: "model", usdz: "model", usd: "model", dae: "model", "3ds": "model", c4d: "model", ply: "model",
  aep: "aep", aet: "aep", prproj: "aep",
  fig: "design", sketch: "design", xd: "design", indd: "design", afdesign: "design", afphoto: "design", afpub: "design", cdr: "design", xcf: "design", ai: "design",
  mid: "midi", midi: "midi",
  cr2: "raw", cr3: "raw", nef: "raw", arw: "raw", dng: "raw", raf: "raw", orf: "raw", rw2: "raw",
  jxl: "jxl", mobi: "ebook", azw: "ebook", azw3: "ebook",
};
const unknown = (format: string, name: string): Sniffed => {
  const e = extOf(name);
  return { kind: "unknown", format, why: INSTEAD[format] ?? `is a kind of file this app can't read${e ? ` (.${e})` : ""}: drop images, video, sound, PDFs, Office or text documents, or fonts instead` };
};

// Text by its bytes: its encoding, or null for anything binary. A sample cut mid-character still counts.
export function textEncoding(head: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" | "windows-1252" | null {
  if (!head.length) return null;
  if (starts(head, 0, [0xef, 0xbb, 0xbf])) return "utf-8";
  if (starts(head, 0, [0xff, 0xfe])) return "utf-16le";
  if (starts(head, 0, [0xfe, 0xff])) return "utf-16be";
  let zeroEven = 0, zeroOdd = 0, control = 0, high = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (c === 0) {
      if (i % 2) zeroOdd++;
      else zeroEven++;
    }
    else if (c < 9 || (c > 13 && c < 32 && c !== 27)) control++;
    else if (c >= 0x80) high++;
  }
  const half = head.length / 2;
  // UTF-16 without a mark: every other byte of mostly-Latin text is zero.
  if (zeroOdd > half * 0.6 && zeroEven < half * 0.05) return "utf-16le";
  if (zeroEven > half * 0.6 && zeroOdd < half * 0.05) return "utf-16be";
  if (zeroEven + zeroOdd > 0 || control > head.length * 0.02) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return "utf-8";
  } catch {
    // Not UTF-8, but nothing binary in it: text in an older single-byte encoding (subtitles, CSV exports).
    return high < head.length * 0.3 ? "windows-1252" : null;
  }
}

// A file's kind from its first bytes (4 KB is plenty), with its name and MIME type as hints where
// the bytes don't say. What the bytes are wins over what the name claims.
export function sniff(head: Uint8Array, name: string, type = ""): Sniffed {
  const e = extOf(name);
  const t = type.toLowerCase();
  const is = (at: number, s: string) => ascii(head, at, s.length) === s;
  const of = (kind: Kind, format: string): Sniffed => ({ kind, format });
  if (!head.length) return unknown("empty", name);
  if (starts(head, 0, [0x89, 0x50, 0x4e, 0x47])) return of("image", "png");
  if (starts(head, 0, [0xff, 0xd8, 0xff])) return of("image", "jpeg");
  if (is(0, "GIF8")) return of("image", "gif");
  if (is(0, "RIFF") && is(8, "WEBP")) return of("image", "webp");
  if (is(0, "RIFF") && is(8, "WAVE")) return of("audio", "wav");
  if (is(0, "RIFF") && is(8, "AVI ")) return of("video", "avi");
  if (is(0, "RIFX")) return unknown("aep", name);
  if (is(0, "8BPS")) return of("image", "psd");
  if (starts(head, 0, [0x49, 0x49, 0x2a, 0x00]) || starts(head, 0, [0x4d, 0x4d, 0x00, 0x2a])) return BY_EXT[e] === "raw" ? unknown("raw", name) : of("image", "tiff");
  if (is(4, "ftyp")) {
    const brand = ascii(head, 8, 4).trim().toLowerCase();
    // The generic image brands (mif1, msf1) say which codec in the list that follows.
    const brands = ascii(head, 8, Math.min(Math.max(head[3], 16), 64) - 8).toLowerCase();
    if (/^avi[fs]$/.test(brand) || (/^m[is]f1$/.test(brand) && brands.includes("avi"))) return of("image", "avif");
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return of("image", "heic");
    if (brand === "crx") return unknown("raw", name);
    if (/^m4[abp]/.test(brand) || t.startsWith("audio/") || AUDIO_EXT.test(e)) return of("audio", "m4a");
    return of("video", brand === "qt" ? "mov" : "mp4");
  }
  if (is(0, "OggS")) return t.startsWith("video/") || e === "ogv" ? of("video", "ogv") : of("audio", "ogg");
  if (is(0, "fLaC")) return of("audio", "flac");
  if (is(0, "ID3")) return of("audio", "mp3");
  if (is(0, "FORM") && (is(8, "AIFF") || is(8, "AIFC"))) return of("audio", "aiff");
  if (is(0, "MThd")) return unknown("midi", name);
  if (starts(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return t.startsWith("audio/") || e === "weba" || e === "mka" ? of("audio", "webm") : of("video", e === "mkv" ? "mkv" : "webm");
  if (starts(head, 0, [0x30, 0x26, 0xb2, 0x75])) return e === "wma" || t.startsWith("audio/") ? of("audio", "wma") : of("video", "wmv");
  if (is(0, "FLV")) return of("video", "flv");
  if (is(0, "wOFF")) return of("font", "woff");
  if (is(0, "wOF2")) return of("font", "woff2");
  if (is(0, "OTTO")) return of("font", "otf");
  if (is(0, "ttcf")) return of("font", "ttc");
  // TrueType: version 1.0 (or 'true'), then a sane table count and a first table tag in letters.
  if ((starts(head, 0, [0, 1, 0, 0]) || is(0, "true")) && head[4] === 0 && head[5] > 0 && head[5] < 80 && /^[A-Za-z0-9 /]{4}$/.test(ascii(head, 12, 4))) return of("font", "ttf");
  if (ascii(head, 0, Math.min(head.length, 1024)).includes("%PDF-")) return of("pdf", "pdf");
  if (is(0, "%!PS")) return unknown("ps", name);
  if (is(0, "{\\rtf")) return of("rtf", "rtf");
  if (is(0, "PK") && (starts(head, 2, [3, 4]) || starts(head, 2, [5, 6]))) return of("archive", "zip");
  if (starts(head, 0, [0xd0, 0xcf, 0x11, 0xe0])) return unknown("ole", name);
  if (starts(head, 0, [0x7f, 0x45, 0x4c, 0x46])) return unknown("elf", name);
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xcf, 0xfa, 0xed, 0xfe], [0xce, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((s) => starts(head, 0, s))) return unknown("macho", name);
  if (starts(head, 0, [0x1f, 0x8b]) || starts(head, 0, [0x37, 0x7a, 0xbc, 0xaf]) || is(0, "Rar!") || is(0, "BZh") || starts(head, 0, [0xfd, 0x37, 0x7a, 0x58]) || is(257, "ustar")) return unknown("packed", name);
  if (is(0, "SQLite format 3")) return unknown("db", name);
  if (is(0, "glTF") || is(0, "BLENDER") || is(0, "Kaydara FBX")) return unknown("model", name);
  if (is(0, "fig-kiwi") || is(0, "gimp xcf")) return unknown("design", name);
  if (starts(head, 0, [0xff, 0x0a]) || is(4, "JXL ")) return unknown("jxl", name);
  const binary = head.subarray(0, 64).includes(0);
  if (is(0, "MZ") && binary) return unknown("exe", name);
  if (is(0, "BM") && starts(head, 6, [0, 0, 0, 0])) return of("image", "bmp");
  if (starts(head, 0, [0, 0, 1, 0]) && (e === "ico" || t.includes("icon"))) return of("image", "ico");
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0 && (binary || e === "aac")) return of("audio", "aac");
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (AUDIO_EXT.test(e) || t.startsWith("audio/"))) return of("audio", "mp3");
  // No signature. SVG is text; anything else that reads as text is text, whatever it's called
  // (source code, subtitles, logs, a file with no extension; a .ts file is not a video).
  const enc = textEncoding(head);
  if (enc) {
    const peek = new TextDecoder(enc).decode(head.subarray(0, 2048));
    if (/<svg[\s>]/i.test(peek) && !/<html[\s>]/i.test(peek)) return of("image", "svg");
    if (t === "image/svg+xml" || e === "svg") return of("image", "svg");
    // 3D scenes written as text (OBJ, glTF, Collada) are still not something to read.
    if (BY_EXT[e] === "model") return unknown("model", name);
    return of("text", enc);
  }
  if (t.startsWith("audio/") || AUDIO_EXT.test(e)) return of("audio", e || "audio");
  if (t.startsWith("video/") || VIDEO_EXT.test(e)) return of("video", e || "video");
  if (BY_EXT[e]) return unknown(BY_EXT[e], name);
  if (t.startsWith("image/") || IMAGE_EXT.test(e)) return of("image", e || "image");
  if (FONT_EXT.test(e)) return of("font", e);
  if (e === "pdf" || t === "application/pdf") return of("pdf", "pdf");
  return unknown("binary", name);
}

// What to do about a picture, sound or video this browser couldn't decode.
export function cantDecode(s: Sniffed): string {
  if (s.kind === "image") {
    if (s.format === "heic") return "is an HEIC photo, which only Safari can decode: open it in Photos or Preview and export it as JPEG (or drop it in Safari)";
    if (s.format === "tiff") return "is a TIFF image, which only Safari can decode: export it as PNG or JPEG";
    return `is ${/^[aeio]/.test(s.format) ? "an" : "a"} ${s.format.toUpperCase()} image this browser can't decode: export it as PNG or JPEG`;
  }
  if (s.kind === "audio") return `is ${s.format.toUpperCase()} audio this browser can't decode: convert it to MP3, WAV or M4A`;
  if (s.kind === "video") return `is ${s.format.toUpperCase()} video this browser can't play: export it as MP4 (H.264) or WebM`;
  return "couldn't be read";
}

// ── XML, as much of it as documents need ──

type Handlers = { open?: (tag: string, attrs: string) => void; close?: (tag: string) => void; text?: (s: string) => void; stop?: () => boolean };
const XML = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:"[^"]*"|'[^']*'|[^>"'])*>|<(\/?)([^\s<>/]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.includes("&") ? s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITY[e] ?? m))) : s;

// Walks tags and text in order. Tag names come without their namespace prefix (w:p and a:p are both "p").
function scan(xml: string, h: Handlers) {
  XML.lastIndex = 0;
  for (let m; (m = XML.exec(xml)); ) {
    if (m[3] !== undefined) {
      const tag = m[3].slice(m[3].indexOf(":") + 1);
      if (m[2]) h.close?.(tag);
      else {
        h.open?.(tag, m[4]);
        if (m[5]) h.close?.(tag);
      }
      if (h.stop?.()) return;
    } else if (m[1] !== undefined) h.text?.(m[1]);
    else if (m[6] !== undefined) h.text?.(unescapeXml(m[6]));
  }
}
const attrRe = new Map<string, RegExp>();
// An attribute by its name without prefix (w:val → "val"); `prefixed` asks for one that has a prefix (r:id, not id).
function attr(attrs: string, name: string, prefixed = false): string | undefined {
  const key = `${prefixed ? ":" : ""}${name}`;
  let re = attrRe.get(key);
  if (!re) attrRe.set(key, (re = new RegExp(`(?:^|\\s)${prefixed ? "[\\w.-]+:" : "(?:[\\w.-]+:)?"}${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)));
  const m = re.exec(attrs);
  return m ? unescapeXml(m[1] ?? m[2]) : undefined;
}

// A part's relationships (rId → target path inside the package) and their kinds.
function relsOf(xml: string | undefined, part: string) {
  const out: { id: string; type: string; path: string }[] = [];
  if (!xml) return out;
  const dir = part.split("/").slice(0, -1);
  scan(xml, {
    open(tag, a) {
      if (tag !== "Relationship" || attr(a, "TargetMode") === "External") return;
      const target = attr(a, "Target") ?? "";
      const path = target.startsWith("/") ? [] : [...dir];
      for (const seg of target.split("/")) {
        if (seg === "..") path.pop();
        else if (seg && seg !== ".") path.push(seg);
      }
      out.push({ id: attr(a, "Id") ?? "", type: (attr(a, "Type") ?? "").split("/").pop() ?? "", path: path.join("/") });
    },
  });
  return out;
}
const relsPath = (part: string) => part.replace(/([^/]+)$/, "_rels/$1.rels");

// ── Archives: Office, OpenDocument, iWork, design files, plain zips ──

// `ref`: a picture of the document (its preview), to look at rather than to draw.
export type Member = { name: string; bytes: Uint8Array; ref?: boolean };
export type Opened = {
  format: string; // docx, pptx, xlsx, odt, odp, ods, key, pages, numbers, design, zip
  label: string; // "PowerPoint deck"
  text?: string; // what it says, cut to TEXT_CAP
  note: string; // the tile's line: "12 slides · 3 with notes"
  images: Member[]; // pictures inside it, to attach
  files?: Member[]; // a plain zip's files, to take one by one
  left?: string; // what couldn't be used, to tell the user
};

const PICTURE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
type Entry = { name: string; size: number };
type Zip = { list: Entry[]; has: (n: string) => boolean; get: (pick: (n: string) => boolean) => Record<string, Uint8Array> };

function zipOf(bytes: Uint8Array): Zip {
  const list: Entry[] = [];
  unzipSync(bytes, {
    filter: (f) => {
      list.push({ name: f.name, size: f.originalSize });
      return false;
    },
  });
  const names = new Set(list.map((e) => e.name));
  return { list, has: (n) => names.has(n), get: (pick) => unzipSync(bytes, { filter: (f) => f.originalSize <= MEMBER_MAX && pick(f.name) }) };
}

// The text gathered so far, stopping at the cap.
function gather() {
  const parts: string[] = [];
  let size = 0;
  return {
    get full() {
      return size >= TEXT_CAP;
    },
    add(s: string) {
      if (size >= TEXT_CAP) return;
      parts.push(s);
      size += s.length + 2;
    },
    text: () => tidy(parts.join("\n\n")).slice(0, TEXT_CAP),
    cut: () => (size >= TEXT_CAP ? " · first 200,000 characters" : ""),
  };
}

// Up to IMAGE_CAP of the pictures at `paths` (in that order), named after the document.
function pictures(zip: Zip, paths: string[], stem: string): { images: Member[]; more: number; odd: number } {
  const sizes = new Map(zip.list.map((e) => [e.name, e.size]));
  const all = [...new Set(paths)].filter((p) => sizes.has(p));
  // Under 1 KB is a bullet or a spacer, not a picture.
  const usable = all.filter((p) => PICTURE.test(p) && sizes.get(p)! >= 1024 && sizes.get(p)! <= MEMBER_MAX);
  const take = usable.slice(0, IMAGE_CAP);
  const got = zip.get((n) => take.includes(n));
  const images = take.filter((p) => got[p]).map((p, i) => ({ name: `${stem}-${i + 1}.${extOf(p)}`, bytes: got[p] }));
  return { images, more: usable.length - images.length, odd: all.filter((p) => !PICTURE.test(p)).length };
}
const leftOf = (p: { more: number; odd: number }) =>
  [p.more > 0 && `${plural(p.more, "more picture")} inside it ${p.more === 1 ? "was" : "were"} left out (the first ${IMAGE_CAP} are attached)`, p.odd > 0 && `${plural(p.odd, "picture")} in formats browsers can't show (EMF, WMF, TIFF) ${p.odd === 1 ? "was" : "were"} left out`]
    .filter(Boolean)
    .join("; ") || undefined;

// Paragraphs, headings, lists and tables of a WordprocessingML part, as plain text.
export function wordText(xml: string): string {
  const out: string[] = [];
  const paras: { text: string; prefix: string }[] = [];
  const cells: string[] = [];
  const rows: string[][] = [];
  let inT = false, skip = 0;
  const emit = (line: string) => {
    if (!cells.length) out.push(line);
    else if (line) cells[cells.length - 1] += (cells[cells.length - 1] ? " " : "") + line;
  };
  scan(xml, {
    open(tag, a) {
      // A drawing's fallback repeats its text.
      if (tag === "Fallback") skip++;
      if (skip) return;
      const p = paras[paras.length - 1];
      if (tag === "p") paras.push({ text: "", prefix: "" });
      else if (tag === "tr") rows.push([]);
      else if (tag === "tc") cells.push("");
      else if (!p) return;
      else if (tag === "t") inT = true;
      else if (tag === "tab") p.text += "\t";
      else if (tag === "br" || tag === "cr") p.text += "\n";
      else if (tag === "noBreakHyphen") p.text += "-";
      else if (tag === "pStyle") {
        const v = attr(a, "val") ?? "";
        const level = /^(?:heading|berschrift|titre|ttulo|titolo|kop|rubrik|overskrift|otsikko)\s*([1-6])$/i.exec(v)?.[1];
        if (/^title$/i.test(v)) p.prefix = "# ";
        else if (level) p.prefix = `${"#".repeat(+level)} `;
        else if (/^list\s*(bullet|number)/i.test(v)) p.prefix = "- ";
      } else if (tag === "outlineLvl" && !p.prefix) {
        const n = +(attr(a, "val") ?? 9);
        if (n < 6) p.prefix = `${"#".repeat(n + 1)} `;
      } else if (tag === "numPr" && !p.prefix) p.prefix = "- ";
    },
    close(tag) {
      if (tag === "Fallback") skip--;
      else if (skip) return;
      else if (tag === "t") inT = false;
      else if (tag === "p") {
        const p = paras.pop();
        const s = p?.text.trim();
        emit(s ? p!.prefix + s : "");
      } else if (tag === "tc") {
        const c = cells.pop();
        if (c !== undefined) rows[rows.length - 1]?.push(c.trim());
      } else if (tag === "tr") {
        const r = rows.pop();
        if (r?.some(Boolean)) emit(`| ${r.join(" | ")} |`);
      }
    },
    text(s) {
      if (inT && !skip && paras.length) paras[paras.length - 1].text += s;
    },
  });
  return tidy(out.join("\n"));
}

function docx(zip: Zip, name: string): Opened {
  const files = zip.get((n) => /^word\/(document|footnotes|endnotes)\.xml$/.test(n));
  const g = gather();
  g.add(wordText(utf8(files["word/document.xml"] ?? new Uint8Array())));
  for (const [part, title] of [["footnotes", "Footnotes"], ["endnotes", "Endnotes"]] as const) {
    const t = files[`word/${part}.xml`] ? wordText(utf8(files[`word/${part}.xml`])) : "";
    if (t) g.add(`${title}:\n${t}`);
  }
  const text = g.text();
  const pics = pictures(zip, zip.list.map((e) => e.name).filter((n) => n.startsWith("word/media/")).sort(natural), stemOf(name));
  const words = text.split(/\s+/).filter(Boolean).length;
  return { format: "docx", label: "Word document", text, note: `Word · ${plural(words, "word")}${pics.images.length ? ` · ${plural(pics.images.length, "picture")}` : ""}${g.cut()}`, images: pics.images, left: leftOf(pics) };
}

type SlideText = { title: string; lines: string[] };
// One slide's (or notes page's) text: its title, then its paragraphs as nested bullets and its tables as rows.
export function slideText(xml: string): SlideText {
  const DROP = /^(sldNum|ftr|dt|hdr|sldImg)$/;
  type Para = { lvl: number; text: string };
  const out: SlideText = { title: "", lines: [] };
  let shape: { ph: string | null; paras: Para[] } | null = null;
  let para: Para | null = null;
  let inT = false, skip = 0;
  const cells: string[] = [];
  const rows: string[][] = [];
  const bullet = (p: Para) => `${"  ".repeat(p.lvl)}- ${p.text}`;
  scan(xml, {
    open(tag, a) {
      if (tag === "Fallback") skip++;
      if (skip) return;
      if (tag === "sp") shape = { ph: null, paras: [] };
      else if (tag === "ph" && shape) shape.ph = attr(a, "type") ?? "body";
      else if (tag === "p") para = { lvl: 0, text: "" };
      else if (tag === "pPr" && para) para.lvl = Math.min(8, +(attr(a, "lvl") ?? 0) || 0);
      else if (tag === "t") inT = true;
      else if (tag === "br" && para) para.text += " ";
      else if (tag === "tr") rows.push([]);
      else if (tag === "tc") cells.push("");
    },
    close(tag) {
      if (tag === "Fallback") skip--;
      else if (skip) return;
      else if (tag === "t") inT = false;
      else if (tag === "p" && para) {
        const p = { ...para, text: para.text.replace(/\s+/g, " ").trim() };
        para = null;
        if (!p.text) return;
        if (cells.length) cells[cells.length - 1] += (cells[cells.length - 1] ? " " : "") + p.text;
        else if (shape) shape.paras.push(p);
        else out.lines.push(bullet(p));
      } else if (tag === "tc") {
        const c = cells.pop();
        if (c !== undefined) rows[rows.length - 1]?.push(c);
      } else if (tag === "tr") {
        const r = rows.pop();
        if (r?.some(Boolean)) out.lines.push(`| ${r.join(" | ")} |`);
      } else if (tag === "sp" && shape) {
        const s = shape;
        shape = null;
        if (s.ph && DROP.test(s.ph)) return;
        if ((s.ph === "title" || s.ph === "ctrTitle") && !out.title) out.title = s.paras.map((p) => p.text).join(" ");
        else out.lines.push(...s.paras.map(bullet));
      }
    },
    text(s) {
      if (inT && !skip && para) para.text += s;
    },
  });
  return out;
}

function pptx(zip: Zip, name: string): Opened {
  const files = zip.get((n) => /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/(_rels\/)?slide\d+\.xml(\.rels)?|notesSlides\/notesSlide\d+\.xml)$/.test(n));
  const str = (n: string) => (files[n] ? utf8(files[n]) : undefined);
  // Slides in the order the deck shows them (its id list), or by number when that can't be read.
  const rels = relsOf(str("ppt/_rels/presentation.xml.rels"), "ppt/presentation.xml");
  const ids: string[] = [];
  scan(str("ppt/presentation.xml") ?? "", { open: (tag, a) => void (tag === "sldId" && ids.push(attr(a, "id", true) ?? "")) });
  let order = ids.map((id) => rels.find((r) => r.id === id)?.path ?? "").filter((p) => files[p]);
  if (!order.length) order = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(natural);
  const g = gather();
  const media: string[] = [];
  let noted = 0, shown = 0;
  order.forEach((path, i) => {
    if (g.full) return;
    const slide = slideText(str(path)!);
    const own = relsOf(str(relsPath(path)), path);
    const notesPath = own.find((r) => r.type === "notesSlide")?.path;
    const notes = notesPath && str(notesPath) ? slideText(str(notesPath)!) : null;
    const said = notes ? [notes.title, ...notes.lines.map((l) => l.replace(/^\s*- /, ""))].filter(Boolean).join("\n") : "";
    const pics = own.filter((r) => r.type === "image").map((r) => r.path);
    media.push(...pics);
    if (said) noted++;
    shown++;
    g.add([`## Slide ${i + 1}${slide.title ? `: ${slide.title}` : ""}`, ...slide.lines, said && `Speaker notes: ${said}`].filter(Boolean).join("\n"));
  });
  const pics = pictures(zip, media, stemOf(name));
  const text = g.text();
  return {
    format: "pptx",
    label: "PowerPoint deck",
    text: text && `Slides of “${name}”, in order.\n\n${text}`.slice(0, TEXT_CAP),
    note: `PowerPoint · ${plural(order.length, "slide")}${noted ? ` · ${noted} with notes` : ""}${pics.images.length ? ` · ${plural(pics.images.length, "picture")}` : ""}${shown < order.length ? ` · first ${shown} read` : ""}`,
    images: pics.images,
    left: leftOf(pics),
  };
}

// Number formats that show a date or time: the built-in ones, and custom codes with date letters.
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const dateCode = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "").replace(/general|e[+-]/gi, ""));
// An Excel serial day as a date (and time, when it has one).
export function excelDate(serial: number, date1904 = false): string {
  const d = new Date(Math.round((serial - 25569 + (date1904 ? 1462 : 0)) * 86_400_000));
  if (isNaN(d.getTime())) return String(serial);
  const iso = d.toISOString();
  return serial < 1 && !date1904 ? iso.slice(11, 16) : Number.isInteger(serial) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}
const colOf = (ref: string) => {
  let n = 0;
  for (const c of ref) {
    if (c < "A" || c > "Z") break;
    n = n * 26 + c.charCodeAt(0) - 64;
  }
  return n - 1;
};

function xlsx(zip: Zip): Opened {
  const files = zip.get((n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n));
  const str = (n: string) => (files[n] ? utf8(files[n]) : undefined);
  const shared: string[] = [];
  {
    let cur: string | null = null, inT = false, phonetic = 0;
    scan(str("xl/sharedStrings.xml") ?? "", {
      open(tag) {
        if (tag === "si") cur = "";
        else if (tag === "rPh") phonetic++;
        else if (tag === "t") inT = true;
      },
      close(tag) {
        if (tag === "si" && cur !== null) {
          shared.push(cur);
          cur = null;
        } else if (tag === "rPh") phonetic--;
        else if (tag === "t") inT = false;
      },
      text(s) {
        if (inT && !phonetic && cur !== null) cur += s;
      },
    });
  }
  // Which cell styles show their number as a date.
  const dateStyle: boolean[] = [];
  {
    const custom = new Map<number, string>();
    let inXfs = false;
    scan(str("xl/styles.xml") ?? "", {
      open(tag, a) {
        if (tag === "numFmt") custom.set(+(attr(a, "numFmtId") ?? -1), attr(a, "formatCode") ?? "");
        else if (tag === "cellXfs") inXfs = true;
        else if (tag === "xf" && inXfs) {
          const id = +(attr(a, "numFmtId") ?? 0);
          dateStyle.push(custom.has(id) ? dateCode(custom.get(id)!) : DATE_IDS.has(id));
        }
      },
      close: (tag) => void (tag === "cellXfs" && (inXfs = false)),
    });
  }
  const sheets: { name: string; id: string }[] = [];
  let date1904 = false;
  scan(str("xl/workbook.xml") ?? "", {
    open(tag, a) {
      if (tag === "sheet") sheets.push({ name: attr(a, "name") ?? `Sheet ${sheets.length + 1}`, id: attr(a, "id", true) ?? "" });
      else if (tag === "workbookPr") date1904 = /^(1|true)$/.test(attr(a, "date1904") ?? "");
    },
  });
  const rels = relsOf(str("xl/_rels/workbook.xml.rels"), "xl/workbook.xml");
  let parts = sheets.map((s) => ({ name: s.name, path: rels.find((r) => r.id === s.id)?.path ?? "" })).filter((s) => files[s.path]);
  if (!parts.length) parts = Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort(natural).map((path, i) => ({ name: `Sheet ${i + 1}`, path }));
  const g = gather();
  let total = 0;
  for (const sheet of parts) {
    if (g.full) break;
    const lines: string[] = [];
    let size = 0;
    let row: string[] = [];
    let cell: { col: number; type: string; style: number; v: string } | null = null;
    let inV = false;
    scan(str(sheet.path)!, {
      open(tag, a) {
        if (tag === "row") row = [];
        else if (tag === "c") cell = { col: attr(a, "r") ? colOf(attr(a, "r")!) : row.length, type: attr(a, "t") ?? "n", style: +(attr(a, "s") ?? -1), v: "" };
        else if (tag === "v" || tag === "t") inV = !!cell;
      },
      close(tag) {
        if (tag === "v" || tag === "t") inV = false;
        else if (tag === "c" && cell) {
          const { col, type, style, v } = cell;
          cell = null;
          const value = type === "s" ? (shared[+v] ?? "") : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : type === "n" && v && dateStyle[style] && !isNaN(+v) ? excelDate(+v, date1904) : v;
          if (value && col >= 0 && col < 4096) row[col] = value.replace(/\s+/g, " ").trim();
        } else if (tag === "row") {
          if (!row.some(Boolean)) return;
          const line = Array.from(row, (x) => x ?? "").join("\t");
          lines.push(line);
          size += line.length + 1;
        }
      },
      text(s) {
        if (inV && cell) cell.v += s;
      },
      stop: () => size >= TEXT_CAP,
    });
    total += lines.length;
    g.add(`## Sheet: ${sheet.name} (${plural(lines.length, "row")}, tab-separated)\n${lines.join("\n")}`);
  }
  const big = zip.list.filter((e) => /^xl\/worksheets\/[^/]+\.xml$/.test(e.name) && e.size > MEMBER_MAX).length;
  return {
    format: "xlsx",
    label: "Excel workbook",
    text: g.text(),
    note: `Excel · ${plural(parts.length, "sheet")} · ${plural(total, "row")}${g.cut()}`,
    images: [],
    left: big ? `${plural(big, "sheet")} too large to read ${big === 1 ? "was" : "were"} left out: export ${big === 1 ? "it" : "them"} as CSV` : undefined,
  };
}

// An OpenDocument content.xml as text: headings, paragraphs, lists, tables, slides and their notes, sheets.
export function odfText(xml: string, sheet = false): { text: string; slides: number; sheets: number; notes: number } {
  const out: string[] = [];
  const paras: { text: string; prefix: string; title: boolean }[] = [];
  const cells: { text: string; repeat: number }[] = [];
  const rows: string[][] = [];
  const count = { slides: 0, sheets: 0, notes: 0 };
  let skip = 0, lists = 0, fresh = false, inNotes = false, noted = false, inTitle = false, header = -1, size = 0;
  const emit = (line: string) => {
    if (cells.length) {
      if (line) cells[cells.length - 1].text += (cells[cells.length - 1].text ? " " : "") + line;
    } else {
      out.push(line);
      size += line.length + 1;
    }
  };
  scan(xml, {
    open(tag, a) {
      if (tag === "annotation" || tag === "tracked-changes") skip++;
      if (skip) return;
      const p = paras[paras.length - 1];
      if (tag === "h") paras.push({ text: "", prefix: `${"#".repeat(Math.min(6, +(attr(a, "outline-level") ?? 1) || 1))} `, title: false });
      else if (tag === "p") {
        paras.push({ text: "", prefix: fresh && lists ? `${"  ".repeat(lists - 1)}- ` : "", title: inTitle });
        fresh = false;
      } else if (tag === "list") lists++;
      else if (tag === "list-item") fresh = true;
      else if (tag === "page") {
        count.slides++;
        emit("");
        header = out.length;
        emit(`## Slide ${count.slides}`);
      } else if (tag === "notes") [inNotes, noted] = [true, false];
      else if (tag === "frame") inTitle = attr(a, "class") === "title" && !inNotes;
      else if (tag === "table") {
        count.sheets++;
        emit("");
        if (sheet) emit(`## Sheet: ${attr(a, "name") ?? count.sheets} (tab-separated)`);
      } else if (tag === "table-row") rows.push([]);
      else if (tag === "table-cell" || tag === "covered-table-cell") cells.push({ text: "", repeat: Math.max(1, +(attr(a, "number-columns-repeated") ?? 1) || 1) });
      else if (!p) return;
      else if (tag === "tab") p.text += "\t";
      else if (tag === "line-break") p.text += "\n";
      else if (tag === "s") p.text += " ".repeat(Math.min(64, +(attr(a, "c") ?? 1) || 1));
    },
    close(tag) {
      if (tag === "annotation" || tag === "tracked-changes") skip--;
      else if (skip) return;
      else if (tag === "p" || tag === "h") {
        const p = paras.pop();
        const s = p?.text.trim();
        if (!s) return void (cells.length || emit(""));
        if (p!.title && header >= 0 && !out[header].includes(": ")) out[header] += `: ${s}`;
        else if (inNotes && !noted) {
          noted = true;
          count.notes++;
          emit(`Speaker notes: ${s}`);
        } else emit(p!.prefix + s);
      } else if (tag === "list") lists--;
      else if (tag === "notes") inNotes = false;
      else if (tag === "frame") inTitle = false;
      else if (tag === "page") header = -1;
      else if (tag === "table-cell" || tag === "covered-table-cell") {
        const c = cells.pop();
        const row = rows[rows.length - 1];
        // An empty cell repeated a thousand times is the sheet's unused width.
        if (c && row) for (let i = 0; i < Math.min(c.repeat, c.text ? 64 : 256); i++) row.push(c.text);
      } else if (tag === "table-row") {
        const r = rows.pop();
        if (!r?.some(Boolean)) return;
        while (r.length && !r[r.length - 1]) r.pop();
        emit(sheet ? r.join("\t") : `| ${r.join(" | ")} |`);
      }
    },
    text(s) {
      if (!skip && paras.length) paras[paras.length - 1].text += s.replace(/\s+/g, " ");
    },
    stop: () => size >= TEXT_CAP,
  });
  return { text: tidy(out.join("\n")).slice(0, TEXT_CAP), ...count };
}

function odf(zip: Zip, name: string, mime: string): Opened {
  const kind = /presentation/.test(mime) || extOf(name) === "odp" ? "odp" : /spreadsheet/.test(mime) || extOf(name) === "ods" ? "ods" : "odt";
  const files = zip.get((n) => n === "content.xml");
  const r = odfText(utf8(files["content.xml"] ?? new Uint8Array()), kind === "ods");
  const pics = pictures(zip, zip.list.map((e) => e.name).filter((n) => n.startsWith("Pictures/") || n.startsWith("media/")).sort(natural), stemOf(name));
  const cut = r.text.length >= TEXT_CAP ? " · first 200,000 characters" : "";
  const with_ = pics.images.length ? ` · ${plural(pics.images.length, "picture")}` : "";
  const note =
    kind === "odp"
      ? `OpenDocument deck · ${plural(r.slides, "slide")}${r.notes ? ` · ${r.notes} with notes` : ""}${with_}`
      : kind === "ods"
        ? `OpenDocument sheet · ${plural(r.sheets, "sheet")}${cut}`
        : `OpenDocument · ${plural(r.text.split(/\s+/).filter(Boolean).length, "word")}${with_}${cut}`;
  return { format: kind, label: kind === "odp" ? "OpenDocument deck" : kind === "ods" ? "OpenDocument spreadsheet" : "OpenDocument text", text: r.text, note, images: pics.images, left: leftOf(pics) };
}

// ── iWork (Keynote, Pages): .iwa files are Snappy-compressed protobuf; text lives in TSWP.StorageArchive ──

// Raw Snappy (no stream header, no checksums), as iWork writes it.
export function unsnappy(src: Uint8Array): Uint8Array {
  let p = 0, len = 0, shift = 0;
  for (;;) {
    const b = src[p++];
    len += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80) || p >= src.length) break;
    shift += 7;
  }
  if (len > MEMBER_MAX * 4) throw new Error("too large");
  const out = new Uint8Array(len);
  let o = 0;
  while (p < src.length && o < len) {
    const tag = src[p++];
    let n: number, off = 0;
    if ((tag & 3) === 0) {
      n = tag >> 2;
      if (n >= 60) {
        const extra = n - 59;
        n = 0;
        for (let i = 0; i < extra; i++) n += src[p++] * 2 ** (8 * i);
      }
      n += 1;
      out.set(src.subarray(p, p + n), o);
      p += n;
      o += n;
      continue;
    }
    if ((tag & 3) === 1) {
      n = ((tag >> 2) & 7) + 4;
      off = ((tag >> 5) << 8) | src[p++];
    } else if ((tag & 3) === 2) {
      n = (tag >> 2) + 1;
      off = src[p] | (src[p + 1] << 8);
      p += 2;
    } else {
      n = (tag >> 2) + 1;
      off = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
      p += 4;
    }
    if (!off || off > o) throw new Error("bad data");
    for (let i = 0; i < n && o < len; i++, o++) out[o] = out[o - off];
  }
  return out.subarray(0, o);
}

// The fields of a protobuf message: [number, wire type, varint value or bytes].
function* fields(b: Uint8Array): Generator<[number, number, number, Uint8Array | null]> {
  let p = 0;
  const varint = () => {
    let v = 0, shift = 0;
    for (;;) {
      const c = b[p++];
      v += (c & 0x7f) * 2 ** shift;
      if (!(c & 0x80) || p >= b.length) return v;
      shift += 7;
    }
  };
  while (p < b.length) {
    const key = varint();
    const wire = key & 7;
    const no = Math.floor(key / 8);
    if (wire === 0) yield [no, wire, varint(), null];
    else if (wire === 2) {
      const n = varint();
      yield [no, wire, n, b.subarray(p, p + n)];
      p += n;
    } else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    else return;
  }
}

// The text storages of one .iwa file, in file order: what kind each is (0 body, 3 text box, 4 presenter note…) and its text.
export function iwaText(iwa: Uint8Array): { kind: number; text: string }[] {
  // Chunks: a zero byte, a 3-byte length, then that much Snappy.
  const chunks: Uint8Array[] = [];
  for (let p = 0; p + 4 <= iwa.length; ) {
    const n = iwa[p + 1] | (iwa[p + 2] << 8) | (iwa[p + 3] << 16);
    chunks.push(iwa[p] === 0 ? unsnappy(iwa.subarray(p + 4, p + 4 + n)) : iwa.subarray(p + 4, p + 4 + n));
    p += 4 + n;
  }
  const b = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  chunks.reduce((o, c) => (b.set(c, o), o + c.length), 0);
  const out: { kind: number; text: string }[] = [];
  // Archives: a length-prefixed ArchiveInfo listing its messages (type, length), then their payloads.
  for (let p = 0; p < b.length; ) {
    let n = 0, shift = 0;
    for (;;) {
      const c = b[p++];
      n += (c & 0x7f) * 2 ** shift;
      if (!(c & 0x80) || p >= b.length) break;
      shift += 7;
    }
    const info = b.subarray(p, p + n);
    p += n;
    for (const [no, wire, , msg] of fields(info)) {
      if (no !== 2 || wire !== 2 || !msg) continue;
      let type = 0, length = 0;
      for (const [f, w, v] of fields(msg)) {
        if (f === 1 && w === 0) type = v;
        else if (f === 3 && w === 0) length = v;
      }
      // TSWP.StorageArchive: kind = 1, text = 3 (repeated).
      if (type === 2001 || type === 2005) {
        let kind = 3;
        const texts: string[] = [];
        for (const [f, w, v, bytes] of fields(b.subarray(p, p + length))) {
          if (f === 1 && w === 0) kind = v;
          else if (f === 3 && w === 2 && bytes) texts.push(utf8(bytes));
        }
        // Attachment marks and layout controls aren't words.
        const text = tidy(texts.join("\n").replace(/[\u2028\u2029\u000b]/g, "\n").replace(/[\ufffc\u0000-\u0008\u000c\u000e-\u001f]/g, ""));
        if (text) out.push({ kind, text });
      }
      p += length;
    }
  }
  return out;
}

function iwork(zip: Zip, name: string): Opened {
  const e = extOf(name);
  const slides = zip.list.some((x) => /(^|\/)Index\/Slide/.test(x.name));
  const format = e === "key" || e === "pages" || e === "numbers" ? e : slides ? "key" : "pages";
  const label = format === "key" ? "Keynote deck" : format === "numbers" ? "Numbers spreadsheet" : "Pages document";
  const wanted = (n: string) => /^Index\/(Document|Slide[^/]*)\.iwa$/.test(n);
  let iwa = zip.get(wanted);
  // iWork '13 kept the index as a zip inside the zip.
  if (!Object.keys(iwa).length && zip.has("Index.zip")) {
    try {
      iwa = unzipSync(zip.get((n) => n === "Index.zip")["Index.zip"], { filter: (f) => f.originalSize <= MEMBER_MAX && wanted(f.name) });
    } catch {}
  }
  const g = gather();
  let n = 0;
  if (format !== "numbers")
    for (const path of Object.keys(iwa).sort((a, b) => +/Slide/.test(a) - +/Slide/.test(b) || natural(a, b))) {
      let found: { kind: number; text: string }[] = [];
      try {
        found = iwaText(iwa[path]);
      } catch {}
      // Headers and footers (1) repeat on every page; cell text (5) has no table around it here.
      const body = found.filter((s) => s.kind !== 1 && s.kind !== 4 && s.kind !== 5).map((s) => s.text);
      const notes = found.filter((s) => s.kind === 4).map((s) => s.text);
      if (!body.length && !notes.length) continue;
      if (/Slide/.test(path)) g.add([`## Slide ${++n}`, ...body, notes.length && `Speaker notes: ${notes.join("\n")}`].filter(Boolean).join("\n"));
      else g.add(body.join("\n\n"));
    }
  const text = g.text();
  // The app's own preview of the first page or slide, then the pictures placed in the document (not their thumbnails).
  const preview = ["preview.jpg", "preview-web.jpg", "QuickLook/Thumbnail.jpg", "QuickLook/Thumbnail.png"].find((p) => zip.has(p));
  const data = zip.list.map((x) => x.name).filter((p) => p.startsWith("Data/") && !/-small-\d+\.\w+$/.test(p)).sort(natural);
  const pics = pictures(zip, [...(preview ? [preview] : []), ...data], stemOf(name));
  const how = format === "key" ? "File → Export To → PowerPoint or PDF" : format === "numbers" ? "File → Export To → Excel or CSV" : "File → Export To → Word or PDF";
  return {
    format,
    label,
    text: text ? `${format === "key" ? `Text of the Keynote deck “${name}”, slide by slide (the slides may not be in show order).` : `Text of “${name}”.`}\n\n${text}`.slice(0, TEXT_CAP) : undefined,
    note: `${label.split(" ")[0]} · ${text ? (format === "key" ? plural(n, "slide") : plural(text.split(/\s+/).filter(Boolean).length, "word")) : "preview only"}${pics.images.length ? ` · ${plural(pics.images.length, "picture")}` : ""}`,
    images: pics.images.map((im, i) => (preview && i === 0 ? { ...im, ref: true } : im)),
    left: text ? (format === "key" ? `Keynote slides are read in file order, which may not be the show's; for exact order and layout use ${how}` : undefined) : `its text couldn't be read${pics.images.length ? " (its preview is attached)" : ""}: in ${label.split(" ")[0]} use ${how} and drop that`,
  };
}

// Design files that carry a flattened preview of themselves (Figma, Sketch, XD, Krita, OpenRaster, Procreate, Affinity).
const PREVIEWS = ["mergedimage.png", "previews/preview.png", "preview.png", "QuickLook/Preview.png", "QuickLook/Thumbnail.png", "thumbnail.png", "Thumbnails/thumbnail.png"];
function design(zip: Zip, name: string): Opened | null {
  const preview = PREVIEWS.find((p) => zip.has(p));
  const figma = zip.has("canvas.fig");
  if (!preview || !(figma || BY_EXT[extOf(name)] === "design" || /^(kra|ora|procreate)$/.test(extOf(name)) || zip.has("mergedimage.png") || zip.has("document.json"))) return null;
  const got = zip.get((n) => n === preview || (figma && /^images\/[^/]+$/.test(n)));
  const images: Member[] = [{ name: `${stemOf(name)}-preview.png`, bytes: got[preview], ref: true }];
  // Figma keeps its images without extensions.
  for (const [path, bytes] of Object.entries(got)) {
    if (path === preview || images.length > IMAGE_CAP) continue;
    const s = sniff(bytes.subarray(0, 64), path);
    if (s.kind === "image" && bytes.length >= 1024) images.push({ name: `${stemOf(name)}-${images.length}.${s.format === "jpeg" ? "jpg" : s.format}`, bytes });
  }
  const app = figma ? "Figma" : extOf(name) === "sketch" ? "Sketch" : extOf(name) === "xd" ? "Adobe XD" : "design";
  return {
    format: "design",
    label: `${app} file`,
    note: `${app} file · preview`,
    images: images.filter((i) => i.bytes),
    left: `only its flattened preview${images.length > 1 ? " and placed images" : ""} could be read: for the real frames, export them as PNG or SVG and drop those`,
  };
}

// Opens a zip: a document's text and pictures, a design file's preview, or a plain archive's files.
// Throws (a reason that reads after the file's name) when it can't be opened.
export function openArchive(bytes: Uint8Array, name: string): Opened {
  let zip: Zip;
  try {
    zip = zipOf(bytes);
  } catch {
    throw new Error("is a zip archive that couldn't be opened (damaged, or protected with a password)");
  }
  if (zip.has("word/document.xml")) return docx(zip, name);
  if (zip.has("ppt/presentation.xml")) return pptx(zip, name);
  if (zip.has("xl/workbook.xml")) return xlsx(zip);
  const mime = zip.has("mimetype") ? utf8(zip.get((n) => n === "mimetype")["mimetype"] ?? new Uint8Array()).trim() : "";
  if (zip.has("content.xml") && (mime.includes("opendocument") || /^od[tps]$/.test(extOf(name)))) return odf(zip, name, mime);
  if (zip.list.some((e) => /^Index\/.+\.iwa$/.test(e.name)) || zip.has("Index.zip")) return iwork(zip, name);
  const d = design(zip, name);
  if (d) return d;
  // A plain archive: its files, taken one by one like any others.
  const real = zip.list.filter((e) => !e.name.endsWith("/") && !/(^|\/)(__MACOSX\/|\.[^/]*$|Thumbs\.db$|desktop\.ini$)/.test(e.name)).sort((a, b) => natural(a.name, b.name));
  if (!real.length) throw new Error("is an empty zip archive");
  const take: string[] = [];
  let total = 0;
  for (const e of real) {
    if (take.length >= ZIP_FILES || e.size > MEMBER_MAX || total + e.size > ZIP_TOTAL) continue;
    take.push(e.name);
    total += e.size;
  }
  const got = zip.get((n) => take.includes(n));
  const files = take.filter((n) => got[n]).map((n) => ({ name: n.split("/").pop()!, bytes: got[n] }));
  const more = real.length - files.length;
  return {
    format: "zip",
    label: "Zip archive",
    note: `Zip · ${plural(files.length, "file")}`,
    images: [],
    files,
    left: more > 0 ? `${plural(more, "more file")} inside it ${more === 1 ? "wasn't" : "weren't"} opened (the first ${ZIP_FILES}, up to 30 MB each, are): unzip it and drop the ones you need` : undefined,
  };
}

// ── RTF ──

const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "themedata", "colorschememapping", "latentstyles", "datastore", "generator", "listtable", "listoverridetable", "rsidtbl", "xmlnstbl", "filetbl", "revtbl", "fldinst", "pgdsctbl", "nonshppict", "expandedcolortbl", "panose", "falt", "bkmkstart", "bkmkend"]);
const RTF_CHARS: Record<string, string> = { par: "\n", line: "\n", sect: "\n\n", page: "\n\n", row: "\n", tab: "\t", cell: " | ", emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", emspace: " ", enspace: " " };
const CODEPAGE: Record<string, string> = { "932": "shift_jis", "936": "gbk", "949": "euc-kr", "950": "big5", "10000": "macintosh", "65001": "utf-8" };

// An RTF file's words. `src` is the file read one byte per character (latin1).
export function rtfText(src: string): string {
  let out = "";
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false, uc = 1, drop = 0, page = "windows-1252";
  // Bytes written as \'hh wait here: in multi-byte code pages, two make one character.
  let pending: number[] = [];
  const flush = () => {
    if (!pending.length) return;
    let s: string;
    try {
      s = new TextDecoder(page).decode(new Uint8Array(pending));
    } catch {
      s = String.fromCharCode(...pending);
    }
    pending = [];
    out += s;
  };
  const put = (s: string) => {
    if (skip) return;
    if (drop > 0) return void drop--;
    flush();
    out += s;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") {
      flush();
      stack.push({ skip, uc });
    } else if (c === "}") {
      flush();
      ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
    } else if (c === "\\") {
      const n = src[i + 1];
      if (n === "'") {
        const byte = parseInt(src.slice(i + 2, i + 4), 16);
        i += 3;
        if (skip || isNaN(byte)) continue;
        if (drop > 0) drop--;
        else pending.push(byte);
      } else if (n === "*") {
        skip = true;
        i++;
      } else if (n === "\\" || n === "{" || n === "}") {
        put(n);
        i++;
      } else if (n === "~") {
        put("\u00a0");
        i++;
      } else if (n === "\n" || n === "\r") {
        put("\n");
        i++;
      } else if (n === "-" || n === "_" || n === "|" || n === ":") i++;
      else {
        const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40));
        if (!m) continue;
        i += m[0].length;
        const [, word, arg] = m;
        if (RTF_SKIP.has(word)) skip = true;
        else if (word === "u" && arg) {
          const code = +arg < 0 ? +arg + 65536 : +arg;
          if (!skip) {
            flush();
            out += String.fromCharCode(code);
            drop = uc;
          }
        } else if (word === "uc" && arg) uc = +arg;
        else if (word === "ansicpg" && arg) page = CODEPAGE[arg] ?? `windows-${arg}`;
        else if (word === "bin" && arg) i += +arg;
        else if (RTF_CHARS[word]) {
          drop = 0;
          put(RTF_CHARS[word]);
        }
      }
    } else if (c !== "\n" && c !== "\r") put(c);
  }
  flush();
  return tidy(out.replace(/ \| \n/g, "\n")).slice(0, TEXT_CAP);
}

// ── Fonts ──

export type FontInfo = { family: string; weight: number | [number, number]; italic: boolean; format: "ttf" | "otf" | "woff" | "woff2" | "ttc" };

const WEIGHTS: [RegExp, number][] = [[/^(thin|hairline)$/i, 100], [/^(extra|ultra)light$/i, 200], [/^light$/i, 300], [/^(regular|normal|book|roman)$/i, 400], [/^medium$/i, 500], [/^(semi|demi)bold$/i, 600], [/^bold$/i, 700], [/^(extra|ultra)bold$/i, 800], [/^(black|heavy)$/i, 900]];
// Names the canvas reads as one of the kit's faces or a CSS keyword, not as this font.
const RESERVED = /^(serif|sans|sans-serif|mono|monospace|display|heavy|marker|cursive|fantasy|system-ui|inherit|initial|unset|default|normal|bold|italic)$/i;

// A family name the canvas font shorthand takes unquoted (the kit writes `${size}px ${family}`):
// words of letters, digits and hyphens, none starting with a digit, and not a keyword.
export function cssFamily(raw: string): string {
  const words = raw.normalize("NFKD").replace(/[^\w\s-]/g, " ").trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (/^[\d-]/.test(w) && out.length) out[out.length - 1] += w.replace(/^-+/, "");
    else out.push(/^[\d-]/.test(w) ? `F${w.replace(/^-+/, "")}` : w);
  }
  const name = out.join(" ").slice(0, 60) || "Brand Font";
  return RESERVED.test(name) ? `${name} Brand` : name;
}

// A font's family, weight and slant from its file name (WOFF2 tables are Brotli-packed, so the name is all there is).
function fontFromName(filename: string): Pick<FontInfo, "family" | "weight" | "italic"> {
  const parts = stemOf(filename).replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean);
  let weight = 400, italic = false;
  const family: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const two = i + 1 < parts.length ? WEIGHTS.find(([re]) => re.test(parts[i] + parts[i + 1])) : undefined;
    const one = WEIGHTS.find(([re]) => re.test(parts[i]));
    if (two && i > 0) [weight, i] = [two[1], i + 1];
    else if (one && i > 0) weight = one[1];
    else if (/^(italic|oblique|it)$/i.test(parts[i]) && i > 0) italic = true;
    else if (/^(variable|vf|var|webfont|web)$/i.test(parts[i]) && i > 0) continue;
    else family.push(parts[i]);
  }
  return { family: cssFamily(family.join(" ")), weight, italic };
}

// A font file's family (as the canvas will know it), weight (a range for a variable font) and slant.
export function fontInfo(bytes: Uint8Array, filename: string): FontInfo {
  const sig = ascii(bytes, 0, 4);
  const format: FontInfo["format"] = sig === "wOF2" ? "woff2" : sig === "wOFF" ? "woff" : sig === "OTTO" ? "otf" : sig === "ttcf" ? "ttc" : "ttf";
  const guess = { ...fontFromName(filename), format };
  if (format === "woff2") return guess;
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = new Map<string, Uint8Array>();
    if (format === "woff") {
      const n = v.getUint16(12);
      for (let i = 0; i < n; i++) {
        const at = 44 + i * 20;
        const tag = ascii(bytes, at, 4);
        if (!/^(name|OS\/2|fvar)$/.test(tag)) continue;
        const [off, comp, orig] = [v.getUint32(at + 4), v.getUint32(at + 8), v.getUint32(at + 12)];
        const raw = bytes.subarray(off, off + comp);
        tables.set(tag, comp < orig ? unzlibSync(raw) : raw);
      }
    } else {
      const base = format === "ttc" ? v.getUint32(12) : 0;
      const n = v.getUint16(base + 4);
      for (let i = 0; i < n; i++) {
        const at = base + 12 + i * 16;
        const tag = ascii(bytes, at, 4);
        if (/^(name|OS\/2|fvar)$/.test(tag)) tables.set(tag, bytes.subarray(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12)));
      }
    }
    const view = (t: Uint8Array) => new DataView(t.buffer, t.byteOffset, t.byteLength);
    let family = "";
    const name = tables.get("name");
    if (name) {
      const d = view(name);
      const strings = d.getUint16(4);
      let best = -1;
      for (let i = 0; i < d.getUint16(2); i++) {
        const r = 6 + i * 12;
        const [platform, lang, id, len, off] = [d.getUint16(r), d.getUint16(r + 4), d.getUint16(r + 6), d.getUint16(r + 8), d.getUint16(r + 10)];
        if (id !== 1 && id !== 16) continue;
        // The typographic family (16) over the style-linked one (1); Windows English over the rest.
        const score = (id === 16 ? 10 : 0) + (platform === 3 ? (lang === 0x409 ? 3 : 2) : platform === 0 ? 2 : 1);
        if (score <= best) continue;
        const raw = name.subarray(strings + off, strings + off + len);
        const s = platform === 1 ? String.fromCharCode(...raw) : new TextDecoder("utf-16be").decode(raw);
        if (s.trim()) [family, best] = [s.trim(), score];
      }
    }
    const os2 = tables.get("OS/2");
    const fvar = tables.get("fvar");
    let weight: FontInfo["weight"] = os2 && os2.length >= 6 ? Math.min(1000, Math.max(1, view(os2).getUint16(4))) : guess.weight;
    const italic = os2 && os2.length >= 64 ? !!(view(os2).getUint16(62) & 1) : guess.italic;
    if (fvar && fvar.length >= 16) {
      const d = view(fvar);
      const [at, count, size] = [d.getUint16(4), d.getUint16(8), d.getUint16(10)];
      for (let i = 0; i < count; i++) {
        const a = at + i * size;
        if (ascii(fvar, a, 4) === "wght") weight = [Math.round(d.getInt32(a + 4) / 65536), Math.round(d.getInt32(a + 12) / 65536)];
      }
    }
    return { family: family ? cssFamily(family) : guess.family, weight, italic, format };
  } catch {
    return guess;
  }
}

// ── Pictures ──

// An animated GIF's frames and length (a still has one frame).
export function gifInfo(b: Uint8Array): { frames: number; duration: number } {
  let frames = 0, hundredths = 0;
  if (ascii(b, 0, 3) !== "GIF") return { frames: 0, duration: 0 };
  let p = 13 + (b[10] & 0x80 ? 3 * 2 ** ((b[10] & 7) + 1) : 0);
  const blocks = () => {
    while (p < b.length && b[p]) p += b[p] + 1;
    p++;
  };
  while (p < b.length) {
    const c = b[p++];
    if (c === 0x2c) {
      frames++;
      const flags = b[p + 8];
      p += 9 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0) + 1;
      blocks();
    } else if (c === 0x21) {
      if (b[p] === 0xf9) hundredths += b[p + 3] | (b[p + 4] << 8);
      p++;
      blocks();
    } else break;
  }
  return { frames, duration: hundredths / 100 };
}

// A Photoshop file's flattened picture (what it saves for other apps to show), as RGBA. Throws a
// reason that reads after the file's name when there isn't one this can read.
export function psdComposite(b: Uint8Array): { width: number; height: number; rgba: Uint8ClampedArray } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (ascii(b, 0, 4) !== "8BPS") throw new Error("isn't a Photoshop file");
  const big = v.getUint16(4) === 2;
  const [channels, height, width, depth, mode] = [v.getUint16(12), v.getUint32(14), v.getUint32(18), v.getUint16(22), v.getUint16(24)];
  const base = mode === 3 ? 3 : mode === 4 ? 4 : mode === 1 || mode === 8 ? 1 : 0;
  if (!base || (depth !== 8 && depth !== 16)) throw new Error("is a Photoshop file in a colour mode this can't read (only 8- and 16-bit RGB, CMYK and greyscale): export it as PNG");
  if (width * height > 50_000_000) throw new Error("is a very large Photoshop file: export it as PNG or JPEG");
  let p = 26;
  p += 4 + v.getUint32(p); // colour mode data
  p += 4 + v.getUint32(p); // image resources
  p += big ? 8 + v.getUint32(p) * 2 ** 32 + v.getUint32(p + 4) : 4 + v.getUint32(p); // layers and masks
  const compression = v.getUint16(p);
  p += 2;
  if (compression > 1) throw new Error("is a Photoshop file saved with zip compression this can't read: export it as PNG");
  const bps = depth / 8;
  const used = Math.min(channels, base + 1);
  const planes: Uint8Array[] = [];
  if (compression === 0) {
    for (let c = 0; c < used; c++) {
      const plane = new Uint8Array(width * height);
      const at = p + c * width * height * bps;
      // 16-bit: the high byte of each sample.
      for (let i = 0; i < plane.length; i++) plane[i] = b[at + i * bps];
      planes.push(plane);
    }
  } else {
    // PackBits, a row at a time; every row's packed length comes first.
    const lens = p;
    const size = big ? 4 : 2;
    let data = p + channels * height * size;
    for (let c = 0; c < used; c++) {
      const plane = new Uint8Array(width * height);
      const row = new Uint8Array(width * bps);
      for (let y = 0; y < height; y++) {
        const n = big ? v.getUint32(lens + (c * height + y) * 4) : v.getUint16(lens + (c * height + y) * 2);
        let o = 0;
        for (let i = data; i < data + n && o < row.length; ) {
          const k = v.getInt8(i++);
          if (k >= 0) {
            row.set(b.subarray(i, i + Math.min(k + 1, row.length - o)), o);
            i += k + 1;
            o += k + 1;
          } else if (k !== -128) {
            row.fill(b[i++], o, Math.min(row.length, o + 1 - k));
            o += 1 - k;
          }
        }
        for (let x = 0; x < width; x++) plane[y * width + x] = row[x * bps];
        data += n;
      }
      planes.push(plane);
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  const alpha = planes[base];
  // A fourth channel that hides everything is a saved selection, not the picture's transparency.
  const useAlpha = !!alpha && alpha.some((a) => a > 0);
  for (let i = 0; i < width * height; i++) {
    let r: number, g: number, bl: number;
    if (base === 1) r = g = bl = planes[0][i];
    else if (base === 3) [r, g, bl] = [planes[0][i], planes[1][i], planes[2][i]];
    else [r, g, bl] = [(planes[0][i] * planes[3][i]) / 255, (planes[1][i] * planes[3][i]) / 255, (planes[2][i] * planes[3][i]) / 255];
    const a = useAlpha ? alpha[i] : 255;
    // The flattened picture is blended onto white: take the white back out of see-through pixels.
    if (a > 0 && a < 255) [r, g, bl] = [((r + a - 255) * 255) / a, ((g + a - 255) * 255) / a, ((bl + a - 255) * 255) / a];
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = bl;
    rgba[i * 4 + 3] = a;
  }
  return { width, height, rgba };
}

// An SVG with a size a browser will draw it at: width and height from its viewBox when it has
// none (Firefox draws such an image at 0×0), a viewBox when it has only a size, the SVG namespace,
// and small artwork (icons, logos) scaled up so it's sharp when drawn large or sent as a picture.
export function sizedSvg(svg: string, min = 1024): { svg: string; width: number; height: number } | null {
  const m = /<svg\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i.exec(svg);
  if (!m) return null;
  let attrs = m[1];
  const closed = /\/\s*$/.test(attrs);
  if (closed) attrs = attrs.replace(/\/\s*$/, "");
  const px = (s?: string) => {
    const n = /^\s*([\d.]+)\s*(px)?\s*$/.exec(s ?? "");
    return n && +n[1] > 0 ? +n[1] : 0;
  };
  const box = (attr(attrs, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const hasBox = box.length === 4 && box.every((n) => !isNaN(n)) && box[2] > 0 && box[3] > 0;
  let w = px(attr(attrs, "width")), h = px(attr(attrs, "height"));
  if (!w || !h) {
    if (!hasBox) return null;
    [w, h] = w ? [w, (w * box[3]) / box[2]] : h ? [(h * box[2]) / box[3], h] : [box[2], box[3]];
  }
  const set = (name: string, value: string) => {
    const re = new RegExp(`(^|\\s)${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
    attrs = re.test(attrs) ? attrs.replace(re, `$1${name}="${value}"`) : `${attrs} ${name}="${value}"`;
  };
  if (!hasBox) set("viewBox", `0 0 ${w} ${h}`);
  const k = Math.max(w, h) < min ? min / Math.max(w, h) : 1;
  const [width, height] = [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  set("width", String(width));
  set("height", String(height));
  if (!/(^|\s)xmlns\s*=/.test(attrs)) attrs += ' xmlns="http://www.w3.org/2000/svg"';
  return { svg: `${svg.slice(0, m.index)}<svg${attrs}${closed ? "/" : ""}>${svg.slice(m.index + m[0].length)}`, width, height };
}

// ── Soundtracks ──

type Grid = { bpm: number; beats: number[]; downbeats: number[]; hits: number[] };
// A track as the film will use it: its beat grid (seconds from its start) and how loud it is over time.
export type Track = Grid & { duration: number; energy: number[]; hop: number };

// Loudness (RMS) every `hop` seconds.
export function loudness(channels: Float32Array[], sampleRate: number, hop = 0.05): number[] {
  const step = Math.max(1, Math.round(sampleRate * hop));
  const n = Math.floor((channels[0]?.length ?? 0) / step);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const d of channels) for (let j = i * step; j < (i + 1) * step; j++) sum += d[j] * d[j];
    out[i] = Math.sqrt(sum / (step * channels.length));
  }
  return out;
}

// The drop: where the level lifts the most and stays up (two seconds after against two before),
// within the first `upTo` seconds. Null for a track that never lifts.
export function findDrop(energy: number[], hop: number, upTo = Infinity): number | null {
  const n = Math.min(energy.length, Math.floor(upTo / hop));
  const win = Math.round(2 / hop), edge = Math.round(1.5 / hop);
  if (n < edge * 2 + 1) return null;
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + energy[i];
  const mean = (a: number, b: number) => (sum[Math.min(n, b)] - sum[Math.max(0, a)]) / Math.max(1, Math.min(n, b) - Math.max(0, a));
  let best = 0, at = -1;
  for (let i = edge; i <= n - edge; i++) {
    const lift = mean(i, i + win) - mean(i - win, i);
    if (lift > best && mean(i, i + win) > mean(i - win, i) * 1.6) [best, at] = [lift, i];
  }
  return at >= 0 && best > mean(0, n) * 0.4 ? +(at * hop).toFixed(2) : null;
}

// A detected tempo is a whole number of analysis frames per beat, so it's off by up to a percent
// or two: half a beat of drift in thirty seconds. This fits the period to the onsets on the
// sixteenth-note grid (off-beat hits count for it, not against), then picks the beat's phase on it.
export function refineTempo(hits: number[], bpm: number): { bpm: number; phase: number } | null {
  if (hits.length < 8 || !(bpm > 0)) return null;
  const p0 = 60 / bpm;
  const sum = (period: number) => {
    let re = 0, im = 0;
    for (const h of hits) {
      const a = (2 * Math.PI * h) / period;
      re += Math.cos(a);
      im += Math.sin(a);
    }
    return { re, mag: Math.hypot(re, im), phase: ((Math.atan2(im, re) / (2 * Math.PI)) * period + period) % period };
  };
  let best = 0, period = p0, sub = 0;
  for (let k = -600; k <= 600; k++) {
    const p = p0 * (1 + k * 0.00005);
    const s = sum(p / 4);
    if (s.mag > best) [best, period, sub] = [s.mag, p, s.phase];
  }
  // Onsets that don't gather on any grid (speech, ambience) leave the tempo as detected.
  if (best / hits.length < 0.5) return null;
  let phase = sub, on = -Infinity;
  for (let c = 0; c < 4; c++) {
    const ph = sub + (c * period) / 4;
    let score = 0;
    for (const h of hits) score += Math.cos((2 * Math.PI * (h - ph)) / period);
    if (score > on) [on, phase] = [score, ph];
  }
  return { bpm: 60 / period, phase };
}

// A track's facts from its detected grid (src/lib/beats.ts) and samples: the grid refitted so it
// doesn't drift, and the loudness curve the drop is read from. `duration` is the whole track's.
export function trackFacts(grid: Grid, channels: Float32Array[], sampleRate: number, duration: number): Track {
  const hop = 0.05;
  const energy = loudness(channels, sampleRate, hop);
  const span = (channels[0]?.length ?? 0) / sampleRate;
  const fit = refineTempo(grid.hits, grid.bpm);
  if (!fit) return { ...grid, duration, energy, hop };
  const period = 60 / fit.bpm;
  const beats: number[] = [];
  for (let t = fit.phase; t < span; t += period) beats.push(+t.toFixed(3));
  // The bar keeps the phase the detector heard: the refitted beat nearest its first downbeat.
  const first = grid.downbeats[0] ?? beats[0] ?? 0;
  const off = beats.length ? ((beats.reduce((b, t, i) => (Math.abs(t - first) < Math.abs(beats[b] - first) ? i : b), 0) % 4) + 4) % 4 : 0;
  return { bpm: +fit.bpm.toFixed(1), beats, downbeats: beats.filter((_, i) => i % 4 === off), hits: grid.hits, duration, energy, hop };
}

// A file that's someone talking rather than music, going by its name.
export const soundsLikeVoice = (name: string) => /voice|\bvo\b|speech|narrat|interview|podcast|dialog/i.test(name.replace(/[_-]+/g, " "));

const secs = (t: number) => `${+t.toFixed(t < 10 ? 2 : 1)} s`;
const nearest = (t: number, grid: number[], within: number) => {
  const g = grid.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);
  return Math.abs(g - t) <= within ? g : t;
};

// The drop as the film can use it: on the track's nearest downbeat (or beat), inside the film.
export function dropOf(t: Track, film: number): number | null {
  const raw = findDrop(t.energy, t.hop, Math.min(film, t.duration));
  if (raw === null) return null;
  const onBar = nearest(raw, t.downbeats, 0.35);
  return onBar !== raw ? onBar : nearest(raw, t.beats, 0.2);
}

// What the director and the animator are told about a music track attached as the film's soundtrack.
export function soundtrackNote(name: string, t: Track, film: number): string {
  const bpm = Math.round(t.bpm * 10) / 10;
  const beat = 60 / t.bpm;
  const drop = dropOf(t, film);
  const first = t.beats[0] ?? 0;
  const down = t.downbeats[0] ?? first;
  return [
    `Soundtrack attached: “${name}”, ${bpm} BPM, first downbeat at ${secs(down)}${drop !== null ? `, loudest hit (the drop) at ${secs(drop)}` : ""}, ${secs(t.duration)} long.`,
    `This track is the film's music and plays under the picture exactly as it is, from its start, so cut the film to this exact tempo: ${bpm} BPM, whatever tempo the subject would otherwise suggest (a beat is ${beat.toFixed(3)} s; the ${film} s film is ${(film / beat).toFixed(1)} beats).`,
    first > 0.03 ? `Its first beat lands at ${secs(first)}, not at 0, so every beat falls ${secs(first)} after the even grid: shift cuts and hits by that much.` : "",
    drop !== null ? `Put the film's biggest moment on the drop at ${secs(drop)}.` : "It has no clear drop: build with the picture instead.",
    t.duration > film + 0.5 ? `The film is ${film} s long, so it plays the track's first ${film} s.` : t.duration < film - 0.5 ? `The track ends at ${secs(t.duration)}, before the film does: land the last big beat by then and let the ending hold without music.` : "",
    "Do not plan any other music.",
  ]
    .filter(Boolean)
    .join(" ");
}

// What they're told about a recording of someone speaking, attached as the film's voiceover.
export function voiceNote(name: string, duration: number, film: number, transcript: boolean): string {
  return [
    `Voiceover attached: “${name}”, ${secs(duration)} long. It is the film's narration and plays from the film's start exactly as recorded.`,
    transcript ? "Its transcript, with the second each word starts at, is attached (voiceover-transcript.txt): show each thing as it is said, time every beat to the words, and never put on screen a sentence that fights the one being spoken." : "",
    duration > film + 0.5 ? `The film is ${film} s long, so only the first ${film} s of it is heard.` : "",
    "Do not write another voiceover.",
  ]
    .filter(Boolean)
    .join(" ");
}

// The composer's line about a track that doesn't fit the film's length (null when it does).
export function lengthHint(name: string, duration: number, film: number): string | null {
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  if (duration > film + 0.5) return `“${name}” is ${clock(duration)} long; a ${film} s film plays its first ${film} s.`;
  if (duration < film - 0.5) return `“${name}” is ${secs(duration)} long; the film's last ${secs(film - duration)} play without it.`;
  return null;
}

// What they're told about fonts attached as the brand's own.
export function fontNote(fonts: FontInfo[]): string {
  const families = [...new Set(fonts.map((f) => f.family))];
  return families
    .map((family) => {
      const faces = fonts.filter((f) => f.family === family);
      const weights = [...new Set(faces.map((f) => (Array.isArray(f.weight) ? `${f.weight[0]}–${f.weight[1]}` : String(f.weight))))].join(", ");
      return `Brand font attached: use family '${family}' for display type (write family: '${family}' exactly; loaded ${faces.length > 1 ? "weights" : "weight"} ${weights}${faces.some((f) => f.italic) ? ", with italic" : ""}).`;
    })
    .join(" ");
}

// ── The one part that touches the page ──

// Registers font files with the document under their own family names, so canvas text can ask for
// them (`family: 'Name'`). Returns what loaded; a file the browser can't use as a font is left out.
export async function loadFontFiles(files: { name: string; blob: Blob }[]): Promise<(FontInfo & { name: string })[]> {
  const out: (FontInfo & { name: string })[] = [];
  for (const { name, blob } of files) {
    try {
      const buf = await blob.arrayBuffer();
      const info = fontInfo(new Uint8Array(buf), name);
      const face = new FontFace(info.family, buf, { weight: Array.isArray(info.weight) ? info.weight.join(" ") : String(info.weight), style: info.italic ? "italic" : "normal" });
      await face.load();
      document.fonts.add(face);
      out.push({ ...info, name });
    } catch {}
  }
  return out;
}
