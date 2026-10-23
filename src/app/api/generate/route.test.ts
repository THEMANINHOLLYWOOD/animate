import { beforeEach, describe, expect, it, vi } from "vitest";

// A 50 ms function limit, so a "long" answer is cut off at once.
vi.hoisted(() => {
  process.env.ANIMATE_FUNCTION_SECONDS = "0.05";
});

// What the fake model writes: one chunk, then either finishes or runs into the time limit.
const model = vi.hoisted(() => ({ text: "", finish: false, stop: "end_turn" }));

vi.mock("@/lib/store", () => ({ requireUser: async () => null }));
vi.mock("@/lib/anthropic", () => ({
  anthropicClient: () => ({
    beta: {
      messages: {
        stream: (_params: unknown, { signal }: { signal: AbortSignal }) => {
          const on: Record<string, (x: unknown) => void> = {};
          return {
            on(event: string, cb: (x: unknown) => void) {
              on[event] = cb;
            },
            async finalMessage() {
              on.text?.(model.text);
              if (model.finish) return { stop_reason: model.stop, content: [] };
              await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
            },
          };
        },
      },
    },
  }),
}));

import { LIMITS, limit, resetLimits } from "@/lib/limits";
import { POST } from "./route";

const IP = "203.0.113.7";
const GUEST = LIMITS.generate.guest[0][0];
const scene = { stage: "animate", prompt: "A long film about tides", treatment: "Shot list…", duration: 90, aspect: "16:9", files: [] };
const post = (body: object) =>
  POST(new Request("https://app.test/api/generate", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": IP }, body: JSON.stringify(body) }));
// Spends the guest's generation allowance one part at a time; how many parts that took.
const spend = async () => {
  let n = 0;
  while (!(await limit(new Request("https://app.test", { headers: { "x-forwarded-for": IP } }), "generate"))) n++;
  return n;
};
const events = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; text?: string });

beforeEach(() => {
  resetLimits();
  model.stop = "end_turn";
});

describe("POST /api/generate metering", () => {
  it("lets every part of a long answer through, even after the guest's allowance is spent", async () => {
    model.text = "```js\nconst part1 = 1;";
    model.finish = false;
    const first = await events(await post(scene));
    expect(first.at(-1)).toEqual({ type: "partial", text: model.text });

    // The guest uses up their whole allowance meanwhile.
    await spend();
    expect((await post({ ...scene, prompt: "another film" })).status).toBe(429);

    // The client resumes from exactly the text it was sent: that's the pass the server left.
    const sofar = model.text;
    model.text = "\nconst part2 = 2;";
    const second = await events(await post({ ...scene, continuation: sofar }));
    expect(second.at(-1)?.type).toBe("partial");

    // And again, until it finishes.
    model.text = "\n```";
    model.finish = true;
    const third = await post({ ...scene, continuation: sofar + "\nconst part2 = 2;" });
    expect(third.status).toBe(200);
    expect((await events(third)).at(-1)).toEqual({ type: "done" });

    // A connection that dropped mid-answer resumes from text the server never recorded: there's
    // no pass for it, but its film has started, so it goes through too.
    const resumed = await post({ ...scene, continuation: sofar + "anything else" });
    expect(resumed.status).toBe(200);
    await events(resumed);
    // A continuation of a film that never started has nothing to ride on.
    expect((await post({ ...scene, prompt: "another film", continuation: sofar })).status).toBe(429);
  });

  it("a run still thinking at the limit gets its lighter retry", async () => {
    model.text = "";
    model.finish = false;
    expect((await events(await post(scene))).at(-1)?.type).toBe("timeout");
    await spend();
    model.text = "```js\n```";
    model.finish = true;
    const retry = await post({ ...scene, effortCap: "medium" });
    expect(retry.status).toBe(200);
    expect((await events(retry)).at(-1)).toEqual({ type: "done" });
  });

  it("an answer that runs into the output cap is continued like one cut off by time", async () => {
    model.text = "```js\nconst a = 1;";
    model.finish = true;
    model.stop = "max_tokens";
    expect((await events(await post(scene))).at(-1)).toEqual({ type: "partial", text: model.text });
    await spend();
    const sofar = model.text;
    model.text = "\n```";
    model.stop = "end_turn";
    const rest = await post({ ...scene, continuation: sofar });
    expect(rest.status).toBe(200);
    expect((await events(rest)).at(-1)).toEqual({ type: "done" });
  });

  it("once a treatment has started its film, the scene and its fixes go through", async () => {
    model.text = "Treatment";
    model.finish = true;
    const brief = { stage: "direct", prompt: scene.prompt, duration: scene.duration, aspect: scene.aspect, files: [] };
    expect((await events(await post(brief))).at(-1)).toEqual({ type: "done" });
    await spend();
    model.text = "```js\n```";
    expect((await events(await post({ ...scene, treatment: "Treatment" }))).at(-1)).toEqual({ type: "done" });
    expect((await events(await post({ ...scene, treatment: "Treatment", previousCode: "x", error: "boom" }))).at(-1)).toEqual({ type: "done" });
    expect((await events(await post({ ...scene, treatment: "Treatment", previousCode: "x", critique: "- at 1s: …" }))).at(-1)).toEqual({ type: "done" });
    // A new film waits for room.
    expect((await post({ ...brief, prompt: "another film" })).status).toBe(429);
  });

  it("a request claiming to resume without a pass is metered like a new stage", async () => {
    await spend();
    // A lighter retry or a continuation the server never cut short buys nothing once the allowance is spent.
    expect((await post({ ...scene, effortCap: "none" })).status).toBe(429);
    expect((await post({ ...scene, continuation: "```js\nconst x = 1;" })).status).toBe(429);
  });

  it("a film that's stopped or refused has spent only the parts it ran", async () => {
    // Cut short, and the client never comes back for the rest.
    model.text = "```js\nconst a = 1;";
    model.finish = false;
    expect((await events(await post(scene))).at(-1)?.type).toBe("partial");
    // Declined outright.
    model.text = "";
    model.finish = true;
    model.stop = "refusal";
    expect((await events(await post({ ...scene, prompt: "another film", previousCode: "x", error: "boom" }))).at(-1)?.type).toBe("error");
    expect(await spend()).toBe(GUEST - 2);
  });
});
