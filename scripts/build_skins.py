"""Build the character skins atlas (REDESIGN.md R4) from Ninja Adventure (CC0).

    python scripts/build_skins.py

Reads assets/raw/redesign-packs/Ninja Adventure - Asset Pack/.../Actor/Character/<Name>/ and writes:
  public/assets/characters/skins.png   every skin's sheet: a 64 x 112 block (4 facings x 7 rows: walk 1-4,
                                       attack, jump, item), as in the pack
  public/assets/characters/faces.png   every skin's 38 x 38 face, in the same order
  src/house/skins.json                 the list (key, name, category, rarity) and the atlas layout

The atlas format has a `facings` list so isometric skins (4 diagonal facings) fit the same shape later
(REDESIGN.md §5 rule 7). Code asks for "the frame facing this way", never fixed frame numbers.
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'raw', 'redesign-packs', 'Ninja Adventure - Asset Pack', 'Ninja Adventure - Asset Pack', 'Actor', 'Character')
OUT_PNG = os.path.join(ROOT, 'public', 'assets', 'characters', 'skins.png')
OUT_FACES = os.path.join(ROOT, 'public', 'assets', 'characters', 'faces.png')
OUT_JSON = os.path.join(ROOT, 'src', 'house', 'skins.json')

CELL = 16
FACE = 38
PER_ROW = 10  # skins per atlas row
ROWS = 7  # rows per skin: walk 1-4, attack, jump, item
FACINGS = ['down', 'up', 'left', 'right']  # the sheet's column order

# Rarity (STORE.md §3.1). Starters are free for everyone; the rest come with the shop (phase S2).
STARTERS = ['boy', 'woman', 'villager', 'villager2', 'villager3', 'villager4', 'villager5', 'villager6',
            'child', 'oldman', 'princess', 'eskimo']
EPIC = ['goldstatue', 'knightgold', 'master', 'spirit', 'skeletondemon', 'vampire', 'ninjathunder', 'ninjafire',
        'samuraired', 'statue', 'demonred', 'tengu2', 'flam', 'shamanlion', 'sultan2']
RARE = ['ninjablue', 'ninjablue2', 'ninjabomb', 'ninjadark', 'ninjaeskimo', 'ninjagray', 'ninjagreen', 'ninjaleaf',
        'ninjamageblack', 'ninjamageorange', 'ninjamasked', 'ninjared', 'ninjared2', 'ninjawater', 'ninjayellow',
        'redninja3', 'samurai', 'samuraiblue', 'knight', 'skeleton', 'demongreen', 'robotgreen', 'robotgrey',
        'robotcamouflage', 'sorcererblack', 'sorcererorange', 'tengu', 'maskgoldracoon', 'lionyellow', 'sultan']


def rarity(key: str) -> str:
    if key in STARTERS:
        return 'starter'
    if key in EPIC:
        return 'epic'
    if key in RARE:
        return 'rare'
    return 'common'
# Odd files in the pack.
SHEET_FILE = {'SamuraiRed': 'redsamurai.png'}
FACE_FILE = {'ManGreen': 'Faceset1.png'}


def category(name: str) -> str:
    n = name.lower()
    if re.match(r'^(ninja|redninja|samurai|monk|master|knight|fighter|gladiator|redgladiator|hunter|camouflage)', n):
        return 'ninja'
    if re.match(r'^(lion|cavelion|monkey|pig|greenpig|mask|tengu|shamanlion)', n):
        return 'animal'
    if re.match(r'^(skeleton|demon|robot|spirit|statue|goldstatue|vampire|sorcerer|shaman|flam)', n):
        return 'fantasy'
    return 'people'


NAMES = {'Village6': 'Traveller', 'Flam': 'Flame', 'Cavegirl': 'Cave Girl', 'Cavegirl2': 'Cave Girl 2', 'Caveman': 'Cave Man', 'Caveman2': 'Cave Man 2',
         'CaveLion': 'Cave Lion', 'CaveLion2': 'Cave Lion 2', 'Eskimo': 'Arctic Explorer', 'NinjaEskimo': 'Ninja Arctic'}


def nice(name: str) -> str:
    if name in NAMES:
        return NAMES[name]
    s = re.sub(r'(?<=[a-z])(?=[A-Z0-9])', ' ', name)
    return s.strip()


def main():
    if not os.path.isdir(SRC):
        sys.exit(f'Ninja Adventure characters not found at {SRC}')
    names = sorted(d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d)))
    rows = (len(names) + PER_ROW - 1) // PER_ROW
    atlas = Image.new('RGBA', (PER_ROW * 4 * CELL, rows * ROWS * CELL), (0, 0, 0, 0))
    faces = Image.new('RGBA', (PER_ROW * FACE, rows * FACE), (0, 0, 0, 0))
    skins = []
    for i, name in enumerate(names):
        sheet = Image.open(os.path.join(SRC, name, SHEET_FILE.get(name, 'SpriteSheet.png'))).convert('RGBA')
        steps = sheet.height // CELL
        # Rows: walk 1-4, attack, jump, item. Two-row sheets (Child, Old Woman) repeat their walk and use
        # the first pose for the moves they don't have.
        order = list(range(ROWS)) if steps >= ROWS else [0, 1, 0, 1, 0, 1, 0]
        bx, by = i % PER_ROW, i // PER_ROW
        for col in range(4):
            for r, src_row in enumerate(order):
                frame = sheet.crop((col * CELL, src_row * CELL, col * CELL + CELL, src_row * CELL + CELL))
                atlas.paste(frame, ((bx * 4 + col) * CELL, (by * ROWS + r) * CELL))
        face = Image.open(os.path.join(SRC, name, FACE_FILE.get(name, 'Faceset.png'))).convert('RGBA')
        faces.paste(face, (bx * FACE + (FACE - face.width) // 2, by * FACE + (FACE - face.height) // 2))
        key = name.lower()
        skins.append({'key': f'ninja.{key}', 'name': nice(name), 'cat': category(name), 'rarity': rarity(key)})
    atlas.save(OUT_PNG, optimize=True)
    faces.save(OUT_FACES, optimize=True)
    data = {
        'note': 'Generated by scripts/build_skins.py from Ninja Adventure (CC0, pixel-boy). Do not edit by hand.',
        'cell': CELL,
        'face': FACE,
        'perRow': PER_ROW,
        'rows': ROWS,
        'anims': {'walk': [0, 1, 2, 3], 'idle': [0], 'attack': [4], 'jump': [5], 'item': [6]},
        'facings': FACINGS,
        'skins': skins,
    }
    with open(OUT_JSON, 'w') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    print(f'{len(skins)} skins -> {OUT_PNG} ({atlas.width}x{atlas.height}), {OUT_FACES}, {OUT_JSON}')


if __name__ == '__main__':
    main()
