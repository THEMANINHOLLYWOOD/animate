import { auth } from "@clerk/nextjs/server";
import { CLERK_ENABLED, LOCAL_USER } from "./authMode";

// Every user's data lives under users/<userId>/ in the private Blob store:
//   projects/<id>.json          project metadata + scene code
//   assets/<projectId>/<name>   images drawn in a film
//   videos/<projectId>/<ts>.mp4 exported renders
//   audio/<projectId>/<clip>    a film's sound clips
//   fonts/<projectId>/<file>    typefaces dropped with a film's brief

export const userRoot = (userId: string) => `users/${userId}/`;

// Without Clerk (local development only) everything belongs to one local owner.
export async function requireUser() {
  if (!CLERK_ENABLED) return process.env.NODE_ENV === "development" ? LOCAL_USER : null;
  const { userId } = await auth();
  return userId;
}

export function ownsPath(userId: string, pathname: string) {
  return pathname.startsWith(userRoot(userId)) && !pathname.split(/[\\/]/).includes("..");
}

export const unauthorized = () => Response.json({ error: "Sign in required." }, { status: 401 });
