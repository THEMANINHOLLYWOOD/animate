import { afterEach, describe, expect, it, vi } from "vitest";
import { kvFromEnv } from "./kv";

afterEach(() => vi.unstubAllGlobals());

describe("kvFromEnv", () => {
  it("is off without a URL and token", () => {
    expect(kvFromEnv({})).toBeNull();
    expect(kvFromEnv({ KV_REST_API_URL: "https://x.upstash.io" })).toBeNull();
  });

  it("sends each command to the REST endpoint with the token, every argument a string", async () => {
    const fetch = vi.fn(async () => Response.json({ result: "OK" }));
    vi.stubGlobal("fetch", fetch);
    const kv = kvFromEnv({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t0k" })!;
    expect(await kv(["SET", "k", 2, "PX", 1000])).toBe("OK");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.upstash.io");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t0k");
    expect(JSON.parse(init.body as string)).toEqual(["SET", "k", "2", "PX", "1000"]);
  });

  it("throws on an error reply, so callers fall back to memory", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "WRONGPASS" }, { status: 401 })));
    const kv = kvFromEnv({ KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "bad" })!;
    await expect(kv(["GETDEL", "k"])).rejects.toThrow(/WRONGPASS/);
  });
});
