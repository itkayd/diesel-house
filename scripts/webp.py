"""Lossless WebP copies of the biggest PNGs the game loads (same pixels, about a quarter of the size).

  python scripts/webp.py

The PNGs stay the source (scripts/build_skins.py writes skins.png and faces.png); the game loads the .webp.
Run this again whenever one of them changes. Every browser the game supports reads WebP (iPhone: iOS 14+).
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [
    'public/assets/characters/skins.png',
    'public/assets/characters/faces.png',
    'public/assets/furniture/limezu_interiors.png',
]

for rel in FILES:
    src = os.path.join(ROOT, rel)
    out = src[:-4] + '.webp'
    im = Image.open(src).convert('RGBA')
    im.save(out, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    back = Image.open(out).convert('RGBA')
    assert back.tobytes() == im.tobytes(), f'{rel}: the WebP is not pixel-identical'
    print(f'{rel}: {os.path.getsize(src):,} -> {os.path.getsize(out):,} bytes (pixel-identical)')
