"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { MAX_AGENT_BODY, commitCalls, docForAgent, stepUndone, watchPresses, type AgentCall } from "../ai/tools";
import type { EditorState, createEditorStore } from "../store/store";

type Store = ReturnType<typeof createEditorStore>;
type Step = EditorState["past"][number];
// Something the agent did: a tool it ran (an edit carries the call that made it, to replay) or a note.
type Action = { label: string; error: boolean; call?: AgentCall; skipped?: string };
// What became of a reply: its edits are made on a copy while it works, then applied to the doc as it
// is by then (all of them, or those done before an error), or not at all.
type Outcome = "working" | "applied" | "partial" | "none" | "stopped" | "failed";
// step: the undo step its edits made; undone: whether that step was last seen undone (it stays so
// once a new edit discards the redo). waiting: finished, its edits held until a press is let go.
type Msg = { role: "user" | "assistant"; text: string; actions?: Action[]; thinking?: string; outcome?: Outcome; step?: Step; undone?: boolean; error?: string; waiting?: boolean };
// How a request ended: with edits to apply (all of them, or those made before an error), or without.
type End = { apply: "applied" | "partial"; error?: string; seek?: number } | { outcome: "failed" | "stopped"; error?: string };

const AGENT_STEP = "Agent edit";
const TOO_LARGE = "This film is too large to send to the editing agent. Make this change in the editor instead.";

const SUGGESTIONS = [
  "Make the headline 20% bigger",
  "Slow down the intro by a second",
  "Change the accent colour to olive #788C5D",
  "Fade the last line out at the end",
  "Move everything after 5 seconds one second later",
];

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
const applied = (o?: Outcome) => o === "applied" || o === "partial";

// ✓ only for an edit that was applied; – for one that wasn't (stopped, failed, or skipped because its
// layer changed meanwhile); · for reads and notes, and for edits while the reply is still working.
const marker = (a: Action, o?: Outcome) => (a.error ? "!" : !a.call || o === "working" ? "·" : a.skipped || !applied(o) ? "–" : "✓");

// A reply as the agent reads it back next time: never empty, and saying what became of its edits.
function replyText(m: Msg) {
  const edits = (m.actions ?? []).filter((a) => a.call);
  const skipped = edits.filter((a) => a.skipped);
  const notes = [
    m.text.trim() || edits.map((a) => a.label).join("; "),
    m.outcome === "stopped" && "(The user stopped this reply; none of its edits were applied.)",
    m.outcome === "failed" && `(This reply failed${m.error ? `: ${m.error}` : ""}. None of its edits were applied.)`,
    m.outcome === "partial" && `(Cut short${m.error ? ` by an error: ${m.error}` : ""}. The edits made before that were applied.)`,
    skipped.length > 0 && `(Not applied, because the user changed or deleted those layers meanwhile: ${skipped.map((a) => a.label).join("; ")}.)`,
    m.step && m.undone && "(The user has undone this reply's edits.)",
  ];
  return notes.filter(Boolean).join("\n") || "(No reply.)";
}

// A request cut short (the connection dropped): the edits made by then are applied, as when the agent
// hits an error; with none, it failed.
const cutShort = (calls: AgentCall[], error: string): End => (calls.length ? { apply: "partial", error } : { outcome: "failed", error });

// A failed request's message: the server's own when it sent one.
async function failure(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    const message = j?.error ?? j?.message;
    if (typeof message === "string" && message) return message;
  } catch {}
  if (res.status === 401) return "Sign in to use the editing agent.";
  if (res.status === 413) return TOO_LARGE;
  return `The editing agent couldn't be reached (${res.status}). Try again.`;
}

