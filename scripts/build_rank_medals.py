"""Rank medals (LEVELS.md §7.1): cells 12-17 of public/assets/ui/medals.png.

The raw OGA medal sheet isn't in the repo, so (as LEVELS.md allows) one medal shape -- the star medal,
cell 9 -- is re-coloured per rank: plain, bronze, silver, gold, purple, bright gold. Keeps the first 12
cells exactly as they are. Run from the repo root: python scripts/build_rank_medals.py
"""
from PIL import Image

PATH = 'public/assets/ui/medals.png'
CELL = 48
BASE = 9  # the star medal
# (dark, mid, light) per rank: Visitor, Housemate, Regular, Keyholder, Landlord, Legend.
RAMPS = [
    ((46, 40, 52), (92, 84, 98), (150, 142, 150)),
    ((74, 38, 18), (150, 88, 46), (220, 150, 96)),
    ((70, 76, 90), (150, 158, 172), (230, 236, 244)),
    ((92, 64, 10), (200, 150, 40), (255, 222, 120)),
    ((54, 26, 84), (130, 82, 190), (210, 170, 255)),
    ((120, 70, 0), (255, 190, 40), (255, 246, 170)),
]

src = Image.open(PATH).convert('RGBA')
cells = src.width // CELL
keep = src.crop((0, 0, 12 * CELL, CELL))
base = src.crop((BASE * CELL, 0, (BASE + 1) * CELL, CELL))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def tint(ramp):
    out = Image.new('RGBA', (CELL, CELL))
    px, opx = base.load(), out.load()
    for y in range(CELL):
        for x in range(CELL):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            if lum < 0.18:  # the dark outline stays dark
                opx[x, y] = (r, g, b, a)
                continue
            t = min(1.0, (lum - 0.18) / 0.72)
            c = lerp(ramp[0], ramp[1], t * 2) if t < 0.5 else lerp(ramp[1], ramp[2], (t - 0.5) * 2)
            opx[x, y] = (*c, a)
    return out


strip = Image.new('RGBA', (18 * CELL, CELL))
strip.paste(keep, (0, 0))
for i, ramp in enumerate(RAMPS):
    strip.paste(tint(ramp), ((12 + i) * CELL, 0))
strip.save(PATH, optimize=True)
print(f'{PATH}: {cells} -> 18 cells')
