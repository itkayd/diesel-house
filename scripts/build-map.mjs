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

// ---- Furniture ------------------------------------------------------------------------------
// Pieces from limezu_interiors.png (16 tiles wide) and, where LimeZu's free pack has nothing (music),
// Kenney's roguelike-indoors sheet (27 wide, 1 px spacing). [sheet, top-left index, w, h] in tiles.
const INT_GID = 392; // after the 391 room-builder tiles
const KEN_GID = INT_GID + 16 * 89;
const P = {
  bedGreen: ['int', 16, 3, 3], bedWhite: ['int', 96, 3, 3],
  sofaLight: ['int', 1156, 3, 2], sofaGrey: ['int', 1153, 3, 2], sofaRed: ['int', 296, 2, 2],
  armchairL: ['int', 1188, 1, 2], armchairR: ['int', 1189, 1, 2], armchairGreyL: ['int', 1185, 1, 2], armchairGreyR: ['int', 1186, 1, 2],
  pouf: ['int', 1187, 1, 2], poufLight: ['int', 1190, 1, 2],
  shelfLow: ['int', 229, 2, 2], shelfLow2: ['int', 261, 2, 2],
  shelfPink: ['int', 1098, 2, 3], shelfBrown: ['int', 1100, 2, 3], shelfYellow: ['int', 1102, 2, 3], shelfGames: ['int', 1148, 2, 3],
  fireplace: ['int', 1092, 2, 3],
  rugRed: ['int', 247, 4, 3], rugBlue: ['int', 189, 3, 4], rugRedGold: ['int', 269, 3, 4], rugGreenSq: ['int', 458, 2, 2],
  rugSmBlue: ['int', 267, 2, 1], rugSmRed: ['int', 331, 2, 1], rugBeige: ['int', 672, 3, 2], rugGrey: ['int', 675, 3, 2],
  table: ['int', 166, 2, 2], coffee: ['int', 215, 3, 2], stool: ['int', 214, 1, 1],
  deskBook: ['int', 581, 2, 2], tv: ['int', 650, 2, 2], globe: ['int', 1068, 1, 2],
  chair: ['int', 500, 1, 1], chairDark: ['int', 517, 1, 1], chairSideR: ['int', 505, 1, 2], chairSideL: ['int', 543, 1, 2],
  tree: ['int', 714, 2, 3], palm: ['int', 717, 2, 3], bush: ['int', 732, 1, 2], plant: ['int', 784, 1, 1], planter: ['int', 896, 1, 1],
  lampBlue: ['int', 925, 1, 2], lampCream: ['int', 924, 1, 2], lampTable: ['int', 828, 1, 2],
  wardrobe: ['int', 775, 2, 3], wardrobeBig: ['int', 823, 2, 3], cabinet: ['int', 912, 3, 2],
  winCurtain: ['int', 388, 3, 2], win: ['int', 391, 2, 2], winGrey: ['int', 393, 2, 2], frontDoor: ['int', 395, 2, 2], fairy: ['int', 762, 2, 1],
  paint1: ['int', 1136, 1, 1], paint2: ['int', 1137, 1, 1], paint3: ['int', 1138, 1, 1], paintTall: ['int', 1152, 1, 2], paintTall2: ['int', 1184, 1, 2],
  map: ['int', 1082, 2, 1], pinboard: ['int', 621, 2, 2],
  piano: ['ken', 239, 2, 2], speaker: ['ken', 446, 1, 2], speaker2: ['ken', 447, 1, 2],
};
const decorData = new Array(W * H).fill(0); // rugs and things on walls: below everyone, walk-through
const furnData = new Array(W * H).fill(0); // furniture: below everyone
const topData = new Array(W * H).fill(0); // tops of tall things: drawn over people walking behind them
const solidData = new Array(W * H).fill(0); // invisible collision cells
// Light sources (warm lamps, fire, fairy lights; cool moonlight at windows). Radius in px.
const LIGHTS = { lampBlue: [44, '#f4b860'], lampCream: [44, '#f4b860'], lampTable: [34, '#f4b860'], fireplace: [64, '#f4963c'],
  fairy: [30, '#ffe2aa'], win: [36, '#96b4ff'], winGrey: [36, '#96b4ff'], winCurtain: [40, '#96b4ff'], tv: [30, '#7fd1ff'] };
const lights = [];

