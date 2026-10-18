"""Mock-up B, "Warm 32" (REDESIGN.md §5): 32 px tiles. Graduation Cat's House Interior LITE for walls, floors and
most furniture, Cozy Reading Nook pieces (scaled down; licence unclear, mock-up only) in the Library, the disco
floor and ball at 32 px. Characters: Ninja Adventure drawn at 2x (a stand-in for real 32 px skins).
Same layout rules as build_a.py (2-row wall faces, door gaps, stepped diagonal), half the tiles across.
Run: python3 design/redesign/mockups/build_b.py"""
import sys
from PIL import Image, ImageDraw

sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from common import DISCO, PACKS, Scene, bounds, door_tiles, limezu_character, ninja_character, out_dir, tile_in, trim

T = 32
GC = Image.open(PACKS / 'InteriorTilesLITE.png').convert('RGBA')
NOOK = PACKS / 'Cozy_Reading_Nook_Free_Sample/Cozy_Reading_Nook_Free_Sample/Game_Ready'


def gc(cx, cy, cw, ch):
    """A piece of Graduation Cat's sheet, in its 16 px cells, trimmed to what's drawn."""
    return trim(GC.crop((cx * 16, cy * 16, (cx + cw) * 16, (cy + ch) * 16)))


def nook(name, w):
    im = Image.open(NOOK / f'{name}.png').convert('RGBA')
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def tint(im, hexc):
    r, g, b = (int(hexc[k:k + 2], 16) for k in (1, 3, 5))
    im = im.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            px[x, y] = (p[0] * r // 255, p[1] * g // 255, p[2] * b // 255, p[3])
    return im


# Walls: a 32 px column from the middle of each wallpaper strip (64 px tall = 2 face rows).
WALLS = {
    'teal': GC.crop((32, 96, 64, 160)),
    'pink': GC.crop((160, 96, 192, 160)),
}
WALLS['plum'] = tint(WALLS['pink'], '#a58ad6')
walnut = Image.open(NOOK / 'floor_walnut.png').convert('RGBA').resize((128, 128), Image.LANCZOS)
FLOORS = {
    'checker': GC.crop((0, 64, 32, 96)),
    'wood': GC.crop((0, 0, 32, 32)),
    'slate': tint(GC.crop((0, 32, 32, 64)), '#8a7fb0'),
}


def floor_at(name, x, y):
    if name == 'walnut':
        return walnut.crop(((x * T) % 128, (y * T) % 128, (x * T) % 128 + T, (y * T) % 128 + T))
    return FLOORS[name]


HALL = {'id': 'hall', 'polygon': [(1, 7), (9, 7), (12, 10), (12, 15), (1, 15)], 'wall': 'teal', 'floor': 'checker'}
LIBRARY = {'id': 'library', 'polygon': [(2, 1), (11, 1), (11, 6), (2, 6)], 'wall': 'pink', 'floor': 'walnut',
           'door': {'x': 5, 'y': 6, 'w': 2, 'side': 'north'}}
DISCOROOM = {'id': 'disco', 'polygon': [(13, 7), (21, 7), (21, 15), (13, 15)], 'wall': 'plum', 'floor': 'slate',
             'door': {'x': 12, 'y': 11, 'w': 2, 'side': 'east'}}
AREAS = [HALL, LIBRARY, DISCOROOM]
W, H = 22, 16
VOID, TRIM = (43, 31, 39, 255), (200, 148, 106, 255)

s = Scene(W * T, H * T, T)
s.img.paste(VOID, (0, 0, W * T, H * T))
doors = [t for a in AREAS if 'door' in a for t in door_tiles(a['door'])]
gap_below = {(x, y + k) for x, y in doors for k in (1, 2)}
walk = ImageDraw.Draw(s.walk)
draw = ImageDraw.Draw(s.img)
owner = {}
for a in AREAS:
    poly = a['polygon']
    bx, by, bw, bh = bounds(poly)
    ins = lambda x, y: tile_in(poly, x, y)
    for y in range(by, by + bh):
        for x in range(bx, bx + bw):
            if not ins(x, y):
                continue
            owner[(x, y)] = a
            depth = 0
            while y - depth - 1 >= by and ins(x, y - depth - 1):
                depth += 1
            gap = (x, y) in gap_below
            s.img.alpha_composite(floor_at(a['floor'], x, y), (x * T, y * T))
            if depth < 2 and not gap:
                s.img.alpha_composite(WALLS[a['wall']].crop((0, depth * T, T, depth * T + T)), (x * T, y * T))
            else:
                walk.rectangle([x * T, y * T, x * T + T - 1, y * T + T - 1], fill=255)
for x, y in doors:
    below = next((a for a in AREAS if tile_in(a['polygon'], x, y + 1)), HALL)
    s.img.alpha_composite(floor_at(below['floor'], x, y), (x * T, y * T))
    walk.rectangle([x * T, y * T, x * T + T - 1, y * T + T - 1], fill=255)
    owner[(x, y)] = below
# Graduation Cat draws walls as a thin tan line: trace every edge between a room tile and the void.
for (x, y), a in owner.items():
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if (x + dx, y + dy) in owner:
            continue
        x0, y0 = x * T, y * T
        if dx == 1: draw.rectangle([x0 + T - 4, y0, x0 + T - 1, y0 + T - 1], fill=TRIM)
        if dx == -1: draw.rectangle([x0, y0, x0 + 3, y0 + T - 1], fill=TRIM)
        if dy == 1: draw.rectangle([x0, y0 + T - 4, x0 + T - 1, y0 + T - 1], fill=TRIM)
        if dy == -1: draw.rectangle([x0, y0, x0 + T - 1, y0 + 3], fill=TRIM)


def at(area, dx, dy):
    bx, by, _, _ = bounds(area['polygon'])
    return bx * T + dx, by * T + dy


WARM, COOL, PINK = '#f4b860', '#9ec9ff', '#ff8fd0'
shelf_a, shelf_b = gc(20, 10, 2, 3), gc(22, 10, 2, 3)
floor_lamp, table_lamp, plant = gc(16, 16, 2, 3), gc(18, 18, 2, 2), gc(18, 10, 2, 3)

# ---- Library: shelves and a window on the wall, the reading nook on a round rug ----
for i, dx in enumerate((10, 44, 196, 230)):
    s.put(shelf_a if i % 2 == 0 else shelf_b, *at(LIBRARY, dx, 26), solid=True, base=10)
s.put(nook('window_autumn', 46), *at(LIBRARY, 120, 6))
s.put(gc(20, 8, 2, 2), *at(LIBRARY, 176, 14))  # clock
s.put(nook('rug_round_autumn', 104), *at(LIBRARY, 92, 76))
s.put(nook('armchair_olive', 44), *at(LIBRARY, 100, 88), solid=True)
s.put(nook('table_round_walnut', 34), *at(LIBRARY, 148, 98), solid=True)
s.put(nook('books_stack', 16), *at(LIBRARY, 157, 96))
s.put(floor_lamp, *at(LIBRARY, 22, 96), solid=True, base=6, light=(WARM, 70))
s.put(nook('plant_potted', 30), *at(LIBRARY, 250, 112), solid=True)

# ---- Great Hall: window, picture, noticeboard, games table, whisper rug, sofa ----
s.put(gc(16, 6, 2, 3), *at(HALL, 40, 10))  # window
s.put(gc(22, 6, 2, 3), *at(HALL, 36, 4))  # curtains
s.put(gc(18, 14, 4, 2), *at(HALL, 120, 22))  # picture
s.put(gc(0, 10, 2, 2), *at(HALL, 214, 24))  # noticeboard
s.put(gc(27, 0, 5, 6), *at(HALL, 210, 104))  # whisper rug
s.put(gc(24, 7, 6, 3), *at(HALL, 26, 100), solid=True)  # games table
for dx in (44, 82):
    s.put(gc(24, 12, 2, 2), *at(HALL, dx, 140))
s.put(gc(20, 20, 6, 4), *at(HALL, 30, 190), solid=True)  # sofa
s.put(floor_lamp, *at(HALL, 160, 64), solid=True, base=6, light=(WARM, 80))
s.put(table_lamp, *at(HALL, 6, 168), light=(WARM, 50))
s.put(plant, *at(HALL, 300, 200), solid=True, base=10)

# ---- Disco: dance floor, glitter ball, speakers, jukebox, armchairs ----
dance = Image.open(DISCO / 'DanceFloor.png').convert('RGBA')
squares = [dance.crop((cx * 64 + 4, cy * 32 + 2, cx * 64 + 60, cy * 32 + 30)).resize((T, T), Image.BOX) for cy in range(4) for cx in range(4)]
fx0, fy0 = at(DISCOROOM, 32, 84)
cols, rows = 6, 3
for j in range(rows):
    for i in range(cols):
        s.img.alpha_composite(squares[(i * 7 + j * 5) % 16], (fx0 + i * T, fy0 + j * T))
s.meta['disco'] = {'x': fx0, 'y': fy0, 'cols': cols, 'rows': rows, 'cell': T}
Image.open(DISCO / 'DiscoBall.png').convert('RGBA').resize((40, 40), Image.LANCZOS).save(out_dir('b') / 'ball.png')
bx, byy = at(DISCOROOM, 128, 68)
s.meta['ball'] = {'x': bx, 'y': byy, 'src': 'ball.png', 'size': 40}
speaker = Image.open(DISCO / 'Speaker.png').convert('RGBA').resize((28, 50), Image.LANCZOS)
s.put(speaker, *at(DISCOROOM, 8, 40), solid=True)
s.put(speaker, *at(DISCOROOM, 222, 40), solid=True)
s.put(Image.open(DISCO / 'JukeBox.png').convert('RGBA').resize((32, 57), Image.LANCZOS), *at(DISCOROOM, 180, 34), solid=True, light=(PINK, 60))
s.put(table_lamp, *at(DISCOROOM, 50, 44), light=(COOL, 60))
s.put(gc(26, 20, 4, 4), *at(DISCOROOM, 10, 196), solid=True)
s.put(gc(26, 20, 4, 4), *at(DISCOROOM, 186, 196), solid=True)
s.meta['lights'] += [{'x': fx0 + cols * T // 2, 'y': fy0 + rows * T // 2, 'r': 150, 'c': '#c99bff', 'disco': True}]

s.meta['signs'] += [{'x': 6 * T, 'y': 7 * T + 6, 'text': 'Library'}, {'x': 12 * T + 16, 'y': 10 * T + 6, 'text': 'Disco'}]
s.meta['spawn'] = [4 * T, 13 * T]
s.meta['title'] = 'B · Warm 32 (32 px)'
d = out_dir('b')
s.meta['characters'] = [ninja_character('Boy', d, 2), ninja_character('Princess', d, 2), limezu_character('adam', d)]
s.save('b', s.meta['characters'][0])
