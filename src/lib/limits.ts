import { createHash, randomUUID } from "node:crypto";
import { CLERK_ENABLED } from "./authMode";
import { parseIPv4, parseIPv6 } from "./ip";
import { kvFromEnv, type Kv } from "./kv";
import { requireUser } from "./store";

// ── Abuse limits for the routes that spend shared keys ─────────────────────
// Anyone can create without signing in, so every route that calls Anthropic,
// ElevenLabs or fal is metered per caller: the Clerk user when signed in,
// otherwise the client IP (IPv6 grouped by /64, since one host gets a whole /64).
// Guests also share one pool per kind of spend, so a script spread over many
// addresses still meets a ceiling on what guests spend in total. Accounts are free to
// make, so signed-in users share a larger pool of their own. Either pool takes a dozen or
// more callers at their own limit to fill. ANIMATE_GUEST_POOL_SCALE and
// ANIMATE_USER_POOL_SCALE multiply the pools (2 = twice as big).
//
// The windows live in Redis when one is connected (see kv.ts), so every function
// instance and region shares them. Without it they live IN MEMORY, PER INSTANCE:
// a caller whose requests land on several instances gets a multiple of these limits
// and a cold start forgets them, so connect a store in production.

type Window = readonly [count: number, ms: number];
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Generation is metered in PARTS: requests to the model, one slot each, recorded when admitted.
// A stage (a treatment, a scene, a fix) is one part plus one per continuation past the time
// limit, lighter retry or reconnect; a typical film uses 10-25. A new stage only begins with
// room for HEADROOM parts left, and a film that has begun may run up to STRETCH percent of these
// counts to finish (see meterStage), so that is the hard ceiling on what one caller, and guests
// or accounts together, can spend. Otherwise one film is roughly: critique ×2, audio-plan ×1-2,
// tts per voice line, sfx per cue, music ×1; a recreation adds elements, separate and
// transcribe/isolate once each.
export const LIMITS = {
  generate: { guest: [[90, HOUR], [240, DAY]], user: [[300, HOUR], [1500, DAY]], guests: [[1500, HOUR], [6000, DAY]], users: [[4500, HOUR], [20000, DAY]] },
  critique: { guest: [[20, HOUR]], user: [[120, HOUR]], guests: [[300, HOUR]], users: [[1500, HOUR]] },
  elements: { guest: [[6, HOUR], [15, DAY]], user: [[40, HOUR]], guests: [[90, HOUR]], users: [[500, HOUR]] },
  agent: { guest: [[20, HOUR], [60, DAY]], user: [[150, HOUR]], guests: [[300, HOUR]], users: [[1800, HOUR]] },
  "audio-plan": { guest: [[12, HOUR]], user: [[80, HOUR]], guests: [[180, HOUR]], users: [[1000, HOUR]] },
  speech: { guest: [[20, HOUR]], user: [[120, HOUR]], guests: [[300, HOUR]], users: [[1500, HOUR]] }, // isolate + transcribe
  voice: { guest: [[60, HOUR]], user: [[400, HOUR]], guests: [[900, HOUR]], users: [[5000, HOUR]] }, // tts
  sfx: { guest: [[120, HOUR]], user: [[800, HOUR]], guests: [[1800, HOUR]], users: [[10000, HOUR]] },
  music: { guest: [[6, HOUR], [15, DAY]], user: [[40, HOUR]], guests: [[90, HOUR]], users: [[500, HOUR]] },
  separate: { guest: [[6, HOUR], [15, DAY]], user: [[40, HOUR]], guests: [[90, HOUR]], users: [[500, HOUR]] },
  brand: { guest: [[60, HOUR]], user: [[300, HOUR]], guests: [[900, HOUR]], users: [[3600, HOUR]] },
  reference: { guest: [[60, HOUR]], user: [[300, HOUR]], guests: [[900, HOUR]], users: [[3600, HOUR]] },
} as const satisfies Record<string, { guest: readonly Window[]; user: readonly Window[]; guests: readonly Window[]; users: readonly Window[] }>;
export type LimitGroup = keyof typeof LIMITS;

