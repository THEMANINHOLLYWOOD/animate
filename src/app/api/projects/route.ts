import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";
import { requireUser, unauthorized, userRoot } from "@/lib/store";
import { Doc } from "@/editor/doc/schema";
import { filmVersion } from "@/lib/library";

const ID = /^[a-z0-9]{4,32}$/;

async function readJson(pathname: string) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return new Response(r.stream).json();
}

const projectPath = (userId: string, id: string) => `${userRoot(userId)}projects/${id}.json`;

// Whether this browser is signed in: 204, or 401.
export async function HEAD() {
  const userId = await requireUser();
  return new Response(null, { status: userId ? 204 : 401 });
}

// The library. It is read in two steps, so it never has to fit one response (4.5 MB on Vercel) and a
// film that hasn't changed isn't sent again:
//   ?index=1     what's stored: each film's id, size and a stamp that changes when it's saved
//   ?ids=a,b,c   those films in full (the page asks in batches that fit a response)
//   ?id=a        one film
// With none of these, every film in full (pages loaded before the index existed still ask this way).
export async function GET(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const q = new URL(req.url).searchParams;
  const id = q.get("id");
  if (id !== null) {
    if (!ID.test(id)) return Response.json({ error: "Invalid id." }, { status: 400 });
    const project = await readJson(projectPath(userId, id));
    return project ? Response.json({ project }) : Response.json({ error: "This film isn't in your library." }, { status: 404 });
  }
  const ids = q.get("ids");
  if (ids !== null) {
    const want = [...new Set(ids.split(","))];
    if (!want.length || want.length > 50 || !want.every((x) => ID.test(x))) return Response.json({ error: "Invalid ids." }, { status: 400 });
    const projects = (await Promise.all(want.map((x) => readJson(projectPath(userId, x)).catch(() => null)))).filter(Boolean);
    return Response.json({ projects });
  }
  const prefix = `${userRoot(userId)}projects/`;
  const blobs = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (q.get("index")) {
    const index = blobs
      .map((b) => ({ id: b.pathname.slice(prefix.length).replace(/\.json$/, ""), v: b.etag || String(+b.uploadedAt), size: b.size }))
      .filter((f) => ID.test(f.id));
    return Response.json({ index });
  }
  const projects = (await Promise.all(blobs.map((b) => readJson(b.pathname).catch(() => null)))).filter(Boolean);
  projects.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return Response.json({ projects });
}

export async function PUT(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const project = await req.json().catch(() => null);
  if (!ID.test(project?.id ?? "") || typeof project.code !== "string") {
    return Response.json({ error: "Invalid project." }, { status: 400 });
  }
  project.updatedAt = Date.now();
  await put(projectPath(userId, project.id), JSON.stringify(project), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return Response.json({ ok: true, project });
}

// The editor's save: a new doc (and length, optionally title) merged into the stored film, leaving
// everything else the Studio saved as it is. With `base` (the version the doc was made from), a film
// whose doc, code, length or format changed since is refused with 409 and sent back as it is now.
// The write is conditional on the copy just read, so a save landing in between is checked too.
export async function PATCH(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const body = (await req.json().catch(() => null)) as { id?: unknown; doc?: unknown; base?: unknown; title?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!ID.test(id)) return Response.json({ error: "Invalid id." }, { status: 400 });
  const parsed = Doc.safeParse(body?.doc);
  if (!parsed.success) return Response.json({ error: "The document is invalid." }, { status: 400 });
  const doc = parsed.data;
  const base = typeof body?.base === "string" ? body.base : undefined;
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : undefined;
  const pathname = projectPath(userId, id);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await get(pathname, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return Response.json({ error: "This film was deleted." }, { status: 404 });
    const cur = await new Response(r.stream).json();
    if (base && filmVersion(cur) !== base) return Response.json({ error: "This film changed since it was opened.", project: cur }, { status: 409 });
    const project = { ...cur, doc, duration: doc.meta.duration, ...(title ? { title } : {}), updatedAt: Date.now() };
    try {
      await put(pathname, JSON.stringify(project), { access: "private", ifMatch: r.blob.etag, addRandomSuffix: false, contentType: "application/json" });
      return Response.json({ ok: true, project });
    } catch (e) {
      // Another save landed between the read and this write: check against that one.
      if (e instanceof BlobPreconditionFailedError) continue;
      throw e;
    }
  }
  return Response.json({ error: "This film is being changed elsewhere. Try again." }, { status: 409 });
}

export async function DELETE(req: Request) {
  const userId = await requireUser();
  if (!userId) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ID.test(id)) return Response.json({ error: "Invalid id." }, { status: 400 });
  const root = userRoot(userId);
  const related = await Promise.all(
    [`${root}assets/${id}/`, `${root}videos/${id}/`, `${root}audio/${id}/`, `${root}fonts/${id}/`].map((prefix) => list({ prefix }).then((r) => r.blobs.map((b) => b.pathname))),
  );
  await del([projectPath(userId, id), ...related.flat()]);
  return Response.json({ ok: true });
}
