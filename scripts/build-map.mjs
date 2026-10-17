// Generates maps/house.tmj (Tiled JSON). Run: npm run map
// Layout: 4 rooms on top, a hallway, 4 rooms below. Each room has one door onto the hallway.
import { readFileSync, writeFileSync } from 'node:fs';

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

// ---- Furniture ------------------------------------------------------------------------------
// From the design mock (design/game/build_mvp.py recipes, design/game/sprites.json pixel rects on
// limezu_interiors.png). Each piece is a map object; the game draws it as a sprite, depth-sorted with
// people by its bottom edge. Recipe x,y are px from the room's wall-face top-left (room 160 wide; face
// y 0-32, floor 32-160). Flags: 'wall' hangs on the wall, 'flat' is a rug, '#rrggbb' gives off light.
const SPRITES = JSON.parse(readFileSync(new URL('../design/game/sprites.json', import.meta.url), 'utf8')).items;
const WARM = '#f4b860', FIRE = '#ff8a3d', COOL = '#9ec9ff', PINK = '#ffb3c7';
const RECIPES = {
  room_01: [['window_curtain', 22, 4, 'wall'], ['picture_land', 120, 10, 'wall'], ['sofa_grey', 56, 33], ['rug_blue', 60, 62, 'flat'],
    ['plant_palm', 4, 30], ['lamp_cream', 140, 33, WARM], ['armchair_red', 14, 78], ['plant_small', 142, 128]],
  room_02: [['fireplace', 64, 10, FIRE], ['picture_a', 24, 10, 'wall'], ['picture_b', 124, 10, 'wall'], ['rug_red', 50, 58, 'flat'],
    ['armchair_red', 34, 62], ['armchair_red', 110, 62], ['sofa_red', 64, 94], ['lamp_red', 8, 36, WARM], ['plant_tree', 138, 130]],
  room_03: [['map_world', 14, 8, 'wall'], ['aquarium', 70, 14, COOL], ['desk_study', 8, 36], ['desk_study', 124, 36], ['rug_green', 68, 72, 'flat'],
    ['stool', 40, 72], ['stool', 106, 72], ['sofa_brown', 64, 92], ['lamp_blue', 8, 100, COOL], ['plant_small', 142, 130]],
  room_04: [['bookshelf', 6, 8], ['bookshelf_2', 40, 8], ['map_world', 112, 10, 'wall'], ['desk_study', 112, 40], ['globe', 143, 38],
    ['rug_beige', 42, 82, 'flat'], ['armchair_red', 22, 80], ['lamp_cream', 90, 60, WARM], ['plant_tree', 140, 128]],
  room_05: [['window_red', 16, 6, 'wall'], ['picture_c', 124, 10, 'wall'], ['plant_small', 8, 40], ['rug_olive', 68, 92, 'flat'],
    ['sofa_brown', 14, 124], ['sofa_white', 54, 126], ['lamp_red', 140, 40, PINK], ['plant_palm', 132, 126]],
  room_06: [['picture_a', 24, 10, 'wall'], ['bookshelf_2', 122, 8], ['rug_red', 50, 88, 'flat'], ['table_wood', 61, 90], ['chair_a', 42, 96],
    ['chair_c', 103, 96], ['lamp_cream', 8, 40, WARM], ['plant_pot', 12, 140]],
  room_07: [['bed_big', 8, 38], ['wardrobe', 128, 4], ['mirror', 106, 8, 'wall'], ['rug_small_red', 60, 118, 'flat'], ['dresser', 120, 132],
    ['plant_pot', 10, 140], ['lamp_table', 52, 40, WARM]],
  room_08: [['picture_land', 24, 10, 'wall'], ['window_curtain', 120, 4, 'wall'], ['dresser', 10, 36], ['bed_blue', 118, 40],
    ['rug_small_blue', 68, 110, 'flat'], ['plant_palm', 130, 124], ['lamp_blue', 8, 120, COOL]],
};
// Hallway decor, world px (hallway face y 192-224, floor 224-304).
const HALL = [['door_double', 20, 196, 'wall'], ['fairy_lights', 128, 194, WARM], ['fairy_lights', 190, 194, WARM], ['fairy_lights', 304, 194, WARM],
  ['fairy_lights', 366, 194, WARM], ['fairy_lights', 480, 194, WARM], ['fairy_lights', 542, 194, WARM], ['fairy_lights', 656, 194, WARM],
  ['picture_c', 520, 206, 'wall'], ['picture_b', 340, 206, 'wall'], // (the noticeboard hangs where picture_land was)
  ['rug_small_red', 188, 250, 'flat'], ['rug_small_red', 368, 250, 'flat'], ['rug_small_red', 548, 250, 'flat'],
  ['plant_palm', 130, 272], ['plant_tree', 330, 279], ['plant_palm', 500, 272], ['plant_tree', 680, 279],
  ['lamp_cream', 226, 226, WARM], ['lamp_cream', 586, 226, WARM],
  // Games corner (UPDATE.md Phase 12, design/game/v2.html): a table and two stools at the west end.
  ['table_wood', 64, 234], ['stool', 58, 262], ['stool', 98, 262]];