function pieceGid(sheet, idx, tx, ty) {
  return sheet === 'int' ? INT_GID + idx + tx + ty * 16 : KEN_GID + idx + tx + ty * 27;
}

// kind: 'rug' | 'wall' (decor, walk-through) | 'thing' (furniture). top: rows from the top drawn above
// people. solid: rows from the bottom that block (default: all rows not in `top`; 0 = walk over, e.g. chairs).
function place(name, x, y, { kind = 'thing', top = 0, solid } = {}) {
  const [sheet, idx, w, h] = P[name];
  const solidRows = solid ?? h - top;
  // Lights sit on the floor in front of wall things (windows, fairy lights), so no glow lands on the dark ceiling.
  const onWall = kind === 'wall';
  if (LIGHTS[name]) lights.push({ x: (x + w / 2) * 16, y: (y + (name === 'fireplace' ? 2.2 : onWall ? h + 1 : h / 2)) * 16, r: LIGHTS[name][0], color: LIGHTS[name][1] });
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++) {
      const cx = x + tx;
      const cy = y + ty;
      const gid = pieceGid(sheet, idx, tx, ty);
      const i = cy * W + cx;
      if (kind !== 'thing') decorData[i] = gid;
      else if (ty < top) topData[i] = gid;
      else furnData[i] = gid;
      if (kind === 'thing' && ty >= h - solidRows && wallData[i] === 0) solidData[i] = WALL_TOP + 1;
    }
}

// Room layouts, in tiles from each room's top-left (rows 0-1 are the wall face, 2-9 the floor).
// Rooms 1-4 have their door at the bottom (keep columns 4-5 of rows 7-9 clear); rooms 5-8 at the top
// (columns 4-5 of rows 0-3 clear).
const LAYOUTS = [
  // 1 gaming
  [['win', 1, 0, { kind: 'wall' }], ['paint2', 7, 0, { kind: 'wall' }], ['tv', 4, 1], ['shelfGames', 8, 0],
   ['rugSmBlue', 4, 4, { kind: 'rug' }], ['pouf', 3, 3, { solid: 0 }], ['poufLight', 6, 3, { solid: 0 }],
   ['palm', 0, 6, { top: 2, solid: 1 }], ['lampBlue', 9, 7, { top: 1, solid: 1 }], ['plant', 1, 2]],
  // 2 music
  [['fairy', 3, 0, { kind: 'wall' }], ['paintTall', 7, 0, { kind: 'wall' }], ['piano', 1, 1], ['speaker', 6, 1], ['speaker2', 9, 1],
   ['rugRed', 3, 4, { kind: 'rug' }], ['armchairL', 2, 5], ['armchairR', 7, 5], ['stool', 5, 5],
   ['bush', 0, 7, { top: 1, solid: 1 }], ['lampCream', 9, 7, { top: 1, solid: 1 }]],
  // 3 study
  [['shelfBrown', 0, 0], ['shelfYellow', 2, 0], ['pinboard', 4, 0, { kind: 'wall' }], ['deskBook', 6, 1], ['chair', 7, 3, { solid: 0 }],
   ['globe', 9, 1], ['rugBeige', 1, 5, { kind: 'rug' }], ['lampCream', 0, 7, { top: 1, solid: 1 }], ['plant', 9, 8]],
  // 4 chill
  [['fairy', 0, 0, { kind: 'wall' }], ['winCurtain', 4, 0, { kind: 'wall' }], ['sofaLight', 1, 1], ['rugBlue', 1, 3, { kind: 'rug' }],
   ['coffee', 1, 4], ['tree', 7, 0], ['plant', 9, 2], ['lampTable', 0, 7], ['sofaRed', 7, 6]],
  // 5 deep talk
  [['fireplace', 1, 0], ['paint1', 7, 0, { kind: 'wall' }], ['shelfPink', 8, 0], ['rugRed', 5, 5, { kind: 'rug' }],
   ['armchairL', 5, 5], ['armchairR', 8, 5], ['stool', 6, 6], ['stool', 7, 6], ['lampCream', 0, 8, { top: 1, solid: 1 }],
   ['planter', 3, 2]],
  // 6 D&D
  [['map', 1, 0, { kind: 'wall' }], ['pinboard', 7, 0, { kind: 'wall' }], ['shelfYellow', 8, 1],
   ['rugRedGold', 3, 4, { kind: 'rug' }], ['table', 4, 5], ['chairSideR', 3, 5, { solid: 0 }], ['chairSideL', 6, 5, { solid: 0 }],
   ['chair', 4, 4, { solid: 0 }], ['chairDark', 5, 7, { solid: 0 }], ['globe', 0, 7], ['plant', 0, 2]],
  // 7 blank
  [['wardrobe', 0, 0], ['win', 7, 0, { kind: 'wall' }], ['bedWhite', 7, 2], ['plant', 6, 2], ['rugBlue', 1, 4, { kind: 'rug' }],
   ['lampTable', 9, 7]],
  // 8 blank
  [['winGrey', 1, 0, { kind: 'wall' }], ['bedGreen', 0, 2], ['bush', 3, 2, { top: 1, solid: 1 }], ['wardrobeBig', 8, 0],
   ['rugRedGold', 6, 4, { kind: 'rug' }], ['lampTable', 9, 8]],
];
for (let i = 0; i < 8; i++) {
  const x = roomX(i % 4);
  const y = i < 4 ? TOP_Y : BOT_Y;
  for (const [name, cx, cy, opts] of LAYOUTS[i]) place(name, x + cx, y + cy, opts);
}

