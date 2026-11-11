import { get } from "@vercel/blob";
import { safeFilename, servableMedia, UNTRUSTED_HEADERS } from "@/lib/media";
import { ownsPath, requireUser, unauthorized } from "@/lib/store";

// One byte range, as a player asks for it ("bytes=0-", "bytes=1000-1999", "bytes=-500"); anything
// else is answered with the whole file.
const RANGE = /^bytes=(\d*)-(\d*)$/;

// Streams a private blob to its owner. ?dl=1 forces a download.
// Served sandboxed with a fixed type: an uploaded SVG still draws in <img>, but opened as a page it runs nothing.
// A Range request is passed on to storage and answered with that part (206): Safari won't play a
// video it can't ask for in ranges, and seeking needs them everywhere.
export async function GET(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const url = new URL(req.url);
  const pathname = url.searchParams.get("p") ?? "";
  if (!ownsPath(userId, pathname)) return Response.json({ error: "Not found." }, { status: 404 });
  const asked = req.headers.get("range")?.trim() ?? "";
  const m = RANGE.exec(asked);
  const range = m && (m[1] || m[2]) ? asked : null;
  let r;
  try {
    r = await get(pathname, { access: "private", ...(range ? { headers: { Range: range } } : {}) });
  } catch {
    // Storage refuses a range past the end of the file (416) along with anything else it can't serve.
    return range ? new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes" } }) : Response.json({ error: "Not found." }, { status: 404 });
  }
  if (!r || r.statusCode !== 200) return Response.json({ error: "Not found." }, { status: 404 });
  const type = servableMedia(r.blob.contentType);
  // What storage sent is a part of the file only when it says which part.
  const part = range ? r.headers.get("content-range") : null;
  const headers = new Headers({
    "Content-Type": type ?? "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
    ...UNTRUSTED_HEADERS,
  });
  if (r.blob.size) headers.set("Content-Length", String(r.blob.size));
  if (part) headers.set("Content-Range", part);
  if (url.searchParams.get("dl") || !type) {
    headers.set("Content-Disposition", `attachment; filename="${safeFilename(pathname.split("/").pop() ?? "")}"`);
  }
  return new Response(r.stream, { status: part ? 206 : 200, headers });
}
