/* eslint-disable @typescript-eslint/no-explicit-any */
// A film's own controls. A scene declares what can be played with about it:
//   const P = lib.controls({ Headline: 'BURNING', 'Fire height': [0.6, 0, 1], Ember: '#ff5a1f', Grain: true });
// and reads the values back (P.Headline, P['Fire height']). The editor builds that film's panel from
// the declaration (a field, a slider, a swatch, a switch, a choice, a point to drag on the canvas),
// keeps what's set on the film's code layer (props.controls), and the scene then draws with those.

export type ControlDef = { name: string; group?: string } & (
  | { kind: "number"; value: number; min: number; max: number; step: number }
  | { kind: "color"; value: string }
  | { kind: "text"; value: string }
  | { kind: "toggle"; value: boolean }
  | { kind: "select"; value: string; options: string[] }
  // A place in the frame, as fractions of its width and height.
  | { kind: "point"; value: [number, number] }
);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && num(x[0]) && num(x[1]);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

// A step that gives a slider about a hundred stops, on round numbers; whole numbers stay whole.
function stepFor(value: number, min: number, max: number) {
  const span = max - min;
  if ([value, min, max].every(Number.isInteger) && span >= 3) return 1;
  const raw = span / 100;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

function slider(value: number, min?: number, max?: number, step?: number) {
  let lo = num(min) ? min : value < 0 ? -Math.abs(value) * 2 : 0;
  let hi = num(max) ? max : value > 1 ? Math.abs(value) * 2 : value < 0 ? Math.abs(value) * 2 : 1;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) hi = lo + 1;
  return { kind: "number" as const, value: clamp(value, lo, hi), min: lo, max: hi, step: num(step) && step > 0 ? step : stepFor(value, lo, hi) };
}

// One control from its declaration: 'words' (text), '#ff5a1f' (colour), true (switch), 0.6 or
// [value, min, max, step?] (slider), { options: [...], value } (choice), { point: [x, y] } (a place in
// the frame), or the long form { value, min, max, step } / { text } / { color }. Null if it's none of these.
function defOf(name: string, spec: any, group?: string): ControlDef | null {
  const base = { name, ...(group ? { group } : {}) };
  if (typeof spec === "boolean") return { ...base, kind: "toggle", value: spec };
  if (typeof spec === "string") return HEX.test(spec.trim()) ? { ...base, kind: "color", value: spec.trim() } : { ...base, kind: "text", value: spec };
  if (num(spec)) return { ...base, ...slider(spec) };
  if (Array.isArray(spec)) return num(spec[0]) ? { ...base, ...slider(spec[0], spec[1], spec[2], spec[3]) } : null;
  if (!spec || typeof spec !== "object") return null;
  if (Array.isArray(spec.options) && spec.options.length) {
    const options = spec.options.map(String);
    return { ...base, kind: "select", options, value: options.includes(String(spec.value)) ? String(spec.value) : options[0] };
  }
  if (pair(spec.point)) return { ...base, kind: "point", value: [spec.point[0], spec.point[1]] };
  if (typeof spec.color === "string") return { ...base, kind: "color", value: spec.color };
  if (typeof spec.text === "string") return { ...base, kind: "text", value: spec.text };
  if (typeof spec.toggle === "boolean") return { ...base, kind: "toggle", value: spec.toggle };
  return defOf(name, num(spec.value) ? [spec.value, spec.min, spec.max, spec.step] : spec.value, group);
}

// lib.controls(spec) or lib.controls('Group', spec): the controls it declares, in order.
export function controlDefs(a: unknown, b?: unknown): ControlDef[] {
  const group = typeof a === "string" ? a : undefined;
  const spec = (group === undefined ? a : b) as Record<string, unknown> | null;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return [];
  const out: ControlDef[] = [];
  for (const [name, s] of Object.entries(spec)) {
    const d = defOf(name, s, group);
    if (d) out.push(d);
  }
  return out;
}

// Where a control's value is kept on its layer: a name is one step of a property path.
export const controlKey = (name: string) => name.replace(/\./g, "·");
export const controlPath = (name: string) => `props.controls.${controlKey(name)}`;

// A stored value as this control takes it (within its range, of its kind), or its default.
export function controlValue(d: ControlDef, v: unknown): any {
  if (v === undefined || v === null) return d.value;
  switch (d.kind) {
    case "number":
      return num(v) ? clamp(v, d.min, d.max) : d.value;
    case "color":
    case "text":
      return typeof v === "string" ? v : d.value;
    case "toggle":
      return typeof v === "boolean" ? v : num(v) ? v >= 0.5 : d.value;
    case "select":
      return d.options.includes(String(v)) ? String(v) : d.value;
    case "point":
      return pair(v) ? [v[0], v[1]] : d.value;
  }
}

// What the scene reads: every declared control by name, set values over defaults.
export function controlValues(defs: ControlDef[], set: Record<string, unknown> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const d of defs) out[d.name] = controlValue(d, set?.[controlKey(d.name)]);
  return out;
}

// What's set on a code layer, static and keyed (resolved props carry keyed ones as "controls.<name>").
export function controlsSet(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...((props.controls && typeof props.controls === "object" ? props.controls : {}) as Record<string, unknown>) };
  for (const k of Object.keys(props)) if (k.startsWith("controls.")) out[k.slice(9)] = props[k];
  return out;
}

// The controls a code layer's scene declares, as last found (kept on the layer as props.controlDefs).
export function declaredControls(props: Record<string, unknown>): ControlDef[] {
  const d = props.controlDefs;
  return Array.isArray(d) ? (d.filter((x) => x && typeof x === "object" && typeof (x as ControlDef).name === "string" && typeof (x as ControlDef).kind === "string") as ControlDef[]) : [];
}

// A kit whose lib.controls answers with what's set (and reports each declaration it sees).
export function withControls<K extends object>(kit: K, set: Record<string, unknown> | undefined, seen?: (defs: ControlDef[]) => void): K {
  return {
    ...kit,
    controls: (a: unknown, b?: unknown) => {
      const defs = controlDefs(a, b);
      seen?.(defs);
      return controlValues(defs, set);
    },
  };
}

// A value somewhere else in a control's range (the editor's "Shuffle"); words and places stay put.
export function shuffled(d: ControlDef, r: () => number): unknown {
  switch (d.kind) {
    case "number": {
      const v = d.min + r() * (d.max - d.min);
      return clamp(Math.round(v / d.step) * d.step, d.min, d.max);
    }
    case "toggle":
      return r() < 0.5;
    case "select":
      return d.options[Math.floor(r() * d.options.length)];
    case "color": {
      const h = Math.floor(r() * 360), s = 55 + Math.floor(r() * 40), l = 35 + Math.floor(r() * 30);
      const f = (n: number) => {
        const k = (n + h / 30) % 12, a = (s / 100) * Math.min(l / 100, 1 - l / 100);
        return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
          .toString(16)
          .padStart(2, "0");
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    }
    default:
      return d.value;
  }
}
