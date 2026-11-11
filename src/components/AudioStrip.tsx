"use client";

import { useRef } from "react";
import type { AudioClip } from "@/lib/audio";

const KIND_LABEL: Record<AudioClip["kind"], string> = { voice: "Voice", music: "Music", sfx: "SFX", background: "Background", original: "Original" };

export default function AudioStrip({
  clips,
  duration,
  busyLabel,
  onChange,
  onRemove,
  onUpload,
  onScore,
  onRegenerate,
  canScore,
}: {
  clips: AudioClip[];
  duration: number;
  busyLabel: string | null;
  onChange: (id: string, patch: Partial<AudioClip>) => void;
  onRemove: (id: string) => void;
  onUpload: (files: File[]) => void;
  onScore: () => void;
  onRegenerate: (id: string) => void;
  canScore: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="audio">
      <div className="section-label lib-head">
        <span>Sound</span>
        <span className="audio-actions">
          <button className="linkish" onClick={() => input.current?.click()}>
            ＋ Add audio
          </button>
          {canScore && (
            <button className="linkish accent" onClick={onScore} disabled={!!busyLabel}>
              ✦ Score this film
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept="audio/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) onUpload(Array.from(e.target.files));
              // The same file can be picked again.
              e.target.value = "";
            }}
          />
        </span>
      </div>
      {busyLabel && (
        <div className="audio-busy">
          <span className="dot" /> {busyLabel}
        </div>
      )}
      {!clips.length && !busyLabel && (
        <p className="hint">No sound yet. Score the film for a voiceover, music and sound effects, or add your own tracks.</p>
      )}
      {clips.map((c) => {
        const left = `${Math.max(0, Math.min(100, (c.start / duration) * 100))}%`;
        const width = `${Math.max(1, Math.min(100 - (c.start / duration) * 100, (c.duration / duration) * 100))}%`;
        return (
          <div className={`audio-clip k-${c.kind}${c.muted ? " muted" : ""}`} key={c.id}>
            <div className="audio-head">
              <span className="audio-kind">{KIND_LABEL[c.kind]}</span>
              <input className="audio-name" value={c.label} onChange={(e) => onChange(c.id, { label: e.target.value })} aria-label="Clip name" />
              <button className={`tl-flag${c.muted ? " on" : ""}`} title={c.muted ? "Unmute" : "Mute"} onClick={() => onChange(c.id, { muted: !c.muted })}>
                {c.muted ? "🔇" : "🔊"}
              </button>
              {c.source === "generated" && (
                <button className="linkish" onClick={() => onRegenerate(c.id)} disabled={!!busyLabel} title="Generate this again">
                  ↻
                </button>
              )}
              <button className="chip-x" aria-label="Remove" onClick={() => onRemove(c.id)}>
                ×
              </button>
            </div>
            <div className="audio-lane" title={`${c.start.toFixed(2)}s → ${(c.start + c.duration).toFixed(2)}s`}>
              <div className="audio-bar" style={{ left, width }} />
            </div>
            <div className="audio-controls">
              <label>
                Start
                <input type="number" step={0.1} min={0} max={duration} value={+c.start.toFixed(2)} onChange={(e) => onChange(c.id, { start: Math.max(0, +e.target.value) })} />
              </label>
              <label className="audio-gain">
                Volume
                <input type="range" min={0} max={2} step={0.05} value={c.gain} style={{ ["--fill" as string]: `${(c.gain / 2) * 100}%` }} onChange={(e) => onChange(c.id, { gain: +e.target.value })} />
              </label>
              {(c.text || c.prompt) && <span className="audio-text" title={c.text || c.prompt}>{c.text || c.prompt}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
