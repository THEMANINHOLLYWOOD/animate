import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, MODEL } from "@/lib/anthropic";
import { clip, errorResponse, meterStage, over } from "@/lib/limits";
import { styleById, styleNote } from "@/lib/styles";
import { DIRECTOR_PROMPT, RECREATE_ANIMATOR, RECREATE_DIRECTOR, SYSTEM_PROMPT } from "@/lib/prompt";
import type { BrandKit } from "@/lib/brand";

export const maxDuration = 300;

const client = anthropicClient();

type InFile =
  | { kind: "image"; name: string; mediaType: string; data: string; asset: boolean }
  | { kind: "pdf"; name: string; data: string }
  | { kind: "text"; name: string; text: string };

type Body = {
  stage: "direct" | "animate";
  prompt: string;
  treatment?: string;
  duration: number;
  aspect: string;
  files: InFile[];
  previousCode?: string;
  error?: string;
  brands?: BrandKit[];
  recreate?: boolean;
  history?: { role: "user" | "assistant"; text: string }[];
  notes?: string; // extra instructions for the animator (e.g. elements drawn as separate layers)
  style?: string; // an animation style id from src/lib/styles.ts
  critique?: string; // problems found by the review of rendered stills
  continuation?: string; // text produced so far by a run the time limit cut off
  // A retry after a run that was still thinking at the limit. "none" is low effort plus an
  // instruction to start writing at once (thinking can't be turned off on this model), so text
  // starts early and the client's continuations carry it the rest of the way.
  effortCap?: "none" | "low" | "medium" | "high";
};

