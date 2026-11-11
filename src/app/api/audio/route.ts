import { errorResponse, limit, within } from "@/lib/limits";
import { canonicalWav } from "@/lib/media";

// ElevenLabs bridge. The key stays server-side; results stream straight back.
//   POST multipart  action=isolate      audio=<wav ≤ 120 s>     -> audio/mpeg (voice only)
//   POST multipart  action=transcribe   audio=<wav ≤ 120 s>     -> { text, words:[{w,s,e}] }
//   POST json       action=sfx          { prompt, seconds }     -> audio/mpeg
//   POST json       action=tts          { text, voice? }        -> { audio (base64 mp3), words:[{w,s,e}] }
//   POST json       action=music        { prompt, seconds ≤ 120 } -> audio/mpeg (paid plans)
//   GET  ?voices=1                                              -> { voices:[{id,name,labels}] }
// Isolation and transcription bill per minute of input, so only uncompressed WAV is taken
// (its length is exact from the header) and nothing longer than the longest film plus slack.

export const maxDuration = 120;
const MAX_AUDIO_SECONDS = 120;
const MAX_MUSIC_MS = 120_000;
const JSON_GROUPS = { sfx: "sfx", tts: "voice", music: "music" } as const;
const EL = "https://api.elevenlabs.io/v1";
const key = () => process.env.ELEVENLABS_API_KEY ?? "";

const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George (premade, available on every plan)

// The account can't pay for this (no credits left, or a plan that doesn't include it): trying again won't help.
const cantPay = (status: number, body: string) => status === 402 || /paid_plan_required|limited_access|quota_exceeded|character_limit/i.test(body);

function elError(status: number, body: string) {
  if (status === 402 || /paid_plan_required|limited_access/.test(body)) return "This needs a paid ElevenLabs plan.";
  // (A used-up quota comes back as a 401 too, so it's read before the key is blamed.)
  if (/quota|character_limit|exceeded/i.test(body)) return "The ElevenLabs credits for this month are used up.";
  if (status === 401) return "The ElevenLabs key was rejected.";
  try {
    const d = JSON.parse(body);
    return d?.detail?.message ?? d?.detail ?? `ElevenLabs returned ${status}.`;
  } catch {
    return `ElevenLabs returned ${status}.`;
  }
}

async function passthrough(res: Response) {
  if (!res.ok) {
    const body = await res.text();
    console.error(`[elevenlabs] ${res.status} ${body.slice(0, 300)}`);
    return Response.json({ error: elError(res.status, body) }, { status: cantPay(res.status, body) ? 402 : 502 });
  }
  return new Response(res.body, { headers: { "Content-Type": res.headers.get("content-type") ?? "audio/mpeg" } });
}

type Char = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

// Character alignment -> word timings.
function wordsFromAlignment(a: Char | null) {
  if (!a) return [];
  const out: { w: string; s: number; e: number }[] = [];
  let w = "", s = 0, e = 0;
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (w) out.push({ w, s, e });
      w = "";
    } else {
      if (!w) s = a.character_start_times_seconds[i];
      w += c;
      e = a.character_end_times_seconds[i];
    }
  });
  if (w) out.push({ w, s, e });
  return out;
}

export async function POST(req: Request) {
  if (!key()) return Response.json({ error: "ELEVENLABS_API_KEY is not set." }, { status: 503 });
  // Stopping a build stops the provider call, and a slow one ends inside the function's own limit.
  const signal = within(req, 110_000);
  try {
    return await handle(req, signal);
  } catch (e) {
    if (req.signal.aborted) return errorResponse("Stopped.", 499);
    const timedOut = (e as Error).name === "TimeoutError" || signal.aborted;
    console.error(`[elevenlabs] ${(e as Error).message}`);
    return errorResponse(timedOut ? "The sound took too long to make. Try again." : "Couldn't reach the sound service. Try again.", timedOut ? 504 : 502);
  }
}

