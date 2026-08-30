"""Procedural cherry blossom ornaments (SVG) for the blush skin.

Writes three compact SVGs next to the given output path, all deterministic (same seed, same
bytes), used by blush.css as mask-images (the build inlines them), so colour comes from skin
tokens and only the shapes live here:

- <name>-branch.svg  the wood: a gnarled branch reaching in from the top-right corner, its
                     twigs and every flower stalk (one silhouette, one paint)
- <name>-bloom.svg   the flowers: five notched petals each, plus buds, in the same viewBox
                     and at the same coordinates as the branch, so the two layers register
- <name>-petals.svg  a seamless tile of loose petals (repeats in x and y) that the skin
                     scrolls downward for the petal fall

    python3 tools/blush-sakura.py src/skins/blush.svg [--preview DIR]

The output argument is a stem: src/skins/blush.svg produces blush-branch.svg, blush-bloom.svg
and blush-petals.svg. --preview DIR also writes sakura-preview.html (light and dark) to DIR.
"""
import argparse
import math
import os
import random

args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
args.add_argument('output', help='stem of the SVGs to write, e.g. src/skins/blush.svg')
args.add_argument('--preview', metavar='DIR', help='also write sakura-preview.html here')
args = args.parse_args()

VB_W, VB_H = 900, 900
TILE_W, TILE_H = 800, 1000
rng = random.Random(7)


def r(v):
    return '%d' % round(v)


