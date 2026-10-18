"""Builds the R3 house art (REDESIGN.md R3, look A) from the packs in assets/raw/redesign-packs/ (gitignored;
on Diesel's laptop and in DieselHouse_v3_lite.zip). Run from the repo root: python3 scripts/art/build_house_art.py

Writes (committed, so the game and the map builder don't need the packs):
  public/assets/furniture/house_v3.png   furniture atlas (only the pieces used)
  public/assets/tiles/house_extra.png    extra 16 px floor and wall tiles (grass, deck, hedge, skyline)
  src/house/art/topdown.json             the top-down art table: kind -> where to draw it from (REDESIGN §5, rule 4)

The art table also lists the LimeZu pieces the game already had (design/game/sprites.json), so every
piece of furniture is looked up the same way. In R6 an iso table sits next to it.

Pieces drawn here in code (no pack has them top-down at 16 px): arcade cabinets, beanbags, jukebox, DJ
booth, deck chair, telescope, stairs, the hedge and skyline wall faces."""
import json
import random
import pathlib
import sys
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'design/redesign/mockups'))
from common import DISCO, LRK, NINJA, PACKS, piece, trim  # noqa: E402

COZY = PACKS / 'Cozy Interior - 165+ Pixel art furniture assets/Cozy Interior - 165+ Pixel art furniture assets'
NT = NINJA / 'Backgrounds/Tilesets'
EDGE = (13, 9, 18, 255)

pieces = {}  # kind -> (image, pack)


def add(kind, im, pack):
    pieces[kind] = (trim(im.convert('RGBA')), pack)


def cozy(path):
    return Image.open(COZY / f'{path}.png').convert('RGBA')


def ninja(sheet, cx, cy, cw, ch):
    return Image.open(NT / sheet).convert('RGBA').crop((cx * 16, cy * 16, (cx + cw) * 16, (cy + ch) * 16))


def outline(im):
    """A 1 px dark outline around everything drawn."""
    w, h = im.size
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    a = im.getchannel('A')
    for dx, dy in ((0, 1), (2, 1), (1, 0), (1, 2)):
        out.paste(EDGE, (dx, dy, dx + w, dy + h), a)
    out.alpha_composite(im, (1, 1))
    return out


def canvas(w, h):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


# ---- Pixel Interior LRK (bitglow): sofas, armchairs, fireplaces, tables, chairs, rugs, shelves, lamps, plants ----
cab, liv, dec = LRK / 'cabinets_LRK.png', LRK / 'livingroom_LRK.png', LRK / 'decorations_LRK.png'
BITGLOW = 'Pixel Interior LRK (bitglow)'
for kind, sheet, n in [
    ('bookcase_full', cab, 0), ('bookcase_tv', cab, 1), ('bookcase_bright', cab, 13), ('bookcase_bright_tv', cab, 14),
    ('bookcase_dark', cab, 23), ('bookcase_low', cab, 5), ('bookcase_low_bright', cab, 18), ('bookcase_thin', cab, 7),
    ('cabinet_books', cab, 3),
    ('sofa_beige', liv, 6), ('sofa_grey_lrk', liv, 18), ('armchair_beige', liv, 8), ('armchair_grey', liv, 20),
    ('sofa_side_left', liv, 0), ('sofa_side_right', liv, 1),
    ('fireplace_stone', liv, 3), ('fireplace_brick', liv, 17),
    ('table_long', liv, 38), ('table_long_dark', liv, 39), ('table_tall', liv, 24),
    ('chair_wood_a', liv, 25), ('chair_wood_b', liv, 26), ('chair_wood_left', liv, 29), ('chair_wood_right', liv, 30),
    ('table_round_white', liv, 42), ('table_oval_white', liv, 56), ('stool_wood', liv, 41), ('chair_white_a', liv, 43), ('chair_white_b', liv, 44), ('chair_white_left', liv, 47), ('chair_white_right', liv, 48),
    ('table_round_wood', liv, 49), ('chair_dark_a', liv, 50), ('chair_dark_b', liv, 51), ('chair_dark_left', liv, 54), ('chair_dark_right', liv, 55),
    ('table_small_oval', liv, 58),
    ('rug_cream_wide', liv, 60), ('rug_cream_pattern', liv, 62), ('rug_oval_cream', liv, 67), ('rug_oval_grey', liv, 70),
    ('rug_red_wide', liv, 71), ('rug_red_pattern', liv, 73), ('rug_runner', liv, 64),
    ('tv_wall', liv, 80),
    ('lamp_tripod', dec, 1), ('lamp_floor', dec, 0), ('lamp_floor_grey', dec, 2), ('lamp_desk', dec, 3), ('lamp_desk_pink', dec, 4),
    ('plant_big', dec, 7), ('plant_tall', dec, 8), ('plant_round', dec, 9), ('vase_roses', dec, 11), ('vase_flowers', dec, 12),
    ('picture_sunset', dec, 5), ('picture_hills', dec, 10), ('mirror_tall', dec, 6), ('clock_round', dec, 14),
]:
    add(kind, piece(sheet, n), BITGLOW)

