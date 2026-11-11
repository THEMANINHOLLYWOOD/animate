# animate Studio — Editor implementation plan

> **Historical.** This is the plan the editor was started from (October 2026), kept for its reasoning.
> What was built differs: the renderer is Canvas 2D (`src/editor/render/renderDoc.ts`), not PixiJS;
> films are still written as code, with text split into layers (`src/editor/extract/splitText.ts`),
> each object a `lib.layer` part (`extract/parts.ts`) and each film's own controls (`src/lib/controls.ts`);
> the agent edits through tools replayed as operations (`src/editor/ai/tools.ts`), not JSON Patch; the
> doc is saved on the film. Guests can create without an account. See `README.md` for how things are now.

Goal: turn animate from "generate and export" into a full editor. It should feel like **Figma** on the canvas (select, move, edit text in place, layers) and **Premiere / After Effects** on the timeline (tracks, trims, keyframes, curves, effects, audio, video). Any animation, whether Claude made it or a person built it, can be broken down and edited down to the last keyframe. Claude can generate the audio for every film: voiceover, music and sound effects.

## Status (updated 2026-10-07)

Shipped and verified end to end in a browser (local mode, real Anthropic + ElevenLabs + Blob):
- Phase 0–1: document schema, interpolation, ops, undo; a 63-layer sample film as a doc; `/editor/[id]` with canvas select/move, inspector, Premiere-style timeline (clips, trims, keyframe diamonds), mobile layout.
- Editing agent (`/api/agent`): strict tools mapped to the same ops; one undo step per request; verified on a multi-layer retime.
- Sound: reference-video stems (ElevenLabs isolation + transcription, aligned subtraction for the background), Claude sound plan (structured output), ElevenLabs VO (with word timing) and SFX (3-at-a-time queue), music on paid plans; sound strip; playback locked to the picture; MP4 export with AAC.
- Recreate mode: a dropped video or X link with no brief is rebuilt shot for shot. The video is **stripped into elements** (`/api/elements`): every text/shape/image becomes an editable layer with keyframes; a code layer underneath draws the leftovers. Films are saved as documents, open in the editor, and chat edits go through the agent.
- Chat thread per film with revert; progress panel with Claude's reasoning; favorites; public share links.

Next, in order: audio on the editor timeline (Phase 5 UI), agent tools for sound, Mediabunny export, graph editor (Phase 3), effects/masks (Phase 4), re-voice from transcript, song identification via a fingerprint service.

---

## 1. The one decision everything rests on

Today a film is **opaque code** (`scene(ctx, W, H, t, …)`). Code can't be edited with handles and curves. So the source of truth becomes a **scene document**: structured JSON describing layers, keyframes, effects and audio. Code is kept only where it earns its place, as a **code layer** for generative effects (particle fields, globes, flow fields). Each code layer declares its parameters so they still show up as sliders.

```
Doc
├─ meta        { id, title, size {w,h}, fps, duration, background, version }
├─ assets[]    { id, kind: image|video|audio|font, src (blob path), meta }
├─ layers[]    (tree, top = front)
│   └─ Layer   { id, name, type, parentId, start, end, locked, hidden, blend,
│                transform { x, y, scale, rotation, anchor, opacity },
│                props     (type-specific: text, font, fill, stroke, path, src, code, params…),
│                anim      { "<propPath>": Keyframe[] },
│                effects[] { id, type, enabled, params (keyframable) },
│                mask?     { layerId, mode: alpha|luma|inverted } }
├─ audio[]     { id, assetId, track, start, in, out, gain: Keyframe[], fadeIn, fadeOut, role: vo|music|sfx }
└─ markers[]   { t, label, kind: beat|word|cue }

Keyframe { t (seconds, layer-local), v (number | number[] | color | string),
           ease: "linear" | "hold" | { bezier: [x1,y1,x2,y2] } | { spring: { k, c } } }
```

