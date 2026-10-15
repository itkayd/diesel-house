// Generates maps/house.tmj (Tiled JSON). Run: npm run map
// Layout: 4 rooms on top, a hallway, 4 rooms below. Each room has one door onto the hallway.
import { writeFileSync } from 'node:fs';

const COLS = 17; // limezu_room_builder.png is 17 tiles wide
const ROOM_W = 10; // interior width in tiles
const ROOM_H = 10; // interior height incl. the 2-tile wall face at the top
const HALL_H = 7; // hallway height incl. its 2-tile wall face
const DOOR_W = 2;

const W = 1 + 4 * (ROOM_W + 1);
const TOP_Y = 1; // first interior row of the top rooms
const HALL_Y = TOP_Y + ROOM_H + 1;
const BOT_Y = HALL_Y + HALL_H + 1;
const H = BOT_Y + ROOM_H + 1;

const WALL_TOP = 12; // solid dark "ceiling" tile

// Wall face styles: top-left tile index of each 2-row group. Pieces used: +7/+8/+9 (left/mid/right), +24/+25/+26 below.
const WALL = { pink: 85, yellow: 119, mint: 153, wood: 187, brown: 221, red: 255, grey: 289, beige: 323 };
// Floors: top-left of each 3x2 block. "pattern" blocks repeat; "flat" blocks have a shadow row/column for under walls.
const FLOOR = {
  brick: { base: 96, pattern: true },
  yellow: { base: 130, pattern: true },
  teal: { base: 164, pattern: true },
  herringbone: { base: 232, pattern: true },
  grey: { base: 198, pattern: false },
  rose: { base: 99, pattern: false },
  mauve: { base: 133, pattern: false },
  stone: { base: 167, pattern: false },
  slate: { base: 201, pattern: false },
};

// The free pack has only four patterned floors; its plain floors are all near the same grey-taupe, so
// those get a colour tint (stored as a "floorTint" property on the room zone; HouseScene applies it).
const ROOM_STYLES = [
  { wall: 'pink', floor: 'brick' },
  { wall: 'mint', floor: 'stone', tint: '#a9c6ff' }, // dusty blue
  { wall: 'yellow', floor: 'teal' },
  { wall: 'brown', floor: 'rose', tint: '#c4e3a4' }, // sage
  { wall: 'grey', floor: 'yellow' },
  { wall: 'red', floor: 'mauve', tint: '#dcbcff' }, // lavender
  { wall: 'beige', floor: 'herringbone' },
  { wall: 'wood', floor: 'slate', tint: '#ffcf8f' }, // warm amber
];
const HALL_STYLE = { wall: 'beige', floor: 'grey' };

const floorData = new Array(W * H).fill(0);
const wallData = new Array(W * H).fill(0);
const gid = (i) => i + 1; // firstgid = 1
const set = (layer, x, y, tile) => (layer[y * W + x] = tile === 0 ? 0 : gid(tile));

function floorTile(name, fx, fy) {
  const { base, pattern } = FLOOR[name];
  if (pattern) return base + (fx === 0 ? 0 : fx % 2 === 1 ? 1 : 2) + COLS * (fy % 2);
  return base + (fx === 0 ? 0 : 1) + COLS * (fy === 0 ? 0 : 1);
}

// Everything starts as wall top; areas are carved out below.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(wallData, x, y, WALL_TOP);

