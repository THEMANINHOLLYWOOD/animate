// Client-side audio: decoding, stems, mixing, playback in sync with the film,
// and rendering the mix for export. Everything is plain Web Audio.

export type AudioClip = {
  id: string;
  kind: "voice" | "music" | "sfx" | "background" | "original";
  label: string;
  pathname?: string; // private Blob path when saved
  start: number; // seconds into the film
  duration: number;
  gain: number; // 0..2
  muted: boolean;
  source: "original" | "generated" | "upload";
  text?: string; // voice lines
  prompt?: string; // sfx / music prompt
  words?: { w: string; s: number; e: number }[]; // voice word timings (film seconds)
  beats?: { bpm: number; beats: number[]; downbeats: number[]; hits: number[] }; // music grid (film seconds)
};

let ctx: AudioContext | null = null;
export const audioContext = () => (ctx ??= new AudioContext({ sampleRate: 48000 }));

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer();
  return audioContext().decodeAudioData(buf.slice(0));
}

// 16-bit PCM WAV, mono or stereo.
export function toWav(buffer: AudioBuffer, mono = false): Blob {
  const chans = mono ? 1 : Math.min(2, buffer.numberOfChannels);
  const n = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + n * chans * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + n * chans * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, chans, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * chans * 2, true);
  data.setUint16(32, chans * 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, n * chans * 2, true);
  const src = Array.from({ length: chans }, (_, c) => buffer.getChannelData(mono ? 0 : c));
  if (mono && buffer.numberOfChannels > 1) {
    const r = buffer.getChannelData(1);
    src[0] = src[0].map((v, i) => (v + r[i]) / 2);
  }
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < chans; c++) {
      const v = Math.max(-1, Math.min(1, src[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  return new Blob([data.buffer], { type: "audio/wav" });
}

// A WAV copy that fits under maxBytes (server requests are capped at 4.5 MB in production):
// the highest sample rate up to maxRate, in stereo while that still allows ≥ 22.05 kHz, else mono.
export async function fittedWav(b: AudioBuffer, maxBytes = 3_600_000, maxRate = 24000, stereo = false): Promise<Blob> {
  const rateFor = (ch: number) => Math.max(8000, Math.min(maxRate, Math.floor((maxBytes - 44) / (b.duration * 2 * ch))));
  const ch = stereo && b.numberOfChannels > 1 && rateFor(2) >= 22050 ? 2 : 1;
  const rate = rateFor(ch);
  const off = new OfflineAudioContext(ch, Math.ceil(b.duration * rate), rate);
  const s = off.createBufferSource();
  s.buffer = b;
  s.connect(off.destination);
  s.start();
  return toWav(await off.startRendering(), ch === 1);
}

// Mono, ≤ 24 kHz: all speech services need.
export const speechWav = (b: AudioBuffer, maxBytes = 3_600_000) => fittedWav(b, maxBytes, 24000, false);

function monoOf(b: AudioBuffer) {
  const out = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < b.length; i++) out[i] += d[i] / b.numberOfChannels;
  }
  return out;
}

function resampleTo(b: AudioBuffer, rate: number): Promise<AudioBuffer> {
  if (b.sampleRate === rate) return Promise.resolve(b);
  const len = Math.ceil((b.length * rate) / b.sampleRate);
  const off = new OfflineAudioContext(b.numberOfChannels, len, rate);
  const s = off.createBufferSource();
  s.buffer = b;
  s.connect(off.destination);
  s.start();
  return off.startRendering();
}

// background = original − isolated voice, after aligning the two by cross-correlation
// (codecs add small delays). Returns null when they don't line up well enough.
export async function subtractAligned(original: AudioBuffer, voice: AudioBuffer): Promise<AudioBuffer | null> {
  const rate = original.sampleRate;
  const v = await resampleTo(voice, rate);
  const a = monoOf(original);
  const b = monoOf(v);
  const win = Math.min(a.length, b.length, rate * 8);
  const maxLag = Math.round(rate * 0.25);
  let best = 0, bestLag = 0, energy = 0;
  for (let i = 0; i < win; i += 1) energy += a[i] * a[i];
  // Decimate for speed, then refine around the best lag.
  const step = 8;
  for (let lag = -maxLag; lag <= maxLag; lag += step) {
    let s = 0;
    for (let i = 0; i < win; i += 4) {
      const j = i + lag;
      if (j >= 0 && j < b.length) s += a[i] * b[j];
    }
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  for (let lag = bestLag - step; lag <= bestLag + step; lag++) {
    let s = 0;
    for (let i = 0; i < win; i++) {
      const j = i + lag;
      if (j >= 0 && j < b.length) s += a[i] * b[j];
    }
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (energy <= 0 || best / energy < 0.15) return null;
  const out = audioContext().createBuffer(original.numberOfChannels, original.length, rate);
  for (let c = 0; c < original.numberOfChannels; c++) {
    const src = original.getChannelData(c);
    const vc = v.getChannelData(Math.min(c, v.numberOfChannels - 1));
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) {
      const j = i + bestLag;
      dst[i] = src[i] - (j >= 0 && j < vc.length ? vc[j] : 0);
    }
  }
  return out;
}

// ── Live playback locked to the film clock ───────────────────────────────

type Loaded = { clip: AudioClip; buffer: AudioBuffer };

export class Mixer {
  private nodes: AudioBufferSourceNode[] = [];
  private master: GainNode;
  constructor(private loaded: Loaded[]) {
    this.master = audioContext().createGain();
    this.master.connect(audioContext().destination);
  }
  update(loaded: Loaded[]) {
    this.loaded = loaded;
  }
  // (Re)schedule every clip so that film time `t` plays now.
  play(t: number) {
    this.stop();
    const ac = audioContext();
    if (ac.state === "suspended") ac.resume();
    const now = ac.currentTime + 0.02;
    const ducks = duckWindows(this.loaded.map((l) => l.clip));
    for (const { clip, buffer } of this.loaded) {
      if (clip.muted) continue;
      const g = ac.createGain();
      g.gain.value = clip.gain;
      if (isBed(clip)) scheduleDucking(g.gain, clip.gain, ducks, now - t);
      g.connect(this.master);
      const s = ac.createBufferSource();
      s.buffer = buffer;
      s.connect(g);
      const offset = t - clip.start;
      const dur = Math.min(buffer.duration, clip.duration);
      if (offset >= dur) continue;
      if (offset >= 0) s.start(now, offset, dur - offset);
      else s.start(now - offset, 0, dur);
      this.nodes.push(s);
    }
  }
  stop() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {}
    }
    this.nodes = [];
  }
}

