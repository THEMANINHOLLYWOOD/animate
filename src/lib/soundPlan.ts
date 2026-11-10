// The sound-plan contract shared by the API route and tests.
export const SOUND_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["music", "voice", "sfx", "musicGuess", "notes"],
  properties: {
    music: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["prompt", "energy"],
          properties: {
            prompt: { type: "string", description: "Composition brief for a music generator: genre, instruments, tempo (BPM), mood, how it should evolve; under 400 characters" },
            energy: { type: "string", enum: ["low", "medium", "high"] },
          },
        },
      ],
    },
    voice: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["p", "text"],
        properties: {
          p: { type: "number", description: "Start as a fraction of the film, 0..1" },
          text: { type: "string", description: "What is spoken, exactly as it should be read aloud" },
        },
      },
    },
    sfx: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["p", "prompt", "seconds", "gain"],
        properties: {
          p: { type: "number", description: "Start as a fraction of the film, 0..1" },
          prompt: { type: "string", description: "Description for a sound-effect generator, e.g. 'soft paper whoosh, short, airy'" },
          seconds: { type: "number", description: "Length in seconds, 0.3..6" },
          gain: { type: "number", description: "Relative loudness 0.2..1" },
        },
      },
    },
    musicGuess: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["title", "artist", "confidence", "why"],
          properties: {
            title: { type: "string" },
            artist: { type: "string" },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            why: { type: "string" },
          },
        },
      ],
    },
    notes: { type: "string", description: "One or two sentences on the sound direction, for the user" },
  },
};

export const SOUND_PLAN_SYSTEM = `You are the sound designer for a short motion-graphics film. Given the film's treatment (beats as fractions of the film, the on-screen copy, the mood) you write a sound plan that a generator will execute:

- voice: a voiceover script, split into lines that each start at a beat. Speak at about 2.5 words per second, so a line must fit inside its beat: never more than (beat length in seconds × 2.5) words. Prefer short, clear lines; often the on-screen copy or a paraphrase of it. Leave voice empty when the film is wordless or a voiceover would fight the on-screen type.
- music: one brief for the whole film: genre, instruments, tempo, mood and how it builds, matched to the film's energy and length. Null only if the film should be silent.
- sfx: soft UI-style cues only on actions that carry meaning, plus one returning motif cue on the key idea when it helps. Tasteful cues on moments of motion: transitions, reveals, counters, impacts, risers before a payoff. Describe them for a sound generator (texture, length, character). Keep them subtle: motion graphics sound design, not an action trailer. 4–10 cues for a 10–30 s film.
- musicGuess: when a transcript or a reference's text clearly identifies a real song (lyrics, a named track, a known jingle), name it with your confidence; otherwise null. Never guess from vibe alone.
- notes: one or two sentences for the user on the overall sound direction.

HIGH-ENERGY FILMS (when the treatment's Register is HYPE): the film is cut to a beat grid, so the sound must hit it. The music brief names the treatment's exact tempo as "NNN BPM" with the first beat at 0 s, the genre that suits the subject, a build, and a drop at the treatment's drop beat (give its time in seconds). Sound effects are trailer sound design here, not subtle UI cues: a riser into the drop, a heavy impact on the drop, whooshes on whips and wipes, hits or stabs on the hardest cuts, a sub drop or reverse cymbal where the treatment asks for a breath, and a tail under the end card. 8–16 cues. A cut at beat b of N total beats sits at fraction b ÷ N of the film. Leave voice empty unless the treatment writes a voiceover.

RECREATION MODE (when told the film recreates a reference video): if a transcript is given, the voice lines are the transcript's sentences at their original timings (as fractions). SFX should recreate the sounds you'd expect in the original at the same moments. If a background stem from the original exists, set music to null (the original background is kept) — unless told REBUILD: then the original's stems were separated and every one gets a new version, so always write the music brief (matching the stated tempo and mood) and the voice lines.`;
