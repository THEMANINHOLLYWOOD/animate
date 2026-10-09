"use client";

import { useEffect, useRef, useState } from "react";
import type { Aspect } from "@/lib/engine";
import type { Fonts } from "@/lib/kit";
import type { Doc } from "@/editor/doc/schema";
import { drawStill, previewUrl } from "@/lib/preview";

type Film = { id: string; code: string; doc?: Doc; aspect: Aspect; duration: number; builtin?: boolean; building?: string };

// A film's looping preview: a still right away, then the clip (shipped for examples,
// rendered once in the background for everything else). Plays only while on screen.
export default function Thumb({ film, fonts }: { film: Film; fonts: Fonts | null }) {
  const still = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(film.builtin ? `/previews/${film.id}.mp4` : null);
  const [loaded, setLoaded] = useState<string | null>(null); // the clip that has frames to show
  const empty = !film.code && !film.doc;

  useEffect(() => {
    if (!fonts || !still.current || empty) return;
    drawStill(still.current, film, fonts);
  }, [film.code, film.doc, film.aspect, film.duration, fonts, empty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (film.builtin || !fonts || empty || film.building) return;
    let live = true;
    previewUrl(film, fonts).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [film.code, film.doc, film.aspect, film.duration, film.building, film.builtin, fonts, empty]); // eslint-disable-line react-hooks/exhaustive-deps

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
          onError={() => setSrc(null)}
        />
      )}
    </div>
  );
}
