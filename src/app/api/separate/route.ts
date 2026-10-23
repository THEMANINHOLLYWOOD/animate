import { createFalClient } from "@fal-ai/client";
import { errorResponse, limit } from "@/lib/limits";
import { canonicalWav } from "@/lib/media";

// Stem separation with Meta's SAM Audio, hosted on fal.ai.
//   GET                                              -> { available }
//   POST multipart audio=<wav ≤ 120 s> prompts=["speech","music","sound effects"]
//                                                    -> { stems: [{ prompt, url } | { prompt, error }] }
// One prompt per call (target + residual); the calls run in parallel.
// The audio goes to fal's storage once and every job reads it from there (fal refuses a data URI
// of a few MB as "URL too long"); the stems come back as fal-hosted URLs the browser downloads.
// Each prompt is a billed job on the whole file, so only the three stems the Studio
// uses are accepted, and only uncompressed WAV whose length the header proves.

export const maxDuration = 300;
const PROMPTS = ["speech", "music", "sound effects"];
const MAX_AUDIO_SECONDS = 120;

const FAL = "https://fal.run/fal-ai/sam-audio/separate";
const key = () => process.env.FAL_KEY ?? "";

export async function GET() {
  return Response.json({ available: !!key() });
}

export async function POST(req: Request) {
  if (!key()) return Response.json({ error: "Stem separation isn't set up (FAL_KEY is missing)." }, { status: 503 });
  const limited = await limit(req, "separate");
  if (limited) return limited;
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return Response.json({ error: "No audio attached." }, { status: 400 });
  let prompts: string[] = [];
  try {
    const asked = JSON.parse(String(form.get("prompts") ?? "[]"));
    prompts = PROMPTS.filter((p) => Array.isArray(asked) && asked.includes(p));
  } catch {}
  if (!prompts.length) return Response.json({ error: `No prompts (choose from ${PROMPTS.join(", ")}).` }, { status: 400 });

  // The measured audio rebuilt as a plain WAV, so each job runs on exactly the length checked here.
  const wav = canonicalWav(new Uint8Array(await audio.arrayBuffer()));
  if (!wav) return Response.json({ error: "Send the audio as an uncompressed WAV." }, { status: 415 });
  if (wav.info.seconds > MAX_AUDIO_SECONDS) return errorResponse(`That audio is ${Math.round(wav.info.seconds)} s long; the limit is ${MAX_AUDIO_SECONDS} s.`, 413);
  const bytes = Buffer.from(wav.wav.buffer);
  let audio_url: string;
  try {
    audio_url = await createFalClient({ credentials: key() }).storage.upload(new Blob([bytes], { type: "audio/wav" }));
  } catch (e) {
    console.error(`[separate] upload failed: ${(e as Error).message}`);
    return errorResponse("Couldn't hand the audio to the stem separator. Try again.", 502);
  }

  const stems = await Promise.all(
    prompts.map(async (prompt) => {
      try {
        const r = await fetch(FAL, {
          method: "POST",
          headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ audio_url, prompt, output_format: "wav", acceleration: "balanced" }),
          signal: AbortSignal.any([req.signal, AbortSignal.timeout(280_000)]),
        });
        const text = await r.text();
        if (!r.ok) {
          console.error(`[separate] ${prompt}: ${r.status} ${text.slice(0, 300)}`);
          return { prompt, error: r.status === 401 || r.status === 403 ? "The fal.ai key was rejected." : `fal.ai returned ${r.status}.` };
        }
        const j = JSON.parse(text) as { target?: { url?: string } };
        if (!j.target?.url) return { prompt, error: "No stem came back." };
        return { prompt, url: j.target.url };
      } catch (e) {
        return { prompt, error: (e as Error).name === "TimeoutError" ? "Separation timed out." : (e as Error).message };
      }
    }),
  );
  console.log(`[separate] ${(bytes.length / 1e6).toFixed(2)}MB · ${stems.map((s) => `${s.prompt}:${"url" in s ? "ok" : s.error}`).join(" · ")}`);
  return Response.json({ stems });
}