def rr(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


# --- curves ----------------------------------------------------------------------------------
def bezier(p0, p1, p2, p3):
    def f(t):
        s = 1 - t
        return (s ** 3 * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t ** 3 * p3[0],
                s ** 3 * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t ** 3 * p3[1])
    return f


def quad(p0, p1, p2):
    def f(t):
        s = 1 - t
        return (s * s * p0[0] + 2 * s * t * p1[0] + t * t * p2[0],
                s * s * p0[1] + 2 * s * t * p1[1] + t * t * p2[1])
    return f


def tapered(curve, w0, w1, wobble=0.0, samples=60):
    """Closed polygon around a curve, width falling from w0 to w1, with an optional sideways
    wobble (two sines) so the wood looks knotted rather than piped."""
    pts = [curve(i / samples) for i in range(samples + 1)]
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        u = i / samples
        ax, ay = pts[min(i + 1, samples)]
        bx, by = pts[max(i - 1, 0)]
        tx, ty = ax - bx, ay - by
        n = math.hypot(tx, ty) or 1
        nx, ny = -ty / n, tx / n
        off = wobble * (math.sin(u * 9.3) * 0.6 + math.sin(u * 23.1 + 1.2) * 0.4)
        w = (w0 + (w1 - w0) * u) * (1 + 0.12 * math.sin(u * 17.7 + 0.5)) / 2
        left.append((x + nx * (w + off), y + ny * (w + off)))
        right.append((x - nx * (w - off), y - ny * (w - off)))
    d = 'M' + ' '.join(r(x) + ' ' + r(y) for x, y in left)
    d += ' ' + ' '.join(r(x) + ' ' + r(y) for x, y in reversed(right))
    return d + 'Z'


def tangent(curve, t):
    a = curve(min(1, t + 0.01))
    b = curve(max(0, t - 0.01))
    n = math.hypot(a[0] - b[0], a[1] - b[1]) or 1
    return ((a[0] - b[0]) / n, (a[1] - b[1]) / n)


# --- the branch ------------------------------------------------------------------------------
# Two limbs fan out from beyond the top-right corner: the upper one bows down and to the left
# across the tile, the lower one runs flatter and shorter beneath it.
LIMBS = (
    (bezier((940, -30), (700, 70), (400, 250), (130, 620)), 30, 6,
     ((0.2, 1, 150), (0.32, -1, 210), (0.44, 1, 170), (0.56, -1, 200), (0.68, 1, 150), (0.8, -1, 170), (0.9, 1, 110))),
    (bezier((960, 150), (760, 240), (560, 330), (300, 340)), 22, 5,
     ((0.25, -1, 150), (0.42, 1, 120), (0.58, -1, 170), (0.74, 1, 140), (0.9, -1, 150))),
)
wood = []
twigs = []      # (curve, w0) for the flower stalks to hang from
for limb, w0, w1, twig_spec in LIMBS:
    wood.append(tapered(limb, w0, w1, wobble=3.0, samples=36))
    # Twigs leave the limb alternately above and below it; each bends toward the drooping side.
    for u, side, length in twig_spec:
        x, y = limb(u)
        tx, ty = tangent(limb, u)
        a = math.radians(38 + rng.uniform(-6, 6)) * side
        dx = tx * math.cos(a) - ty * math.sin(a)
        dy = tx * math.sin(a) + ty * math.cos(a)
        ex, ey = x + dx * length, y + dy * length + 0.25 * length     # gravity
        cx, cy = x + dx * length * 0.55, y + dy * length * 0.55 - 0.05 * length
        twig = quad((x, y), (cx, cy), (ex, ey))
        tw = (12 - 3 * u) * w0 / 30
        wood.append(tapered(twig, tw, 3, wobble=1.2, samples=16))
        twigs.append((twig, tw))
        # a short spur off the outer half of the twig
        if length > 140:
            sx, sy = twig(0.62)
            stx, sty = tangent(twig, 0.62)
            b = math.radians(-50 * side + rng.uniform(-8, 8))
            sdx = stx * math.cos(b) - sty * math.sin(b)
            sdy = stx * math.sin(b) + sty * math.cos(b)
            spur = quad((sx, sy), (sx + sdx * 30, sy + sdy * 30 + 4), (sx + sdx * 60, sy + sdy * 60 + 14))
            wood.append(tapered(spur, 6, 2.5, samples=10))
            twigs.append((spur, 6))

# --- flowers ---------------------------------------------------------------------------------
# One petal, unit length, pointing +y: obovate with the notched tip that says "cherry".
PETAL = ('M0 .16C.1 .22 .22 .5 .21 .78Q.19 .95 .12 .98Q.04 .99 0 .86Q-.04 .99 -.12 .98'
         'Q-.19 .95 -.21 .78C-.22 .5 -.1 .22 0 .16Z')
FLOWER = ''.join('<use href="#p" transform="rotate(%d)"/>' % (72 * k) for k in range(5))
defs = ('<path id="p" d="%s"/>' % PETAL
        + '<g id="f">' + FLOWER + '</g>'
        + '<path id="b" d="M0 -10C6 -8 8 0 5 6Q0 9 -5 6C-8 0 -6 -8 0 -10Z"/>')

stalks = []     # into the branch layer
blooms = []     # into the bloom layer
placed = []     # flower centres, to keep silhouettes from merging into blobs


def clear(x, y, rad):
    return all(math.dist((x, y), (px, py)) > rad + prad for px, py, prad in placed)


def cluster(x, y, base_angle, n, spread=110):
    """n flowers on stalks radiating from (x, y) around base_angle (degrees, +y down)."""
    made = 0
    for k in range(n):
        bud = k == n - 1 and rng.random() < 0.25
        for _ in range(6):
            a = math.radians(base_angle + (k - (n - 1) / 2) * spread / max(n - 1, 1) + rng.uniform(-14, 14))
            L = rng.uniform(36, 54)
            fx, fy = x + math.cos(a) * L, y + math.sin(a) * L
            size = rng.uniform(38, 50)
            rad = 11 if bud else size * 0.84
            if not clear(fx, fy, rad):
                continue
            placed.append((fx, fy, rad))
            # stalk: a slight curve so it does not read as a pin
            mx, my = (x + fx) / 2 + math.sin(a) * 4, (y + fy) / 2 - math.cos(a) * 4
            stalks.append('M%s %sQ%s %s %s %s' % (r(x), r(y), r(mx), r(my), r(fx), r(fy)))
            if bud:
                blooms.append('<use href="#b" transform="translate(%s %s)rotate(%s)scale(1.4)"/>'
                              % (r(fx), r(fy), rr(math.degrees(a) - 90)))
            else:
                blooms.append('<use href="#f" transform="translate(%s %s)rotate(%s)scale(%s)"/>'
                              % (r(fx), r(fy), rr(rng.uniform(0, 72)), rr(size)))
            made += 1
            break
    return made


for twig, w0 in twigs:
    # clusters along the outer part of each twig, hanging on the underside and off the tip
    for t in (0.4, 0.72, 1.0) if w0 > 6.5 else (0.6, 1.0):
        x, y = twig(t)
        tx, ty = tangent(twig, t)
        base = math.degrees(math.atan2(ty, tx))
        if t >= 1.0:
            cluster(x, y, base, 4, spread=130)
        else:
            cluster(x, y, base + (75 if ty >= 0 else -75), 3, spread=100)

# clusters straight off each limb near its tip
for limb, _, _, _ in LIMBS:
    for u in (0.9, 0.98):
        x, y = limb(u)
        tx, ty = tangent(limb, u)
        cluster(x, y, math.degrees(math.atan2(ty, tx)) + 20, 3, spread=120)

branch_svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">' % (VB_W, VB_H)
              + '<path d="' + ''.join(wood) + '"/>'
              + '<path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="'
              + ''.join(stalks) + '"/>'
              + '</svg>')
