import { describe, expect, it } from "vitest";
import { canonicalWav, safeFilename, servableMedia, sniffImage, svgToPng, videoType, wavInfo } from "./media";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

// A minimal WAV: header + `dataBytes` of silence.
function wav({ format = 1, channels = 1, rate = 16000, bits = 16, dataBytes = 32000, declared = undefined as number | undefined, extra = 0 } = {}) {
  const b = new Uint8Array(44 + dataBytes + extra);
  const v = new DataView(b.buffer);
  b.set(bytes("RIFF"), 0);
  v.setUint32(4, 36 + dataBytes, true);
  b.set(bytes("WAVEfmt "), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, format, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * (bits / 8), true);
  v.setUint16(32, channels * (bits / 8), true);
  v.setUint16(34, bits, true);
  b.set(bytes("data"), 36);
  v.setUint32(40, declared ?? dataBytes, true);
  return b;
}

describe("sniffImage", () => {
  it("reads raster types from magic bytes", () => {
    expect(sniffImage(bytes([0x89], "PNG\r\n\x1a\n", [0, 0]))).toBe("image/png");
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(bytes("GIF89a", [1, 0]))).toBe("image/gif");
    expect(sniffImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBe("image/avif");
    expect(sniffImage(bytes([0, 0, 1, 0, 1, 0, 16, 16]))).toBe("image/x-icon");
  });

  it("spots SVG however it starts, and nothing else passes", () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe("image/svg+xml");
    expect(sniffImage(new TextEncoder().encode('\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg>'))).toBe("image/svg+xml");
    expect(sniffImage(bytes("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImage(bytes("plain text"))).toBeNull();
    // Many comments and no <svg: a fast null, not catastrophic backtracking.
    const t = performance.now();
    expect(sniffImage(bytes("<!---->".repeat(600), "<x"))).toBeNull();
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe("wavInfo", () => {
  it("measures length from the header and the bytes actually sent", () => {
    expect(wavInfo(wav({ dataBytes: 32000 }))?.seconds).toBe(1);
    expect(wavInfo(wav({ rate: 8000, dataBytes: 16000 * 3 }))?.seconds).toBe(3);
    expect(wavInfo(wav({ channels: 2, rate: 44100, bits: 16, dataBytes: 44100 * 4 }))?.seconds).toBe(1);
    // A lying data size (0 or streaming 0xffffffff) doesn't shorten the count; trailing bytes count.
    expect(wavInfo(wav({ dataBytes: 32000, declared: 0 }))?.seconds).toBe(1);
    expect(wavInfo(wav({ dataBytes: 32000, declared: 0xffffffff }))?.seconds).toBe(1);
    expect(wavInfo(wav({ dataBytes: 32000, extra: 32000 }))?.seconds).toBe(2);
  });

  it("refuses compressed or malformed audio", () => {
    expect(wavInfo(wav({ format: 0x55 }))).toBeNull(); // MP3 inside a WAV wrapper
    expect(wavInfo(wav({ format: 0x11 }))).toBeNull(); // IMA ADPCM
    expect(wavInfo(wav({ bits: 4 }))).toBeNull();
    expect(wavInfo(wav({ rate: 1 }))).toBeNull();
    expect(wavInfo(bytes("ID3", new Array(60).fill(0)))).toBeNull();
    expect(wavInfo(new Uint8Array(10))).toBeNull();
  });

  it("refuses a second fmt chunk (decoders read the first; measuring the last undercounted ~9x)", () => {
    // fmt #1: 4 kHz mono 8-bit (what ffmpeg decodes); fmt #2: 192 kHz 8ch 64-bit float.
    const fmt = (rate: number, channels: number, bits: number, format: number) => {
      const c = new Uint8Array(24);
      const v = new DataView(c.buffer);
      c.set(bytes("fmt "), 0);
      v.setUint32(4, 16, true);
      v.setUint16(8, format, true);
      v.setUint16(10, channels, true);
      v.setUint32(12, rate, true);
      v.setUint32(16, rate * channels * (bits / 8), true);
      v.setUint16(20, channels * (bits / 8), true);
      v.setUint16(22, bits, true);
      return c;
    };
    const data = 400_000;
    const b = new Uint8Array(12 + 24 + 24 + 8 + data);
    b.set(bytes("RIFF", [0, 0, 0, 0], "WAVE"), 0);
    b.set(fmt(4000, 1, 8, 1), 12);
    b.set(fmt(192_000, 8, 64, 3), 36);
    b.set(bytes("data"), 60);
    new DataView(b.buffer).setUint32(64, data, true);
    expect(wavInfo(b)).toBeNull();
    expect(canonicalWav(b)).toBeNull();
  });

  it("rebuilds exactly what was measured as a plain WAV", () => {
    // Float, a lying data size (0) and a trailing partial frame.
    const src = wav({ format: 3, channels: 2, rate: 8000, bits: 32, dataBytes: 8000 * 8, declared: 0, extra: 5 });
    src.set(bytes([1, 2, 3, 4]), 44); // some sample bytes to carry over
    const out = canonicalWav(src)!;
    expect(out.info).toEqual({ format: 3, channels: 2, sampleRate: 8000, bits: 32, seconds: 1 });
    const v = new DataView(out.wav.buffer);
    expect(out.wav.length).toBe(44 + 64_000);
    expect(String.fromCharCode(...out.wav.subarray(0, 16))).toBe("RIFF" + String.fromCharCode(...new Uint8Array(new Uint32Array([36 + 64_000]).buffer)) + "WAVEfmt ");
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint32(28, true), v.getUint16(32, true), v.getUint16(34, true)]).toEqual([3, 2, 8000, 64_000, 8, 32]);
    expect(String.fromCharCode(...out.wav.subarray(36, 40))).toBe("data");
    expect(v.getUint32(40, true)).toBe(64_000);
    expect([...out.wav.subarray(44, 48)]).toEqual([1, 2, 3, 4]);
    // The rebuild measures the same as the upload, and as itself.
    expect(wavInfo(out.wav)).toEqual(out.info);
  });
});

describe("served types", () => {
  it("shares only serve videos", () => {
    expect(videoType("video/mp4")).toEqual({ type: "video/mp4", ext: "mp4" });
    expect(videoType("video/webm; codecs=vp9")).toEqual({ type: "video/webm", ext: "webm" });
    expect(videoType("image/svg+xml")).toBeNull();
    expect(videoType(undefined)).toBeNull();
  });

  it("stored media keeps media types; anything else is opaque", () => {
    expect(servableMedia("image/png")).toBe("image/png");
    expect(servableMedia("audio/mpeg")).toBe("audio/mpeg");
    expect(servableMedia("text/html")).toBeNull();
    expect(servableMedia("application/xhtml+xml")).toBeNull();
  });

  it("filenames can't break out of Content-Disposition", () => {
    expect(safeFilename('a"b\r\nSet-Cookie: x=1.mp4')).toBe("abSet-Cookie x1.mp4");
    expect(safeFilename('""', "reference")).toBe("reference");
  });
});

describe("svgToPng", () => {
  it("draws an SVG (script and all) into plain PNG pixels", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><script>alert(1)</script><rect width="120" height="40" fill="#f50"/></svg>');
    const png = await svgToPng(svg);
    expect(png).not.toBeNull();
    expect(sniffImage(png!)).toBe("image/png");
    // Scaled up so the long side is 1024 px.
    expect(png!.readUInt32BE(16)).toBe(1024);
  });

  it("returns null for something that isn't an SVG", async () => {
    expect(await svgToPng(new TextEncoder().encode("<html></html>"))).toBeNull();
  });
});
