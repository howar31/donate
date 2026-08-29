"""Procedural, seamlessly tileable brick texture (running bond) for the poppy skin band.

Generates skins/poppy-brick.webp. Deterministic: the same seeds always produce the same
bytes, so re-running is a no-op unless the parameters below change.

    python3 -m venv .venv && .venv/bin/pip install numpy pillow
    .venv/bin/python tools/brick-texture.py skins/poppy-brick.webp [--preview DIR]

--preview DIR also writes brick-preview.png and a 2x2 brick-tiled.png (seam check) to DIR.
"""
import argparse
import colorsys
import os

import numpy as np
from PIL import Image

args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
args.add_argument('output', help='path of the WebP tile to write, e.g. skins/poppy-brick.webp')
args.add_argument('--preview', metavar='DIR', help='also write brick-preview.png and brick-tiled.png here')
args = args.parse_args()

W, H = 720, 360          # tile in device px; CSS shows it at 480x240 (1.5x)
PW, PH = 180, 60         # brick pitch (brick + mortar)
BW, BH = 170, 50         # brick face
COLS, ROWS = W // PW, H // PH
rng = np.random.default_rng(31)

def periodic_blur(a, sigma, sigma_y=None):
    """Gaussian blur with wrap-around edges via FFT, so the result stays tileable."""
    sy = sigma if sigma_y is None else sigma_y
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.fftfreq(a.shape[1])[None, :]
    g = np.exp(-2 * (np.pi ** 2) * ((sigma ** 2) * fx ** 2 + (sy ** 2) * fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))

def noise(sigma, sigma_y=None):
    n = periodic_blur(rng.standard_normal((H, W)), sigma, sigma_y)
    return n / (n.std() + 1e-9)

yy, xx = np.mgrid[0:H, 0:W]
row = yy // PH
offset = np.where(row % 2 == 1, PW // 2, 0)
xs = (xx + offset) % W
col = xs // PW
u = xs % PW
v = yy % PH

# Edge irregularity: brick outlines wobble by a pixel or two.
wob = noise(2.0) * 0.7
u_eff = u + wob
v_eff = v + wob
brick = (u_eff >= 0) & (u_eff < BW) & (v_eff >= 0) & (v_eff < BH)
# Slight corner rounding / chipping.
du = np.minimum(u_eff, BW - 1 - u_eff)
dv = np.minimum(v_eff, BH - 1 - v_eff)
corner = (du < 3) & (dv < 3) & ((3 - du) ** 2 + (3 - dv) ** 2 > 9)
brick &= ~corner

# Per-brick base colour (seeded by row/col so the tile wraps).
base = np.zeros((H, W, 3))
for r in range(ROWS):
    for c in range(COLS):
        k = np.random.default_rng(1000 + r * 97 + c)
        kind = k.random()
        if kind < 0.10:     # clinker: dark, purplish
            h, s, val = 0.985 + k.random() * 0.02, 0.45 + k.random() * 0.1, 0.30 + k.random() * 0.08
        elif kind < 0.22:   # pale, orange-leaning
            h, s, val = 0.02 + k.random() * 0.02, 0.50 + k.random() * 0.1, 0.62 + k.random() * 0.1
        else:               # standard brick red
            h, s, val = 0.995 + k.random() * 0.03, 0.55 + k.random() * 0.15, 0.42 + k.random() * 0.16
        rgb = colorsys.hsv_to_rgb(h % 1.0, s, val)
        m = (row == r) & (col == c)
        base[m] = rgb

# Surface: coarse mottling, medium blotches, fine grain, sand speckle.
mottle = noise(14.0) * 0.06 + noise(5.0) * 0.045 + noise(1.2) * 0.04 + noise(9.0, 1.4) * 0.05
speck = (rng.random((H, W)) < 0.012) * (rng.random((H, W)) - 0.5) * 0.35
shade = 1.0 + mottle + speck
# Bevel: top/left catches light, bottom/right falls into shadow.
tl = np.exp(-np.minimum(u_eff, v_eff * 1.6) / 2.2)
br = np.exp(-np.minimum(BW - 1 - u_eff, (BH - 1 - v_eff) * 1.6) / 2.8)
shade += 0.08 * tl - 0.20 * br
face = base * shade[..., None]

# Mortar: sandy grey, grainy, recessed under each brick.
mortar_rgb = np.array([0.64, 0.60, 0.55])
grain = 1.0 + noise(0.8) * 0.09 + noise(3.0) * 0.06 + (rng.random((H, W)) - 0.5) * 0.10
# distance below the brick above (v >= BH) or right of a brick (u >= BW): shadow
dy = np.where(v_eff >= BH, v_eff - BH, PH - v_eff)     # distance into the horizontal joint
dx = np.where(u_eff >= BW, u_eff - BW, PW - u_eff)
recess = 1.0 - 0.28 * np.exp(-np.clip(dy, 0, None) / 3.5) - 0.18 * np.exp(-np.clip(dx, 0, None) / 3.0)
mortar = mortar_rgb * (grain * recess)[..., None]

img = np.where(brick[..., None], face, mortar)
img = np.stack([periodic_blur(img[..., i], 0.55) for i in range(3)], axis=-1)
img = np.clip(img, 0, 1)
out = Image.fromarray((img * 255).astype(np.uint8))
out.save(args.output, 'WEBP', quality=80, method=6)
print(f'wrote {args.output} ({os.path.getsize(args.output)} bytes)')
if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    out.save(os.path.join(args.preview, 'brick-preview.png'))
    # 2x2 tiled preview to check the seams
    tiled = Image.new('RGB', (W * 2, H * 2))
    for i in range(2):
        for j in range(2):
            tiled.paste(out, (i * W, j * H))
    tiled.save(os.path.join(args.preview, 'brick-tiled.png'))
    print(f'previews in {args.preview}')