Layer types: `text`, `shape` (rect / ellipse / path), `image`, `video`, `group`, `code`, `globe`, `chart`, `particles`, `waveform`.

**Changing the length** still works: retime = scale every `t` (proportionally, or by ripple from a point).

---

## 2. Architecture

| Concern | Choice | Why |
|---|---|---|
| Rendering | **PixiJS v8** (WebGL2, WebGPU when available) | GPU effects (blur, glow, colour grade, displacement) at 60 fps; mature text and masks; filter ecosystem |
| Code layers | Run on an OffscreenCanvas 2D, uploaded as a Pixi texture | Keeps every existing scene and kit working |
| State | **Zustand + Immer patches** | Undo/redo from patches, cheap selectors for big docs |
| Clock | `AudioContext.currentTime` is the master clock during playback | Audio and picture stay in sync; video frames follow audio |
| Media I/O | **Mediabunny** (replaces `mp4-muxer`, which is deprecated) | Demux and decode imported video, encode video + AAC audio, mux MP4 |
| Audio engine | Web Audio graph; `OfflineAudioContext` for export | Mixer, gain automation, ducking, master limiter |
| Audio generation | **ElevenLabs API** (TTS with timestamps, Music, Sound Effects) | One provider for voice, music and SFX; word timings drive captions and sync |
| AI editing | Claude with **strict tools** emitting JSON Patch against the doc | Precise, reviewable edits instead of regenerating the whole film |
| Persistence | Existing private Vercel Blob: `docs/<id>.json`, versioned snapshots | Already wired, per-user |
| Tests | Vitest (doc ops, interpolation, retime), Playwright (editor flows), golden-frame tests (render → PNG hash) | Rendering regressions are caught automatically |

Folder layout to create:

```
src/editor/
  doc/        schema.ts (zod), ops.ts (pure edits), interpolate.ts, retime.ts, migrate.ts
  render/     PixiRenderer.ts, layers/*.ts, effects/*.ts, codeLayer.ts
  audio/      engine.ts, mixer.ts, waveform.ts, export.ts
  media/      import.ts, videoSource.ts (mediabunny), exportMp4.ts
  store/      store.ts, history.ts, selection.ts
  ui/         Canvas.tsx, Timeline.tsx, GraphEditor.tsx, Inspector.tsx, Layers.tsx, Assets.tsx, Toolbar.tsx
  ai/         tools.ts (patch tool schemas), director.ts, audioDirector.ts
src/app/editor/[id]/page.tsx
```

---

## 3. Phases

Each phase ships something usable, ends with tests green, and is deployed.

### Phase 0: Foundations (doc, store, renderer)
1. Write `schema.ts` with zod schemas for `Doc`, `Layer`, `Keyframe`, `Effect`, `AudioClip`, plus a `version` field and `migrate.ts`.
2. Write `interpolate.ts`: value-at-time for numbers, vectors, colours (OKLab mixing) and strings (hold). Ease kinds: linear, hold, cubic-bézier (Newton–Raphson solve), spring (analytic). Unit tests: endpoints, monotonic beziers, hold behaviour.
3. Write `ops.ts`: pure functions (`addLayer`, `moveLayer`, `setProp`, `addKeyframe`, `moveKeyframes`, `trimLayer`, `splitLayer`, `retime`, `group`, `ungroup`), each returning a new doc. Unit tests for each.
4. Write `store.ts` and `history.ts`: Zustand store; every op goes through `apply(op)` → Immer patches → undo/redo stacks with coalescing (a drag is one undo step).
5. Write `PixiRenderer.ts`: `renderFrame(doc, t)`, with layer renderers for text, shape, image and group. Golden-frame tests.
6. Port the kit into `codeLayer.ts` so existing scenes render as a code layer inside a doc. **Acceptance:** the sample film plays identically as `{ layers: [codeLayer] }`.

