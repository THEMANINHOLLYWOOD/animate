// Stem separation with Meta's SAM Audio, hosted on fal.ai.
//   GET                                              -> { available }
//   POST multipart audio=<wav ≤ 4 MB> prompts=["speech","music","sound effects"]
//                                                    -> { stems: [{ prompt, url } | { prompt, error }] }
// One prompt per call (target + residual); the calls run in parallel.
// The stems come back as fal-hosted URLs the browser downloads.

export const maxDuration = 300;

const FAL = "https://fal.run/fal-ai/sam-audio/separate";
const key = () => process.env.FAL_KEY ?? "";

export async function GET() {
  return Response.json({ available: !!key() });
}

export async function POST(req: Request) {
  if (!key()) return Response.json({ error: "Stem separation isn't set up (FAL_KEY is missing)." }, { status: 503 });
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return Response.json({ error: "No audio attached." }, { status: 400 });
  let prompts: string[] = [];
  try {
    prompts = (JSON.parse(String(form.get("prompts") ?? "[]")) as unknown[]).map(String).filter(Boolean).slice(0, 5);
  } catch {}
  if (!prompts.length) return Response.json({ error: "No prompts." }, { status: 400 });

  // fal takes the audio inline as a data URI (no public upload needed).
  const bytes = Buffer.from(await audio.arrayBuffer());
  const audio_url = `data:${audio.type || "audio/wav"};base64,${bytes.toString("base64")}`;

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