// ── Offline mix for export ──────────────────────────────────────────────

// ── Ducking: the bed (music / background) dips under the voice ──────────

const isBed = (c: AudioClip) => c.kind === "music" || c.kind === "background";
const DUCK = 0.35; // bed level under voice
const RAMP = 0.18; // seconds

// Film-time windows where a voice clip is active.
function duckWindows(clips: AudioClip[]) {
  return clips
    .filter((c) => c.kind === "voice" && !c.muted)
    .map((c) => [c.start, c.start + c.duration] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

// Gain automation in audio-context time; `base` maps film time 0 onto the context clock.
function scheduleDucking(param: AudioParam, gain: number, windows: [number, number][], base: number) {
  if (!windows.length) return;
  param.setValueAtTime(gain, Math.max(0, base));
  for (const [s, e] of windows) {
    const a = base + s - RAMP, b = base + s, c = base + e, d = base + e + RAMP;
    if (d < 0) continue;
    param.setValueAtTime(gain, Math.max(0, a));
    param.linearRampToValueAtTime(gain * DUCK, Math.max(0, b));
    param.setValueAtTime(gain * DUCK, Math.max(0, c));
    param.linearRampToValueAtTime(gain, Math.max(0, d));
  }
}

// ── Offline mix for export ──────────────────────────────────────────────

export async function renderMix(loaded: Loaded[], duration: number, sampleRate = 48000): Promise<AudioBuffer | null> {
  const active = loaded.filter((l) => !l.clip.muted);
  if (!active.length) return null;
  const off = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const ducks = duckWindows(active.map((l) => l.clip));
  for (const { clip, buffer } of active) {
    const g = off.createGain();
    g.gain.value = clip.gain;
    if (isBed(clip)) scheduleDucking(g.gain, clip.gain, ducks, 0);
    g.connect(off.destination);
    const s = off.createBufferSource();
    s.buffer = buffer;
    s.connect(g);
    const dur = Math.min(buffer.duration, clip.duration, Math.max(0, duration - clip.start));
    if (dur <= 0 || clip.start >= duration) continue;
    s.start(Math.max(0, clip.start), 0, dur);
  }
  const mix = await off.startRendering();
  normalizeLoudness(mix);
  return mix;
}

// Delivery loudness: about -16 LUFS integrated (approximated by RMS over the
// louder half of the programme) with true peaks no higher than -1.5 dBFS.
function normalizeLoudness(mix: AudioBuffer) {
  const n = mix.length;
  const win = Math.max(1, Math.round(mix.sampleRate * 0.4));
  const blocks: number[] = [];
  let peak = 0;
  for (let start = 0; start < n; start += win) {
    let sum = 0, count = 0;
    for (let c = 0; c < mix.numberOfChannels; c++) {
      const d = mix.getChannelData(c);
      const end = Math.min(n, start + win);
      for (let i = start; i < end; i++) {
        sum += d[i] * d[i];
        count++;
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
      }
    }
    if (count) blocks.push(sum / count);
  }
  if (!blocks.length || peak === 0) return;
  // Gate out silence: measure the louder half of blocks.
  const sorted = [...blocks].sort((a, b) => b - a);
  const loud = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  const rms = Math.sqrt(loud.reduce((a, b) => a + b, 0) / loud.length);
  const targetRms = Math.pow(10, -16 / 20);
  const peakCap = Math.pow(10, -1.5 / 20);
  let k = targetRms / Math.max(rms, 1e-6);
  if (peak * k > peakCap) k = peakCap / peak;
  if (Math.abs(k - 1) < 0.02) return;
  for (let c = 0; c < mix.numberOfChannels; c++) {
    const d = mix.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
}

export const canEncodeAac = async () => {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    return !!(await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 160_000 })).supported;
  } catch {
    return false;
  }
};
