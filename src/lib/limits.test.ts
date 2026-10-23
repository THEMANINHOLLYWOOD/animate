import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("./store", () => ({ requireUser: async () => user.id }));

import { clientIp, HEADROOM, LIMITS, limit, MAX_FOLLOW_UPS, meterStage, resetLimits, setStore, STRETCH, take, takeLocal } from "./limits";

const HOUR = 3_600_000;
const req = (headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7" }) => new Request("https://app.test/api/generate", { method: "POST", headers });
const from = (ip: string) => req({ "x-forwarded-for": ip });

beforeEach(() => {
  resetLimits();
  setStore(null);
  user.id = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  setStore(undefined);
});

describe("take (sliding window)", () => {
  it("admits up to the limit, then says when the next slot frees up", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(take("k", [[3, HOUR]], t0 + i * 1000)).toBe(0);
    // The oldest of the three leaves the window an hour after it arrived.
    expect(take("k", [[3, HOUR]], t0 + 5000)).toBe(HOUR - 5000);
    expect(take("k", [[3, HOUR]], t0 + HOUR + 1)).toBe(0);
  });

  it("doesn't record refused requests, so retrying doesn't extend the wait", () => {
    const t0 = 1_000_000;
    take("k", [[1, HOUR]], t0);
    for (let i = 1; i <= 5; i++) expect(take("k", [[1, HOUR]], t0 + i)).toBe(HOUR - i);
    expect(take("k", [[1, HOUR]], t0 + HOUR + 1)).toBe(0);
  });

  it("honours every window (hourly and daily)", () => {
    const windows = [[2, HOUR], [3, 24 * HOUR]] as const;
    expect(take("k", windows, 0)).toBe(0);
    expect(take("k", windows, 1)).toBe(0);
    expect(take("k", windows, HOUR + 1)).toBe(0);
    // Hourly room again, but the day is used up until the first request is a day old.
    expect(take("k", windows, 2 * HOUR + 2)).toBe(24 * HOUR - (2 * HOUR + 2));
  });

  it("keys are independent", () => {
    expect(take("a", [[1, HOUR]], 0)).toBe(0);
    expect(take("b", [[1, HOUR]], 0)).toBe(0);
    expect(take("a", [[1, HOUR]], 1)).toBeGreaterThan(0);
  });

  it("is all or nothing across logs, and says which one refused", () => {
    take("a", [[1, HOUR]], 0);
    expect(takeLocal([{ key: "b", windows: [[1, HOUR]] }, { key: "a", windows: [[1, HOUR]] }], 1)).toEqual({ wait: HOUR - 1, at: 1 });
    // b wasn't recorded by the refused request.
    expect(take("b", [[1, HOUR]], 2)).toBe(0);
  });

  it("can ask for room for more than one, but only ever records one", () => {
    // Five an hour; a request needing room for three fits while two or fewer are in the window.
    const three = { need: 3, stretch: 100 };
    for (let t = 0; t < 3; t++) expect(takeLocal([{ key: "k", windows: [[5, HOUR]] }], t, three).wait).toBe(0);
    // Three recorded, not nine: no room for three more, but plain requests still fit twice.
    expect(takeLocal([{ key: "k", windows: [[5, HOUR]] }], 3, three)).toEqual({ wait: HOUR - 3, at: 0 });
    expect(take("k", [[5, HOUR]], 4)).toBe(0);
    expect(take("k", [[5, HOUR]], 5)).toBe(0);
    expect(take("k", [[5, HOUR]], 6)).toBe(HOUR - 6);
  });

  it("can stretch a window past its count, by a bounded share", () => {
    const stretched = { need: 1, stretch: 130 };
    for (let t = 0; t < 10; t++) expect(take("k", [[10, HOUR]], t)).toBe(0);
    expect(take("k", [[10, HOUR]], 10)).toBeGreaterThan(0);
    // Ten an hour stretched to 130% is thirteen.
    for (let t = 11; t < 14; t++) expect(takeLocal([{ key: "k", windows: [[10, HOUR]] }], t, stretched).wait).toBe(0);
    expect(takeLocal([{ key: "k", windows: [[10, HOUR]] }], 14, stretched)).toEqual({ wait: HOUR - 14, at: 0 });
  });
});

