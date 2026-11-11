"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type AudioClip, decodeAudio, Mixer } from "@/lib/audio";

// Keeps decoded buffers for a film's audio clips and a mixer locked to the film clock.
// Unsaved clips live in `blobs` (by clip id); saved ones load from their Blob path.
export function useFilmAudio(clips: AudioClip[], blobs: Record<string, Blob>) {
  const [buffers, setBuffers] = useState<Map<string, AudioBuffer>>(new Map());
  const cache = useRef(new Map<string, AudioBuffer>());
  const [mixer] = useState<Mixer | null>(() => (typeof window === "undefined" ? null : new Mixer([])));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, AudioBuffer>();
      for (const c of clips) {
        const key = c.pathname ?? `blob:${c.id}`;
        let b = cache.current.get(key);
        if (!b) {
          try {
            const blob = blobs[c.id] ?? (c.pathname ? await (await fetch(`/api/media?p=${encodeURIComponent(c.pathname)}`)).blob() : null);
            if (!blob) continue;
            b = await decodeAudio(blob);
            cache.current.set(key, b);
          } catch {
            continue;
          }
        }
        next.set(c.id, b);
      }
      if (!cancelled) setBuffers(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [clips, blobs]);

  const loaded = useMemo(() => clips.filter((c) => buffers.has(c.id)).map((clip) => ({ clip, buffer: buffers.get(clip.id)! })), [clips, buffers]);

  useEffect(() => {
    mixer?.update(loaded);
  }, [loaded, mixer]);

  useEffect(() => () => mixer?.stop(), [mixer]);

  return { loaded, mixer };
}
