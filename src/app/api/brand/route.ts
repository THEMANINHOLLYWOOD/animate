import { readBrand, safeFetch } from "@/lib/brand";
import { limit } from "@/lib/limits";
import { sniffImage, svgToPng, UNTRUSTED_HEADERS } from "@/lib/media";

export const maxDuration = 60;

// GET /api/brand?url=…        -> brand kit (name, description, colours, fonts, logo, preview image)
// GET /api/brand?image=…      -> proxies one public image so the browser can use it on canvas
//                                (raster only: an SVG comes back drawn as a PNG, so no script can ride along)
export async function GET(req: Request) {
  const limited = await limit(req, "brand");
  if (limited) return limited;
  const q = new URL(req.url).searchParams;
  try {
    const image = q.get("image");
    if (image) {
      const r = await safeFetch(image, 8_000_000, "image/*");
      if (r.truncated) return Response.json({ error: "That image is too large." }, { status: 413 });
      // The type comes from the bytes, not the upstream header.
      let type = sniffImage(r.bytes);
      let bytes: Uint8Array = r.bytes;
      if (type === "image/svg+xml") {
        const png = await svgToPng(r.bytes);
        if (!png) return Response.json({ error: "That image couldn't be read." }, { status: 415 });
        type = "image/png";
        bytes = png;
      }
      if (!type) return Response.json({ error: "Not an image." }, { status: 415 });
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", ...UNTRUSTED_HEADERS } });
    }
    const url = q.get("url");
    if (!url) return Response.json({ error: "Missing url." }, { status: 400 });
    return Response.json(await readBrand(url));
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Couldn't read that site." }, { status: 422 });
  }
}
