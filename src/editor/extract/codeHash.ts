// A short fingerprint of a code layer's code, stored when its text is split into layers.
// The split (which text the code skips, which layers draw it) only holds for that exact code:
// once the code changes, the code draws all its own text again and the split layers stand down.

const memo = new Map<string, string>();

// FNV-1a over UTF-16 units, plus the length.
export function codeHash(code: string): string {
  let h = memo.get(code);
  if (h) return h;
  let x = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    x ^= code.charCodeAt(i);
    x = Math.imul(x, 0x01000193);
  }
  h = `${code.length.toString(36)}.${(x >>> 0).toString(36)}`;
  if (memo.size > 64) memo.clear();
  memo.set(code, h);
  return h;
}

// Whether a code layer's split still matches its code (so it skips the text its layers paint).
export const splitLive = (props: Record<string, unknown>) => !!props.skipText && typeof props.splitHash === "string" && props.splitHash === codeHash(String(props.code ?? ""));

// A code layer's props without any split state (before splitting it again).
const SPLIT_STATE = new Set(["skipText", "keepText", "splitHash", "textSplit", "splitSpan"]);
export const unsplit = (props: Record<string, unknown>) => Object.fromEntries(Object.entries(props).filter(([k]) => !SPLIT_STATE.has(k)));

// A code layer's scene clock: the scene time at the clip's start (props.sceneIn) and the scene's length
// (props.sceneT). Until a trim or a time split pins them, the clip is the scene: 0 and end - start.
// Playback and splitting both run the scene by it, so text is recorded at the times it's painted.
export function sceneClock(props: Record<string, unknown>, start: number, end: number) {
  const sceneIn = typeof props.sceneIn === "number" && Number.isFinite(props.sceneIn) ? props.sceneIn : 0;
  const sceneT = typeof props.sceneT === "number" && props.sceneT > 0 ? props.sceneT : end - start;
  return { sceneIn, sceneT };
}

// Whether a split covers scene time st. Its layers were recorded over one stretch of the scene
// (props.splitSpan, in scene time); a code layer lengthened since runs past it, and there it paints all
// its own text, as no layer does. A split with no span recorded covers the whole scene.
export function splitCovers(props: Record<string, unknown>, st: number) {
  const s = props.splitSpan;
  if (!Array.isArray(s) || s.length !== 2 || !s.every((x) => typeof x === "number")) return true;
  return st >= s[0] - 1e-6 && st <= s[1] + 1e-6;
}
