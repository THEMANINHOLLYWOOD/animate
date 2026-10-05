import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/prompt";

export const maxDuration = 300;

const client = new Anthropic();

type InFile =
  | { kind: "image"; name: string; mediaType: string; data: string; asset: boolean }
  | { kind: "pdf"; name: string; data: string }
  | { kind: "text"; name: string; text: string };

type Body = {
  prompt: string;
  duration: number;
  aspect: string;
  files: InFile[];
  previousCode?: string;
  error?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const assetNames: string[] = [];
  for (const f of body.files ?? []) {
    if (f.kind === "image") {
      content.push({ type: "text", text: `Image "${f.name}" (${f.asset ? "available as an asset" : "reference only, do not draw it"}):` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: f.mediaType as "image/png", data: f.data },
      });
      if (f.asset) assetNames.push(f.name);
    } else if (f.kind === "pdf") {
      content.push({ type: "document", title: f.name, source: { type: "base64", media_type: "application/pdf", data: f.data } });
    } else {
      content.push({ type: "text", text: `File "${f.name}":\n<file>\n${f.text}\n</file>` });
    }
  }

  const spec = [
    `Length: ${body.duration}s. Aspect: ${body.aspect}.`,
    assetNames.length ? `Available assets (assets.byName): ${assetNames.map((n) => JSON.stringify(n)).join(", ")}.` : "No image assets.",
  ].join("\n");

  if (body.previousCode) {
    content.push({
      type: "text",
      text: `${spec}\n\nCurrent scene:\n\`\`\`js\n${body.previousCode}\n\`\`\`\n\n${
        body.error
          ? `This scene throws at runtime: ${body.error}\nFix it while keeping the design.`
          : `Revise the scene: ${body.prompt}\nKeep everything that the request doesn't ask to change.`
      }`,
    });
  } else {
    content.push({ type: "text", text: `${spec}\n\nBrief:\n${body.prompt}` });
  }

  const encoder = new TextEncoder();
  const send = (c: ReadableStreamDefaultController, obj: unknown) => c.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const s = client.beta.messages.stream(
          {
            model: "claude-opus-5-5",
            max_tokens: 64000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content }],
          },
          { signal: req.signal },
        );
        s.on("text", (delta) => send(controller, { type: "delta", text: delta }));
        const msg = await s.finalMessage();
        if (msg.stop_reason === "refusal") {
          send(controller, { type: "error", message: "Claude declined this request." });
        } else if (msg.stop_reason === "max_tokens") {
          send(controller, { type: "error", message: "The scene ran past the output limit. Try a simpler brief." });
        } else {
          send(controller, { type: "done" });
        }
      } catch (e) {
        const message =
          e instanceof Anthropic.AuthenticationError || (e instanceof Error && /authentication method/i.test(e.message))
            ? "No valid Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local and restart the dev server."
            : e instanceof Anthropic.RateLimitError
              ? "Rate limited. Try again in a moment."
              : e instanceof Anthropic.APIError
                ? `API error ${e.status ?? ""}: ${e.message}`
                : e instanceof Error
                  ? e.message
                  : String(e);
        send(controller, { type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
