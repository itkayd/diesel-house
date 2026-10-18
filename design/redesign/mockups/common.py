"""Shared helpers for the R2 look mock-ups (REDESIGN.md §5). Each build_<x>.py composes one scene from the
real packs in assets/raw/redesign-packs/ (gitignored, on Diesel's laptop and in the handoff zip) and writes
public/mockups/<x>/: scene.png (everything under the character), mask.png (white = you can walk here),
meta.json (lights, disco floor, signs, spawn, character) and the character sheet. public/mockups/engine.js
plays them. Run from the repo root: python3 design/redesign/mockups/build_a.py (b, c)."""
import json
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[3]
PACKS = ROOT / 'assets/raw/redesign-packs'
NINJA = PACKS / 'Ninja Adventure - Asset Pack/Ninja Adventure - Asset Pack'
LRK = PACKS / 'pixelinterior_LRK_v1.1'
DISCO = PACKS / 'GameArtFromMichealMuirden'


def out_dir(name):
    d = ROOT / 'public/mockups' / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def inside(poly, x, y):
    """Even-odd point in polygon (same rule as src/house/rooms.ts)."""
    res = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            res = not res
        j = i
    return res


def tile_in(poly, tx, ty):
    return inside(poly, tx + 0.5, ty + 0.5)


def bounds(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def door_tiles(d):
    across = d['side'] in ('north', 'south')
    return [(d['x'] + i, d['y']) if across else (d['x'], d['y'] + i) for i in range(d['w'])]


def components(sheet):
    """The separate sprites on a sheet, in the same order as /tmp items.py numbered them (rows, then x)."""
    im = Image.open(sheet).convert('RGBA')
    W, H = im.size
    a = im.getchannel('A').load()
    seen = bytearray(W * H)
    boxes = []
    for y in range(H):
        for x in range(W):
            if a[x, y] < 16 or seen[y * W + x]:
                continue
            stack = [(x, y)]
            seen[y * W + x] = 1
            x0 = x1 = x
            y0 = y1 = y
            while stack:
                cx, cy = stack.pop()
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1), (cx + 1, cy + 1), (cx - 1, cy - 1), (cx + 1, cy - 1), (cx - 1, cy + 1)):
                    if 0 <= nx < W and 0 <= ny < H and not seen[ny * W + nx] and a[nx, ny] >= 16:
                        seen[ny * W + nx] = 1
                        stack.append((nx, ny))
            if x1 - x0 + 1 >= 6 and y1 - y0 + 1 >= 6:
                boxes.append((x0, y0, x1 - x0 + 1, y1 - y0 + 1))
    merged = True
    while merged:
        merged = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                ax, ay, aw, ah = boxes[i]
                bx, by, bw, bh = boxes[j]
                if ax - 1 <= bx + bw and bx - 1 <= ax + aw and ay - 1 <= by + bh and by - 1 <= ay + ah:
                    nx, ny = min(ax, bx), min(ay, by)
                    boxes[i] = (nx, ny, max(ax + aw, bx + bw) - nx, max(ay + ah, by + bh) - ny)
                    del boxes[j]
                    merged = True
                    break
            if merged:
                break
    boxes.sort(key=lambda b: (b[1] // 8, b[0]))
    return im, boxes


_sheets = {}


def piece(sheet, n):
    """Sprite number n from a sheet (see components)."""
    if sheet not in _sheets:
        _sheets[sheet] = components(sheet)
    im, boxes = _sheets[sheet]
    x, y, w, h = boxes[n]
    return im.crop((x, y, x + w, y + h))


def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im


class Scene:
    """A picture, a walk mask, and what the engine needs to know."""

    def __init__(self, w, h, tile):
        self.tile = tile
        self.img = Image.new('RGBA', (w, h), (20, 15, 28, 255))
        self.walk = Image.new('L', (w, h), 0)
        self.front = Image.new('RGBA', (w, h), (0, 0, 0, 0))  # solid things only: drawn over you when you're behind them
        self.meta = {'size': [w, h], 'tile': tile, 'lights': [], 'signs': [], 'disco': None, 'ball': None, 'solids': []}

    def put(self, sprite, x, y, solid=False, base=None, light=None, front=False):
        """Paste a sprite with its top-left at x, y. solid: its base blocks walking (base: height in px)."""
        self.img.alpha_composite(sprite, (int(x), int(y)))
        w, h = sprite.size
        if solid:
            self.front.alpha_composite(sprite, (int(x), int(y)))
            bh = base or max(5, int(h * 0.45))
            ImageDraw.Draw(self.walk).rectangle([x + 1, y + h - bh, x + w - 2, y + h - 1], fill=0)
            self.meta['solids'].append([int(x), int(y), w, h])
        if light:
            colour, r = light
            self.meta['lights'].append({'x': int(x + w / 2), 'y': int(y + h * 0.3), 'r': r, 'c': colour})
        return w, h

    def save(self, name, character):
        d = out_dir(name)
        self.img.save(d / 'scene.png')
        self.walk.save(d / 'mask.png')
        self.front.save(d / 'front.png')
        self.meta['character'] = character
        (d / 'meta.json').write_text(json.dumps(self.meta, indent=1))
        print(name, self.img.size, 'lights', len(self.meta['lights']))


def ninja_character(name, d, scale=1):
    """A Ninja Adventure character (CC0): 4 columns (down, up, left, right) x 4 walk rows of 16 x 16."""
    sheet = Image.open(NINJA / 'Actor/Character' / name / 'SpriteSheet.png').convert('RGBA').crop((0, 0, 64, 64))
    sheet.save(d / f'char_{name.lower()}.png')
    cols = {'down': 0, 'up': 1, 'left': 2, 'right': 3}
    return {
        'src': f'char_{name.lower()}.png', 'fw': 16, 'fh': 16, 'scale': scale, 'fps': 7,
        'walk': {k: [[c * 16, r * 16] for r in range(4)] for k, c in cols.items()},
        'idle': {k: [[c * 16, 0]] for k, c in cols.items()},
        'feet': [8, 15], 'label': f'Ninja Adventure "{name}" (CC0, 16 px' + (f', drawn {scale}x)' if scale > 1 else ')'),
    }


def limezu_character(name, d, scale=1):
    """A current game character (LimeZu, 16 x 32): run strip of 24 frames, right / up / left / down."""
    src = ROOT / 'public/assets/characters' / f'limezu_{name}_run.png'
    Image.open(src).save(d / f'char_limezu_{name}.png')
    order = ['right', 'up', 'left', 'down']
    return {
        'src': f'char_limezu_{name}.png', 'fw': 16, 'fh': 32, 'scale': scale, 'fps': 10,
        'walk': {k: [[(i * 6 + s) * 16, 0] for s in range(6)] for i, k in enumerate(order)},
        'idle': {k: [[(i * 6) * 16, 0]] for i, k in enumerate(order)},
        'feet': [8, 31], 'label': f'Today\'s character "{name}" (LimeZu, 16 x 32)',
    }
