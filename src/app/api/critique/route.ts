import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient } from "@/lib/anthropic";
import { clip, errorResponse, limit } from "@/lib/limits";

export const maxDuration = 120;

// Claude watches its own frames: a contact sheet and a phone-width strip,
// scored like a harsh motion director, with the three worst problems to fix.

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "problems", "verdict"],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["hook", "readability", "motion", "variety", "composition", "brand", "sound"],
      properties: {
        hook: { type: "integer", description: "1-10: does the first 2 seconds grab?" },
        readability: { type: "integer", description: "1-10: every line readable at phone width, nothing overlapping or clipped" },
        motion: { type: "integer", description: "1-10: motion quality: eased, purposeful, no pops or dead frames" },
        variety: { type: "integer", description: "1-10: something new every 2-4 seconds" },
        composition: { type: "integer", description: "1-10: hierarchy, spacing, safe margins, no corner labels or frame borders" },
        brand: { type: "integer", description: "1-10: matches the brief, references and palette" },
        sound: { type: "integer", description: "1-10: cues land on the key actions (judge from the cue timeline given)" },
      },
    },
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t", "issue", "fix"],
        properties: {
          t: { type: "number", description: "Film time in seconds where it shows" },
          issue: { type: "string", description: "What is wrong, concretely (what overlaps what, what is too small, what pops)" },
          fix: { type: "string", description: "The specific change to make in the scene" },
        },
      },
    },
    verdict: { type: "string", description: "One sentence for the user" },
  },
};

const SYSTEM = `You are a harsh motion director reviewing stills of a film rendered from code, not a proud author. You are given a contact sheet (frames in order, each labelled with its time), a strip of the same frames at phone width, the treatment the film was built from, and the sound cue timeline.

Score 1-10 on: hook in the first 2 s · readability at phone size · motion quality (springs, no dead frames, no pops between adjacent frames) · variety (a new thing every 2-4 s) · composition · brand accuracy · sound sync.

List the 3 biggest problems with timestamps. Hunt specifically for: text overlapping other text or shapes, text clipped at the frame edge or cut off, type too small to read at phone width, a centred-title-on-gradient shot, labels in the corners or frame borders, everything fading in, a dead beat where nothing happens, elements that jump between frames instead of easing, a blurry or empty frame, copy that differs from the treatment, the final frame not holding the payoff.

Be concrete: say which element, where, at what time, and exactly what to change. If the film is genuinely strong, say so and give fewer problems. Never invent problems to fill the list.`;

export async function POST(req: Request) {
  const limited = await limit(req, "critique");
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) ?? {};
  // The Studio sends two sheets (a contact sheet and a phone strip).
  const images = (Array.isArray(b.images) ? b.images : []) as { name: string; data: string }[];
  if (!images.length || images.length > 4 || images.some((img) => typeof img?.data !== "string")) return errorResponse("Send one to four frame sheets.", 400);
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of images) {
    content.push({ type: "text", text: `${clip(img.name, 100)}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.data } });
  }
  const duration = Math.min(120, Math.max(1, Number(b.duration) || 10));
  content.push({
    type: "text",
    text: [`Film: ${duration}s, ${clip(b.aspect, 12)}.`, b.treatment ? `Treatment:\n${clip(b.treatment, 6000)}` : "", b.cues ? `Sound cues: ${clip(b.cues, 6000)}` : "No sound cues yet.", "Review the frames."].filter(Boolean).join("\n\n"),
  });
  try {
    const r = await anthropicClient().messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    const text = r.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    const out = JSON.parse(text);
    console.log(`[critique] ${JSON.stringify(out.scores)} problems=${out.problems.length}`);
    return Response.json(out);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
