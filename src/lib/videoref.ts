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
    v.onloadedmetadata = () => res(v);
    v.onerror = () => rej(new Error("That video couldn't be decoded. Try an MP4 (H.264)."));
  });
}

const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((res) => {
    v.onseeked = () => res();
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05));
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
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * v.duration;
    await seek(v, t);
    g.drawImage(v, 0, 0, c.width, c.height);
    out.push({ t, data: c.toDataURL("image/jpeg", 0.82).split(",")[1] });
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
