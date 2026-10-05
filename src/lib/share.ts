import { del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";

// Public share links point at a rendered MP4 (never at scene code, so viewers
// never run anyone else's code). Videos stay in the private store; viewers get
// a short-lived signed URL.

export type Share = {
  id: string;
  owner: string;
  pathname: string;
  title: string;
  w: number;
  h: number;
  duration: number;
  createdAt: number;
};

const sharePath = (id: string) => `shares/${id}.json`;
const ID = /^[a-z0-9]{10}$/;

export function newShareId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
}

export async function createShare(s: Share) {
  await head(s.pathname); // throws if the video doesn't exist
  await put(sharePath(s.id), JSON.stringify(s), { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/json" });
  return s;
}

export async function readShare(id: string): Promise<Share | null> {
  if (!ID.test(id)) return null;
  try {
    const r = await get(sharePath(id), { access: "private" });
    if (!r || r.statusCode !== 200) return null;
    return (await new Response(r.stream).json()) as Share;
  } catch {
    return null;
  }
}

export async function deleteShare(id: string) {
  await del(sharePath(id));
}

// A signed GET URL for the shared video, valid for two hours.
export async function signedVideoUrl(s: Share) {
  const validUntil = Date.now() + 2 * 60 * 60 * 1000;
  const token = await issueSignedToken({ pathname: s.pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: s.pathname, access: "private", validUntil });
  return presignedUrl;
}

export async function streamShareVideo(s: Share) {
  return get(s.pathname, { access: "private" });
}
