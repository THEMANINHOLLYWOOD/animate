import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { codeHash } from "../extract/codeHash";
import { setProp } from "../doc/ops";
import { createEditorStore } from "../store/store";
import { propAt } from "../doc/interpolate";
import { Doc } from "../doc/schema";
import { buildSampleDoc } from "./__fixtures__/sampleDoc";
import { AGENT_TOOLS, type AgentCall, cleanHistory, commitCalls, docForAgent, replayCalls, runTool, stepUndone, summarizeDoc, watchPresses } from "./tools";

const byName = (doc: Doc, name: string) => doc.layers.find((l) => l.name === name)!;

describe("agent tools on a sample film", () => {
  const sample = buildSampleDoc();

  it("declares strict, valid schemas for every tool", () => {
    for (const t of AGENT_TOOLS) {
      expect(t.strict).toBe(true);
      const schema = t.input_schema as unknown as { properties: object; required: string[]; additionalProperties: boolean };
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    }
  });

  it("summarises layers with ids, timing and animated props", () => {
    const s = summarizeDoc(sample, 7);
    expect(s).toContain('"Headline · line 1"');
    expect(s).toContain("animated: props.reveal");
    expect(s.split("\n").length).toBeGreaterThan(sample.layers.length);
  });

  it("sets a static property and keyframes an animated one at the playhead", () => {
    const h = byName(sample, "Headline · line 1");
    let r = runTool(sample, "set_property", { layer_id: h.id, path: "props.size", value: 130, time: null }, 7);
    expect(byName(r.doc, "Headline · line 1").props.size).toBe(130);
    r = runTool(r.doc, "set_property", { layer_id: h.id, path: "transform.opacity", value: 0.5, time: 7 }, 7);
    expect(propAt(byName(r.doc, "Headline · line 1"), "transform.opacity", 7)).toBeCloseTo(0.5);
    expect(r.isError).toBeFalsy();
  });

  it("moves a whole section later, keyframes travelling with the clips", () => {
    const facts = sample.layers.filter((l) => l.name.startsWith("Facts") || l.name.startsWith("Principle"));
    const before = propAt(facts[0], "props.reveal", 25.2);
    const r = runTool(sample, "move_layers", { layer_ids: facts.map((l) => l.id), dt: 2 }, 0);
    const moved = r.doc.layers.find((l) => l.id === facts[0].id)!;
    expect(moved.start).toBeCloseTo(facts[0].start + 2);
    expect(propAt(moved, "props.reveal", 27.2)).toBeCloseTo(before as number);
  });

  it("adds, keyframes, eases and deletes a new layer", () => {
    let r = runTool(
      sample,
      "add_layer",
      { type: "text", name: "Subtitle", start: 1, end: 5, x: 960, y: 900, props_json: '{"text":"Hello","size":40,"align":"center"}', above_layer_id: null },
      0,
    );
    const id = r.result.replace("created layer id ", "");
    expect(r.doc.layers.find((l) => l.id === id)?.props.text).toBe("Hello");
    r = runTool(r.doc, "add_keyframe", { layer_id: id, path: "transform.opacity", time: 1, value: 0, ease: "ease_out" }, 0);
    r = runTool(r.doc, "add_keyframe", { layer_id: id, path: "transform.opacity", time: 2, value: 1, ease: "linear" }, 0);
    expect(propAt(r.doc.layers.find((l) => l.id === id)!, "transform.opacity", 1.5)).toBeGreaterThan(0.5);
    r = runTool(r.doc, "set_ease", { layer_id: id, path: null, ease: "spring" }, 0);
    expect(r.doc.layers.find((l) => l.id === id)!.anim["transform.opacity"][0].ease).toHaveProperty("spring");
    r = runTool(r.doc, "remove_keyframes", { layer_id: id, path: "transform.opacity", times: [2] }, 0);
    expect(r.doc.layers.find((l) => l.id === id)!.anim["transform.opacity"]).toHaveLength(1);
    r = runTool(r.doc, "delete_layers", { layer_ids: [id] }, 0);
    expect(r.doc.layers.some((l) => l.id === id)).toBe(false);
  });

  it("trims, splits, renames, hides, reorders and retimes", () => {
    const g = byName(sample, "Globe");
    let r = runTool(sample, "trim_layer", { layer_id: g.id, start: 1, end: 29 }, 0);
    r = runTool(r.doc, "split_layer", { layer_id: g.id, time: 10 }, 0);
    expect(r.doc.layers.filter((l) => l.type === "globe")).toHaveLength(2);
    r = runTool(r.doc, "rename_layer", { layer_id: g.id, name: "Earth" }, 0);
    r = runTool(r.doc, "set_layer_flags", { layer_id: g.id, hidden: true, locked: null }, 0);
    r = runTool(r.doc, "reorder_layer", { layer_id: g.id, index: 5 }, 0);
    expect(r.doc.layers[5].name).toBe("Earth");
    expect(r.doc.layers[5].hidden).toBe(true);
    r = runTool(r.doc, "retime_film", { duration: 45, mode: "scale", from: 0 }, 0);
    expect(r.doc.meta.duration).toBe(45);
  });

  it("reports bad ids and invalid input as tool errors without changing the doc", () => {
    const r = runTool(sample, "set_property", { layer_id: "nope", path: "props.size", value: 1, time: null }, 0);
    expect(r.isError).toBe(true);
    expect(r.doc).toBe(sample);
    const bad = runTool(sample, "add_layer", { type: "text", name: "x", start: 0, end: 1, x: 0, y: 0, props_json: "{nope", above_layer_id: null }, 0);
    expect(bad.isError).toBe(true);
  });

  it("seek moves the playhead without editing", () => {
    const r = runTool(sample, "seek", { time: 12 }, 0);
    expect(r.seek).toBe(12);
    expect(r.doc).toBe(sample);
  });
});

