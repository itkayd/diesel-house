// Generates maps/house.tmj (Tiled JSON) from the house data in src/house/rooms.ts. Run: npm run map
// Every area (the hall and each room) is a polygon of tiles: floor inside, a 2-row wall face along each
// top edge, solid wall everywhere else, and a gap through the wall at each room's door. Diagonal edges
// come out stepped. Furniture, game spots, the noticeboard, doors and the spawn point come from the
// same file, so the map and the game's zones can't disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { bounds, doorTiles, HALL, houseSize, ROOMS, tileIn } from '../src/house/rooms.ts';

const COLS = 17; // limezu_room_builder.png is 17 tiles wide
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

const { w: W, h: H } = houseSize();
const AREAS = [{ id: 'hallway', ...HALL }, ...ROOMS];

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

// Doorways: the gap tiles, and the two face rows just below each one (the face of whatever is below).
const doors = ROOMS.flatMap((r) => doorTiles(r.door));
const gapBelowDoor = new Set(doors.flatMap(([x, y]) => [`${x},${y + 1}`, `${x},${y + 2}`]));

function carve(area) {
  const inside = (x, y) => tileIn(area.polygon, x, y);
  const gap = (x, y) => gapBelowDoor.has(`${x},${y}`);
  const b = bounds(area.polygon);
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!inside(x, y)) continue;
      // How far below this column's top edge: rows 0 and 1 are wall face.
      let depth = 0;
      while (y - depth - 1 >= b.y && inside(x, y - depth - 1)) depth++;
      if (depth < 2 && !gap(x, y)) {
        const left = !inside(x - 1, y) || gap(x - 1, y);
        const right = !inside(x + 1, y) || gap(x + 1, y);
        set(wallData, x, y, WALL[area.wall] + (left ? 7 : right ? 9 : 8) + COLS * depth);
      } else set(wallData, x, y, 0);
      // Floor runs under the face too, so doorways have floor. Doorways get plain floor, not the shadow.
      const fx = inside(x - 1, y) ? x - b.x : 0;
      const fy = Math.max(0, depth - 2);
      set(floorData, x, y, gap(x, y) && depth < 2 ? floorTile(area.floor, 1, 1) : floorTile(area.floor, fx, fy));
    }
}
for (const a of AREAS) carve(a);

// The gap through the dividing wall: floor of whatever is just below it (the hall for rooms above it).
for (const [x, y] of doors) {
  set(wallData, x, y, 0);
  const below = AREAS.find((a) => tileIn(a.polygon, x, y + 1)) ?? HALL;
  set(floorData, x, y, floorTile(below.floor, 1, 1));
}

let nextId = 1;

// Zones (for looking at the map in Tiled; the game reads src/house/rooms.ts itself).
const zones = AREAS.map((a) => {
  const b = bounds(a.polygon);
  return {
    id: nextId++, name: a.id, type: 'zone', x: b.x * 16, y: b.y * 16, width: 0, height: 0, rotation: 0, visible: true,
    polygon: a.polygon.map(([x, y]) => ({ x: (x - b.x) * 16, y: (y - b.y) * 16 })),
    properties: a.tint ? [{ name: 'floorTint', type: 'color', value: a.tint }] : [],
  };
});

// ---- Furniture ------------------------------------------------------------------------------
// From the design mock (design/game/build_mvp.py recipes, design/game/sprites.json pixel rects on
// limezu_interiors.png). Each piece is a map object; the game draws it as a sprite, depth-sorted with
// people by its bottom edge.
const SPRITES = JSON.parse(readFileSync(new URL('../design/game/sprites.json', import.meta.url), 'utf8')).items;
const furniture = [];
function place(key, x, y, flag) {
  if (!SPRITES[key]) throw new Error(`no sprite called ${key} in design/game/sprites.json`);
  const [sx, sy, w, h] = SPRITES[key].px;
  const kind = flag === 'wall' ? 'wall' : flag === 'flat' ? 'rug' : 'thing';
  const props = [
    { name: 'sx', type: 'int', value: sx },
    { name: 'sy', type: 'int', value: sy },
  ];
  if (flag?.startsWith('#')) props.push({ name: 'light', type: 'color', value: flag });
  const obj = { id: nextId++, name: key, type: kind, x, y, width: w, height: h, rotation: 0, visible: true, properties: props };
  furniture.push(obj);
  return obj;
}
const placed = new Map(); // area id -> its pieces
for (const a of [...ROOMS, { id: 'hallway', ...HALL }]) {
  const b = bounds(a.polygon);
  placed.set(a.id, a.furniture.map(([key, x, y, flag]) => place(key, b.x * 16 + x, b.y * 16 + y, flag)));
}

// Game spots (UPDATE.md Phase 12): stand here for "Play games". In front of a table or desk; on a rug it's
// a sofa corner (Phase 13: Would you rather works in any room) with only the games that need no table.
const spots = [];
for (const a of [{ id: 'hallway', ...HALL }, ...ROOMS]) {
  if (!a.spot) continue;
  const piece = placed.get(a.id).find((o) => o.name === a.spot);
  if (!piece) throw new Error(`no ${a.spot} in ${a.id}`);
  const rug = piece.type === 'rug';
  const x = piece.x + Math.round(piece.width / 2);
  const y = rug ? piece.y + Math.round(piece.height / 2) : piece.y + piece.height + 11;
  spots.push({
    id: nextId++, name: a.id === 'hallway' ? 'hall' : a.id, type: 'spot', x, y, width: 0, height: 0, point: true, rotation: 0, visible: true,
    properties: [{ name: 'kind', type: 'string', value: rug ? 'sofa' : 'table' }],
  });
}
// The noticeboard (Phase 14: weekly leaderboard and challenges) on the hall wall. Stand at the point to read it.
const board = HALL.board;
spots.push({ id: nextId++, name: 'board', type: 'spot', x: board.x, y: board.y, width: 0, height: 0, point: true, rotation: 0, visible: true,
  properties: [{ name: 'kind', type: 'string', value: 'board' }, { name: 'boardX', type: 'int', value: board.boardX }, { name: 'boardY', type: 'int', value: board.boardY }] });

// Doors: one object per doorway (the gap and the two face rows past it), for the door sign and the
// do-not-disturb check.
const doorObjects = ROOMS.map((r) => {
  const d = r.door;
  const across = d.side === 'north' || d.side === 'south';
  return {
    id: nextId++, name: r.id, type: 'door',
    x: d.x * 16, y: d.y * 16, width: (across ? d.w : 1) * 16, height: (across ? 3 : d.w) * 16, rotation: 0, visible: true,
    properties: [{ name: 'side', type: 'string', value: d.side }],
  };
});

// Spawn: the front door.
zones.push({ id: nextId++, name: 'spawn', type: 'spawn', x: HALL.spawn.x, y: HALL.spawn.y, width: 0, height: 0, point: true, rotation: 0, visible: true });

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
    { id: 8, name: 'doors', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects: doorObjects },
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
console.log(`maps/house.tmj: ${W}x${H} tiles, ${AREAS.length} areas, ${furniture.length} pieces of furniture`);