// The pool a caller draws on alongside their own allowance.
const poolOf = (group: LimitGroup, user: boolean): Entry => {
  const scale = Number(process.env[user ? "ANIMATE_USER_POOL_SCALE" : "ANIMATE_GUEST_POOL_SCALE"]) || 1;
  const windows = LIMITS[group][user ? "users" : "guests"].map(([count, ms]) => [Math.max(1, Math.round(count * scale)), ms] as const);
  return { key: `${group}|${user ? "users" : "guests"}`, windows };
};

// ── The store: Redis when connected, memory otherwise ──────────────────────

let kv: Kv | null | undefined;
let downUntil = 0;
// After a failure the store is left alone for half a minute, so an outage doesn't add its
// timeout to every request; limits keep working from memory meanwhile.
function store() {
  if (Date.now() < downUntil) return null;
  if (kv === undefined) {
    kv = kvFromEnv();
    if (!kv && process.env.NODE_ENV === "production")
      console.warn("[limits] no shared store (KV_REST_API_URL or UPSTASH_REDIS_REST_URL): limits are kept per function instance, so they multiply with instances");
  }
  return kv;
}
// Swaps the store (tests); undefined goes back to reading the environment.
export function setStore(next: Kv | null | undefined) {
  kv = next;
  downUntil = 0;
}

let warnedAt = 0;
function storeFailed(e: unknown) {
  downUntil = Date.now() + 30_000;
  if (Date.now() - warnedAt < MIN) return;
  warnedAt = Date.now();
  console.error(`[limits] shared store unavailable, metering in memory: ${(e as Error).message}`);
}

// Sliding log: each key keeps the times of its admitted requests within its longest window.
// Every admitted request records exactly one slot, and nothing is ever booked ahead or handed
// back, so what a log holds is what was actually spent.
type Entry = { key: string; windows: readonly Window[] };
// What a request needs to be admitted: room for `need` slots under each window's count, taken
// as `stretch` percent of it. Whichever it is, it records one.
export type Rule = { need: number; stretch: number };
const ONE: Rule = { need: 1, stretch: 100 };
const logs = new Map<string, { times: number[]; span: number }>();
// Passes (see meterStage) kept in memory: what each is good for, and until when.
const passes = new Map<string, { pass: Pass; exp: number }>();
// Films (see meterStage) kept in memory: until when each counts as started.
const films = new Map<string, number>();
let calls = 0;

// How many requests a window of `count` may already hold for one more to fit under a rule.
const keepOf = (count: number, { need, stretch }: Rule) => {
  const cap = Math.floor((count * stretch) / 100);
  return cap - Math.min(need, cap);
};

// All or nothing over several logs: records the request in every one and returns wait 0, or
// records nothing and returns how long until it would fit (ms) and which entry refused.
// Refused requests aren't recorded, so retrying while limited doesn't extend the wait.
export function takeLocal(entries: readonly Entry[], now = Date.now(), rule: Rule = ONE): { wait: number; at: number } {
  let wait = 0;
  let at = -1;
  const found = entries.map(({ key, windows }) => {
    const log = logs.get(key) ?? { times: [], span: Math.max(...windows.map(([, ms]) => ms)) };
    let drop = 0;
    while (drop < log.times.length && log.times[drop] <= now - log.span) drop++;
    if (drop) log.times.splice(0, drop);
    return log;
  });
  entries.forEach(({ windows }, i) => {
    const { times } = found[i];
    for (const [count, ms] of windows) {
      const first = times.findIndex((t) => t > now - ms);
      const inWindow = first < 0 ? 0 : times.length - first;
      // Fitting needs the oldest of the last keep + 1 requests to leave the window.
      const keep = keepOf(count, rule);
      const w = inWindow > keep ? times[times.length - keep - 1] + ms - now : 0;
      if (w > wait) [wait, at] = [w, i];
    }
  });
  if (!wait)
    found.forEach((log, i) => {
      log.times.push(now);
      logs.set(entries[i].key, log);
    });
  if (++calls % 500 === 0) sweep(now);
  return { wait, at };
}

// One key, one request: 0 when admitted, else the wait in ms.
export const take = (key: string, windows: readonly Window[], now = Date.now()) => takeLocal([{ key, windows }], now).wait;