const furniture = [];
function place(key, x, y, flag) {
  const [sx, sy, w, h] = SPRITES[key].px;
  const kind = flag === 'wall' ? 'wall' : flag === 'flat' ? 'rug' : 'thing';
  const props = [
    { name: 'sx', type: 'int', value: sx },
    { name: 'sy', type: 'int', value: sy },
  ];
  if (flag?.startsWith('#')) props.push({ name: 'light', type: 'color', value: flag });
  furniture.push({ id: nextId++, name: key, type: kind, x, y, width: w, height: h, rotation: 0, visible: true, properties: props });
}
for (let i = 0; i < 8; i++) {
  const x = roomX(i % 4) * 16;
  const y = (i < 4 ? TOP_Y : BOT_Y) * 16; // the room's wall-face top-left
  for (const [key, rx, ry, flag] of RECIPES[`room_${String(i + 1).padStart(2, '0')}`]) place(key, x + rx, y + ry, flag);
}
for (const [key, x, y, flag] of HALL) place(key, x, y, flag);

// Game spots (UPDATE.md Phase 12): stand here for "Play games". The hallway's games table, and rooms with a
// table or desk: a point just in front of the piece. Rooms without one get a sofa corner on their rug
// (Phase 13: Would you rather works in any room) with only the games that need no table.
const spots = [];
const GAME_TABLES = [['hall', 'table_wood', 'hall'], ['room_03', 'desk_study', 'room_03'], ['room_04', 'desk_study', 'room_04'], ['room_06', 'table_wood', 'room_06'],
  ['room_01', 'rug_blue', 'room_01'], ['room_02', 'rug_red', 'room_02'], ['room_05', 'rug_olive', 'room_05'], ['room_07', 'rug_small_red', 'room_07'], ['room_08', 'rug_small_blue', 'room_08']];
for (const [id, key, zoneName] of GAME_TABLES) {
  const z = zones.find((o) => o.name === (zoneName === 'hall' ? 'hallway' : zoneName));
  const piece = furniture.find((o) => o.name === key && o.x >= z.x && o.x < z.x + z.width && o.y + o.height > z.y && o.y < z.y + z.height);
  if (!piece) throw new Error('no ' + key + ' in ' + zoneName);
  const rug = piece.type === 'rug';
  const x = piece.x + Math.round(piece.width / 2);
  const y = rug ? piece.y + Math.round(piece.height / 2) : piece.y + piece.height + 11;
  const props = [{ name: 'kind', type: 'string', value: rug ? 'sofa' : 'table' }];
  spots.push({ id: nextId++, name: id, type: 'spot', x, y, width: 0, height: 0, point: true, rotation: 0, visible: true, properties: props });
}
// The noticeboard (Phase 14: weekly leaderboard and challenges), on the hallway wall near the games corner,
// between the first two fairy lights (where a picture used to hang). Stand at the point to read it.
spots.push({ id: nextId++, name: 'board', type: 'spot', x: 175, y: 240, width: 0, height: 0, point: true, rotation: 0, visible: true,
  properties: [{ name: 'kind', type: 'string', value: 'board' }, { name: 'boardX', type: 'int', value: 160 }, { name: 'boardY', type: 'int', value: 200 }] });

// Doors: one object per doorway (the gap through the wall), for door frames now and door states later.
const doors = [];
for (let i = 0; i < 8; i++) {
  const top = i < 4;
  const dx = doorX(i % 4);
  // Top rooms: the dividing wall row plus the hallway's wall face. Bottom rooms: the dividing row plus the room's face.
  const y = top ? HALL_Y - 1 : BOT_Y - 1;
  doors.push({
    id: nextId++, name: `room_${String(i + 1).padStart(2, '0')}`, type: 'door',
    x: dx * 16, y: y * 16, width: DOOR_W * 16, height: 3 * 16, rotation: 0, visible: true,
    properties: [{ name: 'side', type: 'string', value: top ? 'north' : 'south' }],
  });
}

// Spawn: west end of the hallway, in the clear lane below the games table (UPDATE.md Phase 12).
zones.push({ id: nextId++, name: 'spawn', type: 'spawn', x: 3 * 16, y: (HALL_Y + 6) * 16, width: 0, height: 0, point: true, rotation: 0, visible: true });

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
  nextlayerid: 11,
  nextobjectid: nextId,
  layers: [
    tileLayer(1, 'floor', floorData),
    tileLayer(2, 'walls', wallData, [{ name: 'collides', type: 'bool', value: true }]),
    { id: 3, name: 'zones', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: zones },
    { id: 8, name: 'doors', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: doors },
    { id: 9, name: 'furniture', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: furniture },
    { id: 10, name: 'spots', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: spots },
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
