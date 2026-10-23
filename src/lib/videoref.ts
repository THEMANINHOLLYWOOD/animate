// Client-side helpers for reference videos (uploads and X posts): read metadata
// and sample frames that Claude can study as images.

export type VideoRef = {
  id: string;
  source: "x" | "file";
  name: string;
  blobUrl: string;
  duration: number;
  w: number;
  h: number;
  poster: string | null;
  // X posts only
  url?: string;
  author?: string;
  handle?: string;
  text?: string;
  download?: string;
};

export type Frame = { t: number; data: string }; // base64 JPEG, no data: prefix

function openVideo(src: string) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = src;
  return new Promise<HTMLVideoElement>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("That video took too long to open. Try an MP4 (H.264).")), 20_000);
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      res(v);
    };
    v.onerror = () => {
      clearTimeout(timer);
      rej(new Error("That video couldn't be decoded. Try an MP4 (H.264)."));
    };
  });
}

// Some files never fire "seeked" for some timestamps; don't wait forever on one frame.
// Resolves true once the picture at t is showing, false when the seek never got there
// (the element would still be showing an earlier frame, or none at all).
const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<boolean>((res) => {
    const target = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05));
    const at = () => !v.seeking && Math.abs(v.currentTime - target) < 0.25;
    const timer = setTimeout(() => {
      v.onseeked = null;
      res(at() && v.readyState >= 2);
    }, 4000);
    v.onseeked = () => {
      clearTimeout(timer);
      v.onseeked = null;
      res(at());
    };
    v.currentTime = target;
  });

export async function probeVideo(src: string) {
  const v = await openVideo(src);
  await seek(v, Math.min(0.5, v.duration / 3));
  const c = document.createElement("canvas");
  const s = Math.min(1, 320 / Math.max(v.videoWidth, v.videoHeight));
  c.width = Math.max(1, Math.round(v.videoWidth * s));
  c.height = Math.max(1, Math.round(v.videoHeight * s));
  c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
  return { duration: v.duration, w: v.videoWidth, h: v.videoHeight, poster: c.toDataURL("image/jpeg", 0.7) };
}

// Evenly spaced frames (centred in each slice), each labelled with its timestamp.
export async function sampleFrames(src: string, count: number, maxSide = 768, onFrame?: (i: number) => void): Promise<Frame[]> {
  const v = await openVideo(src);
  const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(v.videoWidth * s));
  c.height = Math.max(1, Math.round(v.videoHeight * s));
  const g = c.getContext("2d")!;
  const out: Frame[] = [];
  let missed = 0;
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * v.duration;
    // A seek that never landed would label an earlier picture with this timestamp: leave that frame out.
    if (await seek(v, t)) {
      g.drawImage(v, 0, 0, c.width, c.height);
      out.push({ t, data: c.toDataURL("image/jpeg", 0.82).split(",")[1] });
    } else if (++missed > count / 2) {
      throw new Error("This video won't seek reliably, so its frames can't be read. Re-export it as an MP4 (H.264) and try again.");
    }
    onFrame?.(i + 1);
  }
  return out;
}

// Nearest supported format for a source video.
export function aspectFor(w: number, h: number): "16:9" | "9:16" | "1:1" {
  const r = w / h;
  if (r > 1.25) return "16:9";
  if (r < 0.8) return "9:16";
  return "1:1";
}

// Server requests are capped at 4.5 MB in production. Re-encode frames smaller and
// softer until all of them fit in maxBytes of base64 (detail matters less than count).
export async function fitFrames(frames: Frame[], maxBytes: number): Promise<Frame[]> {
  const total = (fs: Frame[]) => fs.reduce((n, f) => n + f.data.length, 0);
  if (total(frames) <= maxBytes) return frames;
  const imgs = await Promise.all(
    frames.map(
      (f) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = `data:image/jpeg;base64,${f.data}`;
        }),
    ),
  );
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  let out = frames;
  for (const [side, q] of [[640, 0.75], [560, 0.7], [480, 0.65], [400, 0.6], [320, 0.55], [256, 0.5]] as const) {
    out = frames.map((f, i) => {
      const img = imgs[i];
      const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.max(1, Math.round(img.naturalWidth * s));
      c.height = Math.max(1, Math.round(img.naturalHeight * s));
      g.drawImage(img, 0, 0, c.width, c.height);
      return { t: f.t, data: c.toDataURL("image/jpeg", q).split(",")[1] };
    });
    if (total(out) <= maxBytes) break;
  }
  return out;
}
