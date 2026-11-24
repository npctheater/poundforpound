"""Build the web heavy-bag assets from the game's own sources (rerun after the game's bag look or sounds change).

Textures: Unity Shared/Bag/Look/Resources/HeavyBagV2/ BlackGold_Albedo (4096 sRGB, AO baked), BlackGold_Pack
(2048: RG normal, B gloss, A metal; A is non-zero only in the metal swatch, so it is dropped and
the shader takes metal from the part type, which is what the hardware UVs sample) and Grain (512) -> WebP at web sizes.
Audio: the shipped bag-hit path (see ../README.md): the L3 baked punch family (13 damage anchors x 8 variants) and the
RingFoley chain grains (ch_clink/rattle/settle/creak/clank) -> two mono AAC sprites + a JSON index of clip offsets.

Usage:  python build_assets.py            (writes ../../../assets/bag/)
Needs ffmpeg + ImageMagick on PATH, numpy + soundfile.
"""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "..", ".."))
VRB = os.path.join(HUB, "Unity VR Boxing", "Assets", "VRBoxing")
LOOK = os.path.join(VRB, "Shared", "Bag", "Look", "Resources", "HeavyBagV2")
L3 = os.path.join(VRB, "Audio", "PunchFamilies", "L3")
FOLEY = os.path.join(VRB, "Audio", "RingFoley")
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "assets", "bag"))

SR = 48000
PAD = 0.06          # silence between sprite clips, s (absorbs AAC priming / edge error)
ANCHORS = [10, 20, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 100]
VARIANTS = 8
CHAIN = {"clink": 14, "rattle": 6, "settle": 3, "creak": 9, "clank": 5}


def run(cmd):
    print(" ".join(cmd))
    subprocess.run(cmd, check=True)


def load_mono(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        raise SystemExit(f"{path}: expected {SR} Hz, got {sr}")
    return x


def sprite(items, name, kbps):
    """items: list of (key, wav path). Writes <name>.m4a and returns {key: [start_s, dur_s]}."""
    parts, index, t = [np.zeros(int(PAD * SR), np.float32)], {}, PAD
    for key, path in items:
        x = load_mono(path)
        index[key] = [round(t, 5), round(len(x) / SR, 5)]
        parts += [x, np.zeros(int(PAD * SR), np.float32)]
        t += len(x) / SR + PAD
    y = np.concatenate(parts)
    peak = float(np.max(np.abs(y)))
    if peak > 1.0:
        raise SystemExit(f"{name}: source peaks at {peak:.3f}; refusing to clip")
    tmp = os.path.join(OUT, f"_{name}.wav")
    sf.write(tmp, y, SR, subtype="FLOAT")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-c:a", "aac", "-b:a", f"{kbps}k",
         "-movflags", "+faststart", os.path.join(OUT, f"{name}.m4a")])
    os.remove(tmp)
    return index


def main():
    os.makedirs(OUT, exist_ok=True)
    # textures
    run(["magick", os.path.join(LOOK, "BlackGold_Albedo.jpg"), "-resize", "2048x2048", "-quality", "84",
         os.path.join(OUT, "bag_albedo.webp")])
    run(["magick", os.path.join(LOOK, "BlackGold_Pack.png"), "-alpha", "off", "-resize", "1024x1024", "-quality", "92", os.path.join(OUT, "bag_pack.webp")])
    run(["magick", os.path.join(LOOK, "Grain.png"), "-resize", "256x256", "-quality", "90",
         os.path.join(OUT, "bag_grain.webp")])
    # audio
    hits = [(f"d{a:03d}_v{v}", os.path.join(L3, f"hit_d{a:03d}_v{v}.wav")) for a in ANCHORS for v in range(VARIANTS)]
    chain = [(f"{k}_{i:02d}", os.path.join(FOLEY, f"ch_{k}_{i:02d}.wav")) for k, n in CHAIN.items() for i in range(1, n + 1)]
    index = {"sr": SR, "hits": sprite(hits, "bag_hits", 96), "chain": sprite(chain, "bag_chain", 80),
             "anchors": ANCHORS, "variants": VARIANTS, "chainCounts": CHAIN,
             "source": "Unity VR Boxing/Assets/VRBoxing/Audio/PunchFamilies/L3 + Audio/RingFoley (ch_*)"}
    with open(os.path.join(OUT, "bag_audio.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT))
    print(f"assets/bag total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    sys.exit(main())
