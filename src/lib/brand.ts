import { isIP } from "node:net";
import { fetch as undiciFetch } from "undici";
import { isPrivateAddress } from "./ip";
import { BLOCKED, publicAgent } from "./net";

// ── Fetching user-supplied URLs safely ─────────────────────────────────────
// Only public http(s) hosts; every redirect hop is re-checked, and the connection
// itself goes through publicAgent, which refuses private addresses at connect time
// (so a DNS answer that changes between check and connect can't reach inside).

function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) links are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // IP literals never reach DNS, so they're judged here; names are judged as they resolve.
  if (isIP(host) && isPrivateAddress(host)) throw new Error(BLOCKED);
}

export async function safeFetch(input: string, maxBytes = 3_000_000, accept = "text/html,*/*") {
  let url = new URL(input);
  for (let hop = 0; hop < 4; hop++) {
    assertPublic(url);
    const res = await undiciFetch(url, {
      redirect: "manual",
      dispatcher: publicAgent,
      signal: AbortSignal.timeout(9000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; animate-brand-reader/1.0)", Accept: accept },
    }).catch((e: Error & { cause?: Error }) => {
      // undici wraps connection errors as "fetch failed"; surface the reason we refused.
      throw e.cause?.message === BLOCKED ? new Error(BLOCKED) : e.name === "TimeoutError" ? new Error("The site took too long to answer.") : new Error("Couldn't reach that site.");
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`The site returned ${res.status}.`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        // Keep what fits; the rest isn't read.
        chunks.push(value.subarray(0, value.length - (size - maxBytes)));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url, contentType: res.headers.get("content-type") ?? "", bytes: Buffer.concat(chunks), truncated };
  }
  throw new Error("Too many redirects.");
}

// ── Brand kit extraction ───────────────────────────────────────────────────

export type BrandKit = {
  url: string;
  host: string;
  name: string;
  description: string;
  themeColor: string | null;
  colors: string[];
  fonts: string[];
  logo: string | null;
  icon: string | null;
  ogImage: string | null;
};

// Pages are attacker-controlled, so the HTML is scanned with indexOf rather than
// backtracking regexes: /<meta\b[^>]*>/ alone is quadratic on a page of unclosed
// "<meta", and one request could pin the CPU for minutes. Inputs are capped too.
const MAX_HTML = 1_500_000;
const MAX_SHEET = 1_000_000;
const MAX_CSS = 3_000_000;
const MAX_TAG = 4000;

// A tag name ends at whitespace, "/" or ">".
const ends = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13 || c === 47 || c === 62;

// The scanners find tags in a lowercased copy and slice the original at the same
// indices, so the copy must keep every character where it was. String#toLowerCase
// doesn't: "İ" becomes two code units and shifts everything after it (Turkish pages).
// Tag and attribute names are ASCII, so lowercasing ASCII alone is enough.
export const lowerAscii = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

// Every <name …> start tag in order (absurdly long ones skipped). `lower` is lowerAscii(html).
export function startTags(html: string, lower: string, name: string) {
  const out: string[] = [];
  const open = "<" + name;
  let i = lower.indexOf(open);
  while (i >= 0) {
    if (!ends(lower.charCodeAt(i + open.length))) {
      i = lower.indexOf(open, i + 1);
      continue;
    }
    const gt = lower.indexOf(">", i);
    if (gt < 0) break; // nothing after this point can close
    if (gt - i <= MAX_TAG) out.push(html.slice(i, gt + 1));
    i = lower.indexOf(open, gt);
  }
  return out;
}

// The text inside each <name …>…</name> element, up to `max` of them.
export function elements(html: string, lower: string, name: string, max = Infinity) {
  const out: string[] = [];
  const open = "<" + name;
  const close = "</" + name;
  let i = lower.indexOf(open);
  while (i >= 0 && out.length < max) {
    if (!ends(lower.charCodeAt(i + open.length))) {
      i = lower.indexOf(open, i + 1);
      continue;
    }
    const gt = lower.indexOf(">", i);
    const end = gt < 0 ? -1 : lower.indexOf(close, gt);
    if (end < 0) break;
    out.push(html.slice(gt + 1, end));
    i = lower.indexOf(open, end);
  }
  return out;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

// <meta property|name=… content=…> as a lookup; the first tag for a key wins.
function metaMap(metaTags: string[]) {
  const map = new Map<string, string | null>();
  for (const m of metaTags) {
    const k = (attr(m, "property") ?? attr(m, "name") ?? "").toLowerCase();
    if (k && !map.has(k)) map.set(k, attr(m, "content"));
  }
  return (key: string) => map.get(key) ?? null;
}

function normHex(h: string) {
  let x = h.toLowerCase();
  if (x.length === 4) x = "#" + x.slice(1).split("").map((c) => c + c).join("");
  return x.slice(0, 7);
}

export function rankColors(css: string) {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const c = normHex(m[0]);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  // Brand-named custom properties count extra. (Anchored after a delimiter with bounded
  // runs, so a long run of dashes can't make the scan quadratic.)
  for (const m of css.matchAll(/(?:^|[^\w-])--([\w-]{1,80})\s{0,8}:\s{0,8}(#[0-9a-f]{3,6})\b/gi)) {
    if (!/brand|primary|accent|main/i.test(m[1])) continue;
    const c = normHex(m[2]);
    counts.set(c, (counts.get(c) ?? 0) + 25);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function rankFonts(css: string) {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s{0,8}:\s{0,8}([^;}]{1,300})/gi)) {
    const first = m[1].split(",")[0].replace(/["']/g, "").trim();
    if (!first || first.startsWith("var(") || /^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system)$/i.test(first)) continue;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 4);
}

export async function readBrand(input: string): Promise<BrandKit> {
  const page = await safeFetch(input, MAX_HTML);
  return brandFrom(page.bytes.toString("utf8"), page.url, (s) => safeFetch(s, MAX_SHEET, "text/css,*/*").then((r) => r.bytes.toString("utf8")));
}

// The kit from a fetched page; `sheet` fetches one linked stylesheet.
export async function brandFrom(html: string, base: URL, sheet: (url: string) => Promise<string>): Promise<BrandKit> {
  const lower = lowerAscii(html);
  const abs = (u: string | null) => {
    if (!u) return null;
    try {
      return new URL(decode(u), base).toString();
    } catch {
      return null;
    }
  };
  const meta = metaMap(startTags(html, lower, "meta"));
  const links = startTags(html, lower, "link");

  const title = decode(elements(html, lower, "title", 1)[0] ?? "");
  const name = decode(meta("og:site_name") ?? meta("application-name") ?? title.split(/[|·–—-]/)[0] ?? base.hostname);
  const description = decode(meta("og:description") ?? meta("description") ?? "");

  // Styles: inline blocks plus the first few stylesheets.
  let css = elements(html, lower, "style").join("\n");
  css += "\n" + [...html.matchAll(/style\s{0,8}=\s{0,8}"([^"]{0,4000})"/gi)].map((m) => m[1]).join(";");
  const sheets = links
    .filter((l) => /rel\s*=\s*["']?stylesheet/i.test(l))
    .map((l) => abs(attr(l, "href")))
    .filter(Boolean)
    .slice(0, 4) as string[];
  const fetched = await Promise.all(sheets.map((s) => sheet(s).catch(() => "")));
  css = (css + "\n" + fetched.join("\n")).slice(0, MAX_CSS);

  // Logo: an <img> that calls itself a logo, then touch icons / svg icons.
  // Prefer a logo naming the brand itself, then one inside the site header; customer logos elsewhere are ignored.
  const brandWord = (name || base.hostname).toLowerCase().split(/\s+/)[0];
  const isLogo = (t: string) => /logo/i.test(`${attr(t, "src")} ${attr(t, "alt")} ${attr(t, "class")}`) && !/\.gif/i.test(attr(t, "src") ?? "");
  const header = elements(html, lower, "header", 1)[0] ?? html.slice(0, 15000);
  const logoImg =
    startTags(html, lower, "img").find((t) => isLogo(t) && `${attr(t, "src")} ${attr(t, "alt")}`.toLowerCase().includes(brandWord)) ??
    startTags(header, lowerAscii(header), "img").find(isLogo);
  const iconLinks = links.filter((l) => /rel\s*=\s*["'][^"']*icon/i.test(l));
  const bestIcon =
    iconLinks.find((l) => /apple-touch-icon/i.test(l)) ??
    iconLinks.find((l) => /\.svg/i.test(attr(l, "href") ?? "")) ??
    iconLinks.sort((a, b) => parseInt(attr(b, "sizes") ?? "0") - parseInt(attr(a, "sizes") ?? "0"))[0];

  const themeColor = meta("theme-color");
  return {
    url: base.toString(),
    host: base.hostname.replace(/^www\./, ""),
    name: name || base.hostname,
    description,
    themeColor: themeColor ? themeColor.toLowerCase() : null,
    colors: rankColors(css).slice(0, 8),
    fonts: rankFonts(css),
    logo: abs(logoImg ? (attr(logoImg, "src") ?? attr(logoImg, "data-src")) : null),
    icon: abs(bestIcon ? attr(bestIcon, "href") : null),
    ogImage: abs(meta("og:image") ?? meta("twitter:image")),
  };
}