// The same sliding log in Redis: one sorted set of request times per key, checked and
// recorded in one script so concurrent requests on other instances can't both slip in.
// With a film's marker as the last key, the request is admitted under the second rule while
// the marker is up, and admitting it (re)starts the marker.
// ARGV: now, id, rule (need, stretch), rule once the film has started (need, stretch), how
// long a film stays started (ms, 0 without a marker), then per log: window count, (count, ms) pairs.
const WINDOW_SCRIPT = `
local now, id, filmMs = tonumber(ARGV[1]), ARGV[2], tonumber(ARGV[7])
local need, stretch, logs = tonumber(ARGV[3]), tonumber(ARGV[4]), #KEYS
if filmMs > 0 then
  logs = logs - 1
  if redis.call('EXISTS', KEYS[#KEYS]) == 1 then need, stretch = tonumber(ARGV[5]), tonumber(ARGV[6]) end
end
local a, wait, at, spans = 8, 0, 0, {}
for k = 1, logs do
  local n, span, ws = tonumber(ARGV[a]), 0, {}
  a = a + 1
  for i = 1, n do
    ws[i] = { tonumber(ARGV[a]), tonumber(ARGV[a + 1]) }
    a = a + 2
    if ws[i][2] > span then span = ws[i][2] end
  end
  spans[k] = span
  redis.call('ZREMRANGEBYSCORE', KEYS[k], '-inf', string.format('%.0f', now - span))
  for i = 1, n do
    local cap, ms = math.floor(ws[i][1] * stretch / 100), ws[i][2]
    local keep = cap - math.min(need, cap)
    if redis.call('ZCOUNT', KEYS[k], string.format('(%.0f', now - ms), '+inf') > keep then
      local oldest = redis.call('ZREVRANGE', KEYS[k], keep, keep, 'WITHSCORES')
      local w = tonumber(oldest[2]) + ms - now
      if w > wait then wait, at = w, k end
    end
  end
end
if wait == 0 then
  for k = 1, logs do
    redis.call('ZADD', KEYS[k], now, id)
    redis.call('PEXPIRE', KEYS[k], spans[k])
  end
  if filmMs > 0 then redis.call('SET', KEYS[#KEYS], '1', 'PX', filmMs) end
end
return { wait, at }`;

// The {rl} hash tag keeps every key in one slot, so the script also runs on a cluster.
const rlKey = (key: string) => `animate:{rl}:${key}`;

// A film the request belongs to: while it counts as started, the request is admitted under
// `started` instead, and admitting it keeps the film started for FILM_MS more.
type Film = { key: string; started: Rule };

async function takeAll(entries: readonly Entry[], rule: Rule, film?: Film): Promise<{ wait: number; at: number }> {
  const now = Date.now();
  const shared = store();
  if (shared) {
    try {
      const keys = [...entries.map((e) => rlKey(e.key)), ...(film ? [rlKey(`film:${film.key}`)] : [])];
      const started = film?.started ?? rule;
      const args = entries.flatMap((e) => [e.windows.length, ...e.windows.flat()]);
      const r = (await shared(["EVAL", WINDOW_SCRIPT, keys.length, ...keys, now, `${now}:${randomUUID()}`, rule.need, rule.stretch, started.need, started.stretch, film ? FILM_MS : 0, ...args])) as [number, number];
      return { wait: Number(r[0]) || 0, at: Number(r[1]) - 1 };
    } catch (e) {
      storeFailed(e);
    }
  }
  const r = takeLocal(entries, now, film && (films.get(film.key) ?? 0) > now ? film.started : rule);
  if (film && !r.wait) films.set(film.key, now + FILM_MS);
  return r;
}

// Forget what has aged out, so the maps can't grow without bound.
function sweep(now: number) {
  for (const [key, log] of logs) if (!log.times.length || log.times.at(-1)! <= now - log.span) logs.delete(key);
  for (const [key, p] of passes) if (p.exp <= now) passes.delete(key);
  for (const [key, exp] of films) if (exp <= now) films.delete(key);
}

export function resetLimits() {
  logs.clear();
  passes.clear();
  films.clear();
  calls = 0;
}

