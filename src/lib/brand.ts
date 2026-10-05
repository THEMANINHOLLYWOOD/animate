import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ── Fetching user-supplied URLs safely ─────────────────────────────────────
// Only public http(s) hosts; every redirect hop is re-checked.

function privateAddress(ip: string) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) links are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("That address isn't reachable.");
}

export async function safeFetch(input: string, maxBytes = 3_000_000, accept = "text/html,*/*") {
  let url = new URL(input);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(9000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; animate-brand-reader/1.0)", Accept: accept },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`The site returned ${res.status}.`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url, contentType: res.headers.get("content-type") ?? "", bytes: Buffer.concat(chunks) };
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

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
const metas = (html: string) => [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function meta(html: string, key: string) {
  for (const m of metas(html)) {
    const k = (attr(m, "property") ?? attr(m, "name") ?? "").toLowerCase();
    if (k === key) return attr(m, "content");
  }
  return null;
}

function normHex(h: string) {
  let x = h.toLowerCase();
  if (x.length === 4) x = "#" + x.slice(1).split("").map((c) => c + c).join("");
  return x.slice(0, 7);
}

function rankColors(css: string) {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const c = normHex(m[0]);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  // Brand-named custom properties count extra.
  for (const m of css.matchAll(/--[\w-]*(brand|primary|accent|main)[\w-]*\s*:\s*(#[0-9a-f]{3,6})\b/gi)) {
    const c = normHex(m[2]);
    counts.set(c, (counts.get(c) ?? 0) + 25);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

function rankFonts(css: string) {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1].split(",")[0].replace(/["']/g, "").trim();
    if (!first || first.startsWith("var(") || /^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system)$/i.test(first)) continue;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 4);
}

export async function readBrand(input: string): Promise<BrandKit> {
  const page = await safeFetch(input);
  const html = page.bytes.toString("utf8");
  const base = page.url;
  const abs = (u: string | null) => {
    if (!u) return null;
    try {
      return new URL(decode(u), base).toString();
    } catch {
      return null;
    }
  };

  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const name = decode(meta(html, "og:site_name") ?? meta(html, "application-name") ?? title.split(/[|·–—-]/)[0] ?? base.hostname);
  const description = decode(meta(html, "og:description") ?? meta(html, "description") ?? "");

  // Styles: inline blocks plus the first few stylesheets.
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  css += "\n" + [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join(";");
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((l) => /rel\s*=\s*["']?stylesheet/i.test(l))
    .map((l) => abs(attr(l, "href")))
    .filter(Boolean)
    .slice(0, 4) as string[];
  const fetched = await Promise.all(sheets.map((s) => safeFetch(s, 1_500_000, "text/css,*/*").then((r) => r.bytes.toString("utf8")).catch(() => "")));
  css += "\n" + fetched.join("\n");

  // Logo: an <img> that calls itself a logo, then touch icons / svg icons.
  // Prefer a logo naming the brand itself, then one inside the site header; customer logos elsewhere are ignored.
  const brandWord = (name || base.hostname).toLowerCase().split(/\s+/)[0];
  const isLogo = (t: string) => /logo/i.test(`${attr(t, "src")} ${attr(t, "alt")} ${attr(t, "class")}`) && !/\.gif/i.test(attr(t, "src") ?? "");
  const imgsIn = (s: string) => [...s.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const header = html.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? html.slice(0, 15000);
  const logoImg =
    imgsIn(html).find((t) => isLogo(t) && `${attr(t, "src")} ${attr(t, "alt")}`.toLowerCase().includes(brandWord)) ??
    imgsIn(header).find(isLogo);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const iconLinks = links.filter((l) => /rel\s*=\s*["'][^"']*icon/i.test(l));
  const bestIcon =
    iconLinks.find((l) => /apple-touch-icon/i.test(l)) ??
    iconLinks.find((l) => /\.svg/i.test(attr(l, "href") ?? "")) ??
    iconLinks.sort((a, b) => parseInt(attr(b, "sizes") ?? "0") - parseInt(attr(a, "sizes") ?? "0"))[0];

  const themeColor = meta(html, "theme-color");
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
    ogImage: abs(meta(html, "og:image") ?? meta(html, "twitter:image")),
  };
}
