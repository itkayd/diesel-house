"""Builds the Diesel House MVP reference: cuts furniture from the LimeZu sheet, renders the
furnished house (design/game/house_furnished.png) and writes trimmed pixel rects into sprites.json.
Run from repo root:  python design/game/build_mvp.py"""
import json, sys, base64, io
from collections import deque
from PIL import Image

SHEET = Image.open('public/assets/furniture/limezu_interiors.png').convert('RGBA')
spr = json.load(open('design/game/sprites.json'))

def cut(region):
    """Largest opaque blob in the search box (8-connected), trimmed to its bounding box."""
    x, y, w, h = [v * 16 for v in region]
    box = SHEET.crop((x, y, x + w, y + h)); a = box.getchannel('A').load()
    seen = set(); best = None
    for sy in range(h):
        for sx in range(w):
            if a[sx, sy] < 20 or (sx, sy) in seen: continue
            q = deque([(sx, sy)]); seen.add((sx, sy)); pts = []
            while q:
                px, py = q.popleft(); pts.append((px, py))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = px + dx, py + dy
                        if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and a[nx, ny] >= 20:
                            seen.add((nx, ny)); q.append((nx, ny))
            if not best or len(pts) > len(best): best = pts
    xs = [p[0] for p in best]; ys = [p[1] for p in best]
    rect = (x + min(xs), y + min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1)
    return rect

for k, v in spr['items'].items():
    v['px'] = list(cut(v['region']))
json.dump(spr, open('design/game/sprites.json', 'w'), indent=1)

def img(k):
    x, y, w, h = spr['items'][k]['px']; return SHEET.crop((x, y, x + w, y + h))