# ---- Cozy Interior 165+ (Sleepless Poetry): kitchen, TV, speakers ----
SP = 'Cozy Interior 165+ (Sleepless Poetry)'
for kind, path in [
    ('tv_stand', 'living room assets/TV stand1'), ('tv', 'living room assets/TV'), ('speaker_tall', 'living room assets/speaker2'),
    ('soundbar', 'living room assets/speaker1'), ('clock_square', 'living room assets/clock'), ('candle', 'living room assets/candle'),
    ('counter_long', 'kitchen assets/kitchen counter19'), ('sink_counter', 'kitchen assets/kitchen sink1'), ('counter_small', 'kitchen assets/small counter'),
    ('coffee_maker', 'kitchen assets/coffee maker'), ('microwave', 'kitchen assets/microwave'), ('toaster', 'kitchen assets/toaster'),
    ('fridge_cream', 'kitchen assets/fridge2'), ('fridge_pink', 'kitchen assets/fridge1'), ('cup', 'kitchen assets/empty cup'),
    ('wall_shelf', 'bedroom assets/wall shelf'), ('books_pile', 'bedroom assets/books2'), ('calendar', 'bedroom assets/calender'),
    ('desk_blue', 'bedroom assets/desk2'),
]:
    add(kind, cozy(path), SP)

# ---- Ninja Adventure (CC0): garden ----
NJ = 'Ninja Adventure (pixel-boy, CC0)'
add('tree_round', ninja('TilesetNature.png', 0, 0, 2, 2), NJ)
add('tree_round_b', ninja('TilesetNature.png', 16, 0, 2, 2), NJ)
add('tree_pine', ninja('TilesetNature.png', 2, 0, 2, 2), NJ)
add('tree_trunk', ninja('TilesetNature.png', 6, 8, 2, 2), NJ)
add('bush', ninja('TilesetNature.png', 0, 10, 1, 1), NJ)
add('bush_b', ninja('TilesetNature.png', 1, 10, 1, 1), NJ)
add('grass_tuft', ninja('TilesetNature.png', 3, 10, 1, 1), NJ)
add('grass_tuft_b', ninja('TilesetNature.png', 6, 10, 1, 1), NJ)
add('rock', ninja('TilesetNature.png', 17, 8, 1, 2), NJ)
add('fire_pit', ninja('tileset_camp.png', 12, 3, 2, 2), NJ)
add('picnic_blanket', ninja('tileset_camp.png', 8, 5, 2, 2), NJ)
add('lantern_post', ninja('tileset_camp.png', 6, 5, 1, 2), NJ)
add('log_bench', ninja('tileset_camp.png', 0, 7, 3, 1), NJ)
add('pond', ninja('TilesetWater.png', 0, 6, 3, 3), NJ)

# ---- Assorted Disco (CC0): just the glitter ball ----
add('disco_ball', Image.open(DISCO / 'DiscoBall.png').convert('RGBA').resize((16, 16), Image.LANCZOS), 'Assorted Disco (Michael Muirden, CC0)')

# ---- Drawn here ----
HERE = 'Diesel House (drawn in code)'


