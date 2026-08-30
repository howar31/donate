"""Procedural Tuscan horizon (SVG) for the tuscan skin's foot: rolling hills and cypress trees.

Generates src/skins/tuscan-horizon.svg, a tile that repeats seamlessly along the x axis: two
hill ridges built from sums of sines with the tile's period (so the ends meet), and cypress
silhouettes (narrow flames, slight lean, some in pairs) standing on the front ridge. The hills
use fill-opacity so that, used as a CSS mask, the ridges come out fainter than the trees.
Deterministic: the same seed always produces the same bytes.

    python3 tools/tuscan-horizon.py src/skins/tuscan-horizon.svg [--preview DIR]

--preview DIR also writes horizon-preview.html (light and dark) to DIR.
"""
import argparse
import math
import os
import random

args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
args.add_argument('output', help='path of the SVG to write, e.g. src/skins/tuscan-horizon.svg')
args.add_argument('--preview', metavar='DIR', help='also write horizon-preview.html here')
args = args.parse_args()

W, H = 1600, 260
rng = random.Random(23)


def r(v):
    return str(int(round(v)))


def ridge(base, amps, phases, steps=64):
    """Closed polygon under a periodic ridge line: y(x) = base + sum(a * sin(k * 2pi x / W + p))."""
    pts = []
    for i in range(steps + 1):
        x = W * i / steps
        y = base
        for k, (a, p) in enumerate(zip(amps, phases), start=1):
            y += a * math.sin(k * 2 * math.pi * x / W + p)
        pts.append((x, y))
    d = 'M0 ' + r(H) + 'L' + ' '.join(r(x) + ' ' + r(y) for x, y in pts) + 'L' + r(W) + ' ' + r(H) + 'Z'
    return d, pts


def ridge_y(pts, x):
    x = x % W
    i = min(int(x / W * (len(pts) - 1)), len(pts) - 2)
    x0, y0 = pts[i]
    x1, y1 = pts[i + 1]
    f = (x - x0) / (x1 - x0) if x1 != x0 else 0
    return y0 + (y1 - y0) * f


back_d, back_pts = ridge(140, [30, 20, 12, 7, 4], [0.4, 2.1, 4.0, 1.3, 5.5])
front_d, front_pts = ridge(198, [16, 12, 8, 5, 3], [3.3, 0.9, 5.2, 2.6, 0.2])


def cypress(x, y0, h, w, lean):
    """A cypress: a flame, widest a quarter of the way up, on a short trunk, tip leaning by `lean`."""
    tip = (x + lean, y0 - h)
    b = y0 - 5  # top of the trunk stub
    return ('M' + r(x - 1.2) + ' ' + r(y0) + 'L' + r(x - 1.2) + ' ' + r(b) + 'L' + r(x - w * 0.22) + ' ' + r(b)
            + 'C' + r(x - w * 0.66) + ' ' + r(y0 - h * 0.1) + ' ' + r(x - w * 0.5) + ' ' + r(y0 - h * 0.48) + ' ' + r(tip[0]) + ' ' + r(tip[1])
            + 'C' + r(x + w * 0.5) + ' ' + r(y0 - h * 0.48) + ' ' + r(x + w * 0.66) + ' ' + r(y0 - h * 0.1) + ' ' + r(x + w * 0.22) + ' ' + r(b)
            + 'L' + r(x + 1.2) + ' ' + r(b) + 'L' + r(x + 1.2) + ' ' + r(y0) + 'Z')


def pine(x, y0, h, w):
    """An umbrella pine: a flat canopy dome on a bare trunk."""
    top = y0 - h
    cy = top + h * 0.36   # canopy underside
    return ('M' + r(x - 1.5) + ' ' + r(y0) + 'L' + r(x - 1.5) + ' ' + r(cy + 4) + 'L' + r(x - w / 2) + ' ' + r(cy)
            + 'C' + r(x - w * 0.42) + ' ' + r(top + h * 0.02) + ' ' + r(x + w * 0.42) + ' ' + r(top + h * 0.02) + ' ' + r(x + w / 2) + ' ' + r(cy)
            + 'L' + r(x + 1.5) + ' ' + r(cy + 4) + 'L' + r(x + 1.5) + ' ' + r(y0) + 'Z')


trees = []
# a roadside row, some pairs and singles, two umbrella pines; all kept away from the seam
def cyp(x, h):
    trees.append(cypress(x, ridge_y(front_pts, x) + 3, h, h * rng.uniform(0.2, 0.26), rng.uniform(-3, 3)))

x = 560
for j in range(6):
    cyp(x, rng.uniform(95, 140))
    x += rng.uniform(24, 34)
for gx, n in ((130, 2), (350, 1), (860, 2), (1060, 1), (1250, 3), (1470, 2)):
    x = gx
    for j in range(n):
        cyp(x, rng.uniform(60, 130))
        x += rng.uniform(20, 30)
for px in (440, 1160):
    trees.append(pine(px, ridge_y(front_pts, px) + 3, rng.uniform(60, 75), rng.uniform(60, 80)))

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">' % (W, H)
       + '<path fill-opacity=".42" d="' + back_d + '"/>'
       + '<path fill-opacity=".62" d="' + front_d + '"/>'
       + '<path d="' + ''.join(trees) + '"/>'
       + '</svg>')

with open(args.output, 'w') as f:
    f.write(svg + '\n')

if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    tile = svg.replace('<svg ', '<svg style="height:200px;display:inline-block;vertical-align:bottom" ')
    html = ('<!doctype html><meta charset="utf-8"><body style="margin:0">'
            '<div style="background:#f1e4cc;color:#7a5a3a;padding:40px 0 0;white-space:nowrap;overflow:hidden;fill:currentColor;opacity:.9">' + tile + tile + '</div>'
            '<div style="background:#2b1d13;color:#d9a06a;padding:40px 0 0;white-space:nowrap;overflow:hidden;fill:currentColor;opacity:.9">' + tile + tile + '</div>'
            '</body>')
    with open(os.path.join(args.preview, 'horizon-preview.html'), 'w') as f:
        f.write(html)
