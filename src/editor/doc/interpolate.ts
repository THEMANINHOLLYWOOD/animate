import type { Ease, Keyframe, Layer, Value } from "./schema";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// Cubic-bézier timing function (CSS semantics): solve x(s) = k for s, return y(s).
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, k: number) {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = k;
  for (let i = 0; i < 8; i++) {
    const err = x(s) - k;
    if (Math.abs(err) < 1e-6) break;
    const d = dx(s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
  }
  // Fall back to bisection if Newton wandered out of range.
  if (s < 0 || s > 1 || Math.abs(x(s) - k) > 1e-4) {
    let lo = 0, hi = 1;
    s = k;
    for (let i = 0; i < 40; i++) {
      if (x(s) < k) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
  }
  return ((ay * s + by) * s + cy) * s;
}

// Critically or under-damped spring from 0 to 1, normalised so it settles at k = 1.
export function springCurve(stiffness: number, damping: number, k: number) {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * Math.sqrt(stiffness));
  const T = 6 / (zeta * w0 || 1); // time to settle, used to map k -> physical time
  const t = k * T;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

export function applyEase(ease: Ease, k: number) {
  const x = clamp01(k);
  if (ease === "linear") return x;
  if (ease === "hold") return 0;
  if ("bezier" in ease) return cubicBezier(...ease.bezier, x);
  return springCurve(ease.spring.stiffness, ease.spring.damping, x);
}

function hexToRgb(h: string): [number, number, number] | null {
  const m = h.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Mix colours in OKLab so midpoints stay vivid instead of muddy.
function toOklab([r, g, b]: [number, number, number]) {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: number[]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
  };
  return `#${enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)}${enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`;
}

export function mixValue(a: Value, b: Value, k: number): Value {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * k;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => x + ((b[i] ?? x) - x) * k);
  if (typeof a === "string" && typeof b === "string") {
    const A = hexToRgb(a), B = hexToRgb(b);
    if (A && B) {
      if (k <= 0) return a;
      if (k >= 1) return b;
      const la = toOklab(A), lb = toOklab(B);
      return fromOklab(la.map((x, i) => x + (lb[i] - x) * k));
    }
  }
  return k < 1 ? a : b; // strings and mismatched kinds hold
}

// Value of a keyframe track at layer-local time t. Keys must be sorted by t.
export function valueAt(keys: Keyframe[], t: number): Value | undefined {
  if (!keys.length) return undefined;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  if (a.ease === "hold") return a.v;
  const k = applyEase(a.ease, (t - a.t) / (b.t - a.t || 1));
  return mixValue(a.v, b.v, k);
}

// Resolve a dotted property path ("transform.x", "props.fill") at doc time t.
export function propAt(layer: Layer, path: string, t: number): unknown {
  const keys = layer.anim[path];
  if (keys?.length) return valueAt(keys, t - layer.start);
  const [root, ...rest] = path.split(".");
  let v: unknown = (layer as Record<string, unknown>)[root];
  for (const p of rest) v = (v as Record<string, unknown> | undefined)?.[p];
  return v;
}