// What a caller can put in front of the model, well above anything the Studio sends
// (text attachments are cut to 200k characters there; reference frames are a few dozen images).
const CAP = {
  prompt: 30_000,
  treatment: 150_000,
  notes: 60_000,
  critique: 10_000,
  error: 10_000,
  previousCode: 300_000,
  continuation: 400_000,
  history: 16,
  historyText: 20_000,
  files: 64,
  pdfs: 5,
  fileText: 200_000,
  brands: 6,
  totalText: 1_000_000,
};
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// The request with every field checked and capped, or the reason it was refused.
function readBody(raw: unknown): Body | string {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (b.stage !== "direct" && b.stage !== "animate") return "Unknown stage.";
  const long = (["prompt", "treatment", "notes", "critique", "error", "previousCode", "continuation"] as const).find((k) => over(b[k], CAP[k]));
  if (long) return `The ${long === "previousCode" ? "scene code" : long} is too long (over ${CAP[long].toLocaleString("en")} characters).`;
  const files = Array.isArray(b.files) ? (b.files as InFile[]) : [];
  if (files.length > CAP.files) return `Too many attachments (the limit is ${CAP.files}).`;
  if (files.filter((f) => f?.kind === "pdf").length > CAP.pdfs) return `Too many PDFs (the limit is ${CAP.pdfs}).`;
  const cleanFiles: InFile[] = [];
  for (const f of files) {
    const name = clip(f?.name, 200);
    if (f?.kind === "image") {
      if (!IMAGE_TYPES.includes(f.mediaType) || typeof f.data !== "string") return `"${name}" isn't a supported image.`;
      cleanFiles.push({ kind: "image", name, mediaType: f.mediaType, data: f.data, asset: !!f.asset });
    } else if (f?.kind === "pdf") {
      if (typeof f.data !== "string") return `"${name}" isn't a readable PDF.`;
      cleanFiles.push({ kind: "pdf", name, data: f.data });
    } else if (f?.kind === "text") {
      if (over(f.text, CAP.fileText)) return `"${name}" is too long (over ${CAP.fileText.toLocaleString("en")} characters).`;
      cleanFiles.push({ kind: "text", name, text: clip(f.text, CAP.fileText) });
    } else return "Unknown attachment.";
  }
  const history = (Array.isArray(b.history) ? (b.history as Body["history"])! : [])
    .slice(-CAP.history)
    .map((m) => ({ role: m?.role === "assistant" ? ("assistant" as const) : ("user" as const), text: clip(m?.text, CAP.historyText) }));
  // Brand kits come back from the client; only the fields the notes use, each cut short.
  const brands = (Array.isArray(b.brands) ? (b.brands as Partial<BrandKit>[]) : []).slice(0, CAP.brands).map(
    (k): BrandKit => ({
      url: clip(k?.url, 500),
      host: clip(k?.host, 200),
      name: clip(k?.name, 200),
      description: clip(k?.description, 1000),
      themeColor: clip(k?.themeColor, 40) || null,
      colors: (Array.isArray(k?.colors) ? k.colors : []).slice(0, 8).map((c) => clip(c, 20)),
      fonts: (Array.isArray(k?.fonts) ? k.fonts : []).slice(0, 4).map((f) => clip(f, 80)),
      logo: null,
      icon: null,
      ogImage: null,
    }),
  );
  const body: Body = {
    stage: b.stage,
    prompt: clip(b.prompt, CAP.prompt),
    treatment: clip(b.treatment, CAP.treatment) || undefined,
    duration: Math.min(120, Math.max(1, Number(b.duration) || 10)),
    aspect: clip(b.aspect, 12) || "16:9",
    files: cleanFiles,
    previousCode: clip(b.previousCode, CAP.previousCode) || undefined,
    error: clip(b.error, CAP.error) || undefined,
    brands,
    recreate: !!b.recreate,
    history: history.length ? history : undefined,
    notes: clip(b.notes, CAP.notes) || undefined,
    style: styleById(b.style)?.id,
    critique: clip(b.critique, CAP.critique) || undefined,
    continuation: clip(b.continuation, CAP.continuation) || undefined,
    effortCap: b.effortCap === "none" || b.effortCap === "low" || b.effortCap === "medium" || b.effortCap === "high" ? b.effortCap : undefined,
  };
  const total =
    body.prompt.length +
    [body.treatment, body.notes, body.critique, body.error, body.previousCode, body.continuation].reduce((n, t) => n + (t?.length ?? 0), 0) +
    history.reduce((n, m) => n + m.text.length, 0) +
    cleanFiles.reduce((n, f) => n + (f.kind === "text" ? f.text.length : 0), 0);
  if (total > CAP.totalText) return "This request carries too much text. Try fewer or shorter attachments.";
  return body;
}

// Hobby functions stop at 300s; Pro allows more (set ANIMATE_FUNCTION_SECONDS=780 there).
const LIMIT_MS = (Number(process.env.ANIMATE_FUNCTION_SECONDS) || 285) * 1000;

// How hard the animator thinks has to fit the function limit: on a 5-minute limit a
// 10 s film at medium effort takes ~2.5 min, a 20 s film doesn't fit at all.
// ANIMATE_EFFORT overrides (set it with a longer limit on Pro).
function animatorEffort(duration: number): "low" | "medium" | "high" {
  const forced = process.env.ANIMATE_EFFORT as "low" | "medium" | "high" | undefined;
  if (forced) return forced;
  if (LIMIT_MS >= 600_000) return "high";
  return duration > 12 ? "medium" : "high";
}

// Upstream failures worth retrying: server-side errors, overloads and dropped connections (an
// error event mid-stream arrives as an APIError without a status), never a bad request,
// credentials, credits or a rate limit.
function transient(e: unknown) {
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (!(e instanceof Anthropic.APIError)) return false;
  if (/credit balance/i.test(e.message)) return false;
  return e.status === undefined || e.status >= 500;
}

const EFFORTS = ["low", "medium", "high"] as const;

