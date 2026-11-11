"use client";

import { useEffect, useRef, useState } from "react";
import type { Aspect } from "@/lib/engine";
import type { Fonts } from "@/lib/kit";
import type { Doc } from "@/editor/doc/schema";
import { drawStill, previewUrl, shippedClip, type Preview } from "@/lib/preview";

type Film = { id: string; code: string; doc?: Doc; aspect: Aspect; duration: number; builtin?: boolean; building?: string };

// After an edit, wait this long for the next one before asking for a new clip (typing in the
// code box, or stepping through lengths, changes the film several times in a row).
const SETTLE_MS = 800;

// A film's looping preview: a still right away, then the clip (shipped for examples,
// rendered once in the background for everything else). Plays only while on screen.
export default function Thumb({ film, fonts }: { film: Film; fonts: Fonts | null }) {
  const still = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const held = useRef<Preview | null>(null); // the rendered clip on show
  const settled = useRef(false); // the first clip is asked for at once, later ones after SETTLE_MS
  const [clip, setClip] = useState<string | null>(null);
  const [broken, setBroken] = useState<string | null>(null); // a clip that failed to play
  const [loaded, setLoaded] = useState<string | null>(null); // the clip that has frames to show
  const empty = !film.code && !film.doc;
  const shipped = shippedClip(film);
  const rendered = !shipped || shipped === broken;
  const src = !rendered ? shipped : clip !== broken ? clip : null;

  useEffect(() => {
    if (!fonts || !still.current || empty) return;
    return drawStill(still.current, film, fonts);
  }, [film.code, film.doc, film.aspect, film.duration, fonts, empty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rendered || !fonts || empty || film.building) return;
    const ctl = new AbortController();
    const timer = setTimeout(
      () => {
        settled.current = true;
        previewUrl(film, fonts, ctl.signal).then((p) => {
          if (ctl.signal.aborted) return p?.release();
          // The film moved on: drop the old version's clip (and its cached copy, if it's another version).
          const prev = held.current;
          held.current = p;
          setClip(p?.url ?? null);
          prev?.release(prev.key !== p?.key);
        });
      },
      settled.current ? SETTLE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [film.code, film.doc, film.aspect, film.duration, film.building, rendered, fonts, empty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Let go of the rendered clip with the tile.
  useEffect(
    () => () => {
      held.current?.release();
      held.current = null;
    },
    [],
  );

  // Only play what's visible. A shipped clip can finish loading before hydration, so check its state too.
  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    const mark = () => setLoaded(src);
    if (v.readyState >= 2) queueMicrotask(mark);
    else v.addEventListener("loadeddata", mark, { once: true });
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()), { threshold: 0.1 });
    io.observe(v);
    return () => {
      io.disconnect();
      v.removeEventListener("loadeddata", mark);
    };
  }, [src]);

  return (
    <div className={`thumb a${film.aspect.replace(":", "x")}`}>
      <canvas ref={still} className="thumb-still" />
      {src && (
        <video
          key={src}
          ref={video}
          className={`thumb-clip${loaded === src ? " on" : ""}`}
          src={src}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          onError={() => {
            setBroken(src);
            // A rendered clip that won't play: let it go, cached copy included, so it renders afresh next time.
            if (held.current?.url === src) {
              held.current.release(true);
              held.current = null;
            }
          }}
        />
      )}
    </div>
  );
}
