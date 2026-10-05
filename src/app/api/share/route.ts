import { createShare, deleteShare, newShareId, readShare, streamShareVideo } from "@/lib/share";
import { ownsPath, requireUser, unauthorized } from "@/lib/store";

// POST   { pathname, title, w, h, duration } -> { id }   (owner only)
// DELETE ?id=…                                           (owner only)
// GET    ?id=…&dl=1                                      (public: download the shared MP4)

export async function POST(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const b = await req.json();
  if (typeof b?.pathname !== "string" || !ownsPath(userId, b.pathname) || !/\/videos\//.test(b.pathname)) {
    return Response.json({ error: "Only your saved videos can be shared." }, { status: 400 });
  }
  try {
    const share = await createShare({
      id: newShareId(),
      owner: userId,
      pathname: b.pathname,
      title: String(b.title ?? "Untitled").slice(0, 120),
      w: Number(b.w) || 1920,
      h: Number(b.h) || 1080,
      duration: Number(b.duration) || 0,
      createdAt: Date.now(),
    });
    return Response.json({ id: share.id });
  } catch {
    return Response.json({ error: "That video couldn't be found." }, { status: 404 });
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const share = await readShare(id);
  if (!share || share.owner !== userId) return Response.json({ error: "Not found." }, { status: 404 });
  await deleteShare(id);
  return Response.json({ ok: true });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const share = await readShare(q.get("id") ?? "");
  if (!share) return Response.json({ error: "This link is no longer available." }, { status: 404 });
  const r = await streamShareVideo(share);
  if (!r || r.statusCode !== 200) return Response.json({ error: "Video not found." }, { status: 404 });
  const name = share.title.replace(/[^\w\- ]+/g, "").trim() || "animation";
  return new Response(r.stream, {
    headers: {
      "Content-Type": r.blob.contentType,
      "Content-Length": String(r.blob.size),
      "Content-Disposition": `${q.get("dl") ? "attachment" : "inline"}; filename="${name}.mp4"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
