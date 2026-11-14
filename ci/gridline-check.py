"""Measures the grid lines in a real emulator screenshot (diagnostic).

Reads emulator-output/gridlines.json (square positions, CSS pixels, from
emulator-test.js phase "gridlines") and the screenshot taken right after,
and prints, for every grid line between two letter squares, how many
screen pixels wide it is and whether grey pixels sit beside it.
"""
import collections
import json
import sys

from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else 'emulator-output'
info = json.load(open(out + '/gridlines.json'))
img = Image.open(out + '/gridlines.png').convert('L')
dpr = info['dpr']
cells = info['cells']
lefts = sorted(set(round(c[0], 3) for c in cells))
tops = sorted(set(round(c[1], 3) for c in cells))
print('screenshot', img.size, 'dpr', dpr, 'grid css', info['grid'])


def runs(vals):
    found = []
    i = 0
    while i < len(vals):
        if vals[i] < 120:
            j = i
            while j < len(vals) and vals[j] < 120:
                j += 1
            fringe = sum(1 for k in (i - 1, j) if 0 <= k < len(vals) and 120 <= vals[k] < 236)
            found.append((i, j - i, fringe))
            i = j
        else:
            i += 1
    return found


def report(name, positions):
    widths = collections.Counter(p[1] for p in positions)
    fringes = collections.Counter(p[2] for p in positions)
    print(name, 'widths', dict(widths), 'grey beside', dict(fringes))


vert = []
for top in tops:
    row = [c for c in cells if round(c[1], 3) == top]
    y = int((row[0][1] + (row[0][3] - row[0][1]) * 0.9) * dpr)
    x0 = int((info['grid'][0] + info['frame']) * dpr) + 2
    x1 = int((info['grid'][2] - info['frame']) * dpr) - 2
    vals = [img.getpixel((x, y)) for x in range(x0, x1)]
    vert += [r for r in runs(vals) if r[1] < 6]
horiz = []
for left in lefts:
    col = [c for c in cells if round(c[0], 3) == left]
    x = int((col[0][0] + (col[0][2] - col[0][0]) * 0.9) * dpr)
    y0 = int((info['grid'][1] + info['frame']) * dpr) + 2
    y1 = int((info['grid'][3] - info['frame']) * dpr) - 2
    vals = [img.getpixel((x, y)) for y in range(y0, y1)]
    horiz += [r for r in runs(vals) if r[1] < 6]
report('vertical lines:  ', vert)
report('horizontal lines:', horiz)
# One row's profile in full, for reference.
top = tops[len(tops) // 2]
row = [c for c in cells if round(c[1], 3) == top]
y = int((row[0][1] + (row[0][3] - row[0][1]) * 0.9) * dpr)
x0 = int((info['grid'][0] + info['frame']) * dpr)
print('row profile', [img.getpixel((x, y)) for x in range(x0, x0 + 200)])
