import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, buildConnector } from "undici";
import { isPrivateAddress } from "./ip";

// ── Connect-time enforcement ───────────────────────────────────────────────
// Checking a hostname and then letting fetch resolve it again loses to DNS
// rebinding (public for the check, private for the connection). This lookup
// is the one the socket connects with, so the address checked is the address used.

export const BLOCKED = "That address isn't reachable.";
const blocked = () => Object.assign(new Error(BLOCKED), { code: "EADDRBLOCKED" });

type Resolve = (host: string, opts: LookupAllOptions, cb: (err: NodeJS.ErrnoException | null, addrs: LookupAddress[]) => void) => void;

export function publicLookup(resolve: Resolve = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true, family: options.family, hints: options.hints }, (err, addrs) => {
      if (err) return callback(err, "");
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return callback(blocked(), "");
      if (options.all) return callback(null, addrs);
      callback(null, addrs[0].address, addrs[0].family);
    });
  };
}

// An undici dispatcher that only ever connects to public addresses: names resolve
// through publicLookup, and the connected peer is checked again (IP literals skip DNS).
const connect = buildConnector({ lookup: publicLookup(), timeout: 9000 });
export const publicAgent = new Agent({
  connect(opts, cb) {
    return connect(opts, (err, socket) => {
      if (err || !socket) return cb(err ?? new Error("Couldn't connect."), null);
      const peer = socket.remoteAddress ?? "";
      if (!isIP(peer) || isPrivateAddress(peer)) {
        socket.destroy();
        return cb(blocked(), null);
      }
      cb(null, socket);
    });
  },
});
