"""Procedural tower crane silhouette (SVG) for the saffron skin, plus its hook block.

Generates src/skins/saffron-crane.svg, a portrait tile (viewBox 700x1000): a lattice mast
rising from the bottom edge, slewing platform, a cab with cut-out glazing (x 129 to 150,
y 82 to 106 of the tile, ending on the jib's top chord; the skin lights it at night), cat head, a flat-top jib of constant depth
toward +x and a short counter-jib with its counterweight bleeding off the left edge. The jib's
bottom chord is flat at y 128, so the trolley can hang anywhere along it at one height. Also
writes saffron-hook.svg next to it (viewBox 100x200): the sheave block with its sheave hole,
swivel, C-shaped hook and safety latch. The skin draws the trolley and the two rope falls in
CSS and animates the rope length. The tile is shown mirrored, far larger than the viewport, so
only the mast and the jib are in frame. Deterministic.

    python3 tools/saffron-crane.py src/skins/saffron-crane.svg [--preview DIR]

--preview DIR also writes crane-preview.html (light and dark) to DIR.
"""
import argparse
import os

args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
args.add_argument('output', help='path of the SVG to write, e.g. src/skins/saffron-crane.svg')
args.add_argument('--preview', metavar='DIR', help='also write crane-preview.html here')
args = args.parse_args()

W, H = 700, 1000
out = []


def rect(x, y, w, h):
    out.append('<rect x="%d" y="%d" width="%d" height="%d"/>' % (round(x), round(y), round(w), round(h)))


def line(x1, y1, x2, y2, w=2):
    out.append('<path d="M%d %dL%d %d" stroke="#000" stroke-width="%s"/>' % (round(x1), round(y1), round(x2), round(y2), w))


def lattice_column(x, top, bottom, width, pitch):
    """Two rails with X bracing and a rung at each panel."""
    rect(x, top, 4.5, bottom - top)
    rect(x + width - 4.5, top, 4.5, bottom - top)
    y = bottom
    while y - pitch >= top:
        line(x + 1, y, x + width - 1, y - pitch, 2.2)
        line(x + width - 1, y, x + 1, y - pitch, 2.2)
        rect(x, y - pitch, width, 2)
        y -= pitch
    rect(x, top, width, 4.5)


def lattice_beam(x1, x2, y, depth_root, depth_tip, pitch):
    """A jib: straight top chord, bottom chord rising toward the tip, zigzag bracing."""
    step = 1 if x2 > x1 else -1
    length = abs(x2 - x1)
    rect(min(x1, x2), y, length, 4.5)
    out.append('<path d="M%d %dL%d %dL%d %dL%d %dZ"/>' % (x1, y + depth_root, x2, y + depth_tip, x2, y + depth_tip + 2.5, x1, y + depth_root + 2.5))
    x = x1
    up = True
    while (x - x2) * step < -pitch:
        nx = x + pitch * step
        t0 = abs(x - x1) / length
        t1 = abs(nx - x1) / length
        d0 = depth_root + (depth_tip - depth_root) * t0
        d1 = depth_root + (depth_tip - depth_root) * t1
        if up:
            line(x, y + d0, nx, y + 2, 2.2)
        else:
            line(x, y + 2, nx, y + d1, 2.2)
        up = not up
        x = nx


XM, MW, TOP = 90, 40, 110
lattice_column(XM - MW / 2, TOP, H, MW, 44)
# slewing platform, cat head, and the operator's cab on the jib side: roof, back wall, floor,
# a front glazing that leans out at the bottom (cut out with evenodd so the skin can light it),
# and window mullions across the glass
rect(XM - MW / 2 - 6, TOP - 8, MW + 12, 10)
CX = XM + MW / 2 + 3               # cab back wall x (113)
# the cab sits on the jib's top chord (y 106): its floor merges with the chord and the glazing
# ends exactly at the chord's upper edge
out.append('<path fill-rule="evenodd" d="M%d %dH%dV%dL%d %dH%dZ M%d %dH%dV%dL%d %dH%dZ"/>'
           % (CX, TOP - 31, CX + 34, TOP - 18, CX + 40, TOP - 1, CX, CX + 16, TOP - 28, CX + 32, TOP - 18, CX + 37, TOP - 4, CX + 16))
rect(CX - 2, TOP - 34, 38, 4)      # roof overhang
rect(CX + 16, TOP - 17, 22, 2)     # horizontal mullion
rect(CX + 25, TOP - 28, 2, 24)     # vertical mullion
APEX = TOP - 62
out.append('<path d="M%d %dL%d %dL%d %dZ"/>' % (XM - 10, TOP - 6, XM + 10, TOP - 6, XM, APEX))
# jib toward +x and counter-jib toward -x
JY = TOP - 4
lattice_beam(XM + MW / 2, 690, JY, 22, 22, 28)
lattice_beam(XM - MW / 2, 0, JY, 24, 22, 28)
rect(0, JY + 22, 40, 28)  # counterweight, bleeding off the edge
# tie bars
line(XM, APEX, XM + 585 * 0.62, JY + 1, 2.2)
line(XM, APEX, 6, JY + 1, 2.2)

svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d">' % (W, H)
       + ''.join(out) + '</svg>')

with open(args.output, 'w') as f:
    f.write(svg + '\n')

# Hook block: sheave block (with the sheave showing as a hole), swivel, hook, safety latch.
HOOK = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200">'
        '<path fill-rule="evenodd" d="M30 0h40v6h4a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8H26a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8h4z'
        'M50 22a15 15 0 1 0 .01 0z"/>'
        '<rect x="38" y="74" width="24" height="10"/>'
        '<rect x="45" y="84" width="10" height="22"/>'
        '<path d="M44 106C22 112 10 140 16 162C22 184 48 198 72 188C86 182 94 166 92 148L78 146C80 158 74 170 62 172'
        'C46 174 30 162 32 148C34 136 44 128 56 124L56 106Z"/>'
        '<path d="M58 118L88 150" stroke="#000" stroke-width="4" stroke-linecap="round"/>'
        '</svg>')
with open(os.path.join(os.path.dirname(args.output), 'saffron-hook.svg'), 'w') as f:
    f.write(HOOK + '\n')

if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    tile = svg.replace('<svg ', '<svg style="height:560px;display:inline-block" ').replace('stroke="#000"', 'stroke="currentColor"')
    hook = HOOK.replace('<svg ', '<svg style="height:280px;display:inline-block;margin-left:40px" ').replace('stroke="#000"', 'stroke="currentColor"')
    html = ('<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex">'
            '<div style="background:#f6c945;color:#171300;padding:20px;fill:currentColor;opacity:.9">' + tile + hook + '</div>'
            '<div style="background:#1b1a17;color:#c9a83a;padding:20px;fill:currentColor;opacity:.9">' + tile + hook + '</div>'
            '</body>')
    with open(os.path.join(args.preview, 'crane-preview.html'), 'w') as f:
        f.write(html)
