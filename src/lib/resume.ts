// A build's checkpoint, kept on the film while it's unfinished: what the brief asked for and what each
// finished stage made, so a build that stops (credits ran out, a rate limit, the time limit, a cancel,
// a reload) is continued from its first unfinished stage instead of started over. It's cleared when
// the build completes. Everything read back from storage goes through planOf: a record that's missing
// or malformed is no plan at all, and the film behaves as it did before there were checkpoints.

import type { ElementsPlan } from "./elements";
import type { Aspect } from "./engine";

export const STAGES = ["direct", "elements", "animate", "review", "sound"] as const;
export type Stage = (typeof STAGES)[number];
// The review looks at the film this many times at most.
export const REVIEW_ROUNDS = 2;

export type Resume = {
  v: 1;
  // The first stage that hasn't finished.
  stage: Stage;
  // The brief as the stages get it, and as it was typed (the thread's first message).
  brief: string;
  request: string;
  recreate: boolean;
  duration: number;
  aspect: Aspect;
  style?: string;
  // How many attachments the brief came with (files, video frames). They last only as long as the page.
  attached?: number;
  // What the finished stages made. Once a working draft is saved the film itself carries the treatment
  // (film.treatment) and the elements (film.doc), so only the animator's brief about the elements stays.
  treatment?: string;
  elements?: ElementsPlan;
  notes?: string;
  // The animator's own line about its draft (the thread's reply).
  note?: string;
  // Review rounds finished.
  rounds?: number;
  // Why it stopped, in the run's own words.
  reason?: string;
  at: number;
};

// A checkpoint reconciled with the film it's on: where to pick up, and with what.
export type Plan = Omit<Resume, "treatment" | "elements" | "rounds"> & { treatment?: string; elements?: ElementsPlan; rounds: number; draft: boolean };

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1"];
const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);
const elementsOf = (x: unknown): ElementsPlan | undefined => {
  const p = x as ElementsPlan | null;
  return p && typeof p === "object" && Array.isArray(p.elements) && p.elements.every((e) => e && typeof e === "object") && typeof p.background === "string" && typeof p.leftover === "string"
    ? p
    : undefined;
};

// A stored checkpoint, checked field by field (only what's known is kept), or null.
export function parseResume(x: unknown): Resume | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (r.v !== 1 || !STAGES.includes(r.stage as Stage)) return null;
  if (typeof r.brief !== "string" || typeof r.request !== "string" || typeof r.recreate !== "boolean") return null;
  if (typeof r.duration !== "number" || !Number.isFinite(r.duration) || r.duration <= 0 || !ASPECTS.includes(r.aspect as Aspect)) return null;
  const rounds = typeof r.rounds === "number" && Number.isInteger(r.rounds) ? Math.min(REVIEW_ROUNDS, Math.max(0, r.rounds)) : 0;
  return {
    v: 1,
    stage: r.stage as Stage,
    brief: r.brief,
    request: r.request,
    recreate: r.recreate,
    duration: r.duration,
    aspect: r.aspect as Aspect,
    style: str(r.style),
    attached: typeof r.attached === "number" && r.attached > 0 ? r.attached : undefined,
    treatment: str(r.treatment),
    elements: elementsOf(r.elements),
    notes: str(r.notes),
    note: str(r.note),
    rounds: rounds || undefined,
    reason: str(r.reason),
    at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
  };
}

type Film = { code?: string; doc?: unknown; treatment?: string; resume?: unknown };

// Where a film's build can be picked up, or null when it has no (readable) checkpoint. The stage is
// only ever as far along as what's really there: a film with a working draft is at its review (or its
// sound); one without goes back to the last stage whose inputs survive.
export function planOf(film: Film): Plan | null {
  const r = parseResume(film.resume);
  if (!r) return null;
  const draft = !!(film.code || film.doc);
  const at = STAGES.indexOf(r.stage);
  if (draft) {
    const treatment = r.treatment ?? str(film.treatment);
    return { ...r, stage: r.stage === "sound" ? "sound" : "review", treatment, elements: undefined, rounds: r.rounds ?? 0, draft };
  }
  const treatment = at > 0 ? r.treatment : undefined;
  const elements = r.recreate && treatment && at > 1 ? r.elements : undefined;
  const stage: Stage = !treatment ? "direct" : r.recreate && !elements ? "elements" : "animate";
  return { ...r, stage, treatment, elements, notes: undefined, note: undefined, rounds: 0, draft };
}

const NAMES: Record<Stage, string> = { direct: "treatment", elements: "elements", animate: "animation", review: "review", sound: "sound" };
// The stages a build goes through, in the words the plan uses (a recreation's treatment is a breakdown).
const stagesOf = (plan: Pick<Plan, "recreate">) => STAGES.filter((s) => s !== "elements" || plan.recreate);
const nameOf = (plan: Pick<Plan, "recreate">, s: Stage) => (s === "direct" && plan.recreate ? "breakdown" : NAMES[s]);

export function progressOf(plan: Pick<Plan, "stage" | "recreate">): { done: string[]; left: string[] } {
  const all = stagesOf(plan);
  const at = all.indexOf(plan.stage);
  return { done: all.slice(0, at).map((s) => nameOf(plan, s)), left: all.slice(at).map((s) => nameOf(plan, s)) };
}

// "Finished: treatment, elements. Left: animation, review, sound."
export function planText(plan: Pick<Plan, "stage" | "recreate">) {
  const { done, left } = progressOf(plan);
  return `${done.length ? `Finished: ${done.join(", ")}.` : "Nothing finished yet."} Left: ${left.join(", ")}.`;
}

// Whether continuing can make the film. `kept`: the brief's attachments are still held by this page.
// With nothing finished and the attachments gone, only a typed brief is enough to start from (a
// recreation is nothing without its video).
export const canContinue = (plan: Pick<Plan, "stage" | "recreate" | "request" | "attached">, kept: boolean) =>
  plan.stage !== "direct" || kept || !plan.attached || (!plan.recreate && !!plan.request.trim());

// The run panel's line when a build is continued without the attachments it started with.
export function lostNote(plan: Pick<Plan, "stage" | "recreate" | "attached">, kept: boolean) {
  if (kept || !plan.attached || plan.stage === "sound") return null;
  if (plan.recreate) return "The reference video isn't kept across a reload: continuing from its breakdown, without its frames or original sound";
  return `The brief's attachments aren't kept across a reload: continuing from the ${plan.stage === "direct" ? "brief" : "treatment"} without them`;
}