// ── Who is calling ─────────────────────────────────────────────────────────

// The caller's IP as Vercel reports it (it overwrites x-forwarded-for, so it can't be
// spoofed there; behind another proxy the first hop is whatever that proxy forwards).
export function clientIp(h: Headers): string {
  const raw = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "").trim();
  if (!raw) return "unknown";
  if (parseIPv4(raw)) return raw;
  const w = parseIPv6(raw);
  if (!w) return raw.slice(0, 64);
  // IPv4-mapped addresses are the IPv4 caller; any other IPv6 caller is bucketed by its /64.
  if (w.slice(0, 5).every((g) => g === 0) && w[5] === 0xffff) return [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255].join(".");
  return `${w.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

export type Caller = { id: string; user: boolean };

export async function callerOf(req: Request): Promise<Caller> {
  let userId: string | null = null;
  try {
    userId = await requireUser();
  } catch {
    // no Clerk session attached to this request: treat as a guest
  }
  return userId ? { id: `u:${userId}`, user: true } : { id: `ip:${clientIp(req.headers)}`, user: false };
}

const inTime = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `in ${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `in ${m} minutes`;
  return `in about ${Math.round(m / 60)} hours`;
};

// A JSON error that is also a valid NDJSON stream line, so both the plain fetch
// callers (failure() reads `error`) and the streaming readers (`type: "error"`) show it.
// A request's own signal plus a deadline, for model and provider calls: stopping a build stops the
// spend, and a slow call ends as an error the client can show, not a platform timeout.
export const within = (req: Request, ms: number) => AbortSignal.any([req.signal, AbortSignal.timeout(ms)]);

