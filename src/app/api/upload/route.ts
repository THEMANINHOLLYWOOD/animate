import { list } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { limit } from "@/lib/limits";
import { ownsPath, requireUser, unauthorized, userRoot } from "@/lib/store";

// Issues short-lived client tokens so browsers upload videos and images
// straight to Blob (bypassing the function body size limit).

const MB = 1024 * 1024;
// What each folder may hold, and how big one file in it may be. videos/ is what share links
// publish, so it takes renders only. audio/ also takes MP4/WebM: sound added from a video file is
// stored as that file (shares only publish videos/, and media serves everything sandboxed).
const FOLDERS: Record<string, { types: string[]; max: number }> = {
  videos: { types: ["video/mp4", "video/webm"], max: 400 * MB },
  assets: { types: ["image/*"], max: 30 * MB },
  audio: { types: ["audio/*", "video/mp4", "video/webm"], max: 150 * MB },
  // A film's own typefaces. Browsers name font files loosely (or not at all), and media serves anything
  // it doesn't know as a plain download, so an unnamed type is let in here.
  fonts: { types: ["font/*", "application/font-woff", "application/font-woff2", "application/x-font-ttf", "application/x-font-otf", "application/vnd.ms-opentype", "application/octet-stream"], max: 20 * MB },
};

// How much one account may keep in all (ANIMATE_STORAGE_GB, 2 by default).
const CAP = (Number(process.env.ANIMATE_STORAGE_GB) || 2) * 1024 * MB;
// What each account holds, as last counted. Counting lists the account's files, which storage bills
// for, so a count stands for ten minutes: the cap is met within that many minutes of uploads.
const held = new Map<string, { bytes: number; at: number }>();
async function stored(userId: string) {
  const known = held.get(userId);
  if (known && Date.now() - known.at < 10 * 60_000) return known.bytes;
  let bytes = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: userRoot(userId), cursor });
    for (const b of page.blobs) bytes += b.size;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (held.size > 5000) held.clear();
  held.set(userId, { bytes, at: Date.now() });
  return bytes;
}

export async function POST(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return Response.json({ error: "Invalid upload request." }, { status: 400 });
  // A token is what lets a file in, so asking for one is what's metered and checked against the cap.
  if (body.type === "blob.generate-client-token") {
    const limited = await limit(req, "upload", { id: `u:${userId}`, user: true });
    if (limited) return limited;
    const bytes = await stored(userId).catch(() => 0);
    if (bytes >= CAP) {
      return Response.json({ error: `Your library is full (${Math.round(CAP / 1024 / MB)} GB). Delete some films or saved videos to make room.` }, { status: 413 });
    }
  }
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!ownsPath(userId, pathname)) throw new Error("Not your folder.");
        const folder = pathname.split("/")[2] ?? "";
        if (!Object.hasOwn(FOLDERS, folder)) throw new Error("Not your folder.");
        return {
          allowedContentTypes: FOLDERS[folder].types,
          maximumSizeInBytes: FOLDERS[folder].max,
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