// A code layer whose text was split out (matching its code), with linked copies and a recorded track.
const CODE = "ctx.fillText('Hi', 100, 100)";
const shake = Array.from({ length: 60 }, (_, i) => ({ id: `kx${i}`, t: i / 30, v: 100 + (i % 2 ? 3 : -3), ease: "linear" as const }));
const splitFilm = () =>
  Doc.parse({
    meta: { id: "f", title: "Split", size: { w: 1920, h: 1080 }, fps: 30, duration: 10 },
    assets: [{ id: "a1", kind: "image", name: "logo", src: "data:image/png;base64,AAAA" }],
    layers: [
      { id: "code", name: "Artwork (code)", type: "code", start: 0, end: 10, props: { code: CODE, skipText: true, keepText: [], splitHash: codeHash(CODE) } },
      { id: "word", name: "“Hi”", type: "text", start: 1, end: 3, transform: { x: 100, y: 100 }, props: { text: "Hi", size: 40, splitFrom: "code", linkId: "L", autoName: true }, anim: { "transform.x": shake } },
      { id: "shadow", name: "“Hi”", type: "text", start: 1, end: 3, transform: { x: 104, y: 104 }, props: { text: "Hi", size: 40, color: "#000", splitFrom: "code", linkId: "L", autoName: true } },
      { id: "plain", name: "Title", type: "text", start: 0, end: 10, transform: { x: 960, y: 200 }, props: { text: "Plain", size: 60 } },
    ],
  });
const get = (doc: Doc, id: string) => doc.layers.find((l) => l.id === id)!;

