import { anthropicClient } from "@/lib/anthropic";
import { clip, limit } from "@/lib/limits";
import { SOUND_PLAN_SCHEMA as SCHEMA, SOUND_PLAN_SYSTEM as SYSTEM } from "@/lib/soundPlan";

export const maxDuration = 120;

// Turns a film (its treatment, copy and timing) into a sound plan: a voiceover
// script, a music brief and a cue list of sound effects, each placed on the
// timeline as a fraction of the film. Strict JSON so the client can act on it.

export async function POST(req: Request) {
  const limited = await limit(req, "audio-plan");
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) ?? {};
  const duration = Math.min(120, Math.max(1, Number(b.duration) || 10));
  // Every field is cut to a cap well above what the Studio sends.
  const parts = [
    `Film length: ${duration}s. Aspect: ${clip(b.aspect, 12) || "16:9"}.`,
    b.recreate ? `RECREATION MODE${b.hasBackground ? " (a background stem from the original exists)" : ""}.` : "",
    b.brief ? `Brief:\n${clip(b.brief, 30_000)}` : "",
    b.treatment ? `Treatment:\n${clip(b.treatment, 150_000)}` : "",
    b.transcript ? `Transcript of the reference audio with word timings (seconds):\n${clip(b.transcript, 60_000)}` : "",
    b.copy ? `On-screen copy in order:\n${clip(b.copy, 30_000)}` : "",
    clip(b.grid, 5000),
    clip(b.rebuild, 10_000),
  ].filter(Boolean);
  const ask = async (effort: "medium" | "high") => {
    const r = await anthropicClient().messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });
    const text = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const plan = JSON.parse(text);
    // Drop unusable cues; the generator rejects empty prompts.
    plan.sfx = (plan.sfx ?? []).filter((c: { prompt?: string }) => c.prompt?.trim());
    plan.voice = (plan.voice ?? []).filter((v: { text?: string }) => v.text?.trim());
    console.log(`[sound-plan] effort=${effort} stop=${r.stop_reason} out=${r.usage.output_tokens} voice=${plan.voice.length} sfx=${plan.sfx.length} music=${!!plan.music} notes=${JSON.stringify(String(plan.notes ?? "").slice(0, 80))}`);
    return plan;
  };
  try {
    let plan = await ask("medium");
    if (!plan.sfx.length && !plan.voice.length) plan = await ask("high");
    return Response.json(plan);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
