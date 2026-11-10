import { z } from "zod";

// The scene document: the editable source of truth for a film.
// Times are seconds. Keyframe times are local to their layer (0 = layer start).

export const DOC_VERSION = 1;

export const Vec2 = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2>;

export const Bezier = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const Ease = z.union([
  z.literal("linear"),
  z.literal("hold"),
  z.object({ bezier: Bezier }),
  z.object({ spring: z.object({ stiffness: z.number().positive(), damping: z.number().positive() }) }),
]);
export type Ease = z.infer<typeof Ease>;

export const Value = z.union([z.number(), z.array(z.number()), z.string()]);
export type Value = z.infer<typeof Value>;

export const Keyframe = z.object({
  id: z.string(),
  // May fall outside [0, end - start]: keys beyond a trim are kept, like AE.
  t: z.number(),
  v: Value,
  // Easing applied from this keyframe towards the next one.
  ease: Ease.default("linear"),
});
export type Keyframe = z.infer<typeof Keyframe>;

export const Transform = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  scale: Vec2.default([1, 1]),
  rotation: z.number().default(0),
  anchor: Vec2.default([0.5, 0.5]),
  opacity: z.number().min(0).max(1).default(1),
});
export type Transform = z.infer<typeof Transform>;

export const Effect = z.object({
  id: z.string(),
  type: z.enum(["blur", "motionBlur", "glow", "shadow", "colorGrade", "tint", "grain", "chromatic", "displace", "pixelate", "vignette"]),
  enabled: z.boolean().default(true),
  params: z.record(z.string(), Value).default({}),
});
export type Effect = z.infer<typeof Effect>;

// "part": one object a code layer draws (lib.layer in its code), as a layer of its own: see extract/parts.ts.
export const LayerType = z.enum(["text", "shape", "image", "video", "group", "code", "part", "globe", "chart", "particles", "waveform"]);
export type LayerType = z.infer<typeof LayerType>;

export const Layer = z.object({
  id: z.string(),
  name: z.string(),
  type: LayerType,
  parentId: z.string().nullable().default(null),
  start: z.number().min(0),
  end: z.number().min(0),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  blend: z.enum(["normal", "multiply", "screen", "overlay", "add"]).default("normal"),
  transform: Transform.default(Transform.parse({})),
  // Type-specific static properties: text, font, fill, stroke, path, src, code, params…
  props: z.record(z.string(), z.unknown()).default({}),
  // Keyframed properties by path, e.g. "transform.x" or "props.fill".
  anim: z.record(z.string(), z.array(Keyframe)).default({}),
  effects: z.array(Effect).default([]),
  mask: z.object({ layerId: z.string(), mode: z.enum(["alpha", "luma", "inverted"]) }).optional(),
});
export type Layer = z.infer<typeof Layer>;

export const Asset = z.object({
  id: z.string(),
  kind: z.enum(["image", "video", "audio", "font"]),
  name: z.string(),
  src: z.string(),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type Asset = z.infer<typeof Asset>;

export const AudioClip = z.object({
  id: z.string(),
  assetId: z.string(),
  track: z.number().int().min(0),
  role: z.enum(["vo", "music", "sfx", "other"]).default("other"),
  start: z.number().min(0),
  in: z.number().min(0).default(0),
  out: z.number().min(0),
  gain: z.array(Keyframe).default([]),
  fadeIn: z.number().min(0).default(0),
  fadeOut: z.number().min(0).default(0),
});
export type AudioClip = z.infer<typeof AudioClip>;

export const Marker = z.object({
  id: z.string(),
  t: z.number().min(0),
  label: z.string().default(""),
  kind: z.enum(["beat", "word", "cue"]).default("cue"),
});
export type Marker = z.infer<typeof Marker>;

export const Doc = z.object({
  meta: z.object({
    id: z.string(),
    title: z.string(),
    size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    fps: z.number().positive().default(30),
    duration: z.number().positive(),
    background: z.string().default("#FAF9F5"),
    version: z.literal(DOC_VERSION).default(DOC_VERSION),
  }),
  assets: z.array(Asset).default([]),
  // Array order is paint order: index 0 paints first (back).
  layers: z.array(Layer).default([]),
  audio: z.array(AudioClip).default([]),
  markers: z.array(Marker).default([]),
});
export type Doc = z.infer<typeof Doc>;

let counter = 0;
export const newId = (prefix = "id") =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