bloom_svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">' % (VB_W, VB_H)
             + '<defs>' + defs + '</defs>' + ''.join(blooms) + '</svg>')

# --- loose petals, a seamless tile ------------------------------------------------------------
loose = []
for _ in range(9):
    x, y = rng.uniform(0, TILE_W), rng.uniform(0, TILE_H)
    a, s = rng.uniform(0, 360), rng.uniform(13, 19)
    # a petal near an edge is repeated across it so the tile wraps without a seam
    for ox in (0, -TILE_W, TILE_W):
        for oy in (0, -TILE_H, TILE_H):
            px, py = x + ox, y + oy
            if -s <= px <= TILE_W + s and -s <= py <= TILE_H + s:
                loose.append('<use href="#p" transform="translate(%s %s)rotate(%s)scale(%s)"/>'
                             % (r(px), r(py), rr(a), rr(s)))
petals_svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">' % (TILE_W, TILE_H)
              + '<defs><path id="p" d="%s"/></defs>' % PETAL + ''.join(loose) + '</svg>')

stem, ext = os.path.splitext(args.output)
for suffix, svg in (('branch', branch_svg), ('bloom', bloom_svg), ('petals', petals_svg)):
    with open('%s-%s%s' % (stem, suffix, ext), 'w') as f:
        f.write(svg + '\n')

if args.preview:
    os.makedirs(args.preview, exist_ok=True)

    def layer(svg, color, opacity):
        return ('<div style="position:absolute;inset:0;color:%s;opacity:%s">' % (color, opacity)
                + svg.replace('<svg ', '<svg style="width:100%;height:100%;fill:currentColor" ')
                + '</div>')

    def scene(bg, wood_c, bloom_c, petal_c, left):
        return ('<div style="position:absolute;left:%dpx;top:40px;width:504px;height:504px;background:%s">' % (left, bg)
                + layer(branch_svg, *wood_c) + layer(bloom_svg, *bloom_c)
                + '<div style="position:absolute;left:0;top:0;width:200px;height:250px;color:%s;opacity:%s">'
                % petal_c + petals_svg.replace('<svg ', '<svg style="width:100%;height:100%;fill:currentColor" ')
                + '</div></div>')
    html = ('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888">'
            + scene('#fdf1f4', ('#78384e', .3), ('#d8235f', .18), ('#d8235f', .25), 40)
            + scene('#1a0f14', ('#000', .5), ('#ffbed2', .6), ('#ffbed2', .4), 640)
            + '</body>')
    with open(os.path.join(args.preview, 'sakura-preview.html'), 'w') as f:
        f.write(html)
