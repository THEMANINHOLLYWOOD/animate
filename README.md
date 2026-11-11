# animate

Describe a film, drop in your files, get a film. A brief (plus images, a video, a song, a deck, a
font…) becomes a short motion-graphics film drawn with Canvas 2D, which you can then edit on a
timeline and export as MP4.

Live: https://animate-navy.vercel.app

## How it works

1. **Director** (`/api/generate`, stage `direct`) turns the brief into a treatment. It first picks
   a register (hype, explainer or story); hype films are written as a shot list on a beat grid.
2. **Animator** (stage `animate`) writes the film as one function,
   `scene(ctx, W, H, t, T, p, lib, assets)`: a pure function of time, drawn with the kit in
   `src/lib/kit.ts` and the effects in `src/lib/fx.ts`.
3. **Review** (`/api/critique`) looks at stills of the film and the animator fixes the worst
   problems, up to two rounds.
4. **Sound** (`/api/audio-plan`, `/api/audio`) plans and generates effects, voice and music, or
   uses the track you attached.

A dropped video with no brief is recreated shot for shot (`/api/elements`, `/api/separate`).
Every stage can be continued where it stopped (`src/lib/resume.ts`).

In the editor (`/editor/[id]`, `src/editor/`), each object the film's code draws with `lib.layer`
is a layer you can move, resize, fade, hide and trim; text is split into text layers; and the
controls the film declares with `lib.controls` become its own panel.

## Where things are

| Path | What |
| --- | --- |
| `src/components/Studio.tsx` | The Studio: composer, build pipeline, library, sound, export |
| `src/lib/prompt.ts` | The director's and animator's instructions |
| `src/lib/kit.ts`, `fx.ts`, `controls.ts` | What a film's code can draw with |
| `src/lib/presets/showcase/` | The example films (also the animator's reference scenes) |
| `src/lib/intake.ts` | Reading any dropped file (see `docs/file-intake.md`) |
| `src/lib/limits.ts` | Rate limits for every route that spends money |
| `src/editor/` | The timeline editor: document, renderer, text split, element layers, agent tools |
| `src/app/api/` | Server routes |
| `public/previews/` | Looping clips for the example tiles (re-render one when its example changes) |

## Running it

```bash
npm install
cp .env.local.example .env.local   # then add ANTHROPIC_API_KEY
npm run dev
```

Only `ANTHROPIC_API_KEY` is required. `.env.local.example` lists every setting and what it turns on.

```bash
npm test        # vitest
npm run lint    # eslint
npx tsc --noEmit -p .
npm run build
```

## Deploying

The project deploys to Vercel with the CLI (`vercel deploy --prod`); there is no Git remote.
Environment variables are set in the Vercel project. On the free plan a request may run for 300
seconds, which is why long stages hand back partial work and continue.

## Notes for agents

Read `AGENTS.md` first: this Next.js version differs from older ones, and its docs ship in
`node_modules/next/dist/docs/`.
