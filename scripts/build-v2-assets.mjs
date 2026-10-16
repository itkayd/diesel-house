// UPDATE.md Phase 9: cuts the art the game uses out of the raw Kenney packs (assets/raw/new-packs/,
// gitignored) into small packed sheets + Phaser atlas JSON in public/assets/, and lists them in
// assets/manifest.json.
//   node scripts/build-v2-assets.mjs
// Cropping runs in headless Edge (canvas), so no image tools are needed.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const RAW = 'assets/raw/new-packs';
const read = (f) => fs.readFileSync(`${RAW}/${f}`).toString('base64');

// Cards: Kenney Playing Cards, medium pixel tilemap (32 px cells). Rows 0-3 hearts, diamonds, clubs,
// spades (A..K in columns 0-12, the suit card in 13); column 14 has the blank card, the back and jokers.
// Dice (red) are on row 8: faces 1-3 in columns 0-2, 4-6 in columns 8-10, "?" in 11.
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CELL = 32;
const cardFrames = {};
SUITS.forEach((s, r) => RANKS.forEach((k, c) => (cardFrames[`${s}_${k}`] = [c, r])));
SUITS.forEach((s, r) => (cardFrames[`suit_${s}`] = [13, r]));
Object.assign(cardFrames, { blank: [14, 0], back: [14, 1], joker_red: [14, 2], joker_black: [14, 3] });
const DICE = { die_1: [0, 8], die_2: [1, 8], die_3: [2, 8], die_4: [8, 8], die_5: [9, 8], die_6: [10, 8], die_q: [11, 8] };

// Input prompts (1-bit, white for the dark UI): 16 px tiles in a 34-wide packed sheet.
const PROMPTS = { key_q: [85], key_e: [87], key_t: [89], key_space: [235, 236], tap: [705], mic: [569] };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto('about:blank');

// Draws [{src (base64 png), sx, sy, w, h, dx, dy}] onto a new canvas; returns base64 PNG.
async function compose(width, height, parts) {
  return page.evaluate(async ([width, height, parts]) => {
    const load = (b64) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const cache = new Map();
    for (const p of parts) {
      if (!cache.has(p.src)) cache.set(p.src, await load(p.src));
      g.drawImage(cache.get(p.src), p.sx, p.sy, p.w, p.h, p.dx, p.dy, p.w, p.h);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, [width, height, parts]);
}
const atlas = (image, frames, w, h) => ({
  frames: Object.fromEntries(Object.entries(frames).map(([name, f]) => [name, { frame: f, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } }])),
  meta: { image, format: 'RGBA8888', size: { w, h }, scale: '1' },
});
const write = (path, b64) => {
  fs.mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(path, Buffer.from(b64, 'base64'));
  return fs.statSync(path).size;
};
const out = {};

// 1. Cards + dice → public/assets/games/cards.png (15 × 5 cells: 4 card rows, then the dice).
{
  const src = read('kenney_playing-cards-pack/Tilesheet/cardsMedium_tilemap_packed.png');
  const parts = [];
  const frames = {};
  for (const [name, [c, r]] of Object.entries(cardFrames)) {
    parts.push({ src, sx: c * CELL, sy: r * CELL, w: CELL, h: CELL, dx: c * CELL, dy: r * CELL });
    frames[name] = { x: c * CELL, y: r * CELL, w: CELL, h: CELL };
  }
  Object.entries(DICE).forEach(([name, [c, r]], i) => {
    parts.push({ src, sx: c * CELL, sy: r * CELL, w: CELL, h: CELL, dx: i * CELL, dy: 4 * CELL });
    frames[name] = { x: i * CELL, y: 4 * CELL, w: CELL, h: CELL };
  });
  const size = write('public/assets/games/cards.png', await compose(15 * CELL, 5 * CELL, parts));
  fs.writeFileSync('public/assets/games/cards.json', JSON.stringify(atlas('cards.png', frames, 15 * CELL, 5 * CELL)) + '\n');
  out.cards = { files: ['public/assets/games/cards.png', 'public/assets/games/cards.json'], frames: Object.keys(frames).length, cell: '32x32', bytes: size, source: 'Kenney · Playing Cards Pack (CC0): Tilesheet/cardsMedium_tilemap_packed.png' };
}

// 2. Emotes → public/assets/emotes/emotes.png (Kenney Emotes, Pixel Style 1, as in design/game/v2.html).
{
  const xml = fs.readFileSync(`${RAW}/kenney_emotes-pack/Spritesheets/pixel_style1.xml`, 'utf8');
  const frames = {};
  for (const m of xml.matchAll(/name="emote_([^".]+)\.png" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g))
    frames[m[1] === '_' ? 'blank' : m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  const size = write('public/assets/emotes/emotes.png', read('kenney_emotes-pack/Spritesheets/pixel_style1.png'));
  fs.writeFileSync('public/assets/emotes/emotes.json', JSON.stringify(atlas('emotes.png', frames, 80, 96)) + '\n');
  out.emotes = { files: ['public/assets/emotes/emotes.png', 'public/assets/emotes/emotes.json'], frames: Object.keys(frames).length, cell: '16x16', bytes: size, source: 'Kenney · Emotes Pack (CC0): Spritesheets/pixel_style1 (Pixel, Style 1)' };
}

// 3. Input prompts → public/assets/prompts/prompts.png (one row).
{
  const src = read('kenney_input-prompts-pixel-1-bit/Tilemap/tilemap_white_packed.png');
  const parts = [];
  const frames = {};
  let x = 0;
  for (const [name, tiles] of Object.entries(PROMPTS)) {
    frames[name] = { x, y: 0, w: tiles.length * 16, h: 16 };
    for (const t of tiles) {
      parts.push({ src, sx: (t % 34) * 16, sy: Math.floor(t / 34) * 16, w: 16, h: 16, dx: x, dy: 0 });
      x += 16;
    }
  }
  const size = write('public/assets/prompts/prompts.png', await compose(x, 16, parts));
  fs.writeFileSync('public/assets/prompts/prompts.json', JSON.stringify(atlas('prompts.png', frames, x, 16)) + '\n');
  out.prompts = { files: ['public/assets/prompts/prompts.png', 'public/assets/prompts/prompts.json'], frames: Object.keys(frames), cell: '16x16', bytes: size, source: 'Kenney · Input Prompts Pixel 1-bit (CC0): Tilemap/tilemap_white_packed.png' };
}

// 4. UI pack → public/assets/ui/ui-pack.png (panels, buttons, bars: small tiles, thick outline; 23 × 7
// tiles of 16 px, loaded as a spritesheet for the game windows, walkie button and progress bars).
{
  const size = write('public/assets/ui/ui-pack.png', read('kenney_ui-pack-pixel-adventure/Tilesheets/Small tiles/Thick outline/tilemap_packed.png'));
  out.uiPack = { files: ['public/assets/ui/ui-pack.png'], frame: '16x16', tiles: 161, bytes: size, source: 'Kenney · UI Pack Pixel Adventure (CC0): Tilesheets/Small tiles/Thick outline/tilemap_packed.png' };
}

await browser.close();
const manifest = JSON.parse(fs.readFileSync('assets/manifest.json', 'utf8'));
manifest.v2 = out;
fs.writeFileSync('assets/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(8)} ${String(v.bytes).padStart(6)} bytes  ${v.files.join(', ')}`);
