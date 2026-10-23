import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetch as undiciFetch } from "undici";
import { safeFetch } from "./brand";
import { BLOCKED, publicAgent, publicLookup } from "./net";

type Addr = { address: string; family: number };
const fakeDns = (addrs: Addr[]) => (_h: string, _o: unknown, cb: (e: null, a: Addr[]) => void) => cb(null, addrs);
const ask = (addrs: Addr[], all: boolean) =>
  new Promise<{ err: Error | null; result: unknown }>((resolve) =>
    publicLookup(fakeDns(addrs))("example.test", { all }, (err, address, family) => resolve({ err, result: all ? address : [address, family] })),
  );

describe("publicLookup", () => {
  it("passes public answers through in both callback shapes", async () => {
    const addrs = [{ address: "93.184.216.34", family: 4 }];
    expect(await ask(addrs, true)).toEqual({ err: null, result: addrs });
    expect(await ask(addrs, false)).toEqual({ err: null, result: ["93.184.216.34", 4] });
  });

  it("refuses an answer containing any private address (rebinding, mixed records)", async () => {
    for (const addrs of [[{ address: "127.0.0.1", family: 4 }], [{ address: "93.184.216.34", family: 4 }, { address: "::ffff:a9fe:a9fe", family: 6 }]]) {
      const { err } = await ask(addrs, true);
      expect(err?.message).toBe(BLOCKED);
    }
  });
});

describe("connect-time enforcement", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((_req, res) => res.end("internal secret"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("the agent itself refuses names that resolve privately (no pre-check involved)", async () => {
    const err = await undiciFetch(`http://localhost:${port}/`, { dispatcher: publicAgent }).catch((e: Error & { cause?: Error }) => e);
    expect((err as Error & { cause?: Error }).cause?.message).toBe(BLOCKED);
  });

  it("safeFetch refuses loopback in every spelling", async () => {
    for (const u of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`, `http://[::ffff:7f00:1]:${port}/`]) {
      await expect(safeFetch(u), u).rejects.toThrow(BLOCKED);
    }
  });
});
