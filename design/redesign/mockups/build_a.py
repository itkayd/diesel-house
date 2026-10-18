"""Mock-up A, "Cosy LimeZu+" (REDESIGN.md §5): today's 16 px LimeZu walls and floors, built with the same
rules as scripts/build-map.mjs (2-row wall faces, door gaps, stepped diagonals), furnished with LimeZu plus
Pixel Interior LRK (bitglow) and the disco pieces scaled to 16 px. Ninja Adventure character (CC0).
Run: python3 design/redesign/mockups/build_a.py"""
import json
import sys
from PIL import Image, ImageDraw

sys.path.insert(0, str(__import__('pathlib').Path(__file__).parent))
from common import DISCO, LRK, ROOT, Scene, bounds, door_tiles, limezu_character, ninja_character, out_dir, piece, tile_in

T = 16
COLS = 17
WALL_TOP = 12
WALL = {'pink': 85, 'yellow': 119, 'mint': 153, 'wood': 187, 'brown': 221, 'red': 255, 'grey': 289, 'beige': 323}
FLOOR = {'brick': (96, True), 'yellow': (130, True), 'teal': (164, True), 'herringbone': (232, True),
         'grey': (198, False), 'rose': (99, False), 'mauve': (133, False), 'stone': (167, False), 'slate': (201, False)}

builder = Image.open(ROOT / 'public/assets/tiles/limezu_room_builder.png').convert('RGBA')
interiors = Image.open(ROOT / 'public/assets/furniture/limezu_interiors.png').convert('RGBA')
SPR = json.loads((ROOT / 'design/game/sprites.json').read_text())['items']


