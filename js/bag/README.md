# Heavy bag (site component)

The game's heavy bag, live on the page: click or tap where you hit it, swipe through it to hit harder. It is the
shipped Black & Gold v2 bag running the game's own maths and sounds, ported from Unity `Assets/VRBoxing/Shared/Bag/`.

## Mount

```js
import { mountHeavyBag } from './js/bag/heavy-bag.js';   // needs the "three" import map entry (vendor/three)

const bag = mountHeavyBag(document.getElementById('bag'), { /* options */ });
await bag.ready;            // resolves once textures, audio and shaders are up (it lazy-inits near the viewport)
bag.hit(90, 0, 0.6);        // programmatic hit: damage 0..100, u -1..1 across the camera-facing side, v 0..1 bottom to top
bag.setMuted(true);         // bag.muted reads it back
bag.dispose();
```

The container just needs a size; the canvas fills it (`position: absolute; inset: 0`) and is transparent, so the
section's own background shows behind the bag. The component adds its own small overlays inside the container: the
hit readout, the hint, and the mute button.

| option | default | |
|---|---|---|
| `base` | `../../assets/bag/` relative to this file | asset folder URL |
| `lazy` | `true` | build only when the container comes within `rootMargin` of the viewport |
| `rootMargin` | `'400px'` | IntersectionObserver margin for the lazy build |
| `readout` | `true` | damage number beside the bag, fades in about 1.2 s |
| `hint` | `true` | "CLICK OR SWIPE THE BAG" ("TAP OR SWIPE" on touch), top left; hides after the first hit |
| `muteButton` | `true` | speaker toggle, top right of the container |
| `maxPixelRatio` | `2` | DPR cap |
| `exposure` | `1.8` | overall brightness |
| `waveScale` | `1` | travelling-ripple amplitude; 1 is the game's (see Notes) |
| `onHit` | `null` | `({ damage, unit }) => {}` |

Events on the container: `bag:ready`, and `bag:hit` with `detail = { damage, unit }`.

## Behaviour

- **Input.** pointerdown on the bag hits at once. A plain tap is a solid shot (about 78 to 86 damage, high enough that every tap shows the game's ripple, which starts at 70 and is faint below about 78). Pointer speed
  into the bag, measured in short-side lengths per second over the last 110 ms, carries it up to 100, so a fast mouse
  flick or a thumb swipe from outside into the bag lands a full shot. Held swipes can land further hits, at least
  200 ms apart. The punch comes from a boxer standing in front, so a side hit glances and twists; a swipe's sideways
  motion bends it further. The canvas sets `touch-action: pan-y`, so vertical swipes still scroll the page.
- **Response** (`bag-sim.js`): `HeavyBagSolver` (critically damped swing and twist with soft-knee ceilings, elastic
  dent with a 0.12 s hold and the end bulge), `HeavyBagResidual` (six relaxing dent sites), `HeavyBagWave` (the
  travelling ripple, from damage 70), the impact stamp from `HeavyBagMark.hlsl` and `HeavyBagPresenter`, the soft
  impact cue, and the hoist-chain jolt from `HeavyBagLook`. It uses the shipped configuration: Default x SwingLevels
  DEFAULT x HeavyBagEmphasis 1.25.
- **Look** (`bag-shader.js`): `HeavyBagV2.shader` ported to GLSL3, using the game's albedo, normal and gloss maps plus
  the grain detail map. The gym's light probe is replaced by a fixed night-gym L0+L1 set, with a warm key that
  follows the cursor slightly. The mesh is generated in the browser by a port of `HeavyBagV2Geometry.cs`, so it costs
  no download.
- **Sound** (`bag-audio.js`): the game's L3 bag punch family (13 damage anchors x 8 variants, neighbouring anchors
  blended, never the same variant twice in a row, ±45 cents, stack duck) plus the RingFoley chain grains, planned the
  way `BagChainGrainPlanner` does on impact and on swing reversals. They play through a port of the game room's
  early taps, slap, and `SynthGymIr` late tail. Audio unlocks on the first click, or on a tap's pointerup/touchend (a touch pointerdown is not a user gesture); the first tap's sound is held and played the moment audio unlocks, so it is not lost. The
  sources are recorded samples, never synthesized.
- **Cost.** It draws only while the bag moves: it stays awake 9 s after a hit, then stops. It pauses offscreen and in
  hidden tabs. The scene is 4 draw calls and 40k triangles. `prefers-reduced-motion` turns off the camera parallax
  only; the bag's physics stay the same.

## Assets (`assets/bag/`, 1.60 MB total)

| file | bytes | source |
|---|---|---|
| `bag_albedo.webp` | 702,928 | game albedo 4096, scaled to 2048, WebP q84 |
| `bag_pack.webp` | 45,814 | normal XY + gloss 2048, scaled to 1024 (alpha dropped: metal comes from the mesh part) |
| `bag_grain.webp` | 26,212 | leather grain detail, 256 |
| `bag_hits.m4a` | 610,592 | L3 punch family, mono AAC 96k sprite |
| `bag_chain.m4a` | 215,068 | RingFoley chain grains, mono AAC 80k sprite |
| `bag_audio.json` | 4,285 | sprite offsets, anchors, variants |

Rebuild from the Unity sources with `python tools/build_assets.py` (needs ffmpeg and cwebp). Sprite clips sit 60 ms
apart, and each voice fades in over the 2 ms of padding just before its slice so the punch's crack is never blunted.

## Notes

- **Ripple at 90+.** With the game's numbers (`waveScale: 1`) a 90 to 100 hit sends a wave that visibly bends the
  bag's whole outline for about half a second. In the headset at arm's length that reads as the bag's juice; on a
  screen showing the whole bag, a fresh reviewer called it water-balloon-like. `waveScale: 0.5` keeps the dent and
  the highlight streak and calms the outline. The default stays game-faithful until the owner picks.
- **Stamp.** The impact stamp is the game's: it darkens to 0.16 albedo. On this near-black leather under the night
  light it is barely perceptible here (not compared against the game in the headset).

- **Stamp size.** The brief quoted a 0.335 footprint; the game ships 0.67, after the owner's 2026-08-19 "double its
  size" ruling (`HeavyBagPresenter`). This port follows the game.
- **Harness.** `_dev/bag.html` is the standalone test page, with a HUD (fps, swing, dent, audio state). Debug hooks
  live on `bag._debug` (`state()`, `manual(on)` + `advance(dt)` for deterministic clip capture, `look`, `SH`).
- **Caching.** The dev server sends no cache headers, so after editing a module, refetch it with
  `fetch(url, {cache: 'reload'})` or hard-reload the page.