def arcade(body, screen, accent):
    im, d = canvas(16, 30)
    d.rectangle([1, 6, 14, 29], fill=body)
    d.rectangle([1, 0, 14, 6], fill=accent)  # marquee
    d.rectangle([3, 1, 12, 4], fill=(255, 244, 224, 255))
    d.rectangle([3, 8, 12, 16], fill=(20, 20, 32, 255))
    d.rectangle([4, 9, 11, 15], fill=screen)
    d.point([(5, 11), (9, 13), (7, 10)], fill=(255, 255, 255, 255))
    d.rectangle([0, 18, 15, 21], fill=tuple(int(c * 0.7) for c in body[:3]) + (255,))  # control deck
    d.point([(4, 19), (6, 19)], fill=(255, 90, 90, 255))
    d.point([(10, 19)], fill=(255, 211, 107, 255))
    d.rectangle([2, 23, 13, 28], fill=tuple(int(c * 0.8) for c in body[:3]) + (255,))
    d.line([(1, 29), (14, 29)], fill=tuple(int(c * 0.5) for c in body[:3]) + (255,))
    return outline(im)


add('arcade_red', arcade((200, 64, 72, 255), (90, 200, 255, 255), (255, 211, 107, 255)), HERE)
add('arcade_blue', arcade((64, 96, 200, 255), (120, 255, 150, 255), (255, 120, 200, 255)), HERE)
add('arcade_purple', arcade((128, 72, 190, 255), (255, 200, 90, 255), (120, 220, 255, 255)), HERE)


def beanbag(col):
    im, d = canvas(18, 13)
    d.ellipse([0, 2, 17, 12], fill=tuple(int(c * 0.75) for c in col) + (255,))
    d.ellipse([1, 0, 16, 9], fill=col + (255,))
    d.ellipse([4, 2, 9, 5], fill=tuple(min(255, int(c * 1.2)) for c in col) + (255,))
    return outline(im)


add('beanbag_pink', beanbag((235, 110, 160)), HERE)
add('beanbag_teal', beanbag((70, 180, 190)), HERE)
add('beanbag_yellow', beanbag((240, 190, 70)), HERE)

im, d = canvas(16, 26)  # jukebox: a rounded top with a glowing window
d.rectangle([1, 6, 14, 25], fill=(120, 60, 40, 255))
d.ellipse([1, 0, 14, 13], fill=(150, 80, 50, 255))
d.ellipse([3, 2, 12, 11], fill=(255, 140, 200, 255))
d.rectangle([3, 7, 12, 11], fill=(255, 140, 200, 255))
d.rectangle([4, 13, 11, 18], fill=(40, 24, 40, 255))
for i, c in enumerate([(255, 211, 107), (120, 220, 255), (150, 255, 160)]):
    d.point([(5 + i * 3, 15)], fill=c + (255,))
d.rectangle([3, 20, 12, 23], fill=(200, 160, 90, 255))
add('jukebox', outline(im), HERE)

im, d = canvas(48, 24)  # DJ booth: a desk with two decks and a laptop, lit edge at the front
d.rectangle([0, 6, 47, 23], fill=(40, 34, 56, 255))
d.rectangle([0, 6, 47, 9], fill=(70, 60, 92, 255))
for cx in (9, 38):
    d.ellipse([cx - 6, 0, cx + 6, 10], fill=(20, 18, 28, 255))
    d.ellipse([cx - 4, 2, cx + 4, 8], fill=(60, 56, 70, 255))
    d.point([(cx, 5)], fill=(255, 211, 107, 255))
d.rectangle([19, 1, 28, 7], fill=(150, 150, 170, 255))
d.rectangle([20, 2, 27, 6], fill=(120, 220, 255, 255))
d.line([(1, 21), (46, 21)], fill=(255, 120, 200, 255))
d.line([(1, 22), (46, 22)], fill=(150, 90, 255, 255))
add('dj_booth', outline(im), HERE)

im, d = canvas(14, 22)  # deck chair, striped
d.polygon([(1, 2), (12, 2), (13, 14), (0, 14)], fill=(255, 244, 224, 255))
for y in range(3, 14, 3):
    d.line([(1, y), (12, y)], fill=(80, 170, 220, 255))
