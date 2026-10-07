import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { ownsPath, requireUser, unauthorized } from "@/lib/store";

// Issues short-lived client tokens so browsers upload videos and images
// straight to Blob (bypassing the function body size limit).
export async function POST(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!ownsPath(userId, pathname)) throw new Error("Not your folder.");
        return {
          allowedContentTypes: ["video/mp4", "video/webm", "image/*", "audio/*"],
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
