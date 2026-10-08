import { isXMediaUrl, readXVideo } from "@/lib/xvideo";

export const maxDuration = 60;
const MAX_BYTES = 150 * 1024 * 1024;

// GET /api/reference?x=<post url>        -> post details + video URL
// GET /api/reference?media=<twimg url>   -> streams that video or poster (X media hosts only)
//   &dl=1 to download as a file
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;

  const media = q.get("media");
  if (media) {
    if (!isXMediaUrl(media)) return Response.json({ error: "Not an X media URL." }, { status: 400 });
    const r = await fetch(media, { signal: AbortSignal.timeout(30000) });
    if (!r.ok || !r.body) return Response.json({ error: `X returned ${r.status}.` }, { status: 502 });
    const size = Number(r.headers.get("content-length") ?? 0);
    if (size > MAX_BYTES) return Response.json({ error: "That video is too large to use as a reference." }, { status: 413 });
    const headers = new Headers({
      "Content-Type": r.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    });
    if (size) headers.set("Content-Length", String(size));
    if (q.get("dl")) headers.set("Content-Disposition", `attachment; filename="${q.get("name") ?? "reference"}.mp4"`);
    return new Response(r.body, { headers });
  }

  const x = q.get("x");
  if (!x) return Response.json({ error: "Missing link." }, { status: 400 });
  try {
    return Response.json(await readXVideo(x));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
