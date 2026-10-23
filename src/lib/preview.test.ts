import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHOWCASE } from "./presets/showcase";
import type { SceneFn } from "./engine";

// sessionStorage outlives a reload; each fresh import of the module is a new page load.
let store: Map<string, string>;
const load = async () => {
  vi.resetModules();
  return import("./preview");
};

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const film = { code: "ctx.fillRect(0, 0, W, H);", aspect: "16:9" as const, duration: 4 };
const frame = (scene: SceneFn) => scene(null as never, 480, 270, 0, 4, 0, null, { images: [], byName: {} });
const clock = () => {
  const c = { now: 0 };
  vi.spyOn(performance, "now").mockImplementation(() => c.now);
  return c;
};

describe("preview keys", () => {
  it("change with anything the clip shows", async () => {
    const { previewKey } = await load();
    const k = previewKey(film);
    expect(previewKey({ ...film })).toBe(k);
    expect(previewKey({ ...film, duration: 5 })).not.toBe(k);
    expect(previewKey({ ...film, aspect: "9:16" })).not.toBe(k);
    expect(previewKey({ ...film, code: film.code + " " })).not.toBe(k);
  });
});

describe("shipped example clips", () => {
  const ex = { ...SHOWCASE[0], builtin: true };

  it("are used while the example is unchanged", async () => {
    const { shippedClip } = await load();
    expect(shippedClip(ex)).toBe(`/previews/${ex.id}.mp4`);
  });

  it("aren't once its Length, Format or code changes, or for your own films", async () => {
    const { shippedClip } = await load();
    expect(shippedClip({ ...ex, duration: ex.duration + 1 })).toBeNull();
    expect(shippedClip({ ...ex, aspect: ex.aspect === "1:1" ? "16:9" : "1:1" })).toBeNull();
    expect(shippedClip({ ...ex, code: ex.code + "\n" })).toBeNull();
    expect(shippedClip({ ...ex, builtin: false })).toBeNull();
  });
});

describe("freeze guard", () => {
  it("marks the film busy only while its scene runs", async () => {
    const { guarded, previewKey } = await load();
    let during: string | null = null;
    frame(guarded(() => () => void (during = store.get("animate-preview-busy") ?? null), previewKey(film)));
    expect(during).toBe(previewKey(film));
    await Promise.resolve();
    expect(store.has("animate-preview-busy")).toBe(false);
  });

  it("leaves a film that froze the page alone after the reload", async () => {
    let p = await load();
    store.set("animate-preview-busy", p.previewKey(film)); // the page froze mid-frame
    p = await load();
    expect(p.verdictFor(film)).toBe("frozen");
    expect(p.verdictFor({ ...film, duration: 5 })).toBeUndefined(); // an edited version gets a fresh chance
    expect(await p.previewUrl(film, { serif: "", sans: "", mono: "" })).toBeNull();
  });

  it("treats one very slow frame as a freeze", async () => {
    const { guarded, previewKey, verdictFor } = await load();
    const c = clock();
    const scene = guarded(() => () => void (c.now += 1500), previewKey(film));
    expect(() => frame(scene)).toThrow(/1500ms/);
    expect(verdictFor(film)).toBe("frozen");
  });

  it("gives up the clip once the film overruns its budget, and remembers that", async () => {
    const { guarded, previewKey } = await load();
    const c = clock();
    const scene = guarded(() => () => void (c.now += 40), previewKey(film), 100);
    frame(scene);
    frame(scene);
    expect(() => frame(scene)).toThrow(/over 100ms/);
    const again = await load();
    expect(again.verdictFor(film)).toBe("noclip");
  });

  it("gives up the clip when the scene throws", async () => {
    const { guarded, previewKey, verdictFor } = await load();
    const scene = guarded(() => () => {
      throw new Error("boom");
    }, previewKey(film));
    expect(() => frame(scene)).toThrow("boom");
    expect(verdictFor(film)).toBe("noclip");
  });

  it("doesn't downgrade a freeze", async () => {
    const { previewKey } = await load();
    store.set("animate-preview-verdicts", JSON.stringify({ [previewKey(film)]: "frozen" }));
    const again = await load();
    expect(() =>
      frame(
        again.guarded(() => () => {
          throw new Error("boom");
        }, previewKey(film)),
      ),
    ).toThrow();
    expect(again.verdictFor(film)).toBe("frozen");
  });
});

