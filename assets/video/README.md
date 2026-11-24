# Body-tracking highlight clips

Real fights, replayed. Each clip is the game's own replay of a recorded fight between the game's owner (in VR, his body
drawn by the Body Double network from headset and controllers) and the single-player bot, re-rendered in the game itself
(Unity, headless batch render of the replay playback, the in-game gym and character looks) with a scripted cinematic camera.
No AI generation, no compositing; only a light grade (contrast 1.04, saturation 1.05). Both fighters wear Cole.

Rendered 2560x1440 MSAA 8x, delivered 1920x1080 30 fps: `.mp4` H.264 (faststart, the page loads these), `.webm` VP9,
`.jpg` poster frame. Each file is under 6 MB.

| File | Fight | Recorded (UTC) | Replay window | Camera |
|---|---|---|---|---|
| hero | 8289eaa9 (single player vs Cole, 3 rounds) | 2026-11-21 22:48:30 | 272.4-277.0 s | slow orbit, reveals the neon sign |
| clip1 | d1a6d2d3 (single player vs Cole, 2 rounds) | 2026-11-22 01:17:05 | 280.83-285.4 s | low ringside |
| clip2 | 8289eaa9 | 2026-11-21 22:48:30 | 159.27-~162.6 s (one short 0.4x slow section at 161.25-161.75 s) | block and counter, dolly |
| clip3 | 8289eaa9 | 2026-11-21 22:48:30 | 67.0-70.5 s | side-on |

Body proportions: only fights from build 101.1 onward (natural model proportions, arm length matched to the player) are
used; earlier recordings carry the old fit and were rejected. Times above are fight-clock seconds from the replay's first
frame. Clips were checked frame by frame by a fresh reviewer; a clip ending with a head thrown far back, a one-frame
background flash and an awkward closing squat were trimmed or dropped.