// Hallway: front door by the spawn, a rug runner, pictures between doors, plants, a shoe cabinet, a lamp.
place('frontDoor', 1, HALL_Y, { kind: 'wall' });
const RUG_Y = HALL_Y + 3;
for (let x = 4; x <= W - 5; x++) {
  const col = x === 4 ? 0 : x === W - 5 ? 2 : 1;
  decorData[RUG_Y * W + x] = INT_GID + 672 + col;
  decorData[(RUG_Y + 1) * W + x] = INT_GID + 688 + col;
}
for (const [name, x] of [['paint1', 11], ['paintTall2', 22], ['paint3', 33], ['fairy', 8], ['fairy', 30]]) place(name, x, HALL_Y, { kind: 'wall' });
place('cabinet', 1, HALL_Y + 5); // shoe cabinet
place('tree', W - 4, HALL_Y, { top: 0 });
place('lampCream', W - 2, HALL_Y + 1, { top: 1, solid: 1 });
for (const x of [12, 23, 34]) place('planter', x, HALL_Y + HALL_H - 1);

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

for (const d of doors) lights.push({ x: d.x + 16, y: d.y + 40, r: 26, color: '#f4b860' }); // in the doorway, not on the wall top
const lightObjects = lights.map((l) => ({
  id: nextId++, name: 'light', type: 'light', x: l.x, y: l.y, width: 0, height: 0, point: true, rotation: 0, visible: true,
  properties: [{ name: 'radius', type: 'int', value: l.r }, { name: 'color', type: 'color', value: l.color }],
}));

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
  nextlayerid: 10,
  nextobjectid: nextId,
  layers: [
    tileLayer(1, 'floor', floorData),
    tileLayer(2, 'walls', wallData, [{ name: 'collides', type: 'bool', value: true }]),
    tileLayer(4, 'decor', decorData),
    tileLayer(5, 'furniture', furnData),
    tileLayer(6, 'furniture_top', topData),
    { ...tileLayer(7, 'collision', solidData, [{ name: 'collides', type: 'bool', value: true }]), visible: false },
    { id: 3, name: 'zones', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: zones },
    { id: 8, name: 'doors', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: doors },
    { id: 9, name: 'lights', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: lightObjects },
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
    {
      firstgid: INT_GID,
      name: 'limezu_interiors',
      image: '../public/assets/furniture/limezu_interiors.png',
      imagewidth: 256,
      imageheight: 1424,
      tilewidth: 16,
      tileheight: 16,
      columns: 16,
      tilecount: 16 * 89,
      margin: 0,
      spacing: 0,
    },
    {
      firstgid: KEN_GID,
      name: 'kenney_indoor',
      image: '../public/assets/furniture/kenney_roguelike_indoor.png',
      imagewidth: 458,
      imageheight: 305,
      tilewidth: 16,
      tileheight: 16,
      columns: 27,
      tilecount: 27 * 18,
      margin: 0,
      spacing: 1,
    },
  ],
};

writeFileSync(new URL('../maps/house.tmj', import.meta.url), JSON.stringify(map) + '\n');
console.log(`maps/house.tmj: ${W}x${H} tiles, ${zones.length} objects`);