describe("clientIp", () => {
  it("uses the first forwarded address, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("buckets IPv6 by /64 and unwraps IPv4-mapped callers", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2:aaaa::1" }))).toBe(clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2:bbbb::9" })));
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:3::1" }))).not.toBe(clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2::1" })));
    expect(clientIp(new Headers({ "x-forwarded-for": "::ffff:203.0.113.7" }))).toBe("203.0.113.7");
  });
});

describe("limit", () => {
  it("gives guests a friendly 429 with Retry-After once the hourly allowance is spent", async () => {
    const allowance = LIMITS.generate.guest[0][0];
    for (let i = 0; i < allowance; i++) expect(await limit(req(), "generate")).toBeNull();
    const res = await limit(req(), "generate");
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = JSON.parse(await res!.text());
    // Readable by failure() (error) and by the NDJSON stream readers (type/message).
    expect(body.error).toMatch(/limit/);
    expect(body).toMatchObject({ type: "error", message: body.error });
    // Another address, or another route group, is unaffected.
    expect(await limit(from("198.51.100.9"), "generate")).toBeNull();
    expect(await limit(req(), "critique")).toBeNull();
  });

  it("meters signed-in users by account, with the larger allowance", async () => {
    user.id = "user_123";
    const allowance = LIMITS.generate.user[0][0];
    for (let i = 0; i < allowance; i++) expect(await limit(from(`198.51.100.${i % 200}`), "generate")).toBeNull();
    expect((await limit(req(), "generate"))?.status).toBe(429);
  });

  it("caps what guests spend together, however many addresses they use", async () => {
    vi.stubEnv("ANIMATE_GUEST_POOL_SCALE", "0.01"); // a pool of 3 an hour
    for (let i = 0; i < 3; i++) expect(await limit(from(`198.51.100.${i}`), "critique")).toBeNull();
    const res = await limit(from("198.51.100.99"), "critique");
    expect(res?.status).toBe(429);
    expect((await res!.json()).error).toMatch(/Guests are using a lot/);
    // Signed-in users aren't in the guests' pool.
    user.id = "user_123";
    expect(await limit(from("198.51.100.99"), "critique")).toBeNull();
  });

  it("caps what accounts spend together too, since they're free to make", async () => {
    vi.stubEnv("ANIMATE_USER_POOL_SCALE", "0.01"); // a pool of 15 an hour
    for (let i = 0; i < 15; i++) {
      user.id = `user_${i}`;
      expect(await limit(req(), "critique")).toBeNull();
    }
    user.id = "user_new";
    const res = await limit(req(), "critique");
    expect(res?.status).toBe(429);
    expect((await res!.json()).error).toMatch(/A lot of people/);
    // Guests have their own pool.
    user.id = null;
    expect(await limit(req(), "critique")).toBeNull();
  });
});

// The client's side of a stage: the first request, then follow-ups resuming from the text so far.
const stage = (ip: string, stageId: string, resumeFrom = "", filmId = stageId) => meterStage(from(ip), { stageId, filmId, resumeFrom });
// Begins new stages, each its own film, until one is refused; how many got in.
const fill = async (ip: string, name = "other") => {
  let n = 0;
  while (!(await stage(ip, `${name}-${n}`)).limited) n++;
  return n;
};
const IP = "203.0.113.7";
const OTHER = "198.51.100.9";
const MIN = 60_000;
const GUEST = LIMITS.generate.guest[0][0];
// New stages a guest can begin in an hour: each needs room for HEADROOM parts.
const NEW = GUEST - HEADROOM + 1;
// The most a guest's started work can bring their hour to.
const CEILING = Math.floor((GUEST * STRETCH) / 100);

// A film: treatment, scene, runtime fix and two review fixes, each stage cut short `cuts` times
// (continuations, every third a lighter retry from the same text) before it finishes, so
// 5 × (1 + cuts) parts. Returns the stages that were refused; a stage that began must finish.
const film = async (ip: string, n: number, cuts: number) => {
  const refused: string[] = [];
  for (const name of ["direct", "scene", "fix", "review-1", "review-2"]) {
    const id = `film-${n}-${name}`;
    let s = await stage(ip, id, "", `film-${n}`);
    if (s.limited) {
      refused.push(name);
      continue;
    }
    let text = "";
    for (let part = 0; part < cuts; part++) {
      if (part % 3 === 2) await s.leave(text);
      else await s.leave((text += `${part} `));
      s = await stage(ip, id, text, `film-${n}`);
      expect(s.limited, `film ${n} ${name} part ${part}`).toBeNull();
    }
  }
  return refused;
};