export default function AgentPanel({ store }: { store: Store }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [openThinking, setOpenThinking] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  // Leaving the editor stops a request in flight; its edits aren't applied.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Each reply's step, followed through undo and redo: undone while it's on the redo side, and still
  // undone once a new edit discards it from there.
  useEffect(
    () =>
      store.subscribe((s, p) => {
        if (s.past === p.past && s.future === p.future) return;
        setMsgs((list) => {
          let changed = false;
          const next = list.map((m) => {
            if (!m.step) return m;
            const undone = stepUndone(m.step, s, !!m.undone);
            if (undone === !!m.undone) return m;
            changed = true;
            return { ...m, undone };
          });
          return changed ? next : list;
        });
      }),
    [store],
  );

  // Presses held anywhere on the page: a reply's edits that arrive during a drag wait for its release.
  const presses = useRef<ReturnType<typeof watchPresses> | null>(null);
  useEffect(() => {
    const w = watchPresses(window);
    presses.current = w;
    return () => w.stop();
  }, []);

  const updateLast = (f: (m: Msg) => Msg) => setMsgs((list) => [...list.slice(0, -1), f(list[list.length - 1])]);

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const st = store.getState();
    const body = JSON.stringify({
      doc: docForAgent(st.doc),
      time: st.time,
      selection: st.selection,
      replay: true,
      messages: [...msgs.map((m) => ({ role: m.role, text: m.role === "user" ? m.text : replyText(m) })), { role: "user", text: prompt }],
    });
    const size = new Blob([body]).size;
    setInput("");
    const asked: Msg = { role: "user", text: prompt };
    if (size > MAX_AGENT_BODY) {
      setMsgs([...msgs, asked, { role: "assistant", text: "", outcome: "failed", error: `${TOO_LARGE} (It is ${mb(size)}; the limit is ${mb(MAX_AGENT_BODY)}.)` }]);
      return;
    }
    setMsgs([...msgs, asked, { role: "assistant", text: "", actions: [], thinking: "", outcome: "working" }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const calls: AgentCall[] = [];
    // The reply's edits applied: all of them when it finished, else those done before it was cut short.
    // Replayed onto the doc as it is by then, so edits made meanwhile stay; one undo step.
    const finish = ({ apply: outcome, error, seek }: Extract<End, { apply: unknown }>) => {
      const r = calls.length ? commitCalls(store, calls, AGENT_STEP) : null;
      if (seek !== undefined) store.getState().setTime(seek);
      updateLast((m) => ({
        ...m,
        waiting: false,
        outcome: r?.changed ? outcome : outcome === "applied" ? "none" : "failed",
        step: r?.step,
        error,
        actions: m.actions?.map((a) => (a.call && r?.skipped.has(a.call) ? { ...a, skipped: r.skipped.get(a.call) } : a)),
      }));
    };
    let end: End;
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(await failure(res));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let got: End | undefined;
      while (!got) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (got || !line.trim()) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "text") updateLast((m) => ({ ...m, text: m.text + ev.text }));
          else if (ev.type === "progress") updateLast((m) => ({ ...m, actions: [...(m.actions ?? []), { label: ev.text.trim().slice(0, 140), error: false }] }));
          else if (ev.type === "thinking") updateLast((m) => ({ ...m, thinking: (m.thinking ?? "") + ev.text }));
          else if (ev.type === "action") {
            const call: AgentCall | undefined = ev.call;
            if (call) calls.push(call);
            updateLast((m) => ({ ...m, actions: [...(m.actions ?? []), { label: ev.label, error: !!ev.error, call }] }));
          } else if (ev.type === "done") got = { apply: "applied", seek: ev.seek };
          else if (ev.type === "error") got = ev.changes > 0 ? { apply: "partial", error: ev.message } : { outcome: "failed", error: ev.message };
        }
      }
      if (got) reader.cancel().catch(() => {});
      end = got ?? cutShort(calls, "The connection closed before the agent finished. Try again.");
    } catch (e) {
      end = ac.signal.aborted ? { outcome: "stopped" } : cutShort(calls, (e as Error).message || "The editing agent couldn't be reached. Try again.");
    }
    if ("apply" in end) {
      if (presses.current?.held()) updateLast((m) => ({ ...m, waiting: true }));
      await presses.current?.released(ac.signal);
      // Stopped before its edits landed: none of them are applied.
      if (ac.signal.aborted) end = { outcome: "stopped" };
    }
    if ("apply" in end) finish(end);
    else {
      const { outcome, error } = end;
      updateLast((m) => ({ ...m, waiting: false, outcome, error }));
    }
    setBusy(false);
    if (abortRef.current === ac) abortRef.current = null;
  }

  return (
    <div className="agent">
      <div className="agent-list" ref={listRef}>
        {!msgs.length && (
          <div className="agent-empty">
            <b>Edit by talking</b>
            <p>Say what to change. animate edits the timeline directly, and everything it does is one undo away.</p>
            <div className="agent-sugs">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="agent-msg user">
              {m.text}
            </div>
          ) : (
            <div key={i} className="agent-msg bot">
              {!!m.thinking && (
                <button className="agent-think" onClick={() => setOpenThinking(openThinking === i ? null : i)}>
                  {m.outcome === "working" && !m.actions?.length && !m.text ? <span className="dot" /> : "✦"} Thinking
                  <span>{openThinking === i ? "hide" : "show"}</span>
                </button>
              )}
              {openThinking === i && m.thinking && <div className="agent-think-body">{m.thinking}</div>}
              {!!m.actions?.length && (
                <ul className="agent-actions">
                  {m.actions.map((a, j) => (
                    <li key={j} className={a.error || a.skipped ? "err" : ""}>
                      {marker(a, m.outcome)} {a.label}
                      {a.skipped ? ` (not applied: ${a.skipped})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {m.text && <div className="agent-text">{m.text}</div>}
              {m.outcome === "working" && !m.text && !m.waiting && (
                <div className="agent-working">
                  <span className="dot" /> Working…
                </div>
              )}
              {m.waiting && (
                <div className="agent-working">
                  <span className="dot" /> Its edits apply once you let go
                </div>
              )}
              {applied(m.outcome) && <Applied store={store} step={m.step} undone={!!m.undone} partial={m.outcome === "partial"} />}
              {m.outcome === "stopped" && <div className="agent-applied">Stopped · nothing was applied</div>}
              {m.outcome === "none" && m.actions?.some((a) => a.skipped) && (
                <div className="agent-applied">Nothing was applied: the layers it edited were changed or deleted meanwhile.</div>
              )}
              {m.error && <div className="agent-error">{m.error}</div>}
              {m.outcome === "failed" && m.actions?.some((a) => a.call) && <div className="agent-applied">Nothing was applied.</div>}
            </div>
          ),
        )}
      </div>
      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask for any edit…"
          rows={2}
        />
        {busy ? (
          <button type="button" className="agent-send" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="agent-send" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}

// Where a reply's step stands in the undo history. Its undo link undoes exactly that step, so it works
// only while that step is the latest; once undone, redo brings it back while nothing came after.
function Applied({ store, step, undone, partial }: { store: Store; step?: Step; undone: boolean; partial: boolean }) {
  const at = useStore(store, (s) =>
    !step ? "shared"
    : s.past[s.past.length - 1] === step ? "last"
    : s.future[0] === step ? "undone"
    : s.past.includes(step) ? "earlier"
    : s.future.includes(step) ? "undone-earlier"
    : "gone",
  );
  const what = partial ? "Applied what was finished as one step" : "Applied as one step";
  if (at === "shared") return <div className="agent-applied">{partial ? "Applied what was finished" : "Applied"}, in one step with the drag you were making</div>;
  // Undone behind another undone step (redo that first), or undone and then dropped by a new edit.
  if (at === "undone-earlier" || (at === "gone" && undone)) return <div className="agent-applied">Undone</div>;
  if (at === "gone") return <div className="agent-applied">{partial ? "Applied what was finished" : "Applied"} · no longer in the undo history</div>;
  if (at === "undone")
    return (
      <div className="agent-applied">
        Undone ·{" "}
        <button
          className="linkish"
          onClick={() => {
            const s = store.getState();
            if (s.future[0] === step) s.redo();
          }}
        >
          redo
        </button>
      </div>
    );
  return (
    <div className="agent-applied">
      {what} ·{" "}
      {at === "last" ? (
        <button
          className="linkish"
          onClick={() => {
            const s = store.getState();
            if (s.past[s.past.length - 1] === step) s.undo();
          }}
        >
          undo
        </button>
      ) : (
        <button className="linkish" disabled title="Edits made since come after it in the undo history: undo those first." style={{ opacity: 0.45, cursor: "default" }}>
          undo
        </button>
      )}
    </div>
  );
}
