"""Mock-up C, "Isometric" (REDESIGN.md §5), just to see it: a 2:1 isometric grid of 16 x 8 floor tiles, walls and
floors drawn here in lumeish's colours, lumeish furniture (CC-BY-SA) and Kenney Isometric Library pieces
(CC0, scaled down to the same grid), the disco floor as diamonds. Back walls only (the front is cut away).
Run: python3 design/redesign/mockups/build_c.py"""
import sys
from PIL import Image, ImageDraw

sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from common import DISCO, PACKS, Scene, ninja_character, out_dir, trim

HW, HH = 8, 4  # half a floor tile: 16 x 8 diamonds
LUME = PACKS / 'lumeish - furniture pack/lumeish - furniture pack'
KEN = PACKS / 'kenney_isometricLibrary/Isometric'

# Rooms as rectangles on the iso grid (gx down-right, gy down-left). Doors are tiles between two rooms.
LIBRARY = {'gx': (0, 9), 'gy': (0, 8), 'floor': ((132, 80, 60), (118, 70, 52)), 'wall': ((214, 184, 140), (178, 148, 108)), 'tall': ('x', 'y')}
HALL = {'gx': (0, 11), 'gy': (10, 21), 'floor': ((226, 206, 168), (204, 182, 142)), 'wall': ((150, 162, 178), (122, 134, 152)), 'tall': ('x',)}
DISCOROOM = {'gx': (13, 24), 'gy': (10, 21), 'floor': ((64, 48, 88), (54, 40, 76)), 'wall': ((138, 106, 196), (106, 80, 160)), 'tall': ('y',)}
DOORS = [((5, 9), HALL), ((6, 9), HALL), ((12, 14), DISCOROOM), ((12, 15), DISCOROOM)]
TALL, LOW = 40, 10

xs = [gx - gy for a in (LIBRARY, HALL, DISCOROOM) for gx in a['gx'] for gy in a['gy']]
ys = [gx + gy for a in (LIBRARY, HALL, DISCOROOM) for gx in a['gx'] for gy in a['gy']]
OX = -min(xs) * HW + HW + 16
OY = TALL + 24
W = (max(xs) - min(xs)) * HW + 2 * HW + 32
H = OY + (max(ys) + 2) * HH + 24


def top(gx, gy):
    return OX + (gx - gy) * HW, OY + (gx + gy) * HH


def diamond(gx, gy):
    x, y = top(gx, gy)
    return [(x, y), (x + HW, y + HH), (x, y + 2 * HH), (x - HW, y + HH)]


s = Scene(W, H, 16)
d = ImageDraw.Draw(s.img)
walk = ImageDraw.Draw(s.walk)
door_tiles = {t for t, _ in DOORS}


def tiles(a):
    return [(gx, gy) for gy in range(a['gy'][0], a['gy'][1] + 1) for gx in range(a['gx'][0], a['gx'][1] + 1)]


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


# Floors, with a thin lip along the cut-away front edges.
for a in (LIBRARY, HALL, DISCOROOM):
    gx1, gy1 = a['gx'][1], a['gy'][1]
    for gx, gy in tiles(a):
        c = a['floor'][(gx + gy) % 2]
        d.polygon(diamond(gx, gy), fill=c)
        x, y = top(gx, gy)
        d.line([(x - HW + 3, y + HH + 1), (x + 2, y + 2 * HH - 2)], fill=shade(c, 0.88))  # plank / tile seam
        walk.polygon(diamond(gx, gy), fill=255)
        if gy == gy1:
            d.polygon([(x - HW, y + HH), (x, y + 2 * HH), (x, y + 2 * HH + 4), (x - HW, y + HH + 4)], fill=shade(a['floor'][0], 0.55))
        if gx == gx1:
            d.polygon([(x, y + 2 * HH), (x + HW, y + HH), (x + HW, y + HH + 4), (x, y + 2 * HH + 4)], fill=shade(a['floor'][0], 0.42))
for (gx, gy), a in DOORS:
    d.polygon(diamond(gx, gy), fill=a['floor'][0])
    walk.polygon(diamond(gx, gy), fill=255)


def wall(points, h, colour):
    (x0, y0), (x1, y1) = points
    d.polygon([(x0, y0), (x1, y1), (x1, y1 - h), (x0, y0 - h)], fill=colour)
    d.line([(x0, y0 - h), (x1, y1 - h)], fill=shade(colour, 1.25), width=2)  # top edge
    d.line([(x0, y0 - 1), (x1, y1 - 1)], fill=shade(colour, 0.7), width=2)  # skirting


# Back walls: the left one runs along gx = first column, the right one along gy = first row. Tall on the
# outside of the house, low between rooms so you can see over them. No wall where a door is.
for a in (LIBRARY, HALL, DISCOROOM):
    gx0, gy0 = a['gx'][0], a['gy'][0]
    for gy in range(a['gy'][0], a['gy'][1] + 1):
        if (gx0 - 1, gy) in door_tiles:
            continue
        x, y = top(gx0, gy)
        wall([(x - HW, y + HH), (x, y)], TALL if 'x' in a['tall'] else LOW, a['wall'][0])
    for gx in range(a['gx'][0], a['gx'][1] + 1):
        if (gx, gy0 - 1) in door_tiles:
            continue
        x, y = top(gx, gy0)
        wall([(x, y), (x + HW, y + HH)], TALL if 'y' in a['tall'] else LOW, a['wall'][1])


