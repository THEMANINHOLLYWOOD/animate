// ── Public-address checks for fetching user-supplied URLs ──────────────────
// Every address is parsed to bytes first, so alternate spellings (IPv4-mapped
// "::ffff:7f00:1", IPv4-compatible "::127.0.0.1", zone ids) can't slip past.

export function parseIPv4(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

// Eight 16-bit groups, or null when it isn't an IPv6 address.
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  if (s.includes(".")) {
    // Dotted IPv4 in the last 32 bits (::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::1.2.3.4).
    const cut = s.lastIndexOf(":");
    const v4 = cut >= 0 ? parseIPv4(s.slice(cut + 1)) : null;
    if (!v4) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    s = s.slice(0, cut + 1);
    if (!s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h ? h.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  const room = 8 - tail.length;
  if (halves.length === 1) return head.length === room ? [...head, ...tail] : null;
  const fill = room - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array(fill).fill(0), ...rest, ...tail];
}

function privateV4([a, b, c]: number[]) {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF assignments, TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

// True for anything that isn't a plainly public unicast address (unparseable counts as private).
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return privateV4(v4);
  const w = parseIPv6(ip);
  if (!w) return true;
  // ::ffff:a.b.c.d (IPv4-mapped): judged as the IPv4 address it reaches.
  if (w.slice(0, 5).every((g) => g === 0) && w[5] === 0xffff) return privateV4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255]);
  // Only global unicast (2000::/3) is public; that also rules out ::/96 (unspecified, loopback,
  // IPv4-compatible), 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64), fc00::/7, fe80::/10, ff00::/8.
  if ((w[0] & 0xe000) !== 0x2000) return true;
  if (w[0] === 0x2002) return true; // 6to4 embeds an IPv4 address
  if (w[0] === 0x2001 && (w[1] < 0x0200 || w[1] === 0x0db8)) return true; // Teredo + IETF assignments, documentation
  return false;
}