// Carves an area: 2-row wall face on top, floor beneath. `gaps` are x ranges where the face is a doorway instead.
function carve(x0, y0, w, h, style, gaps = []) {
  const inGap = (x) => gaps.some(([a, b]) => x >= a && x < b);
  const wallBase = WALL[style.wall];
  for (let x = x0; x < x0 + w; x++) {
    const left = x === x0 || inGap(x - 1);
    const right = x === x0 + w - 1 || inGap(x + 1);
    const piece = left ? 7 : right ? 9 : 8;
    for (let r = 0; r < 2; r++) {
      if (inGap(x)) {
        set(wallData, x, y0 + r, 0);
      } else {
        set(wallData, x, y0 + r, wallBase + piece + COLS * r);
      }
    }
    for (let y = y0 + 2; y < y0 + h; y++) set(wallData, x, y, 0);
  }
  // Floor runs under the face too, so doorways have floor.
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const plain = y < y0 + 2 && inGap(x); // doorways get plain floor, not the under-wall shadow
      set(floorData, x, y, plain ? floorTile(style.floor, 1, 1) : floorTile(style.floor, x - x0, Math.max(0, y - y0 - 2)));
    }
}

const zones = [];
let nextId = 1;
const rect = (name, x, y, w, h, properties = []) =>
  zones.push({ id: nextId++, name, type: 'zone', x: x * 16, y: y * 16, width: w * 16, height: h * 16, rotation: 0, visible: true, properties });

// Hallway, with door gaps in its face for the 4 top rooms.
const roomX = (i) => 1 + i * (ROOM_W + 1);
const doorX = (i) => roomX(i) + Math.floor((ROOM_W - DOOR_W) / 2);
const topGaps = [0, 1, 2, 3].map((i) => [doorX(i), doorX(i) + DOOR_W]);
carve(1, HALL_Y, W - 2, HALL_H, HALL_STYLE, topGaps);
rect('hallway', 1, HALL_Y, W - 2, HALL_H);

for (let i = 0; i < 8; i++) {
  const top = i < 4;
  const col = i % 4;
  const x = roomX(col);
  const y = top ? TOP_Y : BOT_Y;
  const style = ROOM_STYLES[i];
  const dx = doorX(col);
  carve(x, y, ROOM_W, ROOM_H, style, top ? [] : [[dx, dx + DOOR_W]]);
  // Door cells in the dividing wall row.
  const doorRow = top ? y + ROOM_H : y - 1;
  for (let d = 0; d < DOOR_W; d++) {
    set(wallData, dx + d, doorRow, 0);
    set(floorData, dx + d, doorRow, floorTile(top ? HALL_STYLE.floor : style.floor, 1, 1));
  }
  // Room zone includes its own door cell, so stepping through the door puts you in the room.
  const name = `room_${String(i + 1).padStart(2, '0')}`;
  const props = style.tint ? [{ name: 'floorTint', type: 'color', value: style.tint }] : [];
  if (top) rect(name, x, y, ROOM_W, ROOM_H + 1, props);
  else rect(name, x, y - 1, ROOM_W, ROOM_H + 1, props);
}

// Spawn: west end of the hallway, just below its wall face.
zones.push({ id: nextId++, name: 'spawn', type: 'spawn', x: 3 * 16, y: (HALL_Y + 4) * 16, width: 0, height: 0, point: true, rotation: 0, visible: true });

const tileLayer = (id, name, data, props = []) => ({
  id, name, type: 'tilelayer', x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data, properties: props,
});

const map = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.11.0',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  infinite: false,
  width: W,
  height: H,
  tilewidth: 16,
  tileheight: 16,
  nextlayerid: 4,
  nextobjectid: nextId,
  layers: [
    tileLayer(1, 'floor', floorData),
    tileLayer(2, 'walls', wallData, [{ name: 'collides', type: 'bool', value: true }]),
    { id: 3, name: 'zones', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: zones },
  ],
  tilesets: [
    {
      firstgid: 1,
      name: 'limezu_room_builder',
      image: '../public/assets/tiles/limezu_room_builder.png',
      imagewidth: 272,
      imageheight: 368,
      tilewidth: 16,
      tileheight: 16,
      columns: COLS,
      tilecount: 391,
      margin: 0,
      spacing: 0,
    },
  ],
};

writeFileSync(new URL('../maps/house.tmj', import.meta.url), JSON.stringify(map) + '\n');
console.log(`maps/house.tmj: ${W}x${H} tiles, ${zones.length} objects`);