describe("clips", () => {
  const fonts = { serif: "", sans: "", mono: "" };
  type Req = string | Request;
  const path = (r: Req) => (typeof r === "string" ? r : new URL(r.url).pathname);
  let saved: Map<string, Response>;
  let cache: { match: (r: Req) => Promise<Response | undefined>; put: (r: Req, res: Response) => Promise<void>; delete: ReturnType<typeof vi.fn>; keys: () => Promise<Request[]> };
  let dropped: ReturnType<typeof vi.fn>;
  let revoked: string[];

  beforeEach(() => {
    const map = (saved = new Map()); // this test's own: a page from an earlier test may still tidy its cache
    cache = {
      match: async (r) => map.get(path(r))?.clone(),
      put: async (r, res) => void map.set(path(r), new Response(await res.blob(), { headers: res.headers })),
      delete: vi.fn(async (r: Req) => map.delete(path(r))),
      keys: async () => [...map.keys()].map((k) => new Request(`http://localhost${k}`)),
    };
    dropped = vi.fn(async () => true);
    vi.stubGlobal("caches", { keys: async () => ["animate-previews-v1", "animate-previews-v2", "other"], delete: dropped, open: async () => cache });
    revoked = [];
    let n = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${++n}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => void revoked.push(u));
  });

  const DAY = 86_400_000;
  const seed = (key: string, used?: number) =>
    saved.set(`/__preview/${key}.mp4`, new Response(new Blob(["mp4"]), { headers: used === undefined ? {} : { "X-Preview-Used": String(used) } }));
  const usedOf = (key: string) => Number(saved.get(`/__preview/${key}.mp4`)?.headers.get("X-Preview-Used"));
  const cached = () => [...saved.keys()].map((k) => k.slice("/__preview/".length, -".mp4".length)).sort();
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("shares one clip per film and frees it once nobody shows it", async () => {
    const p = await load();
    seed(p.previewKey(film));
    const a = (await p.previewUrl(film, fonts))!;
    const b = (await p.previewUrl(film, fonts))!;
    expect(b.url).toBe(a.url);
    a.release();
    await settle();
    expect(revoked).toEqual([]);
    b.release();
    await settle();
    expect(revoked).toEqual([a.url]);
    expect(cache.delete).not.toHaveBeenCalled();
  });

  it("deletes the cached copy of a version that's gone", async () => {
    const p = await load();
    seed(p.previewKey(film));
    (await p.previewUrl(film, fonts))!.release(true);
    await settle();
    expect(cache.delete).toHaveBeenCalledWith(`/__preview/${p.previewKey(film)}.mp4`);
  });

  it("gives nothing to a withdrawn request, and frees what it loaded", async () => {
    const p = await load();
    seed(p.previewKey(film));
    const ctl = new AbortController();
    const req = p.previewUrl(film, fonts, ctl.signal);
    ctl.abort();
    expect(await req).toBeNull();
    await settle();
    expect(revoked).toHaveLength(1);
  });

  it("doesn't keep a failure: a later request tries again", async () => {
    const p = await load();
    expect(await p.previewUrl(film, fonts)).toBeNull(); // nothing cached, and no encoder here
    seed(p.previewKey(film));
    expect(await p.previewUrl(film, fonts)).not.toBeNull();
  });

  it("drops clips cached by other renderer versions", async () => {
    const p = await load();
    await p.previewUrl(film, fonts);
    await settle();
    expect(dropped).toHaveBeenCalledWith("animate-previews-v1");
    expect(dropped).not.toHaveBeenCalledWith("animate-previews-v2");
    expect(dropped).not.toHaveBeenCalledWith("other");
  });

  it("prunes clips of films that are gone, but not one on show", async () => {
    const p = await load();
    const other = { ...film, duration: 9 };
    const shown = { ...film, duration: 7 };
    seed(p.previewKey(film));
    seed(p.previewKey(other));
    seed(p.previewKey(shown));
    const held = await p.previewUrl(shown, fonts);
    await p.prunePreviews([film]);
    expect(cached()).toEqual([p.previewKey(film), p.previewKey(shown)].sort());
    held!.release();
  });

  it("marks a clip shown again as still wanted, at most once a day", async () => {
    const p = await load();
    const k = p.previewKey(film);
    seed(k); // cached before clips carried a date
    const a = (await p.previewUrl(film, fonts))!;
    const first = usedOf(k);
    expect(first).toBeGreaterThan(Date.now() - 1000);
    a.release();
    await settle();
    const put = vi.spyOn(cache, "put");
    (await p.previewUrl(film, fonts))!.release();
    expect(put).not.toHaveBeenCalled();
    expect(usedOf(k)).toBe(first);
  });

  it("stores nothing when the browser can't encode H.264", async () => {
    vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => ({ supported: false }) });
    const p = await load();
    expect(await p.previewUrl(film, fonts)).toBeNull();
    expect(saved.size).toBe(0);
  });

  it("forgets clips nobody has shown for a month, but not one on show", async () => {
    const p = await load();
    const now = Date.now();
    const shown = { ...film, duration: 7 };
    seed("fresh", now - 2 * DAY);
    seed("stale", now - 31 * DAY);
    seed("undated");
    seed(p.previewKey(shown), now - 40 * DAY);
    const held = await p.previewUrl(shown, fonts); // shown again: dated today
    await p.evictPreviews(now);
    expect(cached()).toEqual(["fresh", p.previewKey(shown)].sort());
    await p.evictPreviews(now + 40 * DAY);
    expect(cached()).toEqual([p.previewKey(shown)]); // a month on, but still on show
    held!.release();
    await settle();
    await p.evictPreviews(now + 40 * DAY);
    expect(cached()).toEqual([]);
  });

  it("keeps only the most recently shown clips past the cap", async () => {
    const p = await load();
    const now = Date.now();
    for (let i = 0; i < 203; i++) seed(`k${String(i).padStart(3, "0")}`, now - i * 1000);
    await p.evictPreviews(now);
    const left = cached();
    expect(left).toHaveLength(200);
    expect(left).not.toContain("k200");
    expect(left).not.toContain("k202");
    expect(left).toContain("k199");
  });

  it("tidies the cache by itself a little after the library first asks for a clip", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const p = await load();
      seed("stale", Date.now() - 31 * DAY);
      await p.previewUrl(film, fonts);
      expect(cached()).toContain("stale");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(cached()).not.toContain("stale");
    } finally {
      vi.useRealTimers();
    }
  });
});