async function handle(req: Request, signal: AbortSignal) {
  const H = { "xi-api-key": key() };
  const ct = req.headers.get("content-type") ?? "";

  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return errorResponse("Couldn't read the upload.", 400);
    const action = String(form.get("action") ?? "");
    if (action !== "isolate" && action !== "transcribe") return Response.json({ error: "Unknown action." }, { status: 400 });
    const limited = await limit(req, "speech");
    if (limited) return limited;
    const file = form.get("audio");
    if (!(file instanceof Blob)) return Response.json({ error: "No audio attached." }, { status: 400 });
    // The measured audio rebuilt as a plain WAV, so ElevenLabs bills exactly the length checked here.
    const wav = canonicalWav(new Uint8Array(await file.arrayBuffer()));
    if (!wav) return Response.json({ error: "Send the audio as an uncompressed WAV." }, { status: 415 });
    if (wav.info.seconds > MAX_AUDIO_SECONDS) return errorResponse(`That audio is ${Math.round(wav.info.seconds)} s long; the limit is ${MAX_AUDIO_SECONDS} s.`, 413);
    const audio = new Blob([wav.wav], { type: "audio/wav" });
    const fd = new FormData();
    if (action === "isolate") {
      fd.append("audio", audio, "audio.wav");
      return passthrough(await fetch(`${EL}/audio-isolation`, { signal, method: "POST", headers: H, body: fd }));
    }
    // transcribe
    fd.append("file", audio, "audio.wav");
    fd.append("model_id", "scribe_v1");
    fd.append("timestamps_granularity", "word");
    const r = await fetch(`${EL}/speech-to-text`, { signal, method: "POST", headers: H, body: fd });
    if (!r.ok) return Response.json({ error: elError(r.status, await r.text()) }, { status: 502 });
    const j = await r.json();
    const words = ((j.words ?? []) as { text: string; start: number; end: number; type?: string }[])
      .filter((w) => w.type !== "spacing")
      .map((w) => ({ w: w.text, s: w.start, e: w.end }));
    return Response.json({ text: j.text ?? "", language: j.language_code ?? null, words });
  }

  const body = (await req.json().catch(() => null)) ?? {};
  const action = String(body.action ?? "");
  if (!Object.hasOwn(JSON_GROUPS, action)) return Response.json({ error: "Unknown action." }, { status: 400 });
  const limited = await limit(req, JSON_GROUPS[action as keyof typeof JSON_GROUPS]);
  if (limited) return limited;
  if (action === "sfx") {
    const seconds = Math.min(22, Math.max(0.5, Number(body.seconds) || 2));
    return passthrough(
      await fetch(`${EL}/sound-generation`, {
        signal,
        method: "POST",
        headers: { ...H, "content-type": "application/json" },
        body: JSON.stringify({ text: String(body.prompt ?? "").slice(0, 400), duration_seconds: seconds, prompt_influence: 0.4 }),
      }),
    );
  }
  if (action === "tts") {
    const r = await fetch(`${EL}/text-to-speech/${DEFAULT_VOICE}/with-timestamps?output_format=mp3_44100_128`, {
      signal,
      method: "POST",
      headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ text: String(body.text ?? "").slice(0, 2500), model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2 } }),
    });
    if (!r.ok) {
      const body = await r.text();
      return Response.json({ error: elError(r.status, body) }, { status: cantPay(r.status, body) ? 402 : 502 });
    }
    const j = await r.json();
    return Response.json({ audio: j.audio_base64, words: wordsFromAlignment(j.alignment ?? j.normalized_alignment ?? null) });
  }
  if (action === "music") {
    const ms = Math.min(MAX_MUSIC_MS, Math.max(3000, Math.round((Number(body.seconds) || 30) * 1000)));
    return passthrough(
      await fetch(`${EL}/music`, {
        signal,
        method: "POST",
        headers: { ...H, "content-type": "application/json" },
        body: JSON.stringify({ prompt: String(body.prompt ?? "").slice(0, 1000), music_length_ms: ms }),
      }),
    );
  }
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