// Director and recreation breakdowns plan at high effort; the animator writes at high effort, or
// medium for long films on a short limit (cut-off text is continued, so length isn't the risk;
// thinking past the limit is). Repairs and review fixes start from existing code and get at least
// medium. effortCap lowers any of these for a retry after a run that was still thinking when the limit came.
function stageEffort(body: Body): "low" | "medium" | "high" {
  const base =
    body.stage === "direct"
      ? "high"
      : body.error || body.critique
        ? animatorEffort(body.duration) === "low"
          ? "medium"
          : animatorEffort(body.duration)
        : animatorEffort(body.duration);
  const cap = body.effortCap === "none" ? "low" : body.effortCap && EFFORTS.includes(body.effortCap) ? body.effortCap : "high";
  return EFFORTS[Math.min(EFFORTS.indexOf(base), EFFORTS.indexOf(cap))];
}

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+|\b(?:[a-z0-9-]+\.)+(?:com|io|ai|app|co|org|net|dev|so|xyz|tech|studio|design)\b(?:\/[^\s<>()"']*)?/gi;

function brandNotes(brands: BrandKit[]) {
  return brands
    .map((b) =>
      [
        `Brand kit read from ${b.url}:`,
        `- Name: ${b.name}`,
        b.description && `- Says about itself: ${b.description}`,
        b.themeColor && `- Theme colour: ${b.themeColor}`,
        b.colors.length && `- Most used colours on the site (by frequency): ${b.colors.join(", ")}`,
        b.fonts.length && `- Site fonts: ${b.fonts.join(", ")} (approximate with serif / sans / mono)`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("base64url");

// A stage is everything a request carries except where it resumes from and how hard it
// thinks: the client resends exactly that for every part of a long answer. A film's stages
// all share its brief, length, aspect and kind.
const stageId = (body: Body) => hash({ ...body, continuation: undefined, effortCap: undefined });
const filmId = (body: Body) => hash([body.prompt, body.duration, body.aspect, body.recreate]);

export async function POST(req: Request) {
  // Anyone can create: no sign-in needed to generate, but every caller is metered and capped.
  const body = readBody(await req.json().catch(() => null));
  if (typeof body === "string") return errorResponse(body, 400);
  // Every request is one part, recorded when it's admitted (nothing is held back, so a film
  // that is stopped or abandoned has spent only what it ran). A new stage needs room for a few
  // parts; the parts of a long answer and its lighter retries come back on passes this route
  // leaves when it cuts one short, and they and the film's later stages may run a bounded way
  // past the limit, so a film that has started can finish. A request claiming to resume without
  // a pass is metered like any other, so the claim can't buy anything.
  const stage = await meterStage(req, { stageId: stageId(body), filmId: filmId(body), resumeFrom: body.continuation ?? "" });
  if (stage.limited) return stage.limited;

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const assetNames: string[] = [];
  for (const f of body.files ?? []) {
    if (f.kind === "image") {
      content.push({ type: "text", text: `Image "${f.name}" (${f.asset ? "available as an asset to draw" : "reference only: inform the style, do not draw it"}):` });
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType as "image/png", data: f.data } });
      if (f.asset) assetNames.push(f.name);
    } else if (f.kind === "pdf") {
      content.push({ type: "document", title: f.name, source: { type: "base64", media_type: "application/pdf", data: f.data } });
    } else {
      content.push({ type: "text", text: `File "${f.name}":\n<file>\n${f.text}\n</file>` });
    }
  }

  const spec = [
    `Length: ${body.duration}s. Aspect: ${body.aspect}.`,
    assetNames.length ? `Available image assets (assets.byName): ${assetNames.map((n) => JSON.stringify(n)).join(", ")}.` : "No image assets.",
  ].join("\n");

  let system: string;
  if (body.stage === "direct") {
    system = DIRECTOR_PROMPT;
    content.push({
      type: "text",
      text: body.previousCode
        ? `${spec}\n\nThe film currently exists as this scene:\n\`\`\`js\n${body.previousCode}\n\`\`\`\n\nWrite a revised treatment that applies this change request while keeping what works: ${body.prompt}`
        : `${spec}\n\nBrief:\n${body.prompt}`,
    });
    if (body.brands?.length) content.push({ type: "text", text: brandNotes(body.brands) });
    if (body.recreate) content.push({ type: "text", text: RECREATE_DIRECTOR });
    else if (styleById(body.style)) content.push({ type: "text", text: styleNote(styleById(body.style)!) });
  } else {
    system = SYSTEM_PROMPT;
    const treatment = body.treatment ? `\n\nTreatment:\n${body.treatment}` : "";
    if (body.previousCode) {
      content.push({
        type: "text",
        text: `${spec}${treatment}\n\nCurrent scene:\n\`\`\`js\n${body.previousCode}\n\`\`\`\n\n${
          body.error
            ? `This scene throws at runtime: ${body.error}\nFix it while keeping the design.`
            : body.critique
              ? `A motion director reviewed stills of this scene and found these problems:\n${body.critique}\n\nFix each one precisely (the element, the time, the change). Keep everything else exactly as it is: same concept, same copy, same timing elsewhere.`
            : `${body.history?.length ? `Conversation so far:\n${body.history.map((m) => `${m.role === "user" ? "User" : "animate"}: ${m.text}`).join("\n")}\n\n` : ""}Revise the scene: ${body.prompt}\nKeep everything the request doesn't ask to change.`
        }`,
      });
    } else {
      content.push({ type: "text", text: `${spec}\n\nOriginal brief:\n${body.prompt}${treatment}\n\nBuild this film.` });
    }
    if (body.brands?.length) content.push({ type: "text", text: brandNotes(body.brands) });
    if (body.recreate) content.push({ type: "text", text: RECREATE_ANIMATOR });
    else if (styleById(body.style)) content.push({ type: "text", text: styleNote(styleById(body.style)!) });
    if (body.notes) content.push({ type: "text", text: body.notes });
  }

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, obj: unknown) => c.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      // Hobby-plan functions stop at 300s; end cleanly a little before that.
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), LIMIT_MS);
      // Keep the connection alive through long silent stretches (thinking).
      const ping = setInterval(() => {
        try {
          send(controller, { type: "ping" });
        } catch {}
      }, 15_000);
      const signal = AbortSignal.any([req.signal, deadline.signal]);
      let acc = "";
      // Out of time (or output) is never the end of a film: text written so far comes back to be
      // continued, and a run still thinking tells the client to retry at lower effort. The pass
      // for that follow-up goes down before the event, so the request the event sets off finds it.
      const cutShort = async () => {
        await stage.leave((body.continuation ?? "") + (acc.trim() ? acc : ""));
        send(controller, acc.trim() ? { type: "partial", text: acc } : { type: "timeout", effort: body.effortCap === "none" ? "none" : stageEffort(body) });
      };
      try {
        // The director researches any company or link in the brief with web search + fetch.
        // A continuation already has its research in the text it carries.
        const research = body.stage === "direct" && !body.recreate && !body.continuation && (!!body.prompt.match(URL_RE) || !!body.brands?.length || /\b(company|startup|brand|website|site)\b/i.test(body.prompt));
        const tools: Anthropic.Beta.BetaToolUnion[] = research
          ? [
              { type: "web_search_20260209", name: "web_search", max_uses: 6 },
              { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
            ]
          : [];
        if (body.effortCap === "none")
          content.push({ type: "text", text: "Time is short: the last attempt ran out of time while still planning. Start writing the answer right away and keep any planning to a few lines." });
        const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
        if (body.continuation) {
          // Resume a cut-off run: replay what was produced and ask for the rest only.
          const tail = body.continuation.slice(-240);
          messages.push({ role: "assistant", content: body.continuation });
          messages.push({
            role: "user",
            content: `Your previous message was cut off by a time limit. Continue from exactly where it stopped. It currently ends with:\n<<<\n${tail}\n>>>\nOutput only the remaining text, starting with the very next character. Do not repeat anything, do not add a preamble, and finish it${body.stage === "animate" ? " (close the code block)" : ""}.`,
          });
        }
        let msg: Anthropic.Beta.BetaMessage;
        for (let turn = 0; ; turn++) {
          const s = client.beta.messages.stream(
            {
              model: MODEL,
              max_tokens: 64000,
              thinking: { type: "adaptive", display: "summarized" },
              // Effort per stage: see stageEffort.
              output_config: { effort: stageEffort(body) },
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
              messages,
              ...(tools.length ? { tools } : {}),
            },
            { signal },
          );
          s.on("text", (delta) => {
            acc += delta;
            send(controller, { type: "delta", text: delta });
          });
          // Summarised reasoning, shown in the progress panel so users can watch Claude think.
          s.on("thinking", (delta) => send(controller, { type: "thinking", text: delta }));
          s.on("contentBlock", (block) => {
            if (block.type !== "server_tool_use") return;
            const input = block.input as { query?: string; url?: string };
            // Anything written before a tool call is scratch work, not the treatment.
            acc = "";
            send(controller, { type: "reset" });
            send(controller, {
              type: "status",
              text: block.name === "web_search" ? `Searching “${input.query ?? ""}”` : `Reading ${(input.url ?? "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}`,
            });
          });
          msg = await s.finalMessage();
          if (msg.stop_reason !== "pause_turn" || turn >= 4) break;
          // Resume a paused server-tool turn: resend the assistant content so far.
          const prior = messages[1]?.content;
          messages.splice(1, 1, { role: "assistant", content: [...(Array.isArray(prior) ? prior : []), ...msg.content] as Anthropic.Beta.BetaContentBlockParam[] });
        }
        if (msg.stop_reason === "refusal") {
          send(controller, { type: "error", message: "Claude declined this request." });
        } else if (msg.stop_reason === "max_tokens") {
          // One answer's output cap is no more the end of a long film than the time limit is.
          await cutShort();
        } else {
          send(controller, { type: "done" });
        }
      } catch (e) {
        if (deadline.signal.aborted && !req.signal.aborted) {
          await cutShort();
          return;
        }
        // A passing failure on Anthropic's side (overloaded, "unable to complete", a dropped
        // upstream connection) doesn't end the film either: text so far comes back to be
        // continued, or the client retries the part after a pause.
        if (!req.signal.aborted && transient(e)) {
          console.warn(`[generate] transient upstream error, handing back ${acc.length} chars: ${(e as Error).message.slice(0, 160)}`);
          await stage.leave((body.continuation ?? "") + (acc.trim() ? acc : ""));
          send(controller, acc.trim() ? { type: "partial", text: acc } : { type: "retry" });
          return;
        }
        // The client went away: its one retry of this part may come back. Any other failure
        // ends the stage (the client shows it rather than retrying), so it leaves no pass.
        if (req.signal.aborted) await stage.leave(body.continuation ?? "", true);
        const message = deadline.signal.aborted
          ? `This one took longer than the ${Math.round(LIMIT_MS / 60000)}-minute limit this plan allows. Try a shorter film (under 15 s works reliably), a simpler brief, or a longer limit (Vercel Pro).`
          : e instanceof Anthropic.AuthenticationError || (e instanceof Error && /authentication method/i.test(e.message))
            ? process.env.VERCEL
              ? "The server's Anthropic API key was rejected. Replace ANTHROPIC_API_KEY in the Vercel project settings and redeploy."
              : "No valid Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local and restart the dev server."
            : e instanceof Anthropic.RateLimitError
              ? "Rate limited. Try again in a moment."
              : e instanceof Anthropic.APIError && /credit balance/i.test(e.message)
                ? "The Anthropic account is out of credits. Add credits under Plans & Billing at console.anthropic.com."
                : e instanceof Anthropic.APIError
                  ? `API error ${e.status ?? ""}: ${e.message}`
                  : e instanceof Error
                    ? e.message
                    : String(e);
        send(controller, { type: "error", message });
      } finally {
        clearTimeout(timer);
        clearInterval(ping);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
