import { del, get, list, put } from "@vercel/blob";
import { requireUser, unauthorized, userRoot } from "@/lib/store";

const ID = /^[a-z0-9]{4,32}$/;

async function readJson(pathname: string) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return new Response(r.stream).json();
}

export async function GET() {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const { blobs } = await list({ prefix: `${userRoot(userId)}projects/` });
  const projects = (await Promise.all(blobs.map((b) => readJson(b.pathname).catch(() => null)))).filter(Boolean);
  projects.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return Response.json({ projects });
}

export async function PUT(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const project = await req.json();
  if (!ID.test(project?.id ?? "") || typeof project.code !== "string") {
    return Response.json({ error: "Invalid project." }, { status: 400 });
  }
  project.updatedAt = Date.now();
  await put(`${userRoot(userId)}projects/${project.id}.json`, JSON.stringify(project), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return Response.json({ ok: true, project });
}

export async function DELETE(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ID.test(id)) return Response.json({ error: "Invalid id." }, { status: 400 });
  const root = userRoot(userId);
  const related = await Promise.all(
    [`${root}assets/${id}/`, `${root}videos/${id}/`].map((prefix) => list({ prefix }).then((r) => r.blobs.map((b) => b.pathname))),
  );
  await del([`${root}projects/${id}.json`, ...related.flat()]);
  return Response.json({ ok: true });
}
