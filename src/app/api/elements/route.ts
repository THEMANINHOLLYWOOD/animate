import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic";
import { ELEMENTS_SCHEMA, ELEMENTS_SYSTEM, type ElementsPlan } from "@/lib/elements";
import { requireUser, unauthorized } from "@/lib/store";

export const maxDuration = 300;

// Strip a video into editable elements from its breakdown and sampled frames.
// Body: { breakdown, duration, aspect, w, h, files: [{kind:"image", name, mediaType, data}, {kind:"text", name, text}] }
export async function POST(req: Request) {
  if (!(await requireUser())) return unauthorized();
  const b = await req.json();
  const content: Anthropic.ContentBlockParam[] = [];
  for (const f of b.files ?? []) {
    if (f.kind === "image") {
      content.push({ type: "text", text: `Frame "${f.name}":` });
      content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
    } else if (f.kind === "text") content.push({ type: "text", text: `File "${f.name}":\n${f.text}` });
  }
  content.push({
    type: "text",
    text: `Frame size: ${b.w}×${b.h} px (${b.aspect}). Film length: ${b.duration}s.\n\nShot-by-shot breakdown:\n${b.breakdown}\n\nList every element.`,
  });
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 280_000);
  try {
    const stream = anthropicClient().messages.stream(
      {
        model: "claude-opus-5-5",
        max_tokens: 32000,
        output_config: { effort: "high", format: { type: "json_schema", schema: ELEMENTS_SCHEMA } },
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
