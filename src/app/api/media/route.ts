import { get } from "@vercel/blob";
import { ownsPath, requireUser, unauthorized } from "@/lib/store";

// Streams a private blob to its owner. ?dl=1 forces a download.
export async function GET(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const url = new URL(req.url);
  const pathname = url.searchParams.get("p") ?? "";
  if (!ownsPath(userId, pathname)) return Response.json({ error: "Not found." }, { status: 404 });
  const r = await get(pathname, { access: "private" });
  if (!r || r.statusCode !== 200) return Response.json({ error: "Not found." }, { status: 404 });
  const headers = new Headers({
    "Content-Type": r.blob.contentType,
    "Content-Length": String(r.blob.size),
    "Cache-Control": "private, max-age=3600",
  });
  if (url.searchParams.get("dl")) {
    headers.set("Content-Disposition", `attachment; filename="${pathname.split("/").pop()}"`);
  }
  return new Response(r.stream, { headers });
}