def contact_sheet(path):
    from PIL import ImageDraw
    keys = list(spr['items']); cols = 8; cell = 72
    out = Image.new('RGBA', (cols * cell, ((len(keys) + cols - 1) // cols) * (cell + 12)), (40, 34, 50, 255)); d = ImageDraw.Draw(out)
    for i, k in enumerate(keys):
        im = img(k); s = min(1, 60 / max(im.size)) if max(im.size) > 60 else 1
        cx, cy = (i % cols) * cell, (i // cols) * (cell + 12)
        out.alpha_composite(im, (cx + 4, cy + 4)); d.text((cx + 2, cy + cell - 2), k[:11], fill=(255, 230, 160))
    out = out.resize((out.width * 2, out.height * 2), Image.NEAREST); out.save(path)

# ---------------------------------------------------------------------------------------------
# 1. Base map: floor (with each room's floorTint multiplied in) + walls, from maps/house.tmj
# ---------------------------------------------------------------------------------------------
M = json.load(open('maps/house.tmj')); W, H = M['width'], M['height']
TS = Image.open('public/assets/tiles/limezu_room_builder.png').convert('RGBA'); TCOLS = 17
LAYER = {l['name']: l for l in M['layers']}
ZONES = {o['name']: o for o in LAYER['zones']['objects']}

def tile(g):
    t = g - 1; return TS.crop(((t % TCOLS) * 16, (t // TCOLS) * 16, (t % TCOLS) * 16 + 16, (t // TCOLS) * 16 + 16))

def render_layer(name):
    out = Image.new('RGBA', (W * 16, H * 16), (0, 0, 0, 0))
    for i, g in enumerate(LAYER[name]['data']):
        if g: out.alpha_composite(tile(g), ((i % W) * 16, (i // W) * 16))
    return out

def base_map():
    floor = render_layer('floor')
    for z in ZONES.values():
        tint = next((p['value'] for p in (z.get('properties') or []) if p['name'] == 'floorTint'), None)
        if not tint: continue
        x, y, w, h = int(z['x']), int(z['y']), int(z['width']), int(z['height'])
        if y < 12 * 16: h -= 16          # top rooms: leave the doorway row (hallway floor) untinted
        else: y += 16; h -= 16            # bottom rooms: zone starts at the doorway row
        r, g, b = int(tint[1:3], 16), int(tint[3:5], 16), int(tint[5:7], 16)
        reg = floor.crop((x, y, x + w, y + h)); px = reg.load()
        for yy in range(h):
            for xx in range(w):
                c = px[xx, yy]
                if c[3]: px[xx, yy] = (c[0] * r // 255, c[1] * g // 255, c[2] * b // 255, c[3])
        floor.paste(reg, (x, y))
    out = Image.new('RGBA', floor.size, (20, 15, 28, 255)); out.alpha_composite(floor); out.alpha_composite(render_layer('walls'))
    return out

# ---------------------------------------------------------------------------------------------
# 2. Furniture atlas: only the pieces in sprites.json, shelf-packed, 1px gap
# ---------------------------------------------------------------------------------------------
def atlas():
    keys = sorted(spr['items'], key=lambda k: -spr['items'][k]['px'][3]); AW = 256
    x = y = rowh = 0; pos = {}
    for k in keys:
        w, h = spr['items'][k]['px'][2:]
        if x + w > AW: x = 0; y += rowh + 1; rowh = 0
        pos[k] = (x, y); x += w + 1; rowh = max(rowh, h)
    im = Image.new('RGBA', (AW, y + rowh), (0, 0, 0, 0))
    for k, (ax, ay) in pos.items():
        im.alpha_composite(img(k), (ax, ay)); spr['items'][k]['atlas'] = [ax, ay] + spr['items'][k]['px'][2:]
    return im

# ---------------------------------------------------------------------------------------------
# 3. Room recipes. Coordinates are px relative to the room's wall-face top-left.
#    Room = 160 wide; wall face y 0-32; floor y 32-160.
#    Keep clear: top rooms x 56-104, y 120-160 (door at the bottom); bottom rooms x 56-104, y 0-72 (door at the top).
#    Flags: wall = hangs on the wall face, flat = rug (drawn under everything), light = glow colour.
# ---------------------------------------------------------------------------------------------
WARM, FIRE, COOL, PINK = '#f4b860', '#ff8a3d', '#9ec9ff', '#ffb3c7'
ROOMS = {
 'room_01': {'name': "Sami's room", 'mood': 'chill', 'door': 'open', 'theme': 'Chill lounge', 'items': [
    ('window_curtain', 22, 4, 'wall'), ('picture_land', 120, 10, 'wall'), ('sofa_grey', 56, 33),
    ('rug_blue', 60, 62, 'flat'), ('plant_palm', 4, 30), ('lamp_cream', 140, 33, WARM),
    ('armchair_red', 14, 78), ('plant_small', 142, 128)]},
 'room_02': {'name': "Diesel's den", 'mood': 'deeptalk', 'door': 'open', 'theme': 'Fireside deep talk', 'items': [
    ('fireplace', 64, 10, FIRE), ('picture_a', 24, 10, 'wall'), ('picture_b', 124, 10, 'wall'),
    ('rug_red', 50, 58, 'flat'), ('armchair_red', 34, 62), ('armchair_red', 110, 62), ('sofa_red', 64, 94),
    ('lamp_red', 8, 36, WARM), ('plant_tree', 138, 130)]},
 'room_03': {'name': "Zak's room", 'mood': 'gaming', 'door': 'knock', 'theme': 'Gaming corner', 'items': [
    ('map_world', 14, 8, 'wall'), ('aquarium', 70, 14, COOL), ('desk_study', 8, 36), ('desk_study', 124, 36),
    ('rug_green', 68, 72, 'flat'), ('stool', 40, 72), ('stool', 106, 72), ('sofa_brown', 64, 92),
    ('lamp_blue', 8, 100, COOL), ('plant_small', 142, 130)]},
 'room_04': {'name': "Hodan's room", 'mood': 'study', 'door': 'locked', 'theme': 'Study / library', 'items': [
    ('bookshelf', 6, 8), ('bookshelf_2', 40, 8), ('map_world', 112, 10, 'wall'), ('desk_study', 112, 40),
    ('globe', 143, 38), ('rug_beige', 42, 82, 'flat'), ('armchair_red', 22, 80), ('lamp_cream', 90, 60, WARM),
    ('plant_tree', 140, 128)]},
 'room_05': {'name': "Leila's room", 'mood': 'music', 'door': 'open', 'theme': 'Music lounge', 'items': [
    ('window_red', 16, 6, 'wall'), ('picture_c', 124, 10, 'wall'), ('plant_small', 8, 40),
    ('rug_olive', 68, 92, 'flat'), ('sofa_brown', 14, 124), ('sofa_white', 54, 126), ('lamp_red', 140, 40, PINK),
    ('plant_palm', 132, 126)]},
 'room_06': {'name': "Yusuf's room", 'mood': 'gaming', 'door': 'open', 'theme': 'Board-game table', 'items': [
    ('picture_a', 24, 10, 'wall'), ('bookshelf_2', 122, 8), ('rug_red', 50, 88, 'flat'), ('table_wood', 61, 90),
    ('chair_a', 42, 96), ('chair_c', 103, 96), ('lamp_cream', 8, 40, WARM), ('plant_pot', 12, 140)]},
 'room_07': {'name': "Amira's room", 'mood': 'chill', 'door': 'open', 'theme': 'Bedroom', 'items': [
    ('bed_big', 8, 38), ('wardrobe', 128, 4), ('mirror', 106, 8, 'wall'), ('rug_small_red', 60, 118, 'flat'),
    ('dresser', 120, 132), ('plant_pot', 10, 140), ('lamp_table', 52, 40, WARM)]},
 'room_08': {'name': "Omar's room", 'mood': 'dnd', 'door': 'locked', 'theme': 'Bedroom', 'items': [
    ('picture_land', 24, 10, 'wall'), ('window_curtain', 120, 4, 'wall'), ('dresser', 10, 36), ('bed_blue', 118, 40),
    ('rug_small_blue', 68, 110, 'flat'), ('plant_palm', 130, 124), ('lamp_blue', 8, 120, COOL)]},
}
# Hallway decor, world px. Hallway face y 192-224, floor 224-304. Door gaps x 80-112, 256-288, 432-464, 608-640.
HALL = [('door_double', 20, 196, 'wall'), ('fairy_lights', 128, 194, WARM), ('fairy_lights', 190, 194, WARM),
        ('fairy_lights', 304, 194, WARM), ('fairy_lights', 366, 194, WARM), ('fairy_lights', 480, 194, WARM),
        ('fairy_lights', 542, 194, WARM), ('fairy_lights', 656, 194, WARM), ('picture_land', 166, 206, 'wall'),
        ('picture_c', 520, 206, 'wall'), ('picture_b', 340, 206, 'wall'),
        ('rug_small_red', 188, 250, 'flat'), ('rug_small_red', 368, 250, 'flat'), ('rug_small_red', 548, 250, 'flat'),
        ('plant_palm', 130, 272), ('plant_tree', 330, 279), ('plant_palm', 500, 272), ('plant_tree', 680, 279),
        ('lamp_cream', 226, 226, WARM), ('lamp_cream', 586, 226, WARM)]

def room_origin(rid):
    z = ZONES[rid]; x = int(z['x']); y = int(z['y'])
    return (x, y) if y < 12 * 16 else (x, y + 16)

def placed():
    out = []
    def add(k, x, y, flag=None, room='hallway'):
        w, h = spr['items'][k]['px'][2:]
        light = flag if flag and flag.startswith('#') else None
        z = 1 if flag == 'flat' else 2 if flag == 'wall' else y + h
        out.append({'k': k, 'x': x, 'y': y, 'w': w, 'h': h, 'z': z, 'light': light, 'room': room})
    for rid, r in ROOMS.items():
        ox, oy = room_origin(rid)
        for it in r['items']: add(it[0], ox + it[1], oy + it[2], it[3] if len(it) > 3 else None, rid)
    for it in HALL: add(it[0], it[1], it[2], it[3] if len(it) > 3 else None)
    return out

def b64(im):
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True); return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def b64file(path): return 'data:image/png;base64,' + base64.b64encode(open(path, 'rb').read()).decode()

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'sheet': contact_sheet(sys.argv[2]); sys.exit()
    base = base_map(); base.save('design/game/house_base.png')
    at = atlas(); at.save('design/game/furniture_atlas.png')
    items = placed()
    # preview PNG with furniture (no people) for quick looks
    prev = base.copy()
    for it in sorted(items, key=lambda i: i['z']):
        prev.alpha_composite(img(it['k']), (it['x'], it['y']))
    prev.save('design/game/house_furnished.png')
    json.dump(spr, open('design/game/sprites.json', 'w'), indent=1)
    walls = [1 if g else 0 for g in LAYER['walls']['data']]
    zones = [{'name': z['name'], 'x': z['x'], 'y': z['y'], 'w': z['width'], 'h': z['height']} for z in ZONES.values() if z['name'] != 'spawn']
    rooms = {rid: {k: r[k] for k in ('name', 'mood', 'door', 'theme')} | {'origin': room_origin(rid),
             'recipe': [list(i) for i in r['items']]} for rid, r in ROOMS.items()}
    data = {'W': W, 'H': H, 'walls': walls, 'zones': zones, 'items': items, 'rooms': rooms,
            'atlas': {k: v['atlas'] for k, v in spr['items'].items()},
            'sheet': {k: v['px'] for k, v in spr['items'].items()}, 'spawn': [ZONES['spawn']['x'], ZONES['spawn']['y']]}
    imgs = {'BASE': b64(base), 'ATLAS': b64(at)}
    for n in ('adam', 'alex', 'amelia', 'bob'):
        imgs[f'{n}_idle'] = b64file(f'public/assets/characters/limezu_{n}_idle.png')
        imgs[f'{n}_run'] = b64file(f'public/assets/characters/limezu_{n}_run.png')
    html = open('design/game/mvp.template.html').read()
    html = html.replace('/*THEME*/', open('design/game/theme.css').read())
    html = html.replace('"__DATA__"', json.dumps(data, separators=(',', ':')))
    html = html.replace('"__IMGS__"', json.dumps(imgs))
    open('design/game/mvp.html', 'w').write(html)
    print('mvp.html', len(html) // 1024, 'kB;', len(items), 'pieces placed')
