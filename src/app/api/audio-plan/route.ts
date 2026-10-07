import { anthropicClient } from "@/lib/anthropic";
import { requireUser, unauthorized } from "@/lib/store";
import { SOUND_PLAN_SCHEMA as SCHEMA, SOUND_PLAN_SYSTEM as SYSTEM } from "@/lib/soundPlan";

export const maxDuration = 120;

// Turns a film (its treatment, copy and timing) into a sound plan: a voiceover
// script, a music brief and a cue list of sound effects, each placed on the
// timeline as a fraction of the film. Strict JSON so the client can act on it.

export async function POST(req: Request) {
  if (!(await requireUser())) return unauthorized();
  const b = await req.json();
  const duration = Number(b.duration) || 10;
  const parts = [
    `Film length: ${duration}s. Aspect: ${b.aspect ?? "16:9"}.`,
    b.recreate ? `RECREATION MODE${b.hasBackground ? " (a background stem from the original exists)" : ""}.` : "",
    b.brief ? `Brief:\n${b.brief}` : "",
    b.treatment ? `Treatment:\n${b.treatment}` : "",
    b.transcript ? `Transcript of the reference audio with word timings (seconds):\n${b.transcript}` : "",
    b.copy ? `On-screen copy in order:\n${b.copy}` : "",
  ].filter(Boolean);
  try {
    const r = await anthropicClient().messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    const text = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    return Response.json(JSON.parse(text));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