describe("meterStage", () => {
  it("costs one part per request, recorded when admitted; a new stage needs room for a few", async () => {
    expect(await fill(IP)).toBe(NEW);
    const refused = await stage(IP, "one-more");
    expect(refused.limited?.status).toBe(429);
    expect(Number(refused.limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await refused.limited!.json()).error).toMatch(/guest limit/);
    // The room it keeps is real: plain requests can still use it, up to the limit.
    expect(await limit(from(IP), "generate")).toBeNull();
    for (let i = NEW + 1; i < GUEST; i++) expect(await limit(from(IP), "generate")).toBeNull();
    expect((await limit(from(IP), "generate"))?.status).toBe(429);
  });

  it("abandoned films don't lock a guest out: they cost the parts they ran and nothing more", async () => {
    // Twenty films begun and dropped: some cut short with a pass nobody redeems, some stopped
    // partway through their follow-ups, some just never heard from again.
    let spent = 0;
    for (let i = 0; i < 20; i++) {
      let s = await stage(IP, `film-${i}`);
      expect(s.limited).toBeNull();
      spent++;
      let text = "";
      for (let k = 0; k < i % 4; k++) {
        await s.leave((text += "x"));
        s = await stage(IP, `film-${i}`, text);
        expect(s.limited).toBeNull();
        spent++;
      }
      if (i % 2) await s.leave(text + "y");
    }
    expect(spent).toBe(50);
    expect(await fill(IP)).toBe(NEW - spent);
  });

  it("a film that has started finishes past the limit, up to a bounded allowance", async () => {
    // The treatment begins and is cut short.
    let t = await stage(IP, "direct", "", "film-1");
    await t.leave("treatment, part 1");
    // Meanwhile the guest begins every other stage they have room for.
    expect(await fill(IP)).toBe(NEW - 1);
    expect((await stage(IP, "another-film")).limited?.status).toBe(429);
    // The film carries on: the treatment's follow-up on its pass, then the scene (cut short,
    // then a lighter retry) and a runtime fix, because the film has started.
    t = await stage(IP, "direct", "treatment, part 1", "film-1");
    expect(t.limited).toBeNull();
    let s = await stage(IP, "scene", "", "film-1");
    expect(s.limited).toBeNull();
    await s.leave("scene, part 1");
    s = await stage(IP, "scene", "scene, part 1", "film-1");
    expect(s.limited).toBeNull();
    await s.leave("scene, part 1");
    expect((await stage(IP, "scene", "scene, part 1", "film-1")).limited).toBeNull();
    expect((await stage(IP, "fix", "", "film-1")).limited).toBeNull();
    // New films are still refused, and the allowance is bounded: past it, the film's stages are too.
    expect((await stage(IP, "another-film")).limited?.status).toBe(429);
    let n = 0;
    while (!(await stage(IP, `review-${n}`, "", "film-1")).limited) n++;
    expect(NEW + 5 + n).toBe(CEILING);
    expect(CEILING).toBeGreaterThan(GUEST);
  });

  it("a film begun with just enough room still finishes a typical build", async () => {
    for (let i = 0; i < GUEST - HEADROOM; i++) expect(await limit(from(IP), "generate")).toBeNull();
    // 25 parts, begun with room for 6.
    expect(await film(IP, 1, 4)).toEqual([]);
  });

  it("a guest's longest film and a typical one at once both finish; the next film waits", async () => {
    // 70 parts and 25: past the hourly count, within the allowance.
    expect(await Promise.all([film(IP, 1, 13), film(IP, 2, 4)])).toEqual([[], []]);
    expect((await stage(IP, "film-3-direct", "", "film-3")).limited?.status).toBe(429);
  });

  it("an account's four longest films at once all finish", async () => {
    user.id = "user_123";
    expect(await Promise.all([1, 2, 3, 4].map((n) => film(IP, n, 13)))).toEqual([[], [], [], []]);
  });

  it("forged follow-ups get no allowance: without a pass, a request is metered like a new stage", async () => {
    expect(await fill(IP)).toBe(NEW);
    // A continuation (or lighter retry, or reconnect) the server never left a pass for, of a
    // film that hasn't started.
    expect((await stage(IP, "film-9", "text the server never sent")).limited?.status).toBe(429);
    // Another caller's pass and film are theirs alone.
    const theirs = await stage(OTHER, "film-1");
    await theirs.leave("part 1");
    expect((await stage(IP, "film-1", "part 1")).limited?.status).toBe(429);
    expect((await stage(IP, "scene", "", "film-1")).limited?.status).toBe(429);
    expect((await stage(OTHER, "film-1", "part 1")).limited).toBeNull();
    // A script that claims to resume on every request gets exactly what new stages get.
    let n = 0;
    while (!(await stage("192.0.2.1", `forged-${n}`, `part ${n}`)).limited) n++;
    expect(n).toBe(NEW);
  });

  it("a pass is good for that caller, that stage and that text", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const s = await stage(IP, "film-1");
    // One very long part: by the time it's cut short the film has gone quiet longer than it stays
    // marked started, so only the pass can let its follow-up in.
    vi.setSystemTime(Date.now() + 31 * MIN);
    await s.leave("part 1");
    await fill(IP);
    await fill(OTHER);
    expect((await stage(OTHER, "film-1", "part 1")).limited?.status).toBe(429); // another caller
    expect((await stage(IP, "film-2", "part 1")).limited?.status).toBe(429); // another stage
    expect((await stage(IP, "film-1", "part 1 + forged")).limited?.status).toBe(429); // other text
    expect((await stage(IP, "film-1", "part 1")).limited).toBeNull();
  });

  it("a follow-up refused at the ceiling still has its pass once there's room", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.now();
    // One very long part, begun 45 minutes before it's cut short: its film has gone quiet.
    vi.setSystemTime(t0 - 45 * MIN);
    const s = await stage(IP, "film-1");
    vi.setSystemTime(t0);
    // Meanwhile the guest's other work takes them to the ceiling.
    expect(await fill(IP)).toBe(NEW - 1);
    let n = 0;
    while (!(await stage(IP, `fix-${n}`, "", "other-0")).limited) n++;
    await s.leave("part 1");
    expect((await stage(IP, "film-1", "part 1")).limited?.status).toBe(429);
    // Once the long part's own slot ages out there's room for one: the pass, not spent by the
    // refusal, lets the follow-up take it (a new stage would need room for HEADROOM).
    vi.setSystemTime(t0 + 15 * MIN + 1);
    expect((await stage(IP, "film-2")).limited?.status).toBe(429);
    expect((await stage(IP, "film-1", "part 1")).limited).toBeNull();
  });

  it("a film stops counting as started once it has gone quiet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    expect((await stage(IP, "direct", "", "film-1")).limited).toBeNull();
    expect(await fill(IP)).toBe(NEW - 1);
    expect((await stage(IP, "scene", "", "film-1")).limited).toBeNull();
    vi.setSystemTime(Date.now() + 31 * MIN);
    expect((await stage(IP, "fix", "", "film-1")).limited?.status).toBe(429);
  });

  it("pools still cap what guests spend together, started work included", async () => {
    vi.stubEnv("ANIMATE_GUEST_POOL_SCALE", String(20 / LIMITS.generate.guests[0][0])); // 20 an hour
    // New stages from any number of addresses begin while the pool has room for a few parts.
    let n = 0;
    while (!(await stage(`192.0.2.${n}`, `film-${n}`)).limited) n++;
    expect(n).toBe(20 - HEADROOM + 1);
    const late = await stage("198.51.100.200", "late");
    expect((await late.limited!.json()).error).toMatch(/Guests are using a lot/);
    // The films that began may run past it, but only so far.
    let parts = n;
    for (let i = 0; ; i = (i + 1) % n) {
      const s = await stage(`192.0.2.${i}`, `fix-${parts}`, "", `film-${i}`);
      if (s.limited) {
        expect((await s.limited.json()).error).toMatch(/Guests are using a lot/);
        break;
      }
      parts++;
    }
    expect(parts).toBe(Math.floor((20 * STRETCH) / 100));
    // Signed-in users draw on a pool of their own.
    user.id = "user_123";
    expect((await stage(IP, "theirs")).limited).toBeNull();
  });
});

