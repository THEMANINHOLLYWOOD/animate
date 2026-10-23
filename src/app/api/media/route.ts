import { get } from "@vercel/blob";
import { safeFilename, servableMedia, UNTRUSTED_HEADERS } from "@/lib/media";
import { ownsPath, requireUser, unauthorized } from "@/lib/store";

// Streams a private blob to its owner. ?dl=1 forces a download.
// Served sandboxed with a fixed type: an uploaded SVG still draws in <img>, but opened as a page it runs nothing.
export async function GET(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const url = new URL(req.url);
  const pathname = url.searchParams.get("p") ?? "";
  if (!ownsPath(userId, pathname)) return Response.json({ error: "Not found." }, { status: 404 });
  const r = await get(pathname, { access: "private" });
  if (!r || r.statusCode !== 200) return Response.json({ error: "Not found." }, { status: 404 });
  const type = servableMedia(r.blob.contentType);
  const headers = new Headers({
    "Content-Type": type ?? "application/octet-stream",
    "Content-Length": String(r.blob.size),
    "Cache-Control": "private, max-age=3600",
    ...UNTRUSTED_HEADERS,
  });
  if (url.searchParams.get("dl") || !type) {
    headers.set("Content-Disposition", `attachment; filename="${safeFilename(pathname.split("/").pop() ?? "")}"`);
  }
  return new Response(r.stream, { headers });
}
