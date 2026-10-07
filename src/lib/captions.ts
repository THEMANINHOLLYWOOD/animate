import type { AudioClip } from "./audio";

// Captions from voice word timings: short lines, readable at phone width.
export type Cue = { s: number; e: number; text: string };

const MAX_WORDS = 7;
const MAX_SECONDS = 3.5;
const MAX_GAP = 0.8;

export function cuesFromClips(clips: AudioClip[]): Cue[] {
  const words = clips
    .filter((c) => c.kind === "voice" && !c.muted && c.words?.length)
    .flatMap((c) => c.words!.map((w) => ({ w: w.w, s: w.s, e: w.e })))
    .sort((a, b) => a.s - b.s);
  const cues: Cue[] = [];
  let cur: { s: number; e: number; words: string[] } | null = null;
  for (const w of words) {
    const endsSentence = /[.!?]$/.test(w.w);
    if (cur && (cur.words.length >= MAX_WORDS || w.s - cur.e > MAX_GAP || w.e - cur.s > MAX_SECONDS)) {
      cues.push({ s: cur.s, e: cur.e, text: cur.words.join(" ") });
      cur = null;
    }
    if (!cur) cur = { s: w.s, e: w.e, words: [] };
    cur.words.push(w.w);
    cur.e = w.e;
    if (endsSentence) {
      cues.push({ s: cur.s, e: cur.e, text: cur.words.join(" ") });
      cur = null;
    }
  }
  if (cur) cues.push({ s: cur.s, e: cur.e, text: cur.words.join(" ") });
  // Hold each cue a beat so it can be read, without overlapping the next.
  return cues.map((c, i) => ({ ...c, e: Math.max(c.e, Math.min(c.e + 0.6, cues[i + 1] ? cues[i + 1].s - 0.05 : c.e + 0.6)) }));
}

const ts = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};

export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${ts(c.s)} --> ${ts(c.e)}\n${c.text}\n`).join("\n");

export const cueAt = (cues: Cue[], t: number) => cues.find((c) => t >= c.s && t < c.e) ?? null;

// Burn a caption into a frame: bottom safe area, high contrast, two lines max.
export function drawCaption(ctx: CanvasRenderingContext2D, W: number, H: number, text: string, sans: string) {
  const u = Math.min(W, H) / 1080;
  const size = 38 * u;
  ctx.save();
  ctx.font = `500 ${size}px ${sans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxW = W * 0.8;
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const lh = size * 1.3;
  const padX = 22 * u, padY = 10 * u;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  const bh = lines.length * lh + padY * 2;
  const x = W / 2, y = H - H * 0.08 - bh / 2;
  ctx.fillStyle = "rgba(20,20,19,0.82)";
  ctx.beginPath();
  ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, 10 * u);
  ctx.fill();
  ctx.fillStyle = "#FAF9F5";
  lines.forEach((l, i) => ctx.fillText(l, x, y - ((lines.length - 1) * lh) / 2 + i * lh));
  ctx.restore();
}
