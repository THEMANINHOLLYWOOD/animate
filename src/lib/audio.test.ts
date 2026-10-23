import { describe, expect, it } from "vitest";
import { wavPlan } from "./audio";

const bytes = (p: ReturnType<typeof wavPlan>) => 44 + p.frames * p.channels * 2;

describe("wavPlan", () => {
  it("keeps short audio in stereo at the full rate", () => {
    const p = wavPlan(20, 2, 3_600_000, 32000, true);
    expect(p).toMatchObject({ channels: 2, rate: 32000, frames: 20 * 32000 });
    expect(bytes(p)).toBeLessThanOrEqual(3_600_000);
  });

  it("drops to mono, then lowers the rate, as the audio gets longer", () => {
    const mono = wavPlan(60, 2, 3_600_000, 32000, true);
    expect(mono.channels).toBe(1);
    expect(mono.rate).toBe(29999);
    const lower = wavPlan(180, 2, 3_600_000, 32000, true);
    expect(lower.rate).toBeLessThan(10050);
    expect(lower.rate).toBeGreaterThanOrEqual(8000);
    expect(lower.frames / lower.rate).toBeCloseTo(180, 1);
    for (const p of [mono, lower]) expect(bytes(p)).toBeLessThanOrEqual(3_600_000);
  });

  it("cuts audio too long for 8 kHz instead of going over the limit", () => {
    const p = wavPlan(300, 2, 3_600_000, 32000, true);
    expect(p).toMatchObject({ channels: 1, rate: 8000 });
    expect(bytes(p)).toBeLessThanOrEqual(3_600_000);
    expect(p.frames / p.rate).toBeGreaterThan(220);
    expect(p.frames / p.rate).toBeLessThan(300);
  });

  it("never exceeds the budget across lengths and rates", () => {
    for (const d of [0.5, 3.3, 47.1, 90, 224.9, 225.1, 600])
      for (const [max, rate, stereo] of [[3_600_000, 24000, false], [3_600_000, 32000, true], [500_000, 48000, true]] as const)
        expect(bytes(wavPlan(d, 2, max, rate, stereo))).toBeLessThanOrEqual(max);
  });
});
