import sys
from PIL import Image
root = sys.argv[1]; out = sys.argv[2]
RB  = Image.open(f'{root}/public/assets/tiles/limezu_room_builder.png').convert('RGBA')
INT = Image.open(f'{root}/public/assets/furniture/limezu_interiors.png').convert('RGBA')
T = 16
W, H = 24, 11
scene = Image.new('RGBA', (W*T, H*T), (27, 20, 36, 255))

def tile(sheet, idx, w=1, h=1):
    cols = sheet.width // T
    r, c = divmod(idx, cols)
    return sheet.crop((c*T, r*T, (c+w)*T, (r+h)*T))

def put(sheet, idx, x, y, w=1, h=1):
    scene.alpha_composite(tile(sheet, idx, w, h), (round(x*T), round(y*T)))

for y in range(4, H):
    for x in range(W):
        put(RB, 233 if y % 2 == 0 else 250, x, y)
for x in range(W):
    put(RB, 222, x, 2)
    put(RB, 239, x, 3)

# wall decor
put(INT, 762, 2.5, 2, 2, 1)     # fairy lights
put(INT, 388, 5, 2, 3, 2)       # curtained window
put(INT, 762, 8, 2, 2, 1)
put(INT, 1136, 9.5, 2.5)        # painting
put(INT, 395, 11, 2, 2, 2)      # FRONT DOOR (centre)
put(INT, 1138, 13.5, 2.5)       # painting
put(INT, 762, 14, 2, 2, 1)
put(INT, 393, 16, 2, 2, 2)      # window
put(INT, 1092, 19, 1, 2, 3)     # fireplace
put(INT, 762, 21, 2, 2, 1)

# floor furniture
put(INT, 229, 0, 2, 2, 4)       # bookshelf
put(INT, 296, 4.5, 4, 3, 2)     # red sofa
put(INT, 732, 8, 3, 1, 2)       # bush
put(INT, 247, 10, 5, 4, 3)      # rug in front of the door
put(INT, 714, 14.5, 2.5, 2, 3)  # potted tree
put(INT, 784, 18.5, 4)          # small plant
put(INT, 717, 22, 2.5, 2, 3)    # palm

scene.save(out)