### Phase 1: Player and timeline (read-only)
1. `/editor/[id]` route with a four-panel layout: Layers | Canvas | Inspector, with the Timeline along the bottom. Resizable panes, saved per user.
2. Transport: play/pause, J/K/L shuttle, frame step (← →), loop in/out (I / O), time display in frames and timecode.
3. Timeline: ruler with adaptive ticks, zoom (pinch, ⌥-scroll), playhead scrub, one row per layer with its clip bar, expandable property rows showing keyframe diamonds.
4. **A sample film rebuilt as a native doc** (text, shape, globe and waveform layers), the reference for everything after.

**Acceptance:** opening any saved film shows its full timeline, scrubbing is frame-accurate, and 60 fps playback holds on an M1 at 1080p.

### Phase 2: Figma-style canvas editing
1. Selection: click, shift-click, marquee, hover outlines, select through groups (⌘-click).
2. Transform handles: move, scale (⇧ for aspect lock), rotate, anchor point; snapping to edges, centres, other layers and safe area, with smart guides and distance labels.
3. Text editing in place: double-click opens a contentEditable overlay that matches the Pixi text metrics exactly; commit on blur or Esc.
4. Inspector: position, size, rotation, opacity, fill, stroke, corner radius, typography (family, weight, size, tracking, leading, alignment), blend mode.
5. Layers panel: tree, rename, reorder by drag, show/hide, lock, group (⌘G) and ungroup.
6. Tools: Move (V), Text (T), Rectangle (R), Ellipse (O), Pen (P, bezier paths), Hand (Space), Zoom (Z).
7. Clipboard: copy, paste and duplicate layers within and across docs.

**Acceptance:** a person can build a 3-beat title animation from scratch without touching code.

### Phase 3: Keyframes and the graph editor
1. A stopwatch per property: the first edit creates a keyframe, and later edits at a different time add keyframes (auto-key mode toggle).
2. Keyframe editing on the timeline: select, box-select, drag (snap to frames, playhead, markers and other keys), copy/paste, delete, and ease presets from the right-click menu.
3. **Graph editor** (After Effects style): a value graph and a speed graph per property, bezier handles, multi-curve overlay, fit-to-view, plus presets (ease in, ease out, overshoot, spring, linear, hold).
4. Motion paths: draw the position path on the canvas with spatial bezier handles.
5. Retime: a length change scales all keys; a ripple retime acts from the playhead; time-stretch individual layers.

**Acceptance:** any curve in an imported or generated film can be found, inspected and re-shaped.

### Phase 4: Effects, masks, transitions
1. An effects stack per layer (add, reorder, toggle, keyframe any parameter): Gaussian blur, directional/motion blur, glow, drop shadow, colour grade (lift/gamma/gain, saturation), tint, noise/grain, chromatic aberration, displacement, pixelate, vignette.
2. Masks: alpha, luma and inverted track mattes; shape masks with feather and expansion.
3. Text animators: per character, word or line range selectors driving offset, opacity, blur and scale (the "words reveal" made editable).
4. Transitions as presets that write real keyframes and effects (crossfade, push, wipe, mask reveal, morph-match), so they stay editable afterwards.
5. Adjustment layers (effects applied to everything beneath).

### Phase 5: Audio and video tracks
1. Switch export to **Mediabunny**: canvas → VideoEncoder, mix → AudioEncoder (AAC), muxed MP4. Keep the faster-than-real-time export.
2. Audio engine: Web Audio graph per clip (gain automation, fades) → track busses → master limiter; sample-accurate scheduling against the transport.
3. Audio on the timeline: waveforms computed in a worker and cached as peaks; trim, split, slip, fades, gain rubber-band; mute, solo and volume per track.
4. Video import: Mediabunny demux/decode for frame-accurate seeking; video as a layer (transform, effects, masks); trim, speed, freeze frame.
5. Imports of mp3/wav/m4a and mp4/mov/webm, all stored in Blob.

