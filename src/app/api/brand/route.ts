import { readBrand, safeFetch } from "@/lib/brand";

// GET /api/brand?url=…        -> brand kit (name, description, colours, fonts, logo, preview image)
// GET /api/brand?image=…      -> proxies one public image so the browser can use it on canvas
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const image = q.get("image");
    if (image) {
      const r = await safeFetch(image, 8_000_000, "image/*");
      const type = r.contentType.split(";")[0];
      if (!type.startsWith("image/")) return Response.json({ error: "Not an image." }, { status: 415 });
      return new Response(new Uint8Array(r.bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" } });
    }
    const url = q.get("url");
    if (!url) return Response.json({ error: "Missing url." }, { status: 400 });
    return Response.json(await readBrand(url));
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Couldn't read that site." }, { status: 422 });
  }
}
