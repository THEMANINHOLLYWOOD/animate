// Animation styles a film can be made in. Each is guidance for the director and the animator
// (it overrides the default house style); `example` names the example film that shows it.

export type Style = { id: string; name: string; example?: string; guidance: string };

export const STYLES: Style[] = [
  {
    id: "flat-explainer",
    name: "Flat explainer",
    example: "ex-inca",
    guidance:
      "Flat-vector science-explainer look: rich saturated palettes (deep indigo and violet grounds, warm orange and magenta accents, teal), flat shapes with soft long gradients and inner shading, glowing light sources with bloom halos (stacked translucent circles), rounded geometric characters with big simple eyes, dense layered illustrated environments with parallax, gentle constant motion (bobbing, blinking, drifting particles), smooth camera moves between scenes, clean bold sans titles. Original characters only; never imitate an existing channel's brand or mascots.",
  },
  {
    id: "word-mosaic",
    name: "Word mosaic",
    example: "ex-word-mosaic",
    guidance:
      "Glitchy typographic mosaic on pure black: a terminal prompt typing in white boxes with a block caret, then the frame fills with dense rows of tiny monospace word tiles on small coloured rectangles (reds, white, greys, deep blue, violet) whose colours together paint large images that morph; rows scroll at different speeds, tiles flicker between words, block-glitch bursts on transitions, crisp red or white mono label boxes cut in over the mosaic.",
  },
  {
    id: "brutalist",
    name: "Brutalist type",
    example: "ex-loud",
    guidance:
      "Brutalist kinetic typography: pure black, pure white and one signal red; giant heavy sans words filling the frame edge to edge, hard cuts on a fast beat, strobing inversions, scale punches, squashed and stretched letters, scrolling marquee bands, numbers counting fast.",
  },
  {
    id: "ink",
    name: "Ink and paper",
    example: "ex-enso",
    guidance:
      "Zen sumi-e ink at minimum energy: warm rice-paper ground with fibre texture, black ink brush strokes with pressure, dry-brush streaks and wet grey washes, one tiny vermilion seal as the only colour, long holds, slow eases, lots of empty space, italic serif words appearing slowly.",
  },
  {
    id: "synthwave",
    name: "Synthwave",
    example: "ex-night-drive",
    guidance:
      "1980s synthwave: purple-to-magenta sky, a striped setting sun, a neon magenta and cyan perspective grid rushing toward camera, wireframe mountains, palm silhouettes in parallax, chrome titles with a sweeping shine, neon script that flickers on, glow from stacked strokes.",
  },
  {
    id: "silent-film",
    name: "Silent film",
    example: "ex-last-reel",
    guidance:
      "1920s silent film: sepia monochrome, per-frame flicker, film grain, scratches and dust, gate weave, heavy vignette, art-deco intertitle cards with double-line borders, silhouette cut-out scenes in jerky undercranked motion, iris wipes between shots.",
  },
  {
    id: "watercolour",
    name: "Watercolour",
    example: "ex-seasons",
    guidance:
      "Hand-painted watercolour: soft paper ground, layered translucent washes with noisy edges and colour bleed, organic shapes that grow, gentle wind sway, a soft serif for the few words.",
  },
  {
    id: "editorial",
    name: "Swiss editorial",
    example: "ex-heartbeat",
    guidance:
      "Clean Swiss editorial explainer: warm off-white ground, near-black ink, one or two accent colours, hairline diagrams drawn on with line reveals, a strict grid, mono labels with leader lines, serif headlines, calm and rigorous.",
  },
  {
    id: "cartoon",
    name: "Kids' cartoon",
    example: "ex-hello-shapes",
    guidance:
      "Playful kids' cartoon: candy palette on a soft cream ground, chunky rounded characters with googly eyes that blink and look around, big squash-and-stretch, springy overshoot, speech bubbles that pop, confetti, bouncy rounded titles.",
  },
  {
    id: "pottery",
    name: "Black-figure pottery",
    example: "ex-thermopylae",
    guidance:
      "Ancient Greek black-figure pottery fused with cinematic light: terracotta and ochre with black silhouette figures and bronze rim light, a meander border motif, dawn and dusk skies, a letterboxed wide band for cinematic beats, serif capitals.",
  },
];

export const styleById = (id: unknown) => STYLES.find((s) => s.id === id);

export const styleNote = (s: Style) =>
  `VISUAL STYLE (the user picked "${s.name}"; it replaces the default house style, follow it closely): ${s.guidance}`;
