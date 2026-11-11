import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { ownsPath, requireUser, unauthorized } from "@/lib/store";

// Issues short-lived client tokens so browsers upload videos and images
// straight to Blob (bypassing the function body size limit).

// What each folder may hold. videos/ is what share links publish, so it takes renders only.
// audio/ also takes MP4/WebM: sound added from a video file is stored as that file
// (shares only publish videos/, and media serves everything sandboxed).
const FOLDERS: Record<string, string[]> = {
  videos: ["video/mp4", "video/webm"],
  assets: ["image/*"],
  audio: ["audio/*", "video/mp4", "video/webm"],
};

export async function POST(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return Response.json({ error: "Invalid upload request." }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!ownsPath(userId, pathname)) throw new Error("Not your folder.");
        const folder = pathname.split("/")[2] ?? "";
        if (!Object.hasOwn(FOLDERS, folder)) throw new Error("Not your folder.");
        return {
          allowedContentTypes: FOLDERS[folder],
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
