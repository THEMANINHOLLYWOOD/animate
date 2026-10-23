// ── Shared state across function instances (optional) ──────────────────────
// A Redis store reached over Upstash's REST API. Vercel's Upstash integration sets
// KV_REST_API_URL / KV_REST_API_TOKEN; a database made at upstash.com directly gives
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Either pair turns it on; without
// one, whatever uses it keeps its state in memory instead.

export type Kv = (command: (string | number)[]) => Promise<unknown>;

export function kvFromEnv(env: Record<string, string | undefined> = process.env): Kv | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (command) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command.map(String)),
      cache: "no-store",
      // A slow store must not hold up the request it's metering; callers fall back to memory.
      signal: AbortSignal.timeout(2000),
    });
    const j = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!res.ok || !j || j.error) throw new Error(`Redis ${command[0]}: ${j?.error ?? `HTTP ${res.status}`}`);
    return j.result ?? null;
  };
}
