import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, MODEL } from "@/lib/anthropic";
import { clip, errorResponse, limit } from "@/lib/limits";
import { ELEMENTS_SCHEMA, ELEMENTS_SYSTEM, type ElementsPlan } from "@/lib/elements";

export const maxDuration = 300;

// Strip a video into editable elements from its breakdown and sampled frames.
// Body: { breakdown, duration, aspect, w, h, files: [{kind:"image", name, mediaType, data}, {kind:"text", name, text}] }
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_FILES = 64; // reference frames (up to 32) plus the brief's own images
const MAX_TEXT = 200_000;

export async function POST(req: Request) {
  const limited = await limit(req, "elements");
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) ?? {};
  const files = (Array.isArray(b.files) ? b.files : []) as { kind: string; name: string; mediaType: string; data: string; text: string }[];
  if (files.length > MAX_FILES) return errorResponse(`Too many frames (the limit is ${MAX_FILES}).`, 400);
  const content: Anthropic.ContentBlockParam[] = [];
  for (const f of files) {
    if (f?.kind === "image") {
      if (!IMAGE_TYPES.includes(f.mediaType) || typeof f.data !== "string") return errorResponse("Unsupported frame image.", 400);
      content.push({ type: "text", text: `Frame "${clip(f.name, 200)}":` });
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType as "image/png", data: f.data } });
    } else if (f?.kind === "text") content.push({ type: "text", text: `File "${clip(f.name, 200)}":\n${clip(f.text, MAX_TEXT)}` });
  }
  const num = (v: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Number(v) || d));
  content.push({
    type: "text",
    text: `Frame size: ${num(b.w, 16, 8192, 1920)}×${num(b.h, 16, 8192, 1080)} px (${clip(b.aspect, 12)}). Film length: ${num(b.duration, 1, 120, 10)}s.\n\nShot-by-shot breakdown:\n${clip(b.breakdown, 150_000)}\n\nList every element.`,
  });
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 280_000);
  try {
    const stream = anthropicClient().messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: ELEMENTS_SCHEMA } },
        system: ELEMENTS_SYSTEM,
        messages: [{ role: "user", content }],
      },
      { signal: AbortSignal.any([req.signal, deadline.signal]) },
    );
    const r = await stream.finalMessage();
    const text = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const plan = JSON.parse(text) as ElementsPlan;
    console.log(`[elements] stop=${r.stop_reason} out=${r.usage.output_tokens} elements=${plan.elements.length}`);
    return Response.json(plan);
  } catch (e) {
    const message = deadline.signal.aborted ? "Extracting the elements took longer than the 5-minute limit." : (e as Error).message;
    return Response.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
