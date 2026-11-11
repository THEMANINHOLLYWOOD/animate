// Beat detection in the browser: spectral-flux onsets → tempo by autocorrelation
// of the onset envelope → beat times from the strongest phase. Good enough to
// place cues on the grid of an uploaded track.

export type BeatGrid = { bpm: number; beats: number[]; downbeats: number[]; hits: number[] };

export function detectBeats(buffer: AudioBuffer): BeatGrid {
  const sr = buffer.sampleRate;
  const hop = 512;
  const win = 1024;
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  // Onset envelope: positive change in band energies between frames.
  const bands = 24;
  const frames = Math.max(1, Math.floor((mono.length - win) / hop));
  const env = new Float32Array(frames);
  let prev = new Float32Array(bands);
  const hann = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win));
  const re = new Float32Array(win), im = new Float32Array(win);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) {
      re[i] = mono[off + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const cur = new Float32Array(bands);
    for (let b = 0; b < bands; b++) {
      const lo = Math.floor(Math.pow(win / 2, (b + 1) / (bands + 1)));
      const hi = Math.floor(Math.pow(win / 2, (b + 2) / (bands + 1)));
      let e = 0;
      for (let k = lo; k < Math.max(lo + 1, hi); k++) e += Math.hypot(re[k], im[k]);
      cur[b] = Math.log1p(e);
    }
    let flux = 0;
    for (let b = 0; b < bands; b++) flux += Math.max(0, cur[b] - prev[b]);
    env[f] = flux;
    prev = cur;
  }
  // Normalise and lightly smooth.
  const max = Math.max(...env, 1e-6);
  for (let i = 0; i < frames; i++) env[i] /= max;

  // Tempo: autocorrelation of the envelope over 50–200 BPM.
  const fps = sr / hop;
  let best = 0, bestLag = Math.round((60 / 120) * fps);
  const minLag = Math.round((60 / 200) * fps), maxLag = Math.round((60 / 50) * fps);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < frames; i++) s += env[i] * env[i - lag];
    // Mild preference for ~120 BPM like most trackers.
    const bpm = (60 * fps) / lag;
    s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  const bpm = (60 * fps) / bestLag;

  // Phase: the offset that lines beats up with the most onset energy.
  let bestPhase = 0, bestScore = -1;
  for (let ph = 0; ph < bestLag; ph++) {
    let s = 0;
    for (let i = ph; i < frames; i += bestLag) s += env[i];
    if (s > bestScore) {
      bestScore = s;
      bestPhase = ph;
    }
  }
  const beats: number[] = [];
  for (let i = bestPhase; i < frames; i += bestLag) beats.push(+((i * hop) / sr).toFixed(3));

  // Downbeats: the beat phase (of 4) with the most energy.
  let dbOff = 0, dbScore = -1;
  for (let o = 0; o < 4; o++) {
    let s = 0;
    for (let i = o; i < beats.length; i += 4) s += env[Math.min(frames - 1, Math.round((beats[i] * sr) / hop))];
    if (s > dbScore) {
      dbScore = s;
      dbOff = o;
    }
  }
  const downbeats = beats.filter((_, i) => i % 4 === dbOff);

  // Hits: strong local onset peaks (for SFX placement).
  const hits: number[] = [];
  const thr = 0.35;
  for (let i = 2; i < frames - 2; i++) {
    if (env[i] > thr && env[i] >= env[i - 1] && env[i] >= env[i + 1] && env[i] > env[i - 2] && env[i] > env[i + 2]) {
      const t = +((i * hop) / sr).toFixed(3);
      if (!hits.length || t - hits[hits.length - 1] > 0.12) hits.push(t);
    }
  }
  return { bpm: +bpm.toFixed(1), beats, downbeats, hits };
}

export const snapToGrid = (t: number, grid: number[], tolerance = 0.15) => {
  let best = t, dist = tolerance;
  for (const b of grid) {
    const d = Math.abs(b - t);
    if (d < dist) {
      dist = d;
      best = b;
    }
  }
  return best;
};

// In-place radix-2 FFT.
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = i + j + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