def tile(i, tint=None):
    t = builder.crop(((i % COLS) * T, (i // COLS) * T, (i % COLS + 1) * T, (i // COLS + 1) * T))
    if tint:
        r, g, b = (int(tint[k:k + 2], 16) for k in (1, 3, 5))
        px = t.load()
        for y in range(T):
            for x in range(T):
                p = px[x, y]
                px[x, y] = (p[0] * r // 255, p[1] * g // 255, p[2] * b // 255, p[3])
    return t


def floor_tile(name, fx, fy):
    base, pattern = FLOOR[name]
    if pattern:
        return base + (0 if fx == 0 else 1 if fx % 2 == 1 else 2) + COLS * (fy % 2)
    return base + (0 if fx == 0 else 1) + COLS * (0 if fy == 0 else 1)


def lz(key):
    sx, sy, w, h = SPR[key]['px']
    return interiors.crop((sx, sy, sx + w, sy + h))


def scaled(path, w, h):
    return Image.open(path).convert('RGBA').resize((w, h), Image.LANCZOS)


# ---- the layout (tiles) ----
HALL = {'id': 'hall', 'polygon': [(1, 9), (14, 9), (19, 14), (19, 21), (1, 21)], 'wall': 'beige', 'floor': 'herringbone'}
LIBRARY = {'id': 'library', 'polygon': [(4, 1), (16, 1), (16, 8), (4, 8)], 'wall': 'wood', 'floor': 'stone', 'tint': '#d9b48a',
           'door': {'x': 9, 'y': 8, 'w': 2, 'side': 'north'}}
DISCOROOM = {'id': 'disco', 'polygon': [(20, 9), (32, 9), (32, 21), (20, 21)], 'wall': 'red', 'floor': 'slate', 'tint': '#8f7ad8',
             'door': {'x': 19, 'y': 15, 'w': 2, 'side': 'east'}}
AREAS = [HALL, LIBRARY, DISCOROOM]
W, H = 33, 22

s = Scene(W * T, H * T, T)
for y in range(H):
    for x in range(W):
        s.img.alpha_composite(tile(WALL_TOP), (x * T, y * T))
doors = [t for a in AREAS if 'door' in a for t in door_tiles(a['door'])]
gap_below = {(x, y + k) for x, y in doors for k in (1, 2)}
walk = ImageDraw.Draw(s.walk)
for a in AREAS:
    poly = a['polygon']
    bx, by, bw, bh = bounds(poly)
    ins = lambda x, y: tile_in(poly, x, y)
    for y in range(by, by + bh):
        for x in range(bx, bx + bw):
            if not ins(x, y):
                continue
            depth = 0
            while y - depth - 1 >= by and ins(x, y - depth - 1):
                depth += 1
            gap = (x, y) in gap_below
            fx = x - bx if ins(x - 1, y) else 0
            fl = floor_tile(a['floor'], 1, 1) if gap and depth < 2 else floor_tile(a['floor'], fx, max(0, depth - 2))
            s.img.alpha_composite(tile(fl, a.get('tint')), (x * T, y * T))
            if depth < 2 and not gap:
                left = not ins(x - 1, y) or (x - 1, y) in gap_below
                right = not ins(x + 1, y) or (x + 1, y) in gap_below
                s.img.alpha_composite(tile(WALL[a['wall']] + (7 if left else 9 if right else 8) + COLS * depth), (x * T, y * T))
            else:
                walk.rectangle([x * T, y * T, x * T + T - 1, y * T + T - 1], fill=255)
for x, y in doors:
    below = next((a for a in AREAS if tile_in(a['polygon'], x, y + 1)), HALL)
    s.img.alpha_composite(tile(floor_tile(below['floor'], 1, 1), below.get('tint')), (x * T, y * T))
    walk.rectangle([x * T, y * T, x * T + T - 1, y * T + T - 1], fill=255)


def at(area, dx, dy):
    bx, by, _, _ = bounds(area['polygon'])
    return bx * T + dx, by * T + dy


WARM, COOL, PINK, FIRE = '#f4b860', '#9ec9ff', '#ff8fd0', '#ff8a3d'
cab = LRK / 'cabinets_LRK.png'
liv = LRK / 'livingroom_LRK.png'
dec = LRK / 'decorations_LRK.png'

# ---- Library: shelves along the wall, a reading nook, a study desk ----
for n, dx in ((13, 4), (14, 38), (36, 72), (37, 106), (0, 156)):
    s.put(piece(cab, n), *at(LIBRARY, dx, 2), solid=True, base=8)
s.put(piece(liv, 71), *at(LIBRARY, 40, 62))  # rug
s.put(piece(liv, 8), *at(LIBRARY, 24, 66), solid=True)  # armchair
s.put(piece(liv, 20), *at(LIBRARY, 70, 66), solid=True)
s.put(piece(dec, 3), *at(LIBRARY, 52, 58), light=(WARM, 40))  # table lamp
s.put(lz('desk_study'), *at(LIBRARY, 128, 58), solid=True)
s.put(lz('globe'), *at(LIBRARY, 160, 52), solid=True)
s.put(piece(dec, 9), *at(LIBRARY, 172, 76), solid=True)
s.put(piece(dec, 0), *at(LIBRARY, 4, 70), solid=True, base=5, light=(WARM, 50))

# ---- Great Hall: games table, noticeboard, whisper rug, sofa, plants, lamps ----
s.put(lz('fairy_lights'), *at(HALL, 30, 2), light=(WARM, 26))
s.put(lz('fairy_lights'), *at(HALL, 150, 2), light=(WARM, 26))
board = Image.new('RGBA', (30, 20), (0, 0, 0, 0))
d = ImageDraw.Draw(board)
d.rectangle([0, 0, 29, 19], fill=(91, 58, 36, 255)); d.rectangle([2, 2, 27, 17], fill=(196, 150, 96, 255))
for i, c in enumerate([(255, 244, 224), (255, 211, 107), (158, 201, 255), (255, 159, 178)]):
    d.rectangle([4 + i * 6, 4 + (i % 2) * 5, 8 + i * 6, 9 + (i % 2) * 5], fill=c + (255,))
s.put(board, *at(HALL, 96, 6))
s.put(piece(liv, 67), *at(HALL, 120, 100))  # whisper rug
s.put(piece(liv, 39), *at(HALL, 22, 52), solid=True)  # games table
for n, dx, dy in ((25, 16, 76), (26, 42, 76)):
    s.put(piece(liv, n), *at(HALL, dx, dy))
s.put(piece(liv, 6), *at(HALL, 40, 150), solid=True)  # sofa
s.put(piece(dec, 7), *at(HALL, 4, 36), solid=True)
s.put(lz('plant_palm'), *at(HALL, 240, 150), solid=True)
s.put(piece(dec, 1), *at(HALL, 210, 120), solid=True, base=5, light=(WARM, 54))
s.put(piece(dec, 2), *at(HALL, 200, 34), solid=True, base=5, light=(WARM, 54))
s.put(piece(dec, 5), *at(HALL, 56, 8))  # picture

# ---- Disco: dance floor, glitter ball, speakers, jukebox, DJ desk, sofas ----
dance = Image.open(DISCO / 'DanceFloor.png').convert('RGBA')
squares = [dance.crop((cx * 64 + 4, cy * 32 + 2, cx * 64 + 60, cy * 32 + 30)).resize((T, T), Image.BOX) for cy in range(4) for cx in range(4)]
fx0, fy0 = at(DISCOROOM, 32, 64)
cols, rows = 8, 6
for j in range(rows):
    for i in range(cols):
        s.img.alpha_composite(squares[(i * 7 + j * 5) % 16], (fx0 + i * T, fy0 + j * T))
s.meta['disco'] = {'x': fx0, 'y': fy0, 'cols': cols, 'rows': rows, 'cell': T}
Image.open(DISCO / 'DiscoBall.png').convert('RGBA').resize((24, 24), Image.LANCZOS).save(out_dir('a') / 'ball.png')
bx, byy = at(DISCOROOM, 96, 30)
s.meta['ball'] = {'x': bx, 'y': byy, 'src': 'ball.png', 'size': 24}
s.put(scaled(DISCO / 'Speaker.png', 14, 25), *at(DISCOROOM, 8, 30), solid=True)
s.put(scaled(DISCO / 'Speaker.png', 14, 25), *at(DISCOROOM, 170, 30), solid=True)
s.put(scaled(DISCO / 'JukeBox.png', 16, 29), *at(DISCOROOM, 140, 26), solid=True, light=(PINK, 40))
s.put(lz('bench_wood'), *at(DISCOROOM, 60, 34), solid=True)
s.put(lz('lamp_blue'), *at(DISCOROOM, 28, 32), solid=True, light=(COOL, 44))
s.put(lz('sofa_red'), *at(DISCOROOM, 14, 160), solid=True)
s.put(lz('sofa_red'), *at(DISCOROOM, 146, 160), solid=True)
s.meta['lights'] += [{'x': fx0 + cols * T // 2, 'y': fy0 + rows * T // 2, 'r': 90, 'c': '#c99bff', 'disco': True}]

# Door signs (as in the game: on the hall wall under a north door; beside a side door).
s.meta['signs'] += [{'x': 10 * T, 'y': 9 * T + 3, 'text': 'Library'}, {'x': 19 * T + 8, 'y': 14 * T + 4, 'text': 'Disco'}]
s.meta['spawn'] = [6 * T, 19 * T]
s.meta['title'] = 'A · Cosy LimeZu+ (16 px)'
d = out_dir('a')
s.meta['characters'] = [ninja_character('Boy', d), ninja_character('Princess', d), limezu_character('adam', d)]
s.save('a', s.meta['characters'][0])
