import { describe, expect, it } from "vitest";
import { brandFrom, elements, rankColors, rankFonts, startTags } from "./brand";

const base = new URL("https://acme.example/");
const noSheets = async () => "";

describe("brandFrom", () => {
  it("reads name, description, colours, fonts and logo", async () => {
    const html = `<!doctype html><html><head>
      <title>Acme | Rockets</title>
      <meta property="og:site_name" content="Acme">
      <meta name="description" content="We make rockets &amp; more">
      <meta name="theme-color" content="#FF5500">
      <meta property="og:image" content="/og.png">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="stylesheet" href="/site.css">
      <style>:root{--brand-primary:#ff5500} body{font-family:"Inter",sans-serif;color:#222}</style>
    </head><body><header><img src="/img/acme-logo.svg" alt="Acme"></header></body></html>`;
    const sheets: string[] = [];
    const kit = await brandFrom(html, base, async (u) => (sheets.push(u), "a{color:#123456}"));
    expect(sheets).toEqual(["https://acme.example/site.css"]);
    expect(kit).toMatchObject({
      name: "Acme",
      description: "We make rockets & more",
      themeColor: "#ff5500",
      fonts: ["Inter"],
      logo: "https://acme.example/img/acme-logo.svg",
      icon: "https://acme.example/touch.png",
      ogImage: "https://acme.example/og.png",
    });
    expect(kit.colors[0]).toBe("#ff5500");
    expect(kit.colors).toContain("#123456");
  });

  it("scans tags and elements without regex backtracking", () => {
    const html = '<META name="a"><meta-x><img src=1><title>T</title><Style>x</Style><style';
    const lower = html.toLowerCase();
    expect(startTags(html, lower, "meta")).toEqual(['<META name="a">']);
    expect(elements(html, lower, "title", 1)).toEqual(["T"]);
    expect(elements(html, lower, "style")).toEqual(["x"]);
  });

  it("reads pages whose text changes length when lowercased (Turkish İ)", async () => {
    // "İ".toLowerCase() is two code units; lowercasing the page that way shifts every later slice.
    const title = "İŞ BANKASI · İNTERNET ŞUBESİ İÇİN İLETİŞİM ".repeat(6) + "| Şirket";
    const html = `<html><head><title>${title}</title>
      <meta name="description" content="Türkiye İş Bankası">
      <meta name="theme-color" content="#0A3D91">
      <style>body{font-family:"Roboto",sans-serif;color:#0a3d91}</style>
    </head><body><header><img class="logo" src="/img/isbank-logo.svg" alt="İşbank"></header></body></html>`;
    expect(html.toLowerCase().length).toBeGreaterThan(html.length);
    const kit = await brandFrom(html, new URL("https://www.isbank.example/"), noSheets);
    expect(kit.name).toBe(title.split("·")[0].trim());
    expect(kit.description).toBe("Türkiye İş Bankası");
    expect(kit.themeColor).toBe("#0a3d91");
    expect(kit.colors[0]).toBe("#0a3d91");
    expect(kit.fonts).toEqual(["Roboto"]);
    expect(kit.logo).toBe("https://www.isbank.example/img/isbank-logo.svg");
  });

  it("stays linear on hostile pages (unclosed tags, long runs)", async () => {
    const big = 600_000;
    const pages = [
      "<meta".repeat(big / 5),
      "<title".repeat(big / 6),
      "<header".repeat(big / 7),
      "<style>".repeat(big / 7),
      "<link ".repeat(big / 6),
      'style="'.repeat(big / 7),
    ];
    for (const html of pages) {
      const t = performance.now();
      await brandFrom(html, base, noSheets);
      expect(performance.now() - t, html.slice(0, 8)).toBeLessThan(1500);
    }
    for (const css of ["-".repeat(2_000_000), "font-family:".repeat(150_000), ";--".repeat(500_000) + "x"]) {
      const t = performance.now();
      rankColors(css);
      rankFonts(css);
      expect(performance.now() - t, css.slice(0, 8)).toBeLessThan(1500);
    }
  });
});
