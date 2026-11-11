import { describe, expect, it } from "vitest";
import { makeKit } from "./kit";
import { controlDefs, controlPath, controlsSet, controlValues, shuffled, withControls } from "./controls";

const SPEC = {
  Headline: "BURNING",
  Ember: "#ff5a1f",
  Grain: true,
  "Fire height": [0.6, 0, 1],
  Count: [70, 0, 200],
  Speed: 3,
  Mood: { options: ["Night", "Dawn"], value: "Dawn" },
  Sun: { point: [0.7, 0.3] },
  Junk: null,
};

describe("controlDefs", () => {
  it("reads each kind of control from its shorthand", () => {
    const defs = controlDefs("Look", SPEC);
    expect(defs.map((d) => [d.name, d.kind])).toEqual([
      ["Headline", "text"],
      ["Ember", "color"],
      ["Grain", "toggle"],
      ["Fire height", "number"],
      ["Count", "number"],
      ["Speed", "number"],
      ["Mood", "select"],
      ["Sun", "point"],
    ]);
    expect(defs.every((d) => d.group === "Look")).toBe(true);
    expect(defs[3]).toMatchObject({ value: 0.6, min: 0, max: 1, step: 0.01 });
    expect(defs[4]).toMatchObject({ value: 70, min: 0, max: 200, step: 1 });
    // A bare number gets a range around it.
    expect(defs[5]).toMatchObject({ value: 3, min: 0, max: 6 });
    expect(defs[6]).toMatchObject({ value: "Dawn", options: ["Night", "Dawn"] });
  });

  it("is nothing for a declaration that isn't one", () => {
    expect(controlDefs(null)).toEqual([]);
    expect(controlDefs("Group")).toEqual([]);
    expect(controlDefs([1, 2])).toEqual([]);
  });
});

describe("controlValues", () => {
  const defs = controlDefs(SPEC);
  it("gives the defaults untouched, and what's set within each control's kind and range", () => {
    expect(controlValues(defs, undefined)).toMatchObject({ Headline: "BURNING", Grain: true, "Fire height": 0.6, Mood: "Dawn", Sun: [0.7, 0.3] });
    const v = controlValues(defs, { Headline: "BLAZING", Grain: 0, "Fire height": 4, Mood: "Noon", Sun: [0.1, 0.9], Ember: 12 });
    expect(v).toMatchObject({ Headline: "BLAZING", Grain: false, "Fire height": 1, Mood: "Dawn", Sun: [0.1, 0.9], Ember: "#ff5a1f" });
  });

  it("reads what's set on a layer, static and keyed", () => {
    expect(controlsSet({ controls: { Speed: 2 }, "controls.Fire height": 0.2, code: "x" })).toEqual({ Speed: 2, "Fire height": 0.2 });
    expect(controlPath("v1.2 glow")).toBe("props.controls.v1·2 glow");
  });
});

describe("the kit", () => {
  const kit = makeKit(1920, 1080, { serif: "serif", sans: "sans", mono: "mono" });
  it("answers lib.controls with defaults, and with what's set once bound", () => {
    expect(kit.controls({ Speed: [3, 0, 10] })).toEqual({ Speed: 3 });
    const seen: string[] = [];
    const bound = withControls(kit, { Speed: 8 }, (defs) => seen.push(...defs.map((d) => d.name)));
    expect(bound.controls("Feel", { Speed: [3, 0, 10], Grain: true })).toEqual({ Speed: 8, Grain: true });
    expect(seen).toEqual(["Speed", "Grain"]);
  });
});

describe("shuffled", () => {
  it("stays inside a control's range and options", () => {
    const defs = controlDefs(SPEC);
    let s = 1;
    const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 50; i++)
      for (const d of defs) {
        const v = shuffled(d, r);
        if (d.kind === "number") {
          expect(v as number).toBeGreaterThanOrEqual(d.min);
          expect(v as number).toBeLessThanOrEqual(d.max);
        }
        if (d.kind === "select") expect(d.options).toContain(v);
        if (d.kind === "color") expect(v).toMatch(/^#[0-9a-f]{6}$/);
        if (d.kind === "text" || d.kind === "point") expect(v).toEqual(d.value);
      }
  });
});