**Acceptance:** export a film with music, voiceover and a video clip, and the A/V sync drifts less than one frame over 90 s.

### Phase 6: Generated audio for every film (ElevenLabs)
1. Server routes: `/api/audio/voice` (TTS with timestamps), `/api/audio/music` (composition plan sized to the film), `/api/audio/sfx`. Key in `ELEVENLABS_API_KEY`; results cached in Blob by content hash.
2. **Audio director (Claude):** reads the doc and treatment, then writes (a) a VO script timed to the beats, (b) a music brief (genre, BPM, energy curve, sections aligned to beats, duration), and (c) an SFX cue list (whooshes on transitions, ticks on counters, risers before reveals).
3. Auto-sync: TTS word timestamps → markers, which can (a) snap text-reveal keyframes to spoken words and (b) build captions.
4. Beat sync: onset/beat detection on the music, beat markers, and a "snap keys to beats" command.
5. Auto-mix: duck the music under the voiceover (sidechain-style gain automation written as editable keyframes), loudness-normalise to −14 LUFS for export.
6. One click, **"Score this film"**: the whole pipeline runs, and every result lands as normal, editable clips.

### Phase 7: AI as an editor, and breaking down any animation
1. Generation writes **docs, not code**: the Animator stage returns doc JSON through strict tool schemas, and code layers appear only for generative parts.
2. **"Break apart"**: Claude converts any existing code scene (including old projects) into a native doc (texts, shapes and keyframes extracted), with code layers only for what can't be decomposed.
3. **Ask Claude** on a selection or the whole doc ("make this bouncier", "swap to the brand palette", "translate all text to Spanish", "add a beat-synced intro"). Claude returns JSON Patch ops that are previewed as a diff (ghost layers and keys) before they're applied, and are fully undoable.
4. Link research (shipped) feeds the brand kit into doc styles: colours, fonts and logo as assets.

### Phase 8: Polish and scale
Performance (layer caching, dirty rects, workers for code layers), a 4K export option, templates gallery, share links (view-only player), comments on frames, version history with restore, real-time collaboration (Yjs over Liveblocks or PartyKit), usage limits per user, and billing if needed.

---

## 4. Order of work and sizing

| Phase | Depends on | Rough size |
|---|---|---|
| 0 Foundations | — | 1–1.5 weeks |
| 1 Player + timeline | 0 | 1 week |
| 2 Canvas editing | 1 | 1.5–2 weeks |
| 3 Keyframes + curves | 1 | 1.5 weeks |
| 4 Effects + masks | 2, 3 | 1.5 weeks |
| 5 Audio + video + Mediabunny export | 1 | 1.5–2 weeks |
| 6 Generated audio | 5 | 1 week |
| 7 AI editor + break apart | 3, 4 | 1.5 weeks |
| 8 Polish / collab | all | ongoing |

Phases 2/3 and 5 can run in parallel after Phase 1.

## 5. Risks and mitigations
- **Text fidelity** between Pixi and the in-place editor: one shared layout engine (measure once, render twice), plus golden tests.
- **Browser support**: WebCodecs audio encode is newer in Safari, so fall back to real-time MediaRecorder export; editing works everywhere.
- **Performance with many layers or code layers**: cache static layers as textures; run code layers in workers via OffscreenCanvas.
- **AI edits breaking docs**: zod validation on every patch, a preview before apply, and undo.
- **Cost**: per-user generation quotas; cache audio by hash; Claude prompt caching is already on.

## 6. What's needed from the owner
- `ELEVENLABS_API_KEY` (Phase 6).
- Clerk terms accepted on Vercel (accounts are needed before generation is public).
- Anthropic credits and a monthly spend limit.

Sources: [Mediabunny](https://mediabunny.dev/) (supersedes [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)), [ElevenLabs API](https://elevenlabs.io/api), [TTS with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps), [ElevenLabs Music](https://www.mintlify.com/elevenlabs/elevenlabs-python/api-reference/audio/music).