d.rectangle([0, 14, 13, 17], fill=(170, 120, 70, 255))
d.line([(1, 18), (1, 21)], fill=(120, 80, 50, 255))
d.line([(12, 18), (12, 21)], fill=(120, 80, 50, 255))
add('deck_chair', outline(im), HERE)

im, d = canvas(16, 24)  # telescope on a tripod
d.line([(3, 7), (13, 1)], fill=(200, 200, 220, 255), width=3)
d.rectangle([12, 0, 14, 3], fill=(120, 120, 150, 255))
d.line([(8, 6), (3, 23)], fill=(110, 80, 60, 255))
d.line([(8, 6), (13, 23)], fill=(110, 80, 60, 255))
d.line([(8, 6), (8, 22)], fill=(90, 64, 48, 255))
add('telescope', outline(im), HERE)

im, d = canvas(32, 32)  # stairs going up (to the roof): steps getting lighter towards the top
for i in range(6):
    y = 26 - i * 5
    shade = 90 + i * 20
    d.rectangle([2, y, 29, y + 5], fill=(shade, int(shade * 0.7), int(shade * 0.5), 255))
    d.line([(2, y), (29, y)], fill=(min(255, shade + 40), int(shade * 0.85), int(shade * 0.6), 255))
d.rectangle([0, 0, 1, 31], fill=(70, 50, 40, 255))
d.rectangle([30, 0, 31, 31], fill=(70, 50, 40, 255))
add('stairs_up', im, HERE)

