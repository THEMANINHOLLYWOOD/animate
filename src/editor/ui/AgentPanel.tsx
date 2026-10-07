"use client";

import { useEffect, useRef, useState } from "react";
import type { Doc } from "../doc/schema";
import type { createEditorStore } from "../store/store";

type Store = ReturnType<typeof createEditorStore>;
type Msg = { role: "user" | "assistant"; text: string; actions?: { label: string; error: boolean }[]; thinking?: string; changes?: number; error?: string };

const SUGGESTIONS = [
  "Make the headline 20% bigger",
  "Slow down the intro by a second",
  "Change the accent colour to olive #788C5D",
  "Add a fade-out to the URL on the end card",
  "Move the Facts section 2 seconds later",
];

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

  const updateLast = (f: (m: Msg) => Msg) => setMsgs((list) => [...list.slice(0, -1), f(list[list.length - 1])]);

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setInput("");
    const history = [...msgs, { role: "user" as const, text: prompt }];
    setMsgs([...history, { role: "assistant", text: "", actions: [], thinking: "" }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const st = store.getState();
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc: st.doc,
          time: st.time,
          selection: st.selection,
          messages: history.map((m) => ({ role: m.role, text: m.text || (m.actions?.map((a) => a.label).join("; ") ?? "") })),
        }),
        signal: ac.signal,
      });
      if (res.status === 401) throw new Error("Sign in to use the editing agent.");
      if (!res.body) throw new Error(`Request failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const finish = (doc: Doc | undefined, seek?: number, changes = 0) => {
        if (doc && changes) {
          // One undo step for everything the agent did.
          store.getState().apply((d) => {
            Object.assign(d, doc);
          }, "Agent edit");
        }
        if (seek !== undefined) store.getState().setTime(seek);
        updateLast((m) => ({ ...m, changes }));
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "text") updateLast((m) => ({ ...m, text: m.text + ev.text }));
          else if (ev.type === "progress") updateLast((m) => ({ ...m, actions: [...(m.actions ?? []), { label: ev.text.trim().slice(0, 140), error: false }] }));
          else if (ev.type === "thinking") updateLast((m) => ({ ...m, thinking: (m.thinking ?? "") + ev.text }));
          else if (ev.type === "action") updateLast((m) => ({ ...m, actions: [...(m.actions ?? []), { label: ev.label, error: ev.error }] }));
          else if (ev.type === "done") finish(ev.doc, ev.seek, ev.changes);
          else if (ev.type === "error") {
            if (ev.doc) finish(ev.doc, undefined, 1);
            updateLast((m) => ({ ...m, error: ev.message }));
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") updateLast((m) => ({ ...m, error: (e as Error).message }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="agent">
      <div className="agent-list" ref={listRef}>
        {!msgs.length && (
          <div className="agent-empty">
            <b>Edit by talking</b>
            <p>Tell Claude what to change. It edits the timeline directly, and everything it does is one undo away.</p>
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
                  {busy && i === msgs.length - 1 && !m.actions?.length && !m.text ? <span className="dot" /> : "✦"} Thinking
                  <span>{openThinking === i ? "hide" : "show"}</span>
                </button>
              )}
              {openThinking === i && m.thinking && <div className="agent-think-body">{m.thinking}</div>}
              {!!m.actions?.length && (
                <ul className="agent-actions">
                  {m.actions.map((a, j) => (
                    <li key={j} className={a.error ? "err" : ""}>
                      {a.error ? "!" : "✓"} {a.label}
                    </li>
                  ))}
                </ul>
              )}
              {m.text && <div className="agent-text">{m.text}</div>}
              {busy && i === msgs.length - 1 && !m.text && (
                <div className="agent-working">
                  <span className="dot" /> Working…
                </div>
              )}
              {!!m.changes && (
                <div className="agent-applied">
                  Applied as one step ·{" "}
                  <button className="linkish" onClick={() => store.getState().undo()}>
                    undo
                  </button>
                </div>
              )}
              {m.error && <div className="agent-error">{m.error}</div>}
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
