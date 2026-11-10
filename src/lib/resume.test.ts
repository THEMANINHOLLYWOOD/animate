import { describe, expect, it } from "vitest";
import type { ElementsPlan } from "./elements";
import { canContinue, lostNote, parseResume, planOf, planText, progressOf, type Resume } from "./resume";

const base: Resume = { v: 1, stage: "animate", brief: "A kettle boils", request: "A kettle boils", recreate: false, duration: 5, aspect: "16:9", treatment: "Shot 1: a kettle.", at: 10 };
const elements = { elements: [{ id: "e1", name: "Title" }], background: "#fff", leftover: "" } as unknown as ElementsPlan;

describe("parseResume", () => {
  it("keeps a well-formed checkpoint, and only the fields it knows", () => {
    expect(parseResume({ ...base, extra: 1 })).toEqual(base);
    expect(parseResume(JSON.parse(JSON.stringify({ ...base, style: "ink", attached: 3, rounds: 1, reason: "Stopped.", note: "Built it.", notes: "Leave the title alone." })))).toEqual({
      ...base,
      style: "ink",
      attached: 3,
      rounds: 1,
      reason: "Stopped.",
      note: "Built it.",
      notes: "Leave the title alone.",
    });
  });

  it("is null for anything that isn't a checkpoint of this version", () => {
    for (const bad of [undefined, null, "direct", 7, [], {}, { ...base, v: 2 }, { ...base, stage: "render" }, { ...base, brief: 5 }, { ...base, request: undefined }, { ...base, recreate: "yes" }])
      expect(parseResume(bad)).toBeNull();
    for (const bad of [{ ...base, duration: 0 }, { ...base, duration: NaN }, { ...base, duration: "5" }, { ...base, aspect: "4:3" }]) expect(parseResume(bad)).toBeNull();
  });

  it("drops fields that are malformed without losing the rest", () => {
    const r = parseResume({ ...base, style: 4, treatment: ["x"], elements: { elements: "none" }, rounds: 9, reason: {}, at: "now", attached: -2 });
    expect(r).toEqual({ ...base, treatment: undefined, at: 0, rounds: 2 });
    expect(parseResume({ ...base, elements })?.elements).toEqual(elements);
    expect(parseResume({ ...base, elements: { ...elements, elements: [null] } })?.elements).toBeUndefined();
    expect(parseResume({ ...base, rounds: 1.5 })?.rounds).toBeUndefined();
  });
});

describe("planOf", () => {
  it("is null without a readable checkpoint", () => {
    expect(planOf({ code: "" })).toBeNull();
    expect(planOf({ code: "", resume: { stage: "animate" } })).toBeNull();
    expect(planOf({ code: "x", resume: "corrupt" })).toBeNull();
  });

  it("picks up at the first stage whose work isn't there", () => {
    expect(planOf({ code: "", resume: { ...base, stage: "direct", treatment: undefined } })).toMatchObject({ stage: "direct", draft: false, rounds: 0 });
    expect(planOf({ code: "", resume: base })).toMatchObject({ stage: "animate", treatment: "Shot 1: a kettle.", draft: false });
    // A stage that says more than the film holds goes back to what's there.
    expect(planOf({ code: "", resume: { ...base, treatment: undefined } })?.stage).toBe("direct");
    expect(planOf({ code: "", resume: { ...base, stage: "review", rounds: 1 } })).toMatchObject({ stage: "animate", rounds: 0 });
    expect(planOf({ code: "", resume: { ...base, stage: "sound" } })?.stage).toBe("animate");
    // A treatment noted before the director finished isn't one.
    expect(planOf({ code: "", resume: { ...base, stage: "direct" } })).toMatchObject({ stage: "direct", treatment: undefined });
  });

  it("strips a recreation into elements before animating it", () => {
    const rec = { ...base, recreate: true };
    expect(planOf({ code: "", resume: { ...rec, stage: "elements" } })?.stage).toBe("elements");
    expect(planOf({ code: "", resume: { ...rec, stage: "elements", elements } })).toMatchObject({ stage: "elements", elements: undefined });
    expect(planOf({ code: "", resume: { ...rec, elements } })).toMatchObject({ stage: "animate", elements });
    expect(planOf({ code: "", resume: rec })?.stage).toBe("elements");
    expect(planOf({ code: "", resume: { ...base, stage: "elements" } })?.stage).toBe("animate");
  });

  it("treats a film with a working draft as animated, whatever the checkpoint says", () => {
    expect(planOf({ code: "scene", treatment: "On the film.", resume: { ...base, stage: "review", treatment: undefined, rounds: 1, notes: "n" } })).toMatchObject({
      stage: "review",
      draft: true,
      treatment: "On the film.",
      rounds: 1,
      notes: "n",
    });
    expect(planOf({ code: "scene", resume: base })).toMatchObject({ stage: "review", treatment: "Shot 1: a kettle.", rounds: 0 });
    expect(planOf({ code: "", doc: {}, resume: { ...base, stage: "direct", elements } })).toMatchObject({ stage: "review", elements: undefined });
    expect(planOf({ code: "scene", resume: { ...base, stage: "sound" } })?.stage).toBe("sound");
  });
});

describe("the plan in words", () => {
  it("lists what's finished and what's left", () => {
    expect(planText({ stage: "animate", recreate: false })).toBe("Finished: treatment. Left: animation, review, sound.");
    expect(planText({ stage: "direct", recreate: false })).toBe("Nothing finished yet. Left: treatment, animation, review, sound.");
    expect(planText({ stage: "animate", recreate: true })).toBe("Finished: breakdown, elements. Left: animation, review, sound.");
    expect(planText({ stage: "elements", recreate: true })).toBe("Finished: breakdown. Left: elements, animation, review, sound.");
    expect(planText({ stage: "sound", recreate: false })).toBe("Finished: treatment, animation, review. Left: sound.");
    expect(progressOf({ stage: "review", recreate: false })).toEqual({ done: ["treatment", "animation"], left: ["review", "sound"] });
  });

  it("continues without lost attachments unless nothing else is left to start from", () => {
    const typed = { stage: "direct" as const, recreate: false, request: "A kettle", attached: 2 };
    expect(canContinue(typed, false)).toBe(true);
    expect(canContinue({ ...typed, request: " " }, false)).toBe(false);
    expect(canContinue({ ...typed, request: " " }, true)).toBe(true);
    expect(canContinue({ ...typed, request: "", attached: undefined }, false)).toBe(true);
    expect(canContinue({ ...typed, recreate: true }, false)).toBe(false);
    expect(canContinue({ ...typed, recreate: true, stage: "elements" }, false)).toBe(true);
    expect(lostNote(typed, true)).toBeNull();
    expect(lostNote({ ...typed, attached: undefined }, false)).toBeNull();
    expect(lostNote(typed, false)).toMatch(/continuing from the brief without them/);
    expect(lostNote({ ...typed, stage: "review" }, false)).toMatch(/continuing from the treatment without them/);
    expect(lostNote({ ...typed, recreate: true, stage: "animate" }, false)).toMatch(/reference video isn't kept/);
    expect(lostNote({ ...typed, stage: "sound" }, false)).toBeNull();
  });
});
