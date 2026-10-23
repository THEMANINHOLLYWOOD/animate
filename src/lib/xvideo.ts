// Reads a public X (Twitter) post via the same syndication endpoint X's own
// embeds use, and returns its video so it can be studied as a reference.

export type XVideoRef = {
  id: string;
  url: string;
  author: string;
  handle: string;
  text: string;
  durationMs: number;
  aspect: [number, number] | null;
  poster: string | null;
  video: string; // direct mp4 on video.twimg.com
};

const STATUS_RE = /(?:^|\/\/)(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/\s]+\/status(?:es)?\/(\d{1,25})/i;

export const xStatusId = (url: string) => url.match(STATUS_RE)?.[1] ?? null;
export const isXStatus = (url: string) => !!xStatusId(url);

// Token formula used by X's embed widgets.
const token = (id: string) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

type Variant = { content_type?: string; bitrate?: number; url: string };

export async function readXVideo(url: string): Promise<XVideoRef> {
  const id = xStatusId(url);
  if (!id) throw new Error("That isn't a link to an X post.");
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token(id)}&lang=en`, {
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; animate-reference/1.0)" },
  });
  if (res.status === 404) throw new Error("That post is private, deleted, or unavailable.");
  if (!res.ok) throw new Error(`X returned ${res.status}.`);
  const j = await res.json();
  const media = ((j.mediaDetails ?? []) as { type?: string; video_info?: { duration_millis?: number; aspect_ratio?: [number, number]; variants?: Variant[] }; media_url_https?: string }[]).find(
    (m) => m.type === "video" || m.type === "animated_gif",
  );
  if (!media?.video_info?.variants?.length) throw new Error("That post doesn't have a video.");
  const mp4s = media.video_info.variants.filter((v) => v.content_type === "video/mp4").sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
  // Around 720p is plenty for studying style, and keeps downloads quick.
  const pick = [...mp4s].reverse().find((v) => (v.bitrate ?? 0) <= 2_500_000) ?? mp4s[0];
  if (!pick) throw new Error("That post's video isn't available as MP4.");
  return {
    id,
    url: `https://x.com/${j.user?.screen_name ?? "i"}/status/${id}`,
    author: j.user?.name ?? "",
    handle: j.user?.screen_name ?? "",
    text: String(j.text ?? "").replace(/\s*https:\/\/t\.co\/\w+$/, ""),
    durationMs: media.video_info.duration_millis ?? 0,
    aspect: media.video_info.aspect_ratio ?? null,
    poster: media.media_url_https ?? null,
    video: pick.url,
  };
}

// Only X's own media hosts may be proxied.
export function isXMediaUrl(u: string) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && (url.hostname === "video.twimg.com" || url.hostname === "pbs.twimg.com");
  } catch {
    return false;
  }
}