describe("agent tools on split text", () => {
  it("summarises split text, links and long recorded tracks compactly", () => {
    const s = summarizeDoc(splitFilm(), 2);
    expect(s).toContain("split text of code");
    expect(s).toContain("linked with shadow");
    expect(s).toContain("2 split text layers");
    expect(s).toContain("transform.x (60 keys)");
    expect(s).not.toContain("kx1");
  });

  it("get_layer gives film-time keys, summarises a recording and says where split text stands", () => {
    const r = runTool(splitFilm(), "get_layer", { layer_id: "word" }, 2);
    const j = JSON.parse(r.result);
    expect(j.anim["transform.x"]).toMatchObject({ keys: 60, from: 1, min: 97, max: 103 });
    expect(j.anim["transform.x"].first[0]).toEqual({ t: 1, v: 97, ease: "linear" });
    expect(j.split).toEqual({ from: "code", status: "live" });
    expect(j.linkedWith).toEqual(["shadow"]);
    expect(r.result.length).toBeLessThan(2000);
    const code = JSON.parse(runTool(splitFilm(), "get_layer", { layer_id: "code" }, 2).result);
    expect(code.splitText).toEqual(["word", "shadow"]);
  });

  it("get_keyframes lists a range of a recording in film time", () => {
    const r = runTool(splitFilm(), "get_keyframes", { layer_id: "word", path: "transform.x", from: 2, to: 2.1 }, 0);
    const j = JSON.parse(r.result);
    expect(j.keys.map((k: { t: number }) => k.t)).toEqual([2, 2.033, 2.067, 2.1]);
    const all = JSON.parse(runTool(splitFilm(), "get_keyframes", { layer_id: "plain", path: "props.size", from: null, to: null }, 0).result);
    expect(all).toEqual({ path: "props.size", keys: [], static: 60 });
  });

  it("set_text changes the words on every linked copy and renames layers named by their words", () => {
    const r = runTool(splitFilm(), "set_text", { layer_id: "word", text: "Hello", time: null }, 2);
    expect(r.isError).toBeFalsy();
    expect(r.result).toContain("1 linked copy");
    expect([get(r.doc, "word").props.text, get(r.doc, "shadow").props.text]).toEqual(["Hello", "Hello"]);
    expect([get(r.doc, "word").name, get(r.doc, "shadow").name]).toEqual(["“Hello”", "“Hello”"]);
    expect(runTool(splitFilm(), "set_text", { layer_id: "code", text: "x", time: null }, 0).isError).toBe(true);
  });

  it("set_property moves a whole recorded track, and unlink_layer frees a copy", () => {
    let r = runTool(splitFilm(), "set_property", { layer_id: "word", path: "transform.x", value: 200, time: 1 }, 0);
    const xs = get(r.doc, "word").anim["transform.x"].map((k) => k.v);
    expect(xs.slice(0, 2)).toEqual([200, 206]); // the shake is kept, moved
    r = runTool(r.doc, "unlink_layer", { layer_id: "shadow" }, 0);
    r = runTool(r.doc, "set_text", { layer_id: "word", text: "Bye", time: null }, 2);
    expect(get(r.doc, "shadow").props.text).toBe("Hi");
  });

  it("says when changing the code stands its split text down", () => {
    const r = runTool(splitFilm(), "set_property", { layer_id: "code", path: "props.code", value: "ctx.fillText('Yo', 0, 0)", time: null }, 0);
    expect(r.result).toContain("stood down");
    expect(summarizeDoc(r.doc, 2)).toContain("split text of code (stood down)");
    const later = runTool(r.doc, "set_property", { layer_id: "plain", path: "props.size", value: 50, time: null }, 0);
    expect(later.result).toBe("ok");
    expect(runTool(r.doc, "set_property", { layer_id: "word", path: "props.color", value: "#f00", time: null }, 0).result).toContain("won't show");
  });

  it("get_layer gives a code layer's code whole, and refuses cut-short code as new code", () => {
    const long = CODE + "/*" + "x".repeat(9000) + "*/";
    const film = produce(splitFilm(), (d) => {
      d.layers[0].props.code = long;
      d.layers[0].props.note = "y".repeat(5000);
    });
    const j = JSON.parse(runTool(film, "get_layer", { layer_id: "code" }, 0).result);
    expect(j.props.code).toBe(long);
    expect(j.props.note).toContain("5000 characters in all"); // other long props are still cut
    const huge = produce(film, (d) => {
      d.layers[0].props.code = "x".repeat(500_000);
    });
    const cut = JSON.parse(runTool(huge, "get_layer", { layer_id: "code" }, 0).result).props.code as string;
    expect(cut.length).toBeLessThan(500_000);
    const r = runTool(huge, "set_property", { layer_id: "code", path: "props.code", value: cut, time: null }, 0);
    expect(r.isError).toBe(true);
    expect(r.doc).toBe(huge);
    // Measured in characters, as it would be cut: code full of escapes (longer as JSON) still comes whole.
    const escaped = CODE + "/*" + '"\\\n'.repeat(120_000) + "*/";
    const film2 = produce(film, (d) => {
      d.layers[0].props.code = escaped;
    });
    expect(JSON.stringify(escaped).length).toBeGreaterThan(400_000);
    expect(escaped.length).toBeLessThan(400_000);
    expect(JSON.parse(runTool(film2, "get_layer", { layer_id: "code" }, 0).result).props.code).toBe(escaped);
  });

  it("removing every key keeps the value shown at the playhead", () => {
    const r = runTool(splitFilm(), "remove_keyframes", { layer_id: "word", path: "transform.x", times: null }, 1 + 3 / 30);
    expect(get(r.doc, "word").anim["transform.x"]).toBeUndefined();
    expect(get(r.doc, "word").transform.x).toBeCloseTo(103);
  });
});