def lume(n):
    return Image.open(LUME / f'{n}.png').convert('RGBA')


def kenney(name, w):
    im = trim(Image.open(KEN / f'{name}.png').convert('RGBA'))
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def place(img, gx, gy, solid=False, light=None, lift=0):
    """Stand a sprite on a tile: its bottom middle on the tile's bottom corner."""
    x, y = top(gx, gy)
    return s.put(img, x - img.width // 2, y + 2 * HH - img.height - lift, solid=solid, base=max(4, img.height // 4), light=light)


def rug(gx, gy, rx, ry, colour):
    x, y = top(gx, gy)
    d.ellipse([x - rx, y + HH - ry, x + rx, y + HH + ry], fill=shade(colour, 0.7))
    d.ellipse([x - rx + 3, y + HH - ry + 2, x + rx - 3, y + HH + ry - 2], fill=colour)


WARM, COOL, PINK = '#f4b860', '#9ec9ff', '#ff8fd0'

# ---- Library: bookcases on both walls (Kenney), a reading table, candles, armchair ----
rug(5, 5, 26, 13, (150, 60, 50))
for gx in (2, 5, 8):
    place(kenney('bookcaseWideBooks_S', 30), gx, 0, solid=True)
for gy in (3, 6):
    place(kenney('bookcaseBooks_E', 20), 0, gy, solid=True)
place(kenney('longTableDecoratedChairsBooks_S', 40), 5, 5, solid=True)
place(kenney('candleStand_S', 8), 8, 7, solid=True, light=(WARM, 60))
place(kenney('candleStand_S', 8), 1, 1, solid=True, light=(WARM, 60))
place(lume(10), 2, 8, solid=True)

# ---- Great Hall: games table + chairs, sofas, shelf, desk, whisper rug ----
rug(8, 16, 24, 12, (120, 96, 170))
place(lume(77), 4, 14, solid=True)
place(lume(35), 3, 16)
place(lume(36), 6, 16)
place(lume(63), 0, 12, solid=True)
place(lume(72), 0, 18, solid=True)
place(lume(1), 4, 21, solid=True)
place(lume(12), 10, 20, solid=True)
place(kenney('candleStand_S', 8), 10, 11, solid=True, light=(WARM, 70))
place(kenney('candleStand_S', 8), 1, 20, solid=True, light=(WARM, 60))

# ---- Disco: dance floor diamonds, glitter ball, speakers, jukebox, sofas ----
dance = Image.open(DISCO / 'DanceFloor.png').convert('RGB')
colours = [dance.getpixel((cx * 64 + 32, cy * 32 + 16)) for cy in range(4) for cx in range(4)]
g0 = (15, 12)
cols = rows = 6
for j in range(rows):
    for i in range(cols):
        pts = diamond(g0[0] + i, g0[1] + j)
        d.polygon(pts, fill=colours[(i * 7 + j * 5) % 16])
        d.line(pts + [pts[0]], fill=(40, 30, 56))
tx, ty = top(*g0)
s.meta['disco'] = {'x': tx, 'y': ty, 'cols': cols, 'rows': rows, 'cell': HW, 'iso': True}
Image.open(DISCO / 'DiscoBall.png').convert('RGBA').resize((18, 18), Image.LANCZOS).save(out_dir('c') / 'ball.png')
cx, cy = top(g0[0] + 3, g0[1] + 3)
s.meta['ball'] = {'x': cx, 'y': cy - 30, 'src': 'ball.png', 'size': 18}
speaker = Image.open(DISCO / 'Speaker.png').convert('RGBA').resize((12, 22), Image.LANCZOS)
place(speaker, 14, 10, solid=True)
place(speaker, 23, 10, solid=True)
place(Image.open(DISCO / 'JukeBox.png').convert('RGBA').resize((14, 25), Image.LANCZOS), 19, 10, solid=True, light=(PINK, 60))
place(lume(13), 14, 20, solid=True)
place(lume(14), 22, 19, solid=True)
s.meta['lights'] += [{'x': cx, 'y': cy, 'r': 80, 'c': '#c99bff', 'disco': True}]

lx, ly = top(6, 10)
dx, dy = top(13, 14)
s.meta['signs'] += [{'x': lx, 'y': ly - 30, 'text': 'Library'}, {'x': dx + 6, 'y': dy - 44, 'text': 'Disco'}]
sx, sy = top(5, 18)
s.meta['spawn'] = [sx, sy + HH + 2]
s.meta['title'] = 'C · Isometric (16 x 8 tiles)'
out = out_dir('c')
s.meta['characters'] = [ninja_character('Boy', out), ninja_character('Princess', out)]
s.save('c', s.meta['characters'][0])
