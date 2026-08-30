"""Procedural fern frond silhouette (SVG) for the fern skin's corner ornament.

Generates src/skins/fern-frond.svg, a compact SVG: one tapered rachis, four pinna shapes in <defs>, and one <use> per pinna
(alternate arrangement, lengths and angles following the frond profile, seeded jitter).
Deterministic: the same seed always produces the same bytes.
fern.css uses it as a mask-image (the build inlines it), so its colour comes from a skin
token; only the shape lives here.

    python3 tools/fern-frond.py src/skins/fern-frond.svg [--preview DIR]

--preview DIR also writes frond-preview.html (light and dark) to DIR.
"""
import argparse
import math
import os
import random

args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
args.add_argument('output', help='path of the SVG to write, e.g. src/skins/fern-frond.svg')
args.add_argument('--preview', metavar='DIR', help='also write frond-preview.html here')
args = args.parse_args()

VB_W, VB_H = 900, 1200
rng = random.Random(11)

# Rachis: a cubic Bezier from the bottom-left corner leaning toward the upper right.
P0, P1, P2, P3 = (90, 1190), (110, 820), (300, 380), (680, 70)


def bez(t):
    s = 1 - t
    return (s ** 3 * P0[0] + 3 * s * s * t * P1[0] + 3 * s * t * t * P2[0] + t ** 3 * P3[0],
            s ** 3 * P0[1] + 3 * s * s * t * P1[1] + 3 * s * t * t * P2[1] + t ** 3 * P3[1])


def bez_d(t):
    s = 1 - t
    return (3 * s * s * (P1[0] - P0[0]) + 6 * s * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]),
            3 * s * s * (P1[1] - P0[1]) + 6 * s * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]))


SAMPLES = 800
_ts = [i / SAMPLES for i in range(SAMPLES + 1)]
_pts = [bez(t) for t in _ts]
_cum = [0.0]
for i in range(1, len(_pts)):
    _cum.append(_cum[-1] + math.dist(_pts[i - 1], _pts[i]))
TOTAL = _cum[-1]


def at(u):
    """Point and unit tangent at arc-length fraction u."""
    s = u * TOTAL
    lo, hi = 0, len(_cum) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if _cum[mid] < s:
            lo = mid + 1
        else:
            hi = mid
    i = max(1, lo)
    seg = _cum[i] - _cum[i - 1] or 1
    f = (s - _cum[i - 1]) / seg
    t = _ts[i - 1] + (_ts[i] - _ts[i - 1]) * f
    p = bez(t)
    dx, dy = bez_d(t)
    n = math.hypot(dx, dy) or 1
    return p, (dx / n, dy / n)


def r(v):
    return str(int(round(v)))


