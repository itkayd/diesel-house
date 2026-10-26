"""Pixel frames for the game UI (REDESIGN.md R5: one visual language from the pack style).

Drawn in code, in the style of the Ninja Adventure UI kit (CC0: wood rim, notched corners, bevels),
in Diesel House's night + lamp colours. Each piece is drawn at 1x and saved at 2x (nearest), so CSS
border-image uses it 1:1 and pixels stay crisp. Run: python3 scripts/ui-skin.py
Output: public/assets/ui/skin/*.png (slice sizes in src/ui/skin.css).
"""
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'public/assets/ui/skin'
SCALE = 2
C = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
T = (0, 0, 0, 0)
O = C('#0d0912')


def save(name, img):
    img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST).save(OUT / f'{name}.png')


def frame(size, rings, fill=None, notch=True, rivets=None):
    """rings: list per depth d (0 = outer) of (top, left, right, bottom) colours."""
    img = Image.new('RGBA', (size, size), T)
    px = img.load()
    for y in range(size):
        for x in range(size):
            d = min(x, y, size - 1 - x, size - 1 - y)
            if notch and (x in (0, size - 1)) and (y in (0, size - 1)):
                continue
            if d < len(rings):
                top, left, right, bottom = rings[d]
                # which side is this pixel on (nearest edge wins; ties go to top/bottom)
                dists = {'top': y, 'bottom': size - 1 - y, 'left': x, 'right': size - 1 - x}
                side = min(dists, key=lambda k: (dists[k], k not in ('top', 'bottom')))
                px[x, y] = {'top': top, 'left': left, 'right': right, 'bottom': bottom}[side]
            elif fill:
                px[x, y] = fill
    # inner notches: the outline steps in at each corner so the frame reads as rounded
    if notch:
        for (x, y) in ((1, 1), (size - 2, 1), (1, size - 2), (size - 2, size - 2)):
            px[x, y] = O
    for (x, y, col) in rivets or []:
        px[x, y] = col
    return img


# Sheets and cards: a warm wood rim with gold rivets, a dark inner line, see-through middle.
hi, mid, dk, sh = C('#e0a468'), C('#b0703f'), C('#7a4728'), C('#4a2a19')
inner = C('#1a1222')
gold, goldsh = C('#f4b860'), C('#a8652a')
panel = frame(16, [(O, O, O, O), (hi, mid, dk, dk), (mid, mid, dk, sh), (dk, dk, sh, sh), (inner,) * 4],
              rivets=[(2, 2, gold), (13, 2, gold), (2, 13, goldsh), (13, 13, goldsh)])
save('panel', panel)

# Buttons: bevelled, lit from the top. Middle filled (stretched).
def button(base, light, shade, deep, pressed=False):
    if pressed:
        return frame(12, [(O,) * 4, (shade, base, base, base), (base,) * 4], fill=base)
    return frame(12, [(O,) * 4, (light, light, base, deep), (base, base, base, shade)], fill=base)

save('btn-gold', button(C('#f4b860'), C('#ffe2a8'), C('#c9822f'), C('#a8652a')))
save('btn-gold-down', button(C('#e9a94e'), C('#ffe2a8'), C('#a8652a'), C('#a8652a'), pressed=True))
save('btn-plum', button(C('#3a2c46'), C('#5b4870'), C('#241a2e'), C('#1a1222')))
save('btn-plum-down', button(C('#33263e'), C('#5b4870'), C('#1a1222'), C('#1a1222'), pressed=True))
save('btn-red', button(C('#ff8f7a'), C('#ffc7bb'), C('#c45a48'), C('#9a3f31')))
save('btn-green', button(C('#6fdc8c'), C('#bff3cc'), C('#3f9e5a'), C('#2c7442')))

# Recessed wells: inputs, cards, chips. Shadow at the top, a light line at the bottom.
well = C('#1d1526')
save('well', frame(8, [(O,) * 4, (C('#0f0a15'), C('#0f0a15'), C('#2a2036'), C('#4a3a57'))], fill=well))
save('well-gold', frame(8, [(O,) * 4, (C('#f4b860'),) * 4], fill=C('#2e2018')))
# Raised tile (HUD buttons, pills): like the plum button, slightly brighter rim
save('tile', frame(12, [(O,) * 4, (C('#5b4870'), C('#4a3a5c'), C('#2b2034'), C('#1a1222')), (C('#2b2034'),) * 3 + (C('#241a2e'),)], fill=C('#2b2034')))

# A wooden sign for titles (like the room signs in the house): planks with nail heads.
sign = Image.new('RGBA', (16, 12), T)
sp = sign.load()
plank = [C('#e0a468'), C('#c98a52'), C('#b0703f'), C('#b0703f'), C('#9a5f35'), C('#c98a52'), C('#b0703f'), C('#9a5f35'), C('#7a4728')]
for y in range(12):
    for x in range(16):
        edge = x in (0, 15) or y in (0, 11)
        if edge:
            if (x in (0, 15)) and (y in (0, 11)):
                continue
            sp[x, y] = O
        elif y == 1:
            sp[x, y] = C('#f0c08a')
        elif y == 10:
            sp[x, y] = C('#5c3420')
        else:
            sp[x, y] = plank[(y - 1) % len(plank)]
for (x, y) in ((2, 2), (13, 2), (2, 9), (13, 9)):
    sp[x, y] = C('#4a2a19')
save('sign', sign)

# Dither for sheet backgrounds (very subtle): 4x4 checker of two near colours.
d = Image.new('RGBA', (4, 4), C('#2b2034'))
for y in range(4):
    for x in range(4):
        if (x + y) % 4 == 0:
            d.putpixel((x, y), C('#2f2339'))
save('dither', d)
print('wrote', sorted(p.name for p in OUT.glob('*.png')))