describe("shared store", () => {
  // A stand-in for Redis that answers the commands the limiter sends.
  function fakeRedis(evalReply: [number, number] = [0, 0]) {
    const kv = new Map<string, string>();
    const sent: string[][] = [];
    // What the window script answers: [wait, which key refused (1-based)]; tests may change it.
    const answer = { eval: evalReply };
    const store = async (command: (string | number)[]) => {
      const c = command.map(String);
      sent.push(c);
      if (c[0] === "EVAL") return answer.eval;
      if (c[0] === "SET") return kv.set(c[1], c[2]), "OK";
      if (c[0] === "GETDEL") {
        const v = kv.get(c[1]) ?? null;
        kv.delete(c[1]);
        return v;
      }
      throw new Error(`unexpected ${c[0]}`);
    };
    return { store, sent, kv, answer };
  }
  const windows = (ws: readonly (readonly [number, number])[]) => [String(ws.length), ...ws.flatMap(([n, ms]) => [String(n), String(ms)])];

  it("checks and records every window in one script, with the caller and the guests' pool", async () => {
    const redis = fakeRedis();
    setStore(redis.store);
    expect(await limit(req(), "generate")).toBeNull();
    const [cmd, script, nkeys, k1, k2, , id, ...args] = redis.sent[0];
    expect([cmd, nkeys, k1, k2]).toEqual(["EVAL", "2", "animate:{rl}:generate|ip:203.0.113.7", "animate:{rl}:generate|guests"]);
    expect(id).toMatch(/^\d+:[0-9a-f-]{36}$/);
    expect(script).toMatch(/ZREMRANGEBYSCORE[\s\S]*ZCOUNT[\s\S]*ZADD/);
    // A plain request: room for one, no stretch, no film; then per key its windows.
    expect(args).toEqual(["1", "100", "1", "100", "0", ...windows(LIMITS.generate.guest), ...windows(LIMITS.generate.guests)]);
  });

  it("puts signed-in callers in the accounts' pool", async () => {
    const redis = fakeRedis();
    setStore(redis.store);
    user.id = "user_123";
    await limit(req(), "critique");
    expect(redis.sent[0].slice(3, 5)).toEqual(["animate:{rl}:critique|u:user_123", "animate:{rl}:critique|users"]);
  });

  it("turns the script's answer into a 429 naming the right limit", async () => {
    setStore(fakeRedis([90_000, 2]).store);
    const res = await limit(req(), "generate");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("90");
    expect((await res!.json()).error).toMatch(/Guests are using a lot/);
  });

  it("meters a stage in the same script, with its film's marker; passes are kept there, single use", async () => {
    const redis = fakeRedis();
    setStore(redis.store);
    const s = await stage(IP, "film-1");
    // The pass lookup, then the window script: a new stage unless the film has started.
    expect(redis.sent.map((c) => c[0])).toEqual(["GETDEL", "EVAL"]);
    const [, , nkeys, , , film, , , ...args] = redis.sent[1];
    expect(nkeys).toBe("3");
    expect(film).toMatch(/^animate:\{rl\}:film:/);
    expect(args.slice(0, 5)).toEqual([String(HEADROOM), "100", "1", String(STRETCH), String(30 * MIN)]);
    // Cut short: the pass goes down.
    await s.leave("part 1");
    const set = redis.sent[2];
    expect(set[0]).toBe("SET");
    expect(set[1]).toMatch(/^animate:pass:/);
    expect(JSON.parse(set[2])).toEqual({ n: 1, retried: false });
    expect(set.slice(3)).toEqual(["PX", String(20 * MIN)]);
    // The follow-up redeems it and is metered as started work, for the same film.
    redis.sent.length = 0;
    expect((await stage(IP, "film-1", "part 1")).limited).toBeNull();
    expect(redis.sent.map((c) => c[0])).toEqual(["GETDEL", "EVAL"]);
    expect(redis.sent[1][5]).toBe(film);
    expect(redis.sent[1].slice(8, 13)).toEqual(["1", String(STRETCH), "1", String(STRETCH), String(30 * MIN)]);
    expect(redis.kv.size).toBe(0);
    // A second one finds no pass: the script decides by the film's marker.
    redis.sent.length = 0;
    await stage(IP, "film-1", "part 1");
    expect(redis.sent[1].slice(8, 10)).toEqual([String(HEADROOM), "100"]);
  });

  it("leaves at most MAX_FOLLOW_UPS passes for a stage, one of them a reconnect", async () => {
    const redis = fakeRedis();
    setStore(redis.store);
    const passes = () => redis.sent.filter((c) => c[0] === "SET").map((c) => JSON.parse(c[2]));
    let s = await stage(IP, "film-1");
    let text = "";
    for (let i = 0; i < MAX_FOLLOW_UPS; i++) {
      await s.leave((text += `${i};`));
      s = await stage(IP, "film-1", text);
    }
    await s.leave(text + "more"); // none past the last
    expect(passes().map((p) => p.n)).toEqual(Array.from({ length: MAX_FOLLOW_UPS }, (_, i) => i + 1));

    redis.sent.length = 0;
    const r = await stage(OTHER, "film-2");
    await r.leave("", true); // the client went away
    const again = await stage(OTHER, "film-2", "");
    await again.leave("", true); // and again: no second reconnect pass
    expect(passes()).toEqual([{ n: 1, retried: true }]);
    await again.leave("x"); // a continuation after it still gets one
    expect(passes()[1]).toEqual({ n: 2, retried: true });
  });

  it("every follow-up the Studio's runStage may send finds its pass, busy retries included", async () => {
    const redis = fakeRedis();
    setStore(redis.store);
    // runStage's most: 8 continuations, 3 retries while busy, 5 lighter retries, 1 reconnect.
    const plan = [...Array(8).fill("continue"), ...Array(3).fill("busy"), ...Array(5).fill("lighter"), "reconnect"] as const;
    let s = await stage(IP, "film-1");
    let text = "";
    for (const [i, why] of plan.entries()) {
      // A continuation resumes from more text; the others resend the same text.
      await s.leave(why === "continue" ? (text += `${i};`) : text, why === "reconnect");
      redis.sent.length = 0;
      s = await stage(IP, "film-1", text);
      expect(s.limited, `${why} ${i}`).toBeNull();
      expect(redis.sent[0][0], `${why} ${i}`).toBe("GETDEL");
      expect(redis.sent[1].slice(8, 10), `${why} ${i} admitted on its pass`).toEqual(["1", String(STRETCH)]);
    }
    expect(plan.length).toBe(MAX_FOLLOW_UPS);
  });

  it("a refused stage leaves no pass", async () => {
    const redis = fakeRedis([60_000, 1]);
    setStore(redis.store);
    const s = await stage(IP, "film-1");
    expect(s.limited?.status).toBe(429);
    await s.leave("part 1");
    expect(redis.sent.some((c) => c[0] === "SET")).toBe(false);
  });

  it("a refused follow-up keeps its pass: only the request it admits spends it", async () => {
    const redis = fakeRedis();
    setStore(redis.store);
    await (await stage(IP, "film-1")).leave("part 1");
    const [, key, pass] = redis.sent.find((c) => c[0] === "SET")!;
    // Past the ceiling: the follow-up is refused and its pass goes back as it was.
    redis.answer.eval = [60_000, 1];
    redis.sent.length = 0;
    expect((await stage(IP, "film-1", "part 1")).limited?.status).toBe(429);
    expect(redis.sent.map((c) => c.slice(0, 3))).toEqual([["GETDEL", key], expect.arrayContaining(["EVAL"]), ["SET", key, pass]]);
    // Room again: the follow-up redeems it, as started work.
    redis.answer.eval = [0, 0];
    redis.sent.length = 0;
    expect((await stage(IP, "film-1", "part 1")).limited).toBeNull();
    expect(redis.sent[1].slice(8, 10)).toEqual(["1", String(STRETCH)]);
    expect(redis.kv.size).toBe(0);
  });

  it("falls back to memory when the store fails, and still limits", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    setStore(async () => {
      throw new Error("down");
    });
    for (let i = 0; i < LIMITS.critique.guest[0][0]; i++) expect(await limit(req(), "critique")).toBeNull();
    expect((await limit(req(), "critique"))?.status).toBe(429);
    // Stages too, passes included.
    const s = await stage(OTHER, "film-1");
    expect(s.limited).toBeNull();
    await s.leave("part 1");
    expect((await stage(OTHER, "film-1", "part 1")).limited).toBeNull();
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});
