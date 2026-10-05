"use client";

import { useEffect, useState } from "react";

// One visible stage of a generation run, with Claude's reasoning summary.
export type Step = {
  id: string;
  label: string;
  status: "active" | "done" | "error";
  startedAt: number;
  endedAt?: number;
  thinking: string;
  notes: string[];
};

const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function Progress({
  steps,
  running,
  output,
  onCancel,
  onDismiss,
}: {
  steps: Step[];
  running: boolean;
  output: string;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const i = setInterval(tick, 500);
    return () => clearInterval(i);
  }, [running]);

  if (!steps.length) return null;
  const first = steps[0].startedAt;
  const last = steps[steps.length - 1];
  const end = running ? now || last.startedAt : (last.endedAt ?? last.startedAt);
  const failed = steps.some((s) => s.status === "error");
  const active = steps.find((s) => s.status === "active");
  const tail = output.split("\n").slice(-12).join("\n");

  return (
    <div className={`progress${collapsed ? " collapsed" : ""}`}>
      <div className="progress-head">
        {running ? <span className="dot" /> : <span className={`progress-mark ${failed ? "err" : "ok"}`}>{failed ? "!" : "✓"}</span>}
        <b>{running ? (active?.label ?? "Working") : failed ? "Stopped" : "Done"}</b>
        <span className="progress-time">{dur(end - first)}</span>
        <button className="linkish" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "show steps" : "hide"}
        </button>
        {running ? (
          <button className="linkish" onClick={onCancel}>
            cancel
          </button>
        ) : (
          <button className="linkish" onClick={onDismiss} aria-label="Dismiss">
            ×
          </button>
        )}
      </div>

      {!collapsed && (
        <ol className="progress-steps">
          {steps.map((s) => {
            const isOpen = open === s.id || (open === null && s.status === "active");
            const took = (s.endedAt ?? (running ? now : s.startedAt)) - s.startedAt;
            return (
              <li key={s.id} className={`progress-step ${s.status}`}>
                <button className="progress-step-head" onClick={() => setOpen(isOpen ? "" : s.id)}>
                  <span className="progress-icon">{s.status === "active" ? <span className="dot" /> : s.status === "error" ? "!" : "✓"}</span>
                  <span className="progress-label">{s.label}</span>
                  <span className="progress-step-time">{dur(took)}</span>
                </button>
                {isOpen && (s.thinking || s.notes.length > 0 || (s.status === "active" && tail)) && (
                  <div className="progress-detail">
                    {s.notes.length > 0 && (
                      <ul className="progress-notes">
                        {s.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    )}
                    {s.thinking && <p className="progress-thinking">{s.thinking.slice(-1600)}</p>}
                    {s.status === "active" && tail && <pre className="progress-output">{tail}</pre>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
