import { describe, expect, it } from "vitest";
import type { AudioClip } from "./audio";
import { cueAt, cuesFromClips, toSrt } from "./captions";

const words = (text: string, start: number, wps = 2.5) =>
  text.split(" ").map((w, i) => ({ w, s: start + i / wps, e: start + (i + 0.8) / wps }));

const voice = (text: string, start: number, extra: Partial<AudioClip> = {}): AudioClip => ({
  id: text.slice(0, 4),
  kind: "voice",
  label: "VO",
  start,
  duration: text.split(" ").length / 2.5,
  gain: 1,
  muted: false,
  source: "generated",
  text,
  words: words(text, start),
  ...extra,
});

describe("captions", () => {
  it("splits on sentences and keeps lines short", () => {
    const cues = cuesFromClips([voice("Good mornings are brewed slowly. Every single step counts here today friends.", 1)]);
    expect(cues.map((c) => c.text)).toEqual(["Good mornings are brewed slowly.", "Every single step counts here today friends."]);
    expect(cues[0].s).toBeCloseTo(1);
    expect(cues[1].s).toBeGreaterThan(cues[0].e);
  });

  it("breaks long runs without punctuation at seven words", () => {
    const cues = cuesFromClips([voice("one two three four five six seven eight nine ten", 0)]);
    expect(cues.map((c) => c.text.split(" ").length)).toEqual([7, 3]);
  });

  it("ignores muted voice and clips without timings", () => {
    expect(cuesFromClips([voice("Hidden line here.", 0, { muted: true }), voice("No words", 2, { words: undefined })])).toEqual([]);
  });

  it("writes valid srt and finds the cue at a time", () => {
    const cues = cuesFromClips([voice("Hello there.", 0.5)]);
    expect(toSrt(cues)).toMatch(/^1\n00:00:00,500 --> 00:00:0\d,\d{3}\nHello there.\n/);
    expect(cueAt(cues, 0.6)?.text).toBe("Hello there.");
    expect(cueAt(cues, 9)).toBeNull();
  });
});