// The agent's edits, as the route streams them: each call that changed its copy of the doc.
function agentRun(doc: Doc, steps: [string, Record<string, unknown>][], playhead = 0) {
  const calls: AgentCall[] = [];
  for (const [name, input] of steps) {
    const out = runTool(doc, name, input, playhead);
    if (out.doc !== doc) calls.push({ name, input, t: playhead, ...(out.created ? { created: out.created } : {}) });
    doc = out.doc;
  }
  return { doc, calls };
}

describe("applying the agent's work", () => {
  it("replays its edits onto the doc as it is now, keeping the edits made meanwhile", () => {
    const start = splitFilm();
    const agent = agentRun(start, [["set_property", { layer_id: "plain", path: "props.size", value: 90, time: null }]]);
    // Meanwhile, by hand: a new colour on the same layer, and the shadow moved.
    const mine = produce(start, (d) => {
      d.layers.find((l) => l.id === "plain")!.props.color = "#c00";
      d.layers.find((l) => l.id === "shadow")!.transform.y = 300;
    });
    const r = replayCalls(mine, agent.calls);
    expect(r.applied).toBe(1);
    expect(r.failed).toEqual([]);
    expect(get(r.doc, "plain").props).toMatchObject({ size: 90, color: "#c00" });
    expect(get(r.doc, "shadow").transform.y).toBe(300);
  });

  it("maps the layers it made to the ones the replay makes", () => {
    const start = splitFilm();
    const add = { type: "text", name: "Sub", start: 0, end: 4, x: 10, y: 20, props_json: '{"text":"Sub"}', above_layer_id: null };
    const first = agentRun(start, [["add_layer", add]]);
    const theirs = first.calls[0].created![0];
    // The next call names the layer the first one made, by its id on the agent's copy.
    const second = agentRun(first.doc, [["set_text", { layer_id: theirs, text: "Caption", time: null }]]);
    const r = replayCalls(start, [...first.calls, ...second.calls]);
    expect(r.failed).toEqual([]);
    expect(r.applied).toBe(2);
    const made = r.doc.layers.filter((l) => l.name === "Sub");
    expect(made).toHaveLength(1);
    expect(made[0].props.text).toBe("Caption");
    expect(made[0].id).not.toBe(theirs);
  });

  it("skips edits to layers deleted meanwhile and applies the rest", () => {
    const start = splitFilm();
    const agent = agentRun(start, [
      ["set_property", { layer_id: "plain", path: "props.size", value: 90, time: null }],
      ["set_text", { layer_id: "word", text: "Yo", time: null }],
    ]);
    const mine = produce(start, (d) => {
      d.layers = d.layers.filter((l) => l.id !== "plain");
    });
    const r = replayCalls(mine, agent.calls);
    expect(r.applied).toBe(1);
    expect(r.failed).toEqual([{ index: 0, error: "No layer with id plain." }]);
    expect(get(r.doc, "shadow").props.text).toBe("Yo");
  });

  it("moves or deletes the layers still there when some of a group were deleted meanwhile", () => {
    const start = splitFilm();
    const agent = agentRun(start, [
      ["move_layers", { layer_ids: ["plain", "word"], dt: 1 }],
      ["delete_layers", { layer_ids: ["plain", "shadow"] }],
    ]);
    const mine = produce(start, (d) => {
      d.layers = d.layers.filter((l) => l.id !== "plain");
    });
    const r = replayCalls(mine, agent.calls);
    expect(r.failed).toEqual([]);
    expect(get(r.doc, "word").start).toBeCloseTo(get(start, "word").start + 1);
    expect(r.doc.layers.some((l) => l.id === "shadow")).toBe(false);
    // With none of them left, the call fails as before.
    const gone = produce(mine, (d) => {
      d.layers = d.layers.filter((l) => l.id !== "word");
    });
    expect(replayCalls(gone, [agent.calls[0]]).failed).toHaveLength(1);
  });

  it("lands in the editor as one undo step on top of the edits made meanwhile", () => {
    const start = splitFilm();
    const store = createEditorStore(start);
    const agent = agentRun(start, [
      ["set_text", { layer_id: "word", text: "Yo", time: null }],
      ["move_layers", { layer_ids: ["plain"], dt: 1 }],
    ]);
    store.getState().apply(setProp("plain", "props.size", 72, 0), "Size");
    // What the panel does with the result: replay onto the doc as it is, applied as one step.
    const r = commitCalls(store, agent.calls, "Agent edit");
    const after = store.getState();
    expect(after.past.map((p) => p.label)).toEqual(["Size", "Agent edit"]);
    expect(r).toMatchObject({ changed: true, step: after.past[1] });
    expect(get(after.doc, "plain")).toMatchObject({ start: 1, props: { size: 72 } });
    expect(get(after.doc, "shadow").props.text).toBe("Yo");
    after.undo();
    const undone = store.getState().doc;
    expect(get(undone, "plain")).toMatchObject({ start: 0, props: { size: 72 } });
    expect(get(undone, "shadow").props.text).toBe("Hi");
  });

  it("keeps its own step apart from a drag made after it, and follows it through undo", () => {
    const store = createEditorStore(splitFilm());
    const agent = agentRun(splitFilm(), [["set_property", { layer_id: "plain", path: "props.size", value: 90, time: null }]]);
    const { step } = commitCalls(store, agent.calls, "Agent edit");
    expect(step).toBeDefined();
    // A drag right after: its own step.
    store.getState().beginGesture();
    store.getState().apply(setProp("shadow", "transform.x", 50, 0), "Move layer");
    store.getState().apply(setProp("shadow", "transform.x", 60, 0), "Move layer");
    store.getState().endGesture();
    let s = store.getState();
    expect(s.past.map((p) => p.label)).toEqual(["Agent edit", "Move layer"]);
    expect(s.past[0]).toBe(step);
    expect(stepUndone(step!, s)).toBe(false);
    s.undo();
    s.undo();
    s = store.getState();
    expect(stepUndone(step!, s)).toBe(true);
    expect(get(s.doc, "plain").props.size).toBe(60);
    // A new edit discards the redo side: the reply stays undone.
    s.apply(setProp("plain", "props.color", "#00f", 0), "Colour");
    s = store.getState();
    expect(s.past.includes(step!) || s.future.includes(step!)).toBe(false);
    expect(stepUndone(step!, s, true)).toBe(true);
    expect(stepUndone(step!, s, false)).toBe(false);
  });

  it("has no step of its own when it lands inside a drag's gesture", () => {
    const store = createEditorStore(splitFilm());
    const agent = agentRun(splitFilm(), [["set_property", { layer_id: "plain", path: "props.size", value: 90, time: null }]]);
    // Pressed down to drag, nothing moved yet: the drag's steps would merge into the agent's.
    store.getState().beginGesture();
    const r = commitCalls(store, agent.calls, "Agent edit");
    store.getState().apply(setProp("shadow", "transform.x", 50, 0), "Move layer");
    store.getState().endGesture();
    expect(r.changed).toBe(true);
    expect(r.step).toBeUndefined();
    expect(store.getState().past).toHaveLength(1);
  });

  it("reports calls it couldn't replay and leaves the doc and history alone when nothing applies", () => {
    const store = createEditorStore(splitFilm());
    const calls: AgentCall[] = [{ name: "set_property", input: { layer_id: "gone", path: "props.size", value: 9, time: null }, t: 0 }];
    const r = commitCalls(store, calls, "Agent edit");
    expect(r).toMatchObject({ changed: false, step: undefined });
    expect(r.skipped.get(calls[0])).toBe("No layer with id gone.");
    expect(store.getState().past).toEqual([]);
  });

  it("drops a selected layer the agent deleted from the selection", () => {
    const store = createEditorStore(splitFilm());
    store.getState().select(["plain", "word"]);
    const agent = agentRun(splitFilm(), [["delete_layers", { layer_ids: ["plain"] }]]);
    commitCalls(store, agent.calls, "Agent edit");
    expect(store.getState().selection).toEqual(["word"]);
  });

  it("leaves embedded media out of what is sent", () => {
    const d = splitFilm();
    expect(docForAgent(d).assets[0].src).toBe("");
    expect(d.assets[0].src).toContain("data:");
    const plain = Doc.parse({ ...d, assets: [] });
    expect(docForAgent(plain)).toBe(plain);
  });
});