im, d = canvas(30, 20)  # the noticeboard (same as the game's drawn one, as a sprite for the art table)
d.rectangle([0, 0, 29, 19], fill=(107, 63, 34, 255))
d.rectangle([2, 2, 27, 17], fill=(168, 116, 63, 255))
for i, c in enumerate([(255, 233, 168), (255, 179, 199), (158, 201, 255), (155, 224, 168), (255, 244, 224)]):
    nx, ny = 3 + (i % 3) * 8, 3 + (i // 3) * 8
    d.rectangle([nx, ny, nx + 5, ny + 5], fill=c + (255,))
add('noticeboard', outline(im), HERE)

# ---- Pack the atlas ----
order = sorted(pieces, key=lambda k: (-pieces[k][0].height, k))
W = 512
x = y = row = 0
rects = {}
for k in order:
    im = pieces[k][0]
    if x + im.width + 1 > W:
        x, y, row = 0, y + row + 1, 0
    rects[k] = (x, y, im.width, im.height)
    x += im.width + 1
    row = max(row, im.height)
atlas = Image.new('RGBA', (W, y + row), (0, 0, 0, 0))
for k, (ax, ay, w, h) in rects.items():
    atlas.alpha_composite(pieces[k][0], (ax, ay))
atlas.save(ROOT / 'public/assets/furniture/house_v3.png')

# ---- Extra 16 px tiles (one row): grass x4, deck x4, hedge face 3 x 2 rows, skyline face 4 x 2 rows ----
tiles = []
for cx, cy in ((0, 12), (1, 12), (2, 12), (3, 12)):
    tiles.append(ninja('TilesetFloor.png', cx, cy, 1, 1))


def deck(v):
    """Warm wooden decking for the roof (Ninja's is too orange next to LimeZu): 4 planks, ends offset per tile."""
    im, d = canvas(16, 16)
    for i in range(4):
        y = i * 4
        c = [(154, 100, 64), (140, 90, 58), (160, 106, 68), (146, 94, 60)][(i + v) % 4]
        d.rectangle([0, y, 15, y + 3], fill=c + (255,))
        d.line([(0, y + 3), (15, y + 3)], fill=(96, 60, 40, 255))
        end = (v * 5 + i * 7) % 16
        d.line([(end, y), (end, y + 2)], fill=(110, 70, 46, 255))
        d.point([(1 + (i * 5 + v) % 14, y + 1)], fill=(176, 122, 80, 255))
    return im


for v in range(4):
    tiles.append(deck(v))


def hedge(part, row):
    im, d = canvas(16, 16)
    base = (58, 120, 60) if row == 0 else (44, 96, 50)
    d.rectangle([0, 0, 15, 15], fill=base + (255,))
    rnd = random.Random(row * 10 + part)
    for _ in range(26):
        px, py = rnd.randrange(16), rnd.randrange(16)
        c = (90, 160, 80) if rnd.random() < 0.6 else (34, 80, 42)
        d.rectangle([px, py, px + 1, py], fill=c + (255,))
    if row == 0:
        d.line([(0, 0), (15, 0)], fill=(120, 190, 100, 255))
    else:
        d.rectangle([0, 13, 15, 15], fill=(30, 60, 36, 255))
    if part == 0:
        d.line([(0, 0), (0, 15)], fill=(24, 50, 30, 255))
    if part == 2:
        d.line([(15, 0), (15, 15)], fill=(24, 50, 30, 255))
    return im


for row in (0, 1):
    for part in (0, 1, 2):
        tiles.append(hedge(part, row))


def skyline(col, row):
    """Night sky with the city behind the roof rail: 4 different columns so it doesn't repeat every tile."""
    im, d = canvas(16, 16)
    sky_top, sky_low = (28, 30, 70), (70, 50, 100)
    for yy in range(16):
        t = (row * 16 + yy) / 32
        d.line([(0, yy), (15, yy)], fill=tuple(int(a + (b - a) * t) for a, b in zip(sky_top, sky_low)) + (255,))
    heights = [[13, 20, 10, 17], [18, 11, 22, 15], [12, 19, 16, 9], [21, 14, 11, 18]][col]
    for i, hgt in enumerate(heights):
        x0 = i * 4
        top = 28 - hgt - row * 16
        if top <= 15:
            d.rectangle([x0, max(0, top), x0 + 3, 15], fill=(22, 20, 40, 255))
        for wy in range(max(0, top + 2), 16, 3):
            if (x0 + wy + col) % 5 == 0:
                d.point([(x0 + 1, wy)], fill=(255, 211, 107, 255))
    if row == 0 and col in (0, 2):
        d.point([(3 + col, 3)], fill=(255, 255, 255, 255))
    if row == 1:
        d.rectangle([0, 12, 15, 13], fill=(150, 110, 80, 255))  # the roof rail
        d.line([(0, 12), (15, 12)], fill=(200, 160, 110, 255))
        for px in (1, 6, 11):
            d.line([(px, 13), (px, 15)], fill=(120, 90, 60, 255))
    return im


for row in (0, 1):
    for col in range(4):
        tiles.append(skyline(col, row))
extra = Image.new('RGBA', (16 * len(tiles), 16), (0, 0, 0, 0))
for i, t in enumerate(tiles):
    extra.alpha_composite(t.convert('RGBA'), (i * 16, 0))
extra.save(ROOT / 'public/assets/tiles/house_extra.png')

# ---- The art table ----
table = {}
for k, v in json.loads((ROOT / 'design/game/sprites.json').read_text())['items'].items():
    table[k] = {'sheet': 'limezu_interiors', 'px': v['px'], 'pack': 'Modern Interiors Free (LimeZu)'}
for k, (ax, ay, w, h) in sorted(rects.items()):
    table[k] = {'sheet': 'house_v3', 'px': [ax, ay, w, h], 'pack': pieces[k][1]}
art = {
    'note': 'Generated by scripts/art/build_house_art.py. Top-down art for each kind of furniture (REDESIGN.md §5 rule 4).',
    'tiles': {'sheet': 'house_extra', 'grass': [0, 1, 2, 3], 'deck': [4, 5, 6, 7], 'hedge': [8, 9, 10, 11, 12, 13], 'skyline': [14, 15, 16, 17, 18, 19, 20, 21]},
    'kinds': table,
}
out = ROOT / 'src/house/art/topdown.json'
out.parent.mkdir(parents=True, exist_ok=True)
kinds = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in table.items())
out.write_text('{\n "note": %s,\n "tiles": %s,\n "kinds": {\n%s\n }\n}\n' % (json.dumps(art['note']), json.dumps(art['tiles']), kinds))
print(f'house_v3.png {atlas.size}, {len(rects)} new pieces; house_extra.png {len(tiles)} tiles; {len(table)} kinds')
