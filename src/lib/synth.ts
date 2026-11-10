// A tempo-locked procedural music bed rendered with Web Audio, for films that
// have no track (and when a music generator isn't available). Seeded, so the
// same brief always renders the same bed. One motif returns on the key idea.

export type BedSpec = { bpm: number; energy: "low" | "medium" | "high"; mode: "major" | "minor"; seed: number; motifAt?: number[] };

const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const note = (semi: number) => 220 * Math.pow(2, semi / 12); // A3 = 0

// Chord degrees over a root, as semitone offsets.
const PROGRESSIONS = {
  major: [
    [0, 4, 7, 11],
    [5, 9, 12, 16],
    [-3, 0, 4, 7],
    [7, 11, 14, 17],
  ],
  minor: [
    [0, 3, 7, 10],
    [-4, 0, 3, 7],
    [5, 8, 12, 15],
    [-2, 2, 5, 9],
  ],
};

export function specFromPlan(prompt: string, energy: "low" | "medium" | "high", seed: number): BedSpec {
  const bpmMatch = prompt.match(/(\d{2,3})\s*bpm/i);
  const bpm = bpmMatch ? Math.min(180, Math.max(56, +bpmMatch[1])) : energy === "high" ? 124 : energy === "medium" ? 100 : 72;
  const minor = /minor|melanchol|dark|moody|tense|noir|serious/i.test(prompt);
  return { bpm, energy, mode: minor ? "minor" : "major", seed };
}

export async function renderBed(spec: BedSpec, duration: number, sampleRate = 48000): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const rnd = mulberry(spec.seed);
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const prog = PROGRESSIONS[spec.mode];
  const root = -5 + Math.floor(rnd() * 6); // around E3..A3

  const master = off.createGain();
  master.gain.value = 0.5;
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  master.connect(comp);
  comp.connect(off.destination);

  const lp = off.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = spec.energy === "high" ? 4200 : spec.energy === "medium" ? 2600 : 1600;
  lp.connect(master);

  const voice = (freq: number, t0: number, len: number, gain: number, type: OscillatorType, attack = 0.02, release = 0.3) => {
    const o = off.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = off.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, Math.max(t0 + attack, t0 + len - release));
    g.gain.linearRampToValueAtTime(0, t0 + len);
    o.connect(g);
    g.connect(lp);
    o.start(t0);
    o.stop(t0 + len + 0.05);
  };

  // Pad: one chord per bar, slow attack, two detuned layers.
  for (let t = 0; t < duration; t += bar) {
    const chord = prog[Math.floor(t / bar) % prog.length];
    const fade = Math.min(1, (duration - t) / bar);
    for (const semi of chord) {
      const f = note(root + semi);
      voice(f, t, Math.min(bar * 1.05, duration - t), 0.06 * fade, "triangle", bar * 0.4, bar * 0.35);
      voice(f * 1.003, t, Math.min(bar * 1.05, duration - t), 0.04 * fade, "sine", bar * 0.4, bar * 0.35);
    }
  }

  // Pulse: a soft pluck on beats; busier when energy is higher.
  const density = spec.energy === "high" ? 2 : spec.energy === "medium" ? 1 : 0.5;
  for (let t = beat * 2; t < duration; t += beat / density) {
    if (spec.energy === "low" && rnd() < 0.4) continue;
    const chord = prog[Math.floor(t / bar) % prog.length];
    const semi = chord[Math.floor(rnd() * chord.length)];
    voice(note(root + semi + 12), t, beat * 0.9, 0.05, "sine", 0.005, beat * 0.5);
  }

  // Motif: a short rising figure, placed at the given moments (or every 4 bars).
  const motif = [0, 7, 12, 11];
  const at = spec.motifAt?.length ? spec.motifAt : Array.from({ length: Math.floor(duration / (bar * 4)) }, (_, i) => (i + 1) * bar * 4 - bar);
  for (const t0 of at) {
    motif.forEach((semi, i) => {
      const t = t0 + i * beat * 0.5;
      if (t < duration - 0.2) voice(note(root + 12 + semi), t, beat * 0.75, 0.07, "triangle", 0.01, beat * 0.4);
    });
  }

  // Low end: root on the downbeat of each bar.
  for (let t = 0; t < duration; t += bar) {
    const chord = prog[Math.floor(t / bar) % prog.length];
    voice(note(root + chord[0] - 12), t, bar * 0.95, spec.energy === "high" ? 0.12 : 0.08, "sine", 0.01, bar * 0.5);
  }

  return off.startRendering();
}

// Beat grid for a bed: downbeats every bar, beats every quarter.
export const bedBeats = (spec: BedSpec, duration: number) => {
  const beat = 60 / spec.bpm;
  const beats: number[] = [];
  for (let t = 0; t < duration; t += beat) beats.push(+t.toFixed(3));
  return { bpm: spec.bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
};