describe("the conversation sent to the model", () => {
  it("drops empty turns, keeps turns alternating and ends with the request", () => {
    expect(
      cleanHistory([
        { role: "assistant", text: "Hello" },
        { role: "user", text: "Make it red" },
        { role: "assistant", text: "" },
        { role: "user", text: "  Try again  " },
        { role: "assistant", text: "Done." },
        { role: "assistant", text: "Also moved it." },
        { role: "user", text: "Thanks, now bigger" },
      ]),
    ).toEqual([
      { role: "user", text: "Make it red" },
      { role: "assistant", text: "(No reply.)" },
      { role: "user", text: "Try again" },
      { role: "assistant", text: "Done.\n\nAlso moved it." },
      { role: "user", text: "Thanks, now bigger" },
    ]);
    expect(cleanHistory([{ role: "user", text: "a" }, { role: "assistant", text: "b" }])).toEqual([]);
    expect(cleanHistory("nope")).toEqual([]);
    const long = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }));
    const kept = cleanHistory([...long, { role: "user", text: "last" }].slice(1), 100, 4);
    expect(kept[0].role).toBe("user");
    expect(kept[kept.length - 1].text).toBe("last");
    expect(cleanHistory([{ role: "user", text: "x".repeat(50) }], 10)[0].text).toHaveLength(10);
  });
});

