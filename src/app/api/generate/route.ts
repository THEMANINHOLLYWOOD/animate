import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic";
import { DIRECTOR_PROMPT, RECREATE_ANIMATOR, RECREATE_DIRECTOR, SYSTEM_PROMPT } from "@/lib/prompt";
import { requireUser } from "@/lib/store";
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
};

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

export async function POST(req: Request) {
  // The API key is shared, so generation is limited to signed-in users.
  const userId = await requireUser();
  if (!userId) return Response.json({ error: "Sign in to create animations." }, { status: 401 });

  const body = (await req.json()) as Body;

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
  } else {
    system = SYSTEM_PROMPT;
    const treatment = body.treatment ? `\n\nTreatment:\n${body.treatment}` : "";
    if (body.previousCode) {
      content.push({
        type: "text",
        text: `${spec}${treatment}\n\nCurrent scene:\n\`\`\`js\n${body.previousCode}\n\`\`\`\n\n${
          body.error
            ? `This scene throws at runtime: ${body.error}\nFix it while keeping the design.`
            : `${body.history?.length ? `Conversation so far:\n${body.history.map((m) => `${m.role === "user" ? "User" : "animate"}: ${m.text}`).join("\n")}\n\n` : ""}Revise the scene: ${body.prompt}\nKeep everything the request doesn't ask to change.`
        }`,
      });
    } else {
      content.push({ type: "text", text: `${spec}\n\nOriginal brief:\n${body.prompt}${treatment}\n\nBuild this film.` });
    }
    if (body.brands?.length) content.push({ type: "text", text: brandNotes(body.brands) });
    if (body.recreate) content.push({ type: "text", text: RECREATE_ANIMATOR });
  }

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, obj: unknown) => c.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      // Hobby-plan functions stop at 300s; end cleanly a little before that.
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), 285_000);
      const signal = AbortSignal.any([req.signal, deadline.signal]);
      try {
        // The director researches any company or link in the brief with web search + fetch.
        const research = body.stage === "direct" && !body.recreate && (!!body.prompt.match(URL_RE) || !!body.brands?.length || /\b(company|startup|brand|website|site)\b/i.test(body.prompt));
        const tools: Anthropic.Beta.BetaToolUnion[] = research
          ? [
              { type: "web_search_20260209", name: "web_search", max_uses: 6 },
              { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
            ]
          : [];
        const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
        let msg: Anthropic.Beta.BetaMessage;
        for (let turn = 0; ; turn++) {
          const s = client.beta.messages.stream(
            {
              model: "claude-opus-5-5",
              max_tokens: 64000,
              thinking: { type: "adaptive", display: "summarized" },
              // Director plans at high effort (~1 min); the animator writes code at medium
              // so a full film fits inside the function time limit.
              // ANIMATE_EFFORT=high gives richer films but needs a longer function limit (Vercel Pro).
              output_config: { effort: body.stage === "direct" ? "high" : ((process.env.ANIMATE_EFFORT as "medium" | "high") || "medium") },
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
              messages,
              ...(tools.length ? { tools } : {}),
            },
            { signal },
          );
          s.on("text", (delta) => send(controller, { type: "delta", text: delta }));
          // Summarised reasoning, shown in the progress panel so users can watch Claude think.
          s.on("thinking", (delta) => send(controller, { type: "thinking", text: delta }));
          s.on("contentBlock", (block) => {
            if (block.type !== "server_tool_use") return;
            const input = block.input as { query?: string; url?: string };
            // Anything written before a tool call is scratch work, not the treatment.
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
          send(controller, { type: "error", message: "The output ran past the limit. Try a simpler brief." });
        } else {
          send(controller, { type: "done" });
        }
      } catch (e) {
        const message = deadline.signal.aborted
          ? "This one took longer than the 5-minute limit. Try again, or shorten the brief or the film length."
          : e instanceof Anthropic.AuthenticationError || (e instanceof Error && /authentication method/i.test(e.message))
            ? "No valid Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local and restart the dev server."
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
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