def rr(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


# --- rachis: a tapered polygon -------------------------------------------------------------
left, right = [], []
STEPS = 40
for i in range(STEPS + 1):
    u = i / STEPS
    (x, y), (tx, ty) = at(u)
    hw = 6.0 * (1 - u) ** 0.9 + 0.9
    nx, ny = ty, -tx
    left.append((x + nx * hw, y + ny * hw))
    right.append((x - nx * hw, y - ny * hw))
rachis = 'M' + ' '.join(r(x) + ' ' + r(y) for x, y in left + right[::-1]) + 'Z'

# --- pinna shapes: base at (0,0), tip at (100,0), lobes both sides, curving toward -y ------
def pinna(k):
    """Outline of a pinna with k rounded pinnules per side, in a 100-unit-long local frame."""
    def midrib(v):
        # slight curve toward -y (the frond tip side once placed)
        return (v * 100, -10 * (v ** 1.6))

    def lobe(v):
        return 12 * math.sin(math.pi * v ** 0.85) ** 0.8 + 1.2

    def thick(v):
        return 1.5 * (1 - v) + 0.5

    step = 1 / k
    top = []  # sequence of (ctrl, end) quadratic segments starting after the base point
    start = None
    for j in range(k):
        v0, v1 = j * step, (j + 1) * step
        m0, m1 = midrib(v0), midrib(v1)
        n0 = (m0[0], m0[1] - thick(v0))
        n1 = (m1[0], m1[1] - thick(v1))
        vm = v0 + 0.6 * step
        mm = midrib(vm)
        l = lobe(vm)
        tip = (mm[0], mm[1] - thick(vm) - l)
        c1 = (m0[0] + 100 * step * 0.05, m0[1] - thick(v0) - l * 0.95)
        c2 = (m1[0] - 100 * step * 0.08, m1[1] - thick(v1) - l * 0.5)
        if start is None:
            start = n0
        top.append((c1, tip))
        top.append((c2, n1))
    end = midrib(1)
    # forward along the top edge, then back along the mirrored bottom edge
    d = 'M' + rr(start[0]) + ' ' + rr(start[1])
    for c, e in top:
        d += 'Q' + rr(c[0]) + ' ' + rr(c[1]) + ' ' + rr(e[0]) + ' ' + rr(e[1])
    d += 'L' + rr(end[0]) + ' ' + rr(end[1])
    # mirror: y -> 2*midrib_y - y  (reflect across the curved midrib)
    def mirror(p):
        v = p[0] / 100
        return (p[0], 2 * midrib(min(max(v, 0), 1))[1] - p[1])
    pts = [start] + [e for _, e in top]
    ctrls = [c for c, _ in top]
    for j in range(len(top) - 1, -1, -1):
        c = mirror(ctrls[j])
        e = mirror(pts[j])
        d += 'Q' + rr(c[0]) + ' ' + rr(c[1]) + ' ' + rr(e[0]) + ' ' + rr(e[1])
    return d + 'Z'


VARIANTS = [4, 7, 10, 14]
defs = ''.join('<path id="p%d" d="%s"/>' % (k, pinna(k)) for k in VARIANTS)

# --- pinna placement -------------------------------------------------------------------------
L_MAX = 205.0


def profile(u):
    if u < 0.3:
        return (u / 0.3) ** 0.55
    return (1 - (u - 0.3) / 0.7) ** 0.95


uses = []
N = 44                      # pinnae in total, alternating sides
U0, U1 = 0.14, 0.985
for i in range(N):
    u = U0 + (U1 - U0) * i / (N - 1)
    side = 1 if i % 2 == 0 else -1
    (x, y), (tx, ty) = at(u)
    L = L_MAX * profile(u) * (1 + rng.uniform(-0.07, 0.07))
    if L < 6:
        continue
    a = math.radians(66 - 34 * u + rng.uniform(-3, 3)) * side
    dx = tx * math.cos(a) - ty * math.sin(a)
    dy = tx * math.sin(a) + ty * math.cos(a)
    deg = math.degrees(math.atan2(dy, dx))
    # local -y after rotation; flip sy so the pinna curves toward the rachis tip
    my = (math.sin(math.radians(deg)), -math.cos(math.radians(deg)))
    sy = 1 if my[0] * tx + my[1] * ty > 0 else -1
    k = VARIANTS[min(len(VARIANTS) - 1, int(L / 45))]
    # tuck the base slightly inside the rachis
    bx, by = x - dx * 3, y - dy * 3
    sx = L / 100
    syv = sx * (1 + rng.uniform(-0.08, 0.08)) * sy
    uses.append('<use href="#p%d" transform="translate(%s %s)rotate(%s)scale(%s %s)"/>'
                % (k, r(bx), r(by), rr(deg), rr(sx), rr(syv)))


svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">' % (VB_W, VB_H)
       + '<defs>' + defs + '</defs>'
       + '<path d="' + rachis + '"/>'
       + ''.join(uses)
       + '</svg>')

with open(args.output, 'w') as f:
    f.write(svg + '\n')

if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    html = ('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#e9eee3">'
            '<div style="width:450px;height:600px;margin:40px;color:#2f6f3f;opacity:.9">' + svg.replace('<svg ', '<svg style="width:100%;height:100%;fill:currentColor" ') +
            '</div><div style="position:absolute;left:560px;top:40px;width:450px;height:600px;background:#0f1a14;color:#8fcf9a;opacity:.95">'
            + svg.replace('<svg ', '<svg style="width:100%;height:100%;fill:currentColor" ') + '</div></body>')
    with open(os.path.join(args.preview, 'frond-preview.html'), 'w') as f:
        f.write(html)
