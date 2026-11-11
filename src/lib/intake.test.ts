import { strToU8, zipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { detectBeats } from "./beats";
import {
  cantDecode,
  cssFamily,
  dropOf,
  excelDate,
  findDrop,
  fontInfo,
  fontNote,
  gifInfo,
  IMAGE_CAP,
  iwaText,
  lengthHint,
  loudness,
  odfText,
  openArchive,
  psdComposite,
  refineTempo,
  rtfText,
  sizedSvg,
  slideText,
  sniff,
  soundsLikeVoice,
  soundtrackNote,
  TEXT_CAP,
  textEncoding,
  trackFacts,
  unsnappy,
  voiceNote,
  wordText,
  ZIP_FILES,
} from "./intake";

const bytes = (...parts: (string | number[] | Uint8Array)[]) => {
  const chunks = parts.map((p) => (typeof p === "string" ? Uint8Array.from(p, (c) => c.charCodeAt(0)) : Uint8Array.from(p)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  chunks.reduce((o, c) => (out.set(c, o), o + c.length), 0);
  return out;
};
const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
// Something the size of a real picture (anything under 1 KB is taken for a bullet).
const picture = (seed = 1) => bytes([0x89, 0x50, 0x4e, 0x47], Array.from({ length: 2000 }, (_, i) => (i * seed) % 251));

describe("sniff", () => {
  const kind = (head: Uint8Array, name: string, type = "") => {
    const s = sniff(head, name, type);
    return `${s.kind}/${s.format}`;
  };
  it("knows pictures, sound, video, PDFs and fonts by their first bytes, whatever they're called", () => {
    expect(kind(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "x.bin")).toBe("image/png");
    expect(kind(bytes([0xff, 0xd8, 0xff, 0xe0]), "photo")).toBe("image/jpeg");
    expect(kind(bytes("GIF89a"), "a.txt")).toBe("image/gif");
    expect(kind(bytes("RIFF", [0, 0, 0, 0], "WEBP"), "a")).toBe("image/webp");
    expect(kind(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "), "a")).toBe("audio/wav");
    expect(kind(bytes("ID3", [3, 0, 0]), "song")).toBe("audio/mp3");
    expect(kind(bytes([0xff, 0xfb, 0x90, 0x00]), "song.mp3")).toBe("audio/mp3");
    expect(kind(bytes("fLaC", [0, 0]), "a")).toBe("audio/flac");
    expect(kind(bytes("OggS", [0, 2]), "a.ogg")).toBe("audio/ogg");
    expect(kind(bytes([0, 0, 0, 0x20], "ftypM4A ", [0, 0]), "a.m4a")).toBe("audio/m4a");
    expect(kind(bytes([0, 0, 0, 0x20], "ftypisom", [0, 0]), "a.m4a", "audio/x-m4a")).toBe("audio/m4a");
    expect(kind(bytes([0, 0, 0, 0x20], "ftypisom", [0, 0]), "a.mp4")).toBe("video/mp4");
    expect(kind(bytes([0, 0, 0, 0x14], "ftypqt  ", [0, 0]), "a.mov")).toBe("video/mov");
    expect(kind(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0]), "IMG_1.HEIC")).toBe("image/heic");
    expect(kind(bytes([0, 0, 0, 0x18], "ftypavif", [0, 0]), "a.avif")).toBe("image/avif");
    expect(kind(bytes([0, 0, 0, 0x1c], "ftypmif1", [0, 0, 0, 0], "mif1avifmiaf"), "a.avif")).toBe("image/avif");
    expect(kind(bytes([0, 0, 0, 0x1c], "ftypmif1", [0, 0, 0, 0], "mif1heicmiaf"), "IMG_2.heic")).toBe("image/heic");
    expect(kind(bytes("8BPS", [0, 1]), "a.psd")).toBe("image/psd");
    expect(kind(bytes([0x49, 0x49, 0x2a, 0]), "scan.tif")).toBe("image/tiff");
    expect(kind(bytes("%PDF-1.7\n"), "a.pdf")).toBe("pdf/pdf");
    expect(kind(bytes("wOF2", [0, 1, 0, 0]), "a.woff2")).toBe("font/woff2");
    expect(kind(bytes("wOFF", [0, 1, 0, 0]), "a")).toBe("font/woff");
    expect(kind(bytes("OTTO", [0, 9]), "a")).toBe("font/otf");
    expect(kind(bytes([0, 1, 0, 0, 0, 12, 0, 0x80, 0, 3, 0, 0x40], "GDEF"), "a")).toBe("font/ttf");
    expect(kind(bytes("PK", [3, 4, 20, 0]), "deck.pptx")).toBe("archive/zip");
    expect(kind(bytes("{\\rtf1\\ansi"), "a.rtf")).toBe("rtf/rtf");
  });
  it("reads an Illustrator file saved PDF-compatible as the PDF it is", () => {
    expect(kind(bytes("%PDF-1.6\n%âãÏÓ"), "logo.ai", "application/postscript")).toBe("pdf/pdf");
  });
  it("takes anything that reads as text for text: source code, subtitles, logs, no extension", () => {
    expect(kind(strToU8("export const a = 1;\n"), "a.ts", "video/mp2t")).toBe("text/utf-8");
    expect(kind(strToU8("1\n00:00:01,000 --> 00:00:02,000\nHello\n"), "subs.srt")).toBe("text/utf-8");
    expect(kind(strToU8("\\documentclass{article}"), "paper.tex")).toBe("text/utf-8");
    expect(kind(strToU8("FROM node:22\nRUN npm ci\n"), "Dockerfile")).toBe("text/utf-8");
    expect(kind(strToU8("naïve café ☕"), "notes")).toBe("text/utf-8");
    expect(kind(bytes([0xff, 0xfe], [0x68, 0, 0x69, 0]), "a.txt")).toBe("text/utf-16le");
    expect(kind(bytes([0x68, 0, 0x69, 0, 0x21, 0, 0x0a, 0]), "a.log")).toBe("text/utf-16le");
    // Latin-1 subtitles: not UTF-8, but nothing binary in them.
    expect(kind(bytes("1\nCaf", [0xe9], " cr", [0xe8], "me\n"), "old.srt")).toBe("text/windows-1252");
  });
  it("accepts UTF-8 cut in the middle of a character", () => {
    const cut = strToU8("héllo wörld ☕").subarray(0, 14);
    expect(textEncoding(cut)).toBe("utf-8");
    expect(textEncoding(bytes([0, 1, 2, 3, 0xff, 0xfe, 0, 0]))).toBe(null);
  });
  it("knows SVG with or without a type, and not an HTML page that draws one", () => {
    expect(kind(strToU8('<?xml version="1.0"?><svg viewBox="0 0 10 10"></svg>'), "logo")).toBe("image/svg");
    expect(kind(strToU8("<svg xmlns='http://www.w3.org/2000/svg'/>"), "a.svg", "image/svg+xml")).toBe("image/svg");
    expect(kind(strToU8("<!doctype html><html><body><svg></svg></body></html>"), "page.html")).toBe("text/utf-8");
  });
  it("says what an unusable file is and what to drop instead", () => {
    const why = (head: Uint8Array, name: string) => {
      const s = sniff(head, name);
      expect(s.kind).toBe("unknown");
      return s.why!;
    };
    expect(why(bytes("MZ", [0x90, 0, 3, 0, 0, 0]), "setup.exe")).toMatch(/Windows program/);
    expect(why(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), "old.doc")).toMatch(/old Office file.*\.docx/);
    expect(why(bytes([0x1f, 0x8b, 8, 0]), "a.tar.gz")).toMatch(/unpack it/);
    expect(why(bytes("glTF", [2, 0, 0, 0]), "chair.glb")).toMatch(/3D model.*PNG.*MP4/);
    expect(why(strToU8("v 0 0 0\nv 1 0 0\nf 1 2 3\n"), "chair.obj")).toMatch(/3D model/);
    expect(why(bytes("RIFX", [0, 0, 0, 9], "Egg!"), "comp.aep")).toMatch(/After Effects/);
    expect(why(bytes("%!PS-Adobe-3.0 EPSF-3.0"), "logo.eps")).toMatch(/SVG, PDF or PNG/);
    expect(why(bytes("MThd", [0, 0, 0, 6]), "tune.mid")).toMatch(/MIDI/);
    expect(why(bytes([0x49, 0x49, 0x2a, 0, 8, 0]), "IMG_1.CR2")).toMatch(/camera raw/);
    expect(why(bytes([1, 2, 3, 0, 0, 9, 200, 201]), "thing.xyz")).toMatch(/\(\.xyz\)/);
    expect(why(new Uint8Array(), "nothing.txt")).toMatch(/empty/);
  });
  it("says what to export when the browser can't decode a picture or a sound", () => {
    expect(cantDecode({ kind: "image", format: "heic" })).toMatch(/Safari.*JPEG/);
    expect(cantDecode({ kind: "audio", format: "wma" })).toMatch(/MP3, WAV or M4A/);
    expect(cantDecode({ kind: "video", format: "avi" })).toMatch(/MP4/);
  });
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const wp = (text: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("Word", () => {
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
    ${wp("Launch plan", '<w:pStyle w:val="Title"/>')}
    ${wp("Why now", '<w:pStyle w:val="Heading2"/>')}
    <w:p><w:r><w:t>Fast </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>&amp; simple</w:t></w:r><w:r><w:tab/><w:t>end</w:t><w:br/><w:t>next</w:t></w:r></w:p>
    ${wp("First point", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')}
    <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:txbxContent>${wp("In a box")}</w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent>${wp("In a box")}</w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>
    <w:p><w:r><w:delText>gone</w:delText><w:instrText>PAGE</w:instrText></w:r></w:p>
    <w:tbl><w:tr><w:tc>${wp("Plan")}</w:tc><w:tc>${wp("Price")}</w:tc></w:tr><w:tr><w:tc>${wp("Pro")}</w:tc><w:tc>${wp("$12")}${wp("a month")}</w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  it("reads headings, runs, lists, tables and text boxes once, in order", () => {
    expect(wordText(doc)).toBe(["# Launch plan", "## Why now", "Fast & simple\tend\nnext", "- First point", "In a box", "", "| Plan | Price |", "| Pro | $12 a month |"].join("\n"));
  });
  it("opens a .docx: its text, footnotes and pictures (capped, without bullets or EMFs)", () => {
    const media = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`word/media/image${i + 1}.png`, picture(i + 1)]));
    const o = openArchive(
      zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": doc, "word/footnotes.xml": `<w:footnotes ${W}><w:footnote>${wp("Source: us")}</w:footnote></w:footnotes>`, ...media, "word/media/dot.png": bytes([0x89, 0x50]), "word/media/chart.emf": picture() }),
      "Launch Plan.docx",
    );
    expect(o.format).toBe("docx");
    expect(o.text).toContain("# Launch plan");
    expect(o.text).toContain("Footnotes:\nSource: us");
    expect(o.images.map((i) => i.name)).toEqual(Array.from({ length: IMAGE_CAP }, (_, i) => `Launch Plan-${i + 1}.png`));
    expect(o.images[1].bytes).toEqual(picture(2));
    expect(o.note).toMatch(/^Word · \d+ words · 6 pictures$/);
    expect(o.left).toMatch(/3 more pictures.*1 picture in formats/);
  });
});

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const sp = (type: string | null, paras: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:nvPr>${type === null ? "" : `<p:ph${type ? ` type="${type}"` : ""}/>`}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
const ap = (text: string, lvl = 0) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ""}<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p>`;
const sld = (shapes: string) => `<p:sld ${P}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`;
const rels = (list: [string, string, string][]) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}</Relationships>`;

describe("PowerPoint", () => {
  it("reads a slide: title, nested bullets, tables, and nothing from the footer or the slide number", () => {
    const s = slideText(
      sld(
        sp("title", ap("Q3 in review")) +
          sp("", ap("Revenue up") + ap("Mostly EMEA", 1) + "<a:p><a:endParaRPr/></a:p>") +
          sp("sldNum", "<a:p><a:fld type=\"slidenum\"><a:t>3</a:t></a:fld></a:p>") +
          sp("ftr", ap("Confidential")) +
          sp(null, ap("A loose label")) +
          `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody>${ap("Region")}</a:txBody></a:tc><a:tc><a:txBody>${ap("ARR")}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      ),
    );
    expect(s).toEqual({ title: "Q3 in review", lines: ["- Revenue up", "  - Mostly EMEA", "- A loose label", "| Region | ARR |"] });
  });
  it("opens a .pptx in the deck's own slide order, with speaker notes and each slide's pictures", () => {
    const o = openArchive(
      zip({
        // The deck shows slide2.xml first.
        "ppt/presentation.xml": `<p:presentation ${P}><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
        "ppt/_rels/presentation.xml.rels": rels([["rId1", "slideMaster", "slideMasters/slideMaster1.xml"], ["rId2", "slide", "slides/slide1.xml"], ["rId3", "slide", "slides/slide2.xml"]]),
        "ppt/slides/slide1.xml": sld(sp("title", ap("Second")) + sp("body", ap("Closing thought"))),
        "ppt/slides/slide2.xml": sld(sp("ctrTitle", ap("First")) + sp("subTitle", ap("A subtitle"))),
        "ppt/slides/_rels/slide1.xml.rels": rels([["rId1", "slideLayout", "../slideLayouts/slideLayout2.xml"], ["rId2", "image", "../media/image2.jpeg"]]),
        "ppt/slides/_rels/slide2.xml.rels": rels([["rId1", "notesSlide", "../notesSlides/notesSlide1.xml"], ["rId2", "image", "../media/image1.png"], ["rId3", "image", "../media/image1.png"]]),
        "ppt/notesSlides/notesSlide1.xml": `<p:notes ${P}><p:cSld><p:spTree>${sp("sldImg", "")}${sp("body", ap("Open with the customer story.") + ap("Pause."))}${sp("sldNum", ap("1"))}</p:spTree></p:cSld></p:notes>`,
        "ppt/media/image1.png": picture(3),
        "ppt/media/image2.jpeg": picture(5),
        "ppt/media/unused.png": picture(7),
      }),
      "Q3.pptx",
    );
    expect(o.format).toBe("pptx");
    expect(o.text).toBe(
      ["Slides of “Q3.pptx”, in order.", "", "## Slide 1: First", "- A subtitle", "Speaker notes: Open with the customer story.\nPause.", "", "## Slide 2: Second", "- Closing thought"].join("\n"),
    );
    expect(o.images.map((i) => i.name)).toEqual(["Q3-1.png", "Q3-2.jpeg"]);
    expect(o.images[0].bytes).toEqual(picture(3));
    expect(o.note).toBe("PowerPoint · 2 slides · 1 with notes · 2 pictures");
  });
  it("falls back to file order when the deck's slide list can't be read", () => {
    const o = openArchive(zip({ "ppt/presentation.xml": "<p:presentation/>", "ppt/slides/slide10.xml": sld(sp("title", ap("Ten"))), "ppt/slides/slide2.xml": sld(sp("title", ap("Two"))) }), "d.pptx");
    expect(o.text).toMatch(/## Slide 1: Two[\s\S]*## Slide 2: Ten/);
  });
});

describe("Excel", () => {
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  it("reads sheets as rows: shared and inline strings, numbers, booleans, dates, gaps", () => {
    const o = openArchive(
      zip({
        "xl/workbook.xml": `<workbook ${S}><workbookPr/><sheets><sheet name="Plan &amp; cost" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": rels([["rId1", "worksheet", "worksheets/sheet1.xml"], ["rId2", "worksheet", "/xl/worksheets/sheet2.xml"], ["rId3", "styles", "styles.xml"]]),
        "xl/sharedStrings.xml": `<sst ${S}><si><t>Milestone</t></si><si><r><t>Due</t></r><r><t xml:space="preserve"> date</t></r><rPh><t>ignored</t></rPh></si><si><t>Ship beta</t></si></sst>`,
        "xl/styles.xml": `<styleSheet ${S}><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="#,##0.00 &quot;days&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="165"/></cellXfs></styleSheet>`,
        "xl/worksheets/sheet1.xml": `<worksheet ${S}><sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Owner</t></is></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46000</v></c><c r="C2"><f>1+1</f><v>2</v></c><c r="D2" t="str"><f>A1</f><v>Ana</v></c><c r="E2" t="b"><v>1</v></c><c r="F2" s="3"><v>4.5</v></c></row>
          <row r="3"></row>
        </sheetData></worksheet>`,
        "xl/worksheets/sheet2.xml": `<worksheet ${S}><sheetData/></worksheet>`,
      }),
      "plan.xlsx",
    );
    expect(o.text).toBe(["## Sheet: Plan & cost (2 rows, tab-separated)", "Milestone\tDue date\t\tOwner", "Ship beta\t2025-12-09\t2\tAna\tTRUE\t4.5", "", "## Sheet: Empty (0 rows, tab-separated)"].join("\n"));
    expect(o.note).toBe("Excel · 2 sheets · 2 rows");
  });
  it("turns serial days into dates and times", () => {
    expect(excelDate(45292)).toBe("2024-01-01");
    expect(excelDate(45292.5)).toBe("2024-01-01 12:00");
    expect(excelDate(0.75)).toBe("18:00");
    expect(excelDate(0, true)).toBe("1904-01-01");
  });
  it("stops at the text cap", () => {
    const row = (i: number) => `<row><c t="inlineStr"><is><t>${"x".repeat(990)} ${i}</t></is></c></row>`;
    const o = openArchive(zip({ "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${Array.from({ length: 400 }, (_, i) => row(i)).join("")}</sheetData></worksheet>` }), "big.xlsx");
    expect(o.text!.length).toBeLessThanOrEqual(TEXT_CAP);
    expect(o.text!.length).toBeGreaterThan(TEXT_CAP * 0.9);
    expect(o.note).toMatch(/first 200,000 characters/);
  });
});

describe("OpenDocument", () => {
  const O = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';
  it("reads a text document: headings, spans, spaces, lists, tables; not comments or tracked deletions", () => {
    const xml = `<office:document-content ${O}><office:body><office:text>
      <text:tracked-changes><text:changed-region><text:deletion><text:p>deleted</text:p></text:deletion></text:changed-region></text:tracked-changes>
      <text:h text:outline-level="2">Plan</text:h>
      <text:p>One<text:s text:c="2"/><text:span>two</text:span><text:tab/>three<text:line-break/>four<office:annotation><text:p>a comment</text:p></office:annotation></text:p>
      <text:list><text:list-item><text:p>Item A</text:p><text:list><text:list-item><text:p>Nested</text:p></text:list-item></text:list></text:list-item></text:list>
      <table:table table:name="T"><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>
    </office:text></office:body></office:document-content>`;
    expect(odfText(xml).text).toBe(["## Plan", "One  two\tthree\nfour", "- Item A", "  - Nested", "", "| a | b |"].join("\n"));
  });
  it("opens an .odp slide by slide with titles and notes, and an .ods as rows", () => {
    const odp = `<office:document-content ${O}><office:body><office:presentation>
      <draw:page draw:name="page1"><draw:frame presentation:class="title"><draw:text-box><text:p>Hello</text:p></draw:text-box></draw:frame><draw:frame presentation:class="outline"><draw:text-box><text:list><text:list-item><text:p>Point</text:p></text:list-item></text:list></draw:text-box></draw:frame>
        <presentation:notes><draw:page-thumbnail/><draw:frame presentation:class="notes"><draw:text-box><text:p>Say hi</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>
      <draw:page draw:name="page2"><draw:frame><draw:text-box><text:p>Bye</text:p></draw:text-box></draw:frame></draw:page>
    </office:presentation></office:body></office:document-content>`;
    const o = openArchive(zip({ mimetype: "application/vnd.oasis.opendocument.presentation", "content.xml": odp, "Pictures/a.png": picture() }), "talk.odp");
    expect(o.text).toBe(["## Slide 1: Hello", "- Point", "Speaker notes: Say hi", "", "## Slide 2", "Bye"].join("\n"));
    expect(o.note).toBe("OpenDocument deck · 2 slides · 1 with notes · 1 picture");
    expect(o.images.map((i) => i.name)).toEqual(["talk-1.png"]);
    const ods = `<office:document-content ${O}><office:body><office:spreadsheet><table:table table:name="Costs">
      <table:table-row><table:table-cell><text:p>Item</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"/><table:table-cell office:value="3"><text:p>3</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1020"/></table:table-row>
      <table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
    </table:table></office:spreadsheet></office:body></office:document-content>`;
    expect(openArchive(zip({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": ods }), "c.ods").text).toBe("## Sheet: Costs (tab-separated)\nItem\t\t\t3");
  });
});

// ── iWork fixtures: protobuf by hand, wrapped in Snappy literals ──
const varint = (n: number) => {
  const out: number[] = [];
  for (; n >= 0x80; n = Math.floor(n / 128)) out.push((n % 128) | 0x80);
  return [...out, n];
};
const field = (no: number, v: number | Uint8Array | string) =>
  typeof v === "number" ? [...varint(no * 8), ...varint(v)] : [...varint(no * 8 + 2), ...varint(typeof v === "string" ? strToU8(v).length : v.length), ...(typeof v === "string" ? strToU8(v) : v)];
const archive = (type: number, payload: number[]) => {
  const info = [...field(1, 77), ...field(2, Uint8Array.from([...field(1, type), ...field(2, Uint8Array.from([1, 0, 5])), ...field(3, payload.length)]))];
  return [...varint(info.length), ...info, ...payload];
};
const snappyLiteral = (data: number[]) => [...varint(data.length), ...(data.length <= 60 ? [(data.length - 1) << 2] : [61 << 2, (data.length - 1) & 0xff, (data.length - 1) >> 8]), ...data];
const iwa = (data: number[]) => {
  const packed = snappyLiteral(data);
  return Uint8Array.from([0, packed.length & 0xff, (packed.length >> 8) & 0xff, packed.length >> 16, ...packed]);
};

describe("iWork", () => {
  it("unpacks Snappy copies as well as literals", () => {
    // "abcabcabcabcX": a 3-byte literal, a copy of 9 from 3 back (overlapping), a literal.
    expect(new TextDecoder().decode(unsnappy(Uint8Array.from([13, 2 << 2, 97, 98, 99, ((9 - 4) << 2) | 1, 3, 0 << 2, 88])))).toBe("abcabcabcabcX");
    expect(new TextDecoder().decode(unsnappy(Uint8Array.from([6, 1 << 2, 97, 98, ((4 - 1) << 2) | 2, 2, 0])))).toBe("ababab");
  });
  it("finds the text storages in an .iwa and what each is", () => {
    const data = [...archive(2001, [...field(1, 0), ...field(3, "Body text\u2029next ¶\ufffc")]), ...archive(212, field(1, 9)), ...archive(2001, [...field(1, 4), ...field(3, "A presenter note")]), ...archive(2005, field(3, ""))];
    expect(iwaText(iwa(data))).toEqual([{ kind: 0, text: "Body text\nnext ¶" }, { kind: 4, text: "A presenter note" }]);
  });
  it("opens a .key: slide text, notes, its preview and placed pictures, and says the order may differ", () => {
    const o = openArchive(
      zip({
        "Index/Document.iwa": iwa(archive(1, field(1, 1))),
        "Index/Slide-1.iwa": iwa([...archive(2001, [...field(1, 3), ...field(3, "Big idea")]), ...archive(2001, [...field(1, 4), ...field(3, "Smile")])]),
        "Index/TemplateSlide-1.iwa": iwa(archive(2001, [...field(1, 3), ...field(3, "Title Text")])),
        "preview.jpg": picture(2),
        "Data/photo-12.png": picture(3),
        "Data/photo-small-13.png": picture(4),
        "Metadata/Properties.plist": "x",
      }),
      "Pitch.key",
    );
    expect(o.format).toBe("key");
    expect(o.text).toContain("## Slide 1\nBig idea\nSpeaker notes: Smile");
    expect(o.text).not.toContain("Title Text");
    expect(o.images.map((i) => i.name)).toEqual(["Pitch-1.jpg", "Pitch-2.png"]);
    expect(o.left).toMatch(/file order/);
  });
  it("falls back to the preview, with what to export, when there's no text to read", () => {
    const o = openArchive(zip({ "Index/Document.iwa": Uint8Array.from([9, 9, 9]), "Index/Tables/DataList.iwa": iwa(archive(6005, field(1, 1))), "preview.jpg": picture() }), "Budget.numbers");
    expect(o.text).toBeUndefined();
    expect(o.note).toBe("Numbers · preview only · 1 picture");
    expect(o.left).toMatch(/Export To → Excel or CSV/);
  });
});

describe("design files and plain zips", () => {
  it("takes a Figma file's thumbnail and placed images, and says what to export", () => {
    const o = openArchive(zip({ "canvas.fig": bytes("fig-kiwi", [1, 2, 3]), "thumbnail.png": picture(), "images/3f2a": picture(2), "images/9c1b": bytes([0xff, 0xd8, 0xff], Array.from({ length: 1500 }, () => 7)), "meta.json": "{}" }), "App.fig");
    expect(o.format).toBe("design");
    expect(o.images.map((i) => i.name)).toEqual(["App-preview.png", "App-1.png", "App-2.jpg"]);
    expect(o.left).toMatch(/export them as PNG or SVG/);
    expect(o.files).toBeUndefined();
  });
  it("hands back a plain zip's files, skipping folders and system litter, up to the cap", () => {
    const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`shots/shot ${i + 1}.png`, picture(i + 1)]));
    const o = openArchive(zip({ ...many, "brief.md": "# Brief", "__MACOSX/._brief.md": "x", "shots/.DS_Store": "x", "Thumbs.db": "x" }), "assets.zip");
    expect(o.format).toBe("zip");
    expect(o.files!.length).toBe(ZIP_FILES);
    expect(o.files!.map((f) => f.name).slice(0, 3)).toEqual(["brief.md", "shot 1.png", "shot 2.png"]);
    expect(o.left).toMatch(/4 more files/);
  });
  it("gives a reason for a zip that can't be opened, or has nothing in it", () => {
    expect(() => openArchive(bytes("PK", [3, 4, 9, 9, 9, 9]), "bad.zip")).toThrow(/couldn't be opened/);
    expect(() => openArchive(zip({ "__MACOSX/._a": "x" }), "empty.zip")).toThrow(/empty zip/);
  });
});

describe("RTF", () => {
  it("keeps the words and drops the formatting, tables of fonts and pictures", () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\cocoartf2761
{\fonttbl\f0\fswiss\fcharset0 Helvetica;\f1\fnil Times New Roman;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
{\info{\title Secret title}}
\pard\tx720\pardirnatural\partightenfactor0
\f0\fs24 \cf0 Caf\'e9 \b bold\b0  and \{braces\}\
Second line \u8212? dash \uc0\u9731 \tab end\par
{\pict\pngblip 89504e470d0a}\'93quoted\'94\par
\trowd a\cell b\cell\row
}`;
    expect(rtfText(rtf)).toBe("Café bold and {braces}\nSecond line — dash ☃\tend\n“quoted”\na | b");
  });
  it("reads double-byte code pages", () => {
    expect(rtfText(String.raw`{\rtf1\ansi\ansicpg932 \'82\'b1\'82\'f1 hi}`)).toBe("こん hi");
  });
});

// ── Font fixtures: just the tables fontInfo reads ──
const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const utf16be = (s: string) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
const nameTable = (names: [platform: number, lang: number, id: number, text: string][]) => {
  const strings = names.map(([platform, , , text]) => (platform === 1 ? [...text].map((c) => c.charCodeAt(0)) : utf16be(text)));
  let off = 0;
  const records = names.flatMap(([platform, lang, id], i) => {
    const r = [...u16(platform), ...u16(1), ...u16(lang), ...u16(id), ...u16(strings[i].length), ...u16(off)];
    off += strings[i].length;
    return r;
  });
  return [...u16(0), ...u16(names.length), ...u16(6 + names.length * 12), ...records, ...strings.flat()];
};
const os2 = (weight: number, italic: boolean) => [...u16(4), ...u16(500), ...u16(weight), ...new Array(56).fill(0), ...u16(italic ? 1 : 0x40), 0, 0];
const fvar = (min: number, max: number) => [...u16(1), ...u16(0), ...u16(16), ...u16(2), ...u16(1), ...u16(20), ...u16(0), ...u16(4), ...bytes("wght"), ...u32(min * 65536), ...u32(400 * 65536), ...u32(max * 65536), ...u16(0), ...u16(256)];
const sfnt = (tables: Record<string, number[]>, sig: number[] = [0, 1, 0, 0]) => {
  const tags = Object.keys(tables);
  let off = 12 + tags.length * 16;
  const dir = tags.flatMap((tag) => {
    const r = [...bytes(tag), ...u32(0), ...u32(off), ...u32(tables[tag].length)];
    off += tables[tag].length;
    return r;
  });
  return Uint8Array.from([...sig, ...u16(tags.length), ...u16(0), ...u16(0), ...u16(0), ...dir, ...tags.flatMap((t) => tables[t])]);
};
const woff = (tables: Record<string, number[]>) => {
  const tags = Object.keys(tables);
  const packed = tags.map((t) => zlibSync(Uint8Array.from(tables[t])));
  let off = 44 + tags.length * 20;
  const dir = tags.flatMap((tag, i) => {
    const small = packed[i].length < tables[tag].length;
    const r = [...bytes(tag), ...u32(off), ...u32(small ? packed[i].length : tables[tag].length), ...u32(tables[tag].length), ...u32(0)];
    off += small ? packed[i].length : tables[tag].length;
    return r;
  });
  return Uint8Array.from([...bytes("wOFF"), ...u32(0x00010000), ...u32(0), ...u16(tags.length), ...new Array(30).fill(0), ...dir, ...tags.flatMap((t, i) => (packed[i].length < tables[t].length ? [...packed[i]] : tables[t]))]);
};

describe("fonts", () => {
  it("reads the family (the typographic one over the style-linked one), weight and slant from a TTF or OTF", () => {
    const f = sfnt({ "OS/2": os2(800, true), name: nameTable([[1, 0, 1, "Mac Name"], [3, 0x409, 1, "Acme Sans ExtraBold"], [3, 0x409, 16, "Acme Sans"], [3, 0x407, 16, "Acme Sans DE"], [3, 0x409, 4, "Acme Sans ExtraBold Italic"]]) });
    expect(fontInfo(f, "whatever.ttf")).toEqual({ family: "Acme Sans", weight: 800, italic: true, format: "ttf" });
    expect(fontInfo(sfnt({ name: nameTable([[1, 0, 1, "Old Mac"]]) }, [0x4f, 0x54, 0x54, 0x4f]), "x-Light.otf")).toEqual({ family: "Old Mac", weight: 300, italic: false, format: "otf" });
  });
  it("reads a variable font's weight range", () => {
    expect(fontInfo(sfnt({ "OS/2": os2(400, false), fvar: fvar(100, 900), name: nameTable([[3, 0x409, 1, "Flex"]]) }), "Flex[wght].ttf").weight).toEqual([100, 900]);
  });
  it("reads a WOFF's compressed tables", () => {
    const names = nameTable([[3, 0x409, 1, "Brand Grotesk"], [3, 0x409, 2, "Bold"], [3, 0x409, 4, "Brand Grotesk Bold"], [3, 0x409, 6, "BrandGrotesk-Bold"], [3, 0x409, 5, "Version 1.000; Brand Grotesk; Brand Grotesk Bold"]]);
    expect(fontInfo(woff({ "OS/2": os2(700, false), name: names }), "bg.woff")).toEqual({ family: "Brand Grotesk", weight: 700, italic: false, format: "woff" });
  });
  it("goes by the file name for WOFF2, and for a font it can't parse", () => {
    expect(fontInfo(bytes("wOF2", [0, 1, 0, 0, 9, 9]), "AcmeSans-SemiBoldItalic.woff2")).toEqual({ family: "Acme Sans", weight: 600, italic: true, format: "woff2" });
    expect(fontInfo(bytes("wOF2"), "Inter_Extra_Bold.woff2")).toMatchObject({ family: "Inter", weight: 800, italic: false });
    expect(fontInfo(bytes("wOF2"), "Bold.woff2")).toMatchObject({ family: "Bold Brand", weight: 400 });
    expect(fontInfo(bytes([0, 1, 0, 0, 0, 200]), "Mystery-Black.ttf")).toMatchObject({ family: "Mystery", weight: 900 });
  });
  it("makes family names the canvas font shorthand takes unquoted", () => {
    expect(cssFamily("Söhne Breit")).toMatch(/^So.?hne Breit$/);
    expect(cssFamily("Exo 2")).toBe("Exo2");
    expect(cssFamily("Source Sans 3")).toBe("Source Sans3");
    expect(cssFamily("3270 Condensed")).toBe("F3270 Condensed");
    expect(cssFamily('"Quoted", Name!')).toBe("Quoted Name");
    expect(cssFamily("Display")).toBe("Display Brand");
    expect(cssFamily("serif")).toBe("serif Brand");
    expect(cssFamily("  ")).toBe("Brand Font");
  });
  it("tells the model the family to write, once per family", () => {
    expect(fontNote([{ family: "Acme", weight: 400, italic: false, format: "ttf" }, { family: "Acme", weight: 700, italic: true, format: "ttf" }, { family: "Flex", weight: [100, 900], italic: false, format: "woff2" }])).toBe(
      "Brand font attached: use family 'Acme' for display type (write family: 'Acme' exactly; loaded weights 400, 700, with italic). Brand font attached: use family 'Flex' for display type (write family: 'Flex' exactly; loaded weight 100–900).",
    );
  });
});

describe("pictures", () => {
  it("counts a GIF's frames and its length", () => {
    const frame = (delay: number) => [0x21, 0xf9, 4, 0, delay & 0xff, delay >> 8, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0];
    const gif = (frames: number[]) => bytes("GIF89a", [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255], [0x21, 0xff, 11], "NETSCAPE2.0", [3, 1, 0, 0, 0], frames, [0x3b]);
    expect(gifInfo(gif([...frame(10), ...frame(25), ...frame(300)]))).toEqual({ frames: 3, duration: 3.35 });
    expect(gifInfo(gif(frame(0)))).toEqual({ frames: 1, duration: 0 });
    expect(gifInfo(bytes("nope"))).toEqual({ frames: 0, duration: 0 });
  });
  const psd = (o: { channels: number; w: number; h: number; depth?: number; mode: number; compression: number; data: number[]; big?: boolean }) =>
    Uint8Array.from([...bytes("8BPS"), ...u16(o.big ? 2 : 1), 0, 0, 0, 0, 0, 0, ...u16(o.channels), ...u32(o.h), ...u32(o.w), ...u16(o.depth ?? 8), ...u16(o.mode), ...u32(0), ...u32(4), 1, 2, 3, 4, ...(o.big ? [...u32(0), ...u32(2)] : u32(2)), 9, 9, ...u16(o.compression), ...o.data]);
  it("reads a PSD's flattened picture: raw RGB, with see-through pixels taken back off white", () => {
    // 2×1: opaque red, then half-transparent blue as Photoshop stores it (blended onto white).
    const p = psdComposite(psd({ channels: 4, w: 2, h: 1, mode: 3, compression: 0, data: [255, 127, 0, 127, 0, 255, 255, 128] }));
    expect([p.width, p.height]).toEqual([2, 1]);
    expect([...p.rgba]).toEqual([255, 0, 0, 255, 0, 0, 255, 128]);
  });
  it("reads PackBits rows, 16-bit samples, greyscale and CMYK, and ignores a fourth channel that hides everything", () => {
    // Grey 3×2, RLE: row 1 = run of 3 × 200; row 2 = literal 1, 2, 3.
    const grey = psdComposite(psd({ channels: 1, w: 3, h: 2, mode: 1, compression: 1, data: [...u16(2), ...u16(4), 0xfe, 200, 2, 1, 2, 3] }));
    expect([...grey.rgba]).toEqual([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255, 1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255]);
    const deep = psdComposite(psd({ channels: 3, w: 1, h: 1, depth: 16, mode: 3, compression: 0, data: [0x12, 0x34, 0xab, 0xcd, 0xff, 0xff] }));
    expect([...deep.rgba]).toEqual([0x12, 0xab, 0xff, 255]);
    const cmyk = psdComposite(psd({ channels: 4, w: 1, h: 1, mode: 4, compression: 0, data: [255, 0, 255, 255], big: true }));
    expect([...cmyk.rgba]).toEqual([255, 0, 255, 255]);
    const masked = psdComposite(psd({ channels: 4, w: 1, h: 1, mode: 3, compression: 0, data: [10, 20, 30, 0] }));
    expect([...masked.rgba]).toEqual([10, 20, 30, 255]);
  });
  it("refuses PSDs it can't read with what to export", () => {
    expect(() => psdComposite(psd({ channels: 3, w: 1, h: 1, depth: 32, mode: 3, compression: 0, data: [] }))).toThrow(/export it as PNG/);
    expect(() => psdComposite(psd({ channels: 3, w: 1, h: 1, mode: 9, compression: 0, data: [] }))).toThrow(/colour mode/);
  });
  it("gives an SVG a size to draw at: from its viewBox, scaled up when small, with a viewBox and namespace", () => {
    expect(sizedSvg('<?xml version="1.0"?>\n<svg viewBox="0 0 48 24" fill="none"><path stroke-width="2" d="M0 0"/></svg>')).toEqual({
      svg: '<?xml version="1.0"?>\n<svg viewBox="0 0 48 24" fill="none" width="1024" height="512" xmlns="http://www.w3.org/2000/svg"><path stroke-width="2" d="M0 0"/></svg>',
      width: 1024,
      height: 512,
    });
    expect(sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="2000px" height=\'1000\'><g/></svg>')!.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000" viewBox="0 0 2000 1000"><g/></svg>');
    expect(sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 2 1"/>')).toMatchObject({ width: 1024, height: 512, svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 2 1"/>' });
    expect(sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" viewBox="0 0 4 1"/>')).toMatchObject({ width: 1024, height: 256 });
    // Nothing to size it by: left as it is.
    expect(sizedSvg("<svg><g/></svg>")).toBeNull();
    expect(sizedSvg("<html></html>")).toBeNull();
  });
});

// A stand-in for an AudioBuffer: clicks on a beat grid, louder (with off-beat hats) after `dropAt`.
function clickTrack(bpm: number, seconds: number, first = 0, dropAt = Infinity, sr = 48000) {
  const d = new Float32Array(Math.round(seconds * sr));
  const click = (t: number, gain: number, len: number) => {
    const at = Math.round(t * sr);
    for (let i = 0; i < len && at + i < d.length; i++) d[at + i] += gain * Math.sin(i * 0.9 + i * i * 0.002) * Math.exp(-i / (len / 5));
  };
  const beat = 60 / bpm;
  for (let k = 0, t = first; t < seconds; t = first + ++k * beat) {
    const loud = t >= dropAt;
    click(t, (loud ? 0.9 : 0.25) * (k % 4 === 0 ? 1 : 0.8), 900);
    if (loud) click(t + beat / 2, 0.5, 300);
  }
  return { sampleRate: sr, length: d.length, duration: seconds, numberOfChannels: 1, getChannelData: () => d } as unknown as AudioBuffer;
}

describe("soundtracks", () => {
  it("measures loudness over time and finds where it lifts and stays up", () => {
    const sr = 1000;
    const d = Float32Array.from({ length: 20 * sr }, (_, i) => (i < 9.6 * sr ? 0.1 : 0.8) * (i % 2 ? 1 : -1));
    const e = loudness([d], sr, 0.05);
    expect(e.length).toBe(400);
    expect(e[0]).toBeCloseTo(0.1, 5);
    expect(e[399]).toBeCloseTo(0.8, 5);
    expect(findDrop(e, 0.05)).toBeCloseTo(9.6, 1);
    // Not inside a film that ends before it, and not in a track that never lifts.
    expect(findDrop(e, 0.05, 8)).toBeNull();
    expect(findDrop(new Array(400).fill(0.5), 0.05)).toBeNull();
    expect(findDrop([0.1, 0.9], 0.05)).toBeNull();
  });
  it("refits a roughly detected tempo to the onsets, off-beats included", () => {
    const beat = 60 / 128.4;
    const hits = Array.from({ length: 120 }, (_, i) => +(0.31 + i * beat * 0.5 + (i % 3 ? 0.004 : -0.004)).toFixed(3)).filter((_, i) => i % 2 === 0 || i % 5 === 0);
    const fit = refineTempo(hits, 130.8)!;
    expect(fit.bpm).toBeCloseTo(128.4, 1);
    expect(Math.abs(fit.phase - 0.31)).toBeLessThan(0.02);
    // Speech: onsets on no grid.
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    expect(refineTempo(Array.from({ length: 60 }, () => rand() * 30).sort((a, b) => a - b), 120)).toBeNull();
    expect(refineTempo([1, 2, 3], 120)).toBeNull();
  });
  it("finds a real track's tempo, first beat and drop, without drifting by the end", () => {
    const buf = clickTrack(126, 32, 0.2, 0.2 + 16 * (60 / 126));
    const grid = detectBeats(buf);
    const t = trackFacts(grid, [buf.getChannelData(0)], buf.sampleRate, buf.duration);
    expect(t.bpm).toBeCloseTo(126, 0);
    expect(Math.abs(t.bpm - 126)).toBeLessThan(0.15);
    expect(t.beats[0]).toBeCloseTo(0.2, 1);
    // The last beat is still on a click.
    const last = t.beats[t.beats.length - 1];
    const k = Math.round((last - 0.2) / (60 / 126));
    expect(Math.abs(last - (0.2 + k * (60 / 126)))).toBeLessThan(0.04);
    expect(dropOf(t, 30)).toBeCloseTo(0.2 + 16 * (60 / 126), 1);
    expect(dropOf(t, 5)).toBeNull();
  }, 20_000);
  const track = { bpm: 128, beats: [0.42, 0.889, 1.358], downbeats: [0.42, 2.295, 9.6], hits: [], duration: 31.2, hop: 0.05, energy: [...new Array(192).fill(0.1), ...new Array(432).fill(0.9)] };
  it("tells the director the tempo to cut to, where the grid starts, where the drop is and how much of the track plays", () => {
    const note = soundtrackNote("night drive.mp3", track, 20);
    expect(note).toMatch(/^Soundtrack attached: “night drive\.mp3”, 128 BPM, first downbeat at 0\.42 s, loudest hit \(the drop\) at 9\.6 s, 31\.2 s long\./);
    expect(note).toContain("cut the film to this exact tempo: 128 BPM");
    expect(note).toContain("a beat is 0.469 s; the 20 s film is 42.7 beats");
    expect(note).toContain("Its first beat lands at 0.42 s, not at 0");
    expect(note).toContain("Put the film's biggest moment on the drop at 9.6 s.");
    expect(note).toContain("it plays the track's first 20 s.");
    expect(note).toMatch(/Do not plan any other music\.$/);
    // A film that ends before the drop isn't told about it; a longer one is told where the track ends.
    expect(soundtrackNote("a.mp3", track, 8)).toContain("no clear drop");
    expect(soundtrackNote("a.mp3", track, 45)).toContain("The track ends at 31.2 s, before the film does");
    expect(soundtrackNote("a.mp3", { ...track, beats: [0.01], downbeats: [0.01] }, 31)).not.toMatch(/not at 0|first 31 s|ends at/);
  });
  it("tells the director about a voiceover, and the composer when a track doesn't fit the length", () => {
    expect(voiceNote("vo.wav", 24.3, 20, true)).toMatch(/^Voiceover attached: “vo\.wav”, 24\.3 s long\..*voiceover-transcript\.txt.*only the first 20 s.*Do not write another voiceover\.$/);
    expect(voiceNote("vo.wav", 12, 20, false)).not.toMatch(/transcript|only the first/);
    expect(lengthHint("song.mp3", 192, 30)).toBe("“song.mp3” is 3:12 long; a 30 s film plays its first 30 s.");
    expect(lengthHint("sting.wav", 6.5, 10)).toBe("“sting.wav” is 6.5 s long; the film's last 3.5 s play without it.");
    expect(lengthHint("fits.wav", 10.2, 10)).toBeNull();
  });
  it("guesses a voice recording from its name", () => {
    expect(["Final_VO_v3.wav", "voiceover.mp3", "narration take 2.m4a", "Interview-Ana.mp3"].map(soundsLikeVoice)).toEqual([true, true, true, true]);
    expect(["nova.mp3", "evolve.wav", "Track 01.flac"].map(soundsLikeVoice)).toEqual([false, false, false]);
  });
});
