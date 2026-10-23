// ── Serving bytes we didn't write ──────────────────────────────────────────
// Anything proxied from another site or streamed out of Blob is served with a
// type we chose, never sniffed, and inside a sandbox: opened as a page it can't
// run script on this origin (an SVG or HTML payload would otherwise be XSS).

export const UNTRUSTED_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
} as const;

// A filename that is safe inside Content-Disposition (no quotes, no line breaks).
export const safeFilename = (name: string, fallback = "file") => name.replace(/[^\w.\- ]+/g, "").trim().slice(0, 120) || fallback;

// Raster image types, read from the bytes themselves (the upstream header can lie).
export type RasterType = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" | "image/bmp" | "image/x-icon";

export function sniffImage(b: Uint8Array): RasterType | "image/svg+xml" | null {
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(4, "ftyp") && (at(8, "avif") || at(8, "avis"))) return "image/avif";
  if (at(0, "BM") && b.length > 26) return "image/bmp";
  if (b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0 && b[4] > 0) return "image/x-icon";
  // SVG is text: an <svg root near the top, after any BOM, XML prolog, comments or doctype.
  // (Skipped by hand: a regex with repeated optional comments backtracks exponentially.)
  const head = new TextDecoder().decode(b.subarray(0, 4096)).replace(/^\uFEFF/, "");
  let i = 0;
  for (;;) {
    while (i < head.length && /\s/.test(head[i])) i++;
    const comment = head.startsWith("<!--", i);
    if (!comment && !head.startsWith("<?", i) && head.slice(i, i + 9).toLowerCase() !== "<!doctype") break;
    const end = head.indexOf(comment ? "-->" : ">", i);
    if (end < 0) return null;
    i = end + (comment ? 3 : 1);
  }
  return /^<svg[\s>]/i.test(head.slice(i, i + 5)) ? "image/svg+xml" : null;
}

// ── WAV duration ───────────────────────────────────────────────────────────
// The audio routes only take uncompressed WAV, so length can be checked from the
// header before anything is sent to a service that bills by the minute. What's sent on
// is canonicalWav's rebuild, never the upload itself: a file with odd chunks (a second
// "fmt ", a lying data size) can't then be decoded differently from how it was measured.

export type WavInfo = { format: 1 | 3; channels: number; sampleRate: number; bits: number; seconds: number };
type WavParts = WavInfo & { data: Uint8Array };

function readWav(b: Uint8Array): WavParts | null {
  if (b.length < 44) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let fmt: Omit<WavInfo, "seconds"> | null = null;
  // Walk the chunks to "fmt " and "data"; anything else (LIST, fact…) is skipped.
  for (let o = 12; o + 8 <= b.length; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      // Decoders disagree on which of two formats wins, so a second one is refused.
      if (fmt || size < 16 || o + 24 > b.length) return null;
      let format = v.getUint16(o + 8, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
      if (format === 0xfffe && size >= 40 && o + 34 <= b.length) format = v.getUint16(o + 32, true);
      const channels = v.getUint16(o + 10, true);
      const sampleRate = v.getUint32(o + 12, true);
      const bits = v.getUint16(o + 22, true);
      // PCM or float only: compressed codecs inside a WAV wrapper would hide their real length.
      if ((format !== 1 && format !== 3) || ![8, 16, 24, 32, 64].includes(bits) || (format === 3 && bits < 32)) return null;
      if (channels < 1 || channels > 8 || sampleRate < 4000 || sampleRate > 192_000) return null;
      fmt = { format, channels, sampleRate, bits };
    } else if (id === "data") {
      if (!fmt) return null;
      // Everything from here to the end of the file counts, whatever the header claims
      // (cut to whole sample frames).
      const frame = fmt.channels * (fmt.bits / 8);
      const rest = b.length - (o + 8);
      const data = b.subarray(o + 8, o + 8 + (rest - (rest % frame)));
      return { ...fmt, seconds: data.length / frame / fmt.sampleRate, data };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

export function wavInfo(b: Uint8Array): WavInfo | null {
  const w = readWav(b);
  return w && { format: w.format, channels: w.channels, sampleRate: w.sampleRate, bits: w.bits, seconds: w.seconds };
}

// The measured audio as a plain 44-byte-header WAV: one fmt chunk with the values the
// length was measured from, then exactly the counted sample bytes. Null if it isn't PCM/float WAV.
export function canonicalWav(b: Uint8Array): { info: WavInfo; wav: Uint8Array<ArrayBuffer> } | null {
  const w = readWav(b);
  if (!w) return null;
  const { data, ...info } = w;
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  const blockAlign = info.channels * (info.bits / 8);
  ascii(0, "RIFF");
  v.setUint32(4, 36 + data.length, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, info.format, true);
  v.setUint16(22, info.channels, true);
  v.setUint32(24, info.sampleRate, true);
  v.setUint32(28, info.sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, info.bits, true);
  ascii(36, "data");
  v.setUint32(40, data.length, true);
  out.set(data, 44);
  return { info, wav: out };
}

// An SVG drawn to a PNG (long side up to `max` px), so it can be served as plain pixels.
// Uses sharp, which ships with Next as its image library; null if it's missing or the SVG won't render.
export async function svgToPng(svg: Uint8Array, max = 1024): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    const input = Buffer.from(svg);
    const meta = await sharp(input, { density: 72, limitInputPixels: 4096 * 4096 }).metadata();
    const long = Math.max(meta.width ?? 0, meta.height ?? 0) || max;
    const density = Math.min(72 * 16, Math.max(1, (72 * max) / long));
    return await sharp(input, { density, limitInputPixels: 4096 * 4096 })
      .resize(max, max, { fit: "inside", withoutEnlargement: true })
      .png()
      .timeout({ seconds: 5 })
      .toBuffer();
  } catch {
    return null;
  }
}

// Video types a share link may serve, with the file extension each downloads as.
export function videoType(contentType: string | undefined): { type: "video/mp4" | "video/webm"; ext: "mp4" | "webm" } | null {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (t === "video/mp4") return { type: t, ext: "mp4" };
  if (t === "video/webm") return { type: t, ext: "webm" };
  return null;
}

// Types a user's own stored media may be served as (images drawn in films, renders, audio).
// Anything else goes out as an opaque download.
export const servableMedia = (contentType: string | undefined) => {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)|video\/(mp4|webm)|audio\/[\w.+-]+)$/.test(t) ? t : null;
};