describe("waiting for a press to be let go", () => {
  const press = (type: string, props: Record<string, unknown> = {}) => Object.assign(new Event(type), props);
  // A window stand-in, and replies that wait on it.
  const setup = () => {
    const win = new EventTarget();
    const w = watchPresses(win, (f) => f());
    let landed = 0;
    const wait = (signal?: AbortSignal) => w.released(signal).then(() => landed++);
    const settle = () => new Promise((r) => setTimeout(r));
    return { win, w, wait, settle, landed: () => landed };
  };

  it("applies at once with nothing pressed, and after the release of a drag", async () => {
    const { win, w, wait, settle, landed } = setup();
    await wait();
    expect(landed()).toBe(1);
    win.dispatchEvent(press("pointerdown", { pointerId: 1 }));
    win.dispatchEvent(press("pointermove", { pointerId: 1, buttons: 1 }));
    expect(w.held()).toBe(true);
    void wait();
    await settle();
    expect(landed()).toBe(1);
    win.dispatchEvent(press("pointerup", { pointerId: 1 }));
    await settle();
    expect(landed()).toBe(2);
    expect(w.held()).toBe(false);
  });

  it("waits for every pointer pressed (two fingers) to be let go", async () => {
    const { win, wait, settle, landed } = setup();
    win.dispatchEvent(press("pointerdown", { pointerId: 2 }));
    win.dispatchEvent(press("pointerdown", { pointerId: 3 }));
    void wait();
    win.dispatchEvent(press("pointercancel", { pointerId: 2 }));
    await settle();
    expect(landed()).toBe(0);
    win.dispatchEvent(press("pointerup", { pointerId: 3 }));
    await settle();
    expect(landed()).toBe(1);
  });

  it("counts a press whose release it never saw as let go once the pointer moves unpressed, or the window loses focus", async () => {
    const { win, w, wait, settle, landed } = setup();
    win.dispatchEvent(press("pointerdown", { pointerId: 1 })); // a scrollbar drag: no pointerup follows
    void wait();
    win.dispatchEvent(press("pointermove", { pointerId: 1, buttons: 0 }));
    await settle();
    expect(landed()).toBe(1);
    win.dispatchEvent(press("pointerdown", { pointerId: 1 })); // then switching apps mid-press
    void wait();
    win.dispatchEvent(press("blur"));
    await settle();
    expect(landed()).toBe(2);
    expect(w.held()).toBe(false);
  });

  it("stops waiting when the reply is stopped or the panel goes", async () => {
    const { win, w, wait, settle, landed } = setup();
    win.dispatchEvent(press("pointerdown", { pointerId: 1 }));
    const ac = new AbortController();
    void wait(ac.signal);
    ac.abort();
    await settle();
    expect(landed()).toBe(1);
    void wait();
    w.stop();
    await settle();
    expect(landed()).toBe(2);
    // Stopped: it no longer listens (the release goes unseen).
    win.dispatchEvent(press("pointerup", { pointerId: 1 }));
    expect(w.held()).toBe(true);
  });
});
