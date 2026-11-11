import { limit } from "@/lib/limits";
import { safeFilename, UNTRUSTED_HEADERS } from "@/lib/media";
import { isXMediaUrl, readXVideo } from "@/lib/xvideo";

export const maxDuration = 60;
const MAX_BYTES = 150 * 1024 * 1024;

// The types each X media host may be relayed as; anything else is served as the host's default.
const TYPES: Record<string, string[]> = {
  "video.twimg.com": ["video/mp4"],
  "pbs.twimg.com": ["image/jpeg", "image/png", "image/webp"],
};

// GET /api/reference?x=<post url>        -> post details + video URL
// GET /api/reference?media=<twimg url>   -> streams that video or poster (X media hosts only)
//   &dl=1 to download as a file
export async function GET(req: Request) {
  const limited = await limit(req, "reference");
  if (limited) return limited;
  const q = new URL(req.url).searchParams;

  const media = q.get("media");
  if (media) {
    if (!isXMediaUrl(media)) return Response.json({ error: "Not an X media URL." }, { status: 400 });
    // Redirects are followed by hand so every hop stays on X's media hosts.
    let url = media;
    let r: Response | null = null;
    for (let hop = 0; hop < 3; hop++) {
      // 30 s to answer; the download itself may take longer (a signal passed to fetch also aborts the body).
      const answer = new AbortController();
      const timer = setTimeout(() => answer.abort(), 30000);
      try {
        r = await fetch(url, { redirect: "manual", signal: answer.signal });
      } catch {
        return Response.json({ error: "X didn't answer in time." }, { status: 504 });
      } finally {
        clearTimeout(timer);
      }
      const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
      if (!next) break;
      await r.body?.cancel();
      url = new URL(next, url).toString();
      if (!isXMediaUrl(url)) return Response.json({ error: "Not an X media URL." }, { status: 400 });
      r = null;
    }
    if (!r || !r.ok || !r.body) return Response.json({ error: `X returned ${r?.status ?? "too many redirects"}.` }, { status: 502 });
    const allowed = TYPES[new URL(url).hostname];
    const upstream = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const type = allowed.includes(upstream) ? upstream : allowed[0];
    const size = Number(r.headers.get("content-length") ?? 0);
    if (size > MAX_BYTES) {
      await r.body.cancel();
      return Response.json({ error: "That video is too large to use as a reference." }, { status: 413 });
    }
    // Content-Length can be missing or wrong, so the bytes are counted as they pass through.
    let sent = 0;
    const capped = r.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, c) {
          sent += chunk.byteLength;
          if (sent > MAX_BYTES) c.error(new Error("That video is too large to use as a reference."));
          else c.enqueue(chunk);
        },
      }),
    );
    const headers = new Headers({ "Content-Type": type, "Cache-Control": "private, max-age=3600", ...UNTRUSTED_HEADERS });
    if (size) headers.set("Content-Length", String(size));
    if (q.get("dl")) headers.set("Content-Disposition", `attachment; filename="${safeFilename(q.get("name") ?? "", "reference")}.mp4"`);
    return new Response(capped, { headers });
  }

  const x = q.get("x");
  if (!x) return Response.json({ error: "Missing link." }, { status: 400 });
  try {
    return Response.json(await readXVideo(x));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