export function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify({ error: message, type: "error", message }) + "\n", {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

// Admits the request against the caller's allowance and their pool under `rule` (and, for a
// stage, its film's), or refuses it with a 429 (Retry-After).
async function admit(who: Caller, group: LimitGroup, rule: Rule = ONE, film?: Film): Promise<Response | null> {
  const { wait, at } = await takeAll([{ key: `${group}|${who.id}`, windows: LIMITS[group][who.user ? "user" : "guest"] }, poolOf(group, who.user)], rule, film);
  if (!wait) return null;
  const message =
    at === 1
      ? who.user
        ? `A lot of people are creating right now. Try again ${inTime(wait)}.`
        : `Guests are using a lot of this right now. Try again ${inTime(wait)}${CLERK_ENABLED ? ", or sign in to keep going" : ""}.`
      : who.user
        ? `You've reached the limit for this for now. Try again ${inTime(wait)}.`
        : `You've reached the guest limit for this for now. Try again ${inTime(wait)}${CLERK_ENABLED ? ", or sign in for higher limits" : ""}.`;
  return errorResponse(message, 429, { "Retry-After": String(Math.ceil(wait / 1000)) });
}

// Null when admitted; otherwise a 429 with Retry-After.
export async function limit(req: Request, group: LimitGroup, who?: Caller): Promise<Response | null> {
  return admit(who ?? (await callerOf(req)), group);
}

// ── Generation stages ──────────────────────────────────────────────────────
// Every request to the model is one part, recorded in the caller's allowance and their pool
// when it is admitted. Nothing is reserved for later, so nothing can be left behind: a film
// that is stopped, abandoned or fails has spent exactly the parts it ran, and they age out of
// the windows like any other request.
//
// New stages. A request that resumes nothing and belongs to no film that has started (a new
// film's treatment, a scene straight from a brief, an edit) is begun only when the caller and
// their pool both have room for HEADROOM parts, so it is likely to finish.
//
// Started work may run past the limits by a bounded allowance (up to STRETCH percent of each
// count), so a film that began within them can finish:
// - Follow-ups. When the server cuts a request short (the time limit, the output cap, or the
//   client went away), it knows exactly which request comes back for the rest: the same stage,
//   resuming from the text produced so far. It leaves a single-use pass for that request, keyed
//   by the caller, everything the stage carries and the text it resumes from, so it can't be
//   spent on anything else, nor twice. A stage gets at most MAX_FOLLOW_UPS of them, one of
//   them a reconnect.
// - The film's other stages (the scene after a treatment, runtime and review fixes): every
//   admitted part keeps its film marked started, for that caller, for FILM_MS.
// A request claiming to resume without a pass is metered like any other: as a new stage unless
// its film has started. So the claim never buys more than a new stage of that film would get.

// 8 continuations, 5 lighter retries, 3 retries while Claude's servers are busy and a
// reconnect: what the Studio's runStage may ask for.
export const MAX_FOLLOW_UPS = 17;
// Room a new stage needs: most take one to three parts, a long one several more.
export const HEADROOM = 6;
// How far started work may run past each count, in percent: the hard ceiling.
export const STRETCH = 130;
const PASS_MS = 20 * MIN;
// Spans the gaps in a film (a long part, rendering and reviewing its frames between stages);
// a film left behind stops counting as started soon after.
const FILM_MS = 30 * MIN;
const NEW_STAGE: Rule = { need: HEADROOM, stretch: 100 };
const STARTED: Rule = { need: 1, stretch: STRETCH };

// `n` follow-ups so far; `retried` once it reconnected.
export type Pass = { n: number; retried: boolean };

const hashOf = (...parts: string[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("\0");
  return h.digest("base64url");
};
export const passKey = (who: Caller, stageId: string, resumeFrom: string) => hashOf("pass", who.id, stageId, resumeFrom);
const filmKey = (who: Caller, filmId: string) => hashOf("film", who.id, filmId);

async function grantPass(key: string, pass: Pass) {
  const shared = store();
  if (shared) {
    try {
      await shared(["SET", `animate:pass:${key}`, JSON.stringify(pass), "PX", PASS_MS]);
      return;
    } catch (e) {
      storeFailed(e);
    }
  }
  passes.set(key, { pass, exp: Date.now() + PASS_MS });
}

async function redeemPass(key: string): Promise<Pass | null> {
  const local = passes.get(key);
  if (local) {
    passes.delete(key);
    if (local.exp > Date.now()) return local.pass;
  }
  const shared = store();
  if (!shared) return null;
  try {
    const v = await shared(["GETDEL", `animate:pass:${key}`]);
    if (typeof v !== "string") return null;
    const p = JSON.parse(v) as Partial<Pass>;
    return { n: Math.min(MAX_FOLLOW_UPS, Math.max(0, Number(p.n) || 0)), retried: !!p.retried };
  } catch (e) {
    storeFailed(e);
    return null;
  }
}

export type StageRequest = {
  stageId: string; // everything the request carries except where it resumes from and how hard it thinks
  filmId: string; // what every stage of one film shares
  resumeFrom: string; // the text it continues ("" when starting)
};

export type Stage = {
  limited: Response | null;
  // Leaves the pass for the follow-up that resumes this stage from `resumeFrom` (none once the
  // stage has had all it gets). `reconnect` marks the one retry after the client went away.
  leave: (resumeFrom: string, reconnect?: boolean) => Promise<void>;
};

// Meters one generation request: one part, admitted as started work on a pass or while its film
// has started, otherwise as a new stage.
export async function meterStage(req: Request, s: StageRequest): Promise<Stage> {
  const who = await callerOf(req);
  const key = passKey(who, s.stageId, s.resumeFrom);
  const pass = await redeemPass(key);
  const limited = await admit(who, "generate", pass ? STARTED : NEW_STAGE, { key: filmKey(who, s.filmId), started: STARTED });
  // A pass is spent by the request it admits; a refused follow-up keeps it for when there's room.
  if (limited && pass) await grantPass(key, pass);
  const run = limited ? null : (pass ?? { n: 0, retried: false });
  return {
    limited,
    leave: async (from, reconnect = false) => {
      if (!run || run.n >= MAX_FOLLOW_UPS || (reconnect && run.retried)) return;
      await grantPass(passKey(who, s.stageId, from), { n: run.n + 1, retried: run.retried || reconnect });
    },
  };
}

// ── Input caps ─────────────────────────────────────────────────────────────

// A string field cut to its cap (non-strings become "").
export const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

// True when a string field is longer than its cap (for fields that can't be cut safely, like code).
export const over = (v: unknown, max: number) => typeof v === "string" && v.length > max;
