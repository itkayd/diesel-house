// Generates maps/house.tmj (Tiled JSON) from the house data in src/house/rooms.ts. Run: npm run map
// Every area (the hall and each room) is a polygon of tiles: floor inside, a 2-row wall face along each
// top edge, solid wall everywhere else, and a door rectangle that opens a way through between the hall and
// each room. Diagonal edges come out stepped. Furniture (with what blocks walking: its footprint), game
// spots, the noticeboard, doors and the spawn point come from the same file, so the map and the game's
// zones can't disagree. The art for each kind of furniture is in src/house/art/topdown.json
// (scripts/art/build_house_art.py); this file writes data, the game draws it (REDESIGN.md §5 rule 5).
// Last, it checks every room can be walked to from the front porch, and fails if one can't.
import { readFileSync, writeFileSync } from 'node:fs';
import { bounds, doorGap, doorTiles, HALL, houseSize, ROOMS, tileIn } from '../src/house/rooms.ts';

const T = 16;
const COLS = 17; // limezu_room_builder.png is 17 tiles wide
const LIMEZU_COUNT = 391;
const EXTRA = LIMEZU_COUNT; // house_extra.png's first tile, as a 0-based index across both tilesets
const WALL_TOP = 12; // solid dark "ceiling" tile
const ART = JSON.parse(readFileSync(new URL('../src/house/art/topdown.json', import.meta.url), 'utf8'));
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
const X = ART.tiles; // the extra tiles: grass, deck, hedge (3 x 2), skyline (4 x 2)

const { w: W, h: H } = houseSize();
const AREAS = [{ id: 'hallway', ...HALL }, ...ROOMS];

const floorData = new Array(W * H).fill(0);
const wallData = new Array(W * H).fill(0);
const gid = (i) => i + 1; // firstgid = 1 (the extra tileset carries on after LimeZu's)
const set = (layer, x, y, tile) => (layer[y * W + x] = tile === 0 ? 0 : gid(tile));
const at = (layer, x, y) => layer[y * W + x];
const vary = (x, y) => (x * 7 + y * 13 + ((x * y) % 5)) % 11;

function floorTile(name, fx, fy, x, y) {
  if (name === 'grass') return EXTRA + X.grass[[0, 0, 1, 0, 0, 2, 0, 1, 0, 3, 0][vary(x, y)]];
  if (name === 'deck') return EXTRA + X.deck[(x + y * 3) % 4];
  const { base, pattern } = FLOOR[name];
  if (pattern) return base + (fx === 0 ? 0 : fx % 2 === 1 ? 1 : 2) + COLS * (fy % 2);
  return base + (fx === 0 ? 0 : 1) + COLS * (fy === 0 ? 0 : 1);
}

function wallFace(style, left, right, depth, x) {
  if (style === 'hedge') return EXTRA + X.hedge[depth * 3 + (left ? 0 : right ? 2 : 1)];
  if (style === 'skyline') return EXTRA + X.skyline[depth * 4 + (x % 4)];
  return WALL[style] + (left ? 7 : right ? 9 : 8) + COLS * depth;
}

// Everything starts as wall top; areas are carved out below.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(wallData, x, y, WALL_TOP);

// Doors: every tile of a door's rectangle is open (no wall, no wall face).
const open = new Set(ROOMS.flatMap((r) => doorTiles(r.door)).map(([x, y]) => `${x},${y}`));
const isOpen = (x, y) => open.has(`${x},${y}`);

function carve(area) {
  const inside = (x, y) => tileIn(area.polygon, x, y);
  const b = bounds(area.polygon);
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++) {
      if (!inside(x, y)) continue;
      // How far below this column's top edge: rows 0 and 1 are wall face.
      let depth = 0;
      while (y - depth - 1 >= b.y && inside(x, y - depth - 1)) depth++;
      if (depth < 2 && !isOpen(x, y)) {
        const left = !inside(x - 1, y) || isOpen(x - 1, y);
        const right = !inside(x + 1, y) || isOpen(x + 1, y);
        set(wallData, x, y, wallFace(area.wall, left, right, depth, x));
      } else set(wallData, x, y, 0);
      // Floor runs under the face too, so doorways have floor. Doorways get plain floor, not the shadow.
      const fx = inside(x - 1, y) ? x - b.x : 0;
      const fy = Math.max(0, depth - 2);
      set(floorData, x, y, isOpen(x, y) && depth < 2 ? floorTile(area.floor, 1, 1, x, y) : floorTile(area.floor, fx, fy, x, y));
    }
}
for (const a of AREAS) carve(a);

// The gap through the wall: the room's own floor.
for (const r of ROOMS)
  for (const [x, y] of doorGap(r)) {
    set(wallData, x, y, 0);
    set(floorData, x, y, floorTile(r.floor, 1, 1, x, y));
  }

let nextId = 1;

// Zones (for looking at the map in Tiled; the game reads src/house/rooms.ts itself).
const zones = AREAS.map((a) => {
  const b = bounds(a.polygon);
  return {
    id: nextId++, name: a.id, type: 'zone', x: b.x * T, y: b.y * T, width: 0, height: 0, rotation: 0, visible: true,
    polygon: a.polygon.map(([x, y]) => ({ x: (x - b.x) * T, y: (y - b.y) * T })),
    properties: a.tint ? [{ name: 'floorTint', type: 'color', value: a.tint }] : [],
  };
});

// ---- Furniture ------------------------------------------------------------------------------
// Each piece is a map object at its world position, with its art (sheet + rectangle), what blocks walking
// (its footprint, world px) and where it sorts (its depth point: the middle of its base, or for a piece
// sitting on another, just in front of that one). The game draws it with people, sorted by depthOf().
const furniture = [];
const blocks = []; // footprints, for the reachability check below
function place(kind, x, y, flag, foot, under) {
  const art = ART.kinds[kind];
  if (!art) throw new Error(`no art for ${kind} in src/house/art/topdown.json`);
  const [sx, sy, w, h] = art.px;
  const type = flag === 'wall' ? 'wall' : flag === 'flat' ? 'rug' : flag === 'over' ? 'over' : flag === 'on' ? 'on' : 'thing';
  const props = [
    { name: 'sheet', type: 'string', value: art.sheet },
    { name: 'sx', type: 'int', value: sx },
    { name: 'sy', type: 'int', value: sy },
  ];
  if (flag?.startsWith('#')) props.push({ name: 'light', type: 'color', value: flag });
  let depth = { x: x + w / 2, y: y + h };
  if (type === 'on') {
    if (!under) throw new Error(`${kind} sits on nothing`);
    depth = { x: under.depth.x, y: under.depth.y + 0.5 };
  }
  props.push({ name: 'depthX', type: 'float', value: depth.x }, { name: 'depthY', type: 'float', value: depth.y });
  if (type === 'thing') {
    // Block only the base, so you can stand "behind" the top of tall things.
    const [fx, fy, fw, fh] = foot ?? (() => {
      const bh = w <= 16 ? 5 : Math.max(6, Math.round(h * 0.45));
      return [1, h - bh, w - 2, bh];
    })();
    props.push({ name: 'foot', type: 'string', value: [x + fx, y + fy, fw, fh].join(',') });
    blocks.push({ x: x + fx, y: y + fy, w: fw, h: fh });
  }
  const obj = { id: nextId++, name: kind, type, x, y, width: w, height: h, rotation: 0, visible: true, properties: props, depth };
  furniture.push(obj);
  return obj;
}
const placed = new Map(); // area id -> its pieces
for (const a of AREAS) {
  const b = bounds(a.polygon);
  const list = [];
  for (const [kind, x, y, flag, foot] of a.furniture) {
    const under = [...list].reverse().find((o) => o.type === 'thing');
    list.push(place(kind, Math.round((b.x + x) * T), Math.round((b.y + y) * T), flag, foot, under));
  }
  placed.set(a.id, list);
}
for (const o of furniture) delete o.depth;

// Game spots (UPDATE.md Phase 12): stand here for "Play games". In front of a table; on a rug or blanket
// it's a sofa corner (Phase 13: Would you rather works anywhere) with only the games that need no table.
const spots = [];
for (const a of AREAS) {
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
const hb = bounds(HALL.polygon);
const board = HALL.board;
const px = (v, o) => Math.round((o + v) * T);
spots.push({ id: nextId++, name: 'board', type: 'spot', x: px(board.x, hb.x), y: px(board.y, hb.y), width: 0, height: 0, point: true, rotation: 0, visible: true,
  properties: [{ name: 'kind', type: 'string', value: 'board' }, { name: 'boardX', type: 'int', value: px(board.boardX, hb.x) }, { name: 'boardY', type: 'int', value: px(board.boardY, hb.y) }] });

// Doors: one object per doorway (the gap through the wall), for the door sign, walking to a room and the
// do-not-disturb check. ax/ay: where to stand in the hall just outside; plateX/plateY: the nameplate.
const doorObjects = ROOMS.map((r) => {
  const d = r.door;
  const gap = doorGap(r);
  if (!gap.length) throw new Error(`${r.id}'s door doesn't cross any wall`);
  const gx0 = Math.min(...gap.map((t) => t[0]));
  const gy0 = Math.min(...gap.map((t) => t[1]));
  const gx1 = Math.max(...gap.map((t) => t[0])) + 1;
  const gy1 = Math.max(...gap.map((t) => t[1])) + 1;
  const cx = ((d.x + d.w / 2) * T);
  const cy = ((d.y + d.h / 2) * T);
  let ax, ay, plateX = cx, plateY;
  if (d.side === 'north') {
    ax = cx; ay = (d.y + d.h) * T + 14;
    // On the hall's wall face, at the first row of the door that's in the hall.
    const hallRow = doorTiles(d).filter(([x, y]) => tileIn(HALL.polygon, x, y)).reduce((m, t) => Math.min(m, t[1]), d.y + d.h);
    plateY = hallRow * T + 3;
  } else if (d.side === 'south') {
    ax = cx; ay = d.y * T - 6; plateY = d.y * T - 4;
  } else if (d.side === 'east') {
    ax = d.x * T - 10; ay = cy + 8; plateY = d.y * T - 14;
  } else {
    ax = (d.x + d.w) * T + 10; ay = cy + 8; plateY = d.y * T - 14;
  }
  return {
    id: nextId++, name: r.id, type: 'door',
    x: gx0 * T, y: gy0 * T, width: (gx1 - gx0) * T, height: (gy1 - gy0) * T, rotation: 0, visible: true,
    properties: [
      { name: 'side', type: 'string', value: d.side },
      { name: 'ax', type: 'int', value: Math.round(ax) }, { name: 'ay', type: 'int', value: Math.round(ay) },
      { name: 'plateX', type: 'int', value: Math.round(plateX) }, { name: 'plateY', type: 'int', value: Math.round(plateY) },
    ],
  };
});

// Spawn: the front porch.
const spawn = { x: px(HALL.spawn.x, hb.x), y: px(HALL.spawn.y, hb.y) };
zones.push({ id: nextId++, name: 'spawn', type: 'spawn', x: spawn.x, y: spawn.y, width: 0, height: 0, point: true, rotation: 0, visible: true });

// ---- Can every room be reached from the porch? (Walls and furniture footprints, a little wider.) ----
const blockedAt = (tx, ty) => {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H || at(wallData, tx, ty) !== 0) return true;
  const cx = tx * T + 8, cy = ty * T + 8;
  return blocks.some((b) => cx > b.x - 4 && cx < b.x + b.w + 4 && cy > b.y - 3 && cy < b.y + b.h + 3);
};
const seen = new Set();
const queue = [[Math.floor(spawn.x / T), Math.floor(spawn.y / T)]];
seen.add(queue[0].join(','));
while (queue.length) {
  const [x, y] = queue.shift();
  for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    const k = `${nx},${ny}`;
    if (seen.has(k) || blockedAt(nx, ny)) continue;
    seen.add(k);
    queue.push([nx, ny]);
  }
}
const stuck = [];
for (const r of ROOMS) {
  const b = bounds(r.polygon);
  let floor = 0, reached = 0;
  for (let y = b.y; y < b.y + b.h; y++)
    for (let x = b.x; x < b.x + b.w; x++)
      if (tileIn(r.polygon, x, y) && !blockedAt(x, y)) {
        floor++;
        if (seen.has(`${x},${y}`)) reached++;
      }
  if (reached === 0) stuck.push(`${r.id} (no way in)`);
  else if (reached < floor * 0.85) stuck.push(`${r.id} (only ${reached} of ${floor} floor tiles reachable)`);
}

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
  tilewidth: T,
  tileheight: T,
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
      tilewidth: T,
      tileheight: T,
      columns: COLS,
      tilecount: LIMEZU_COUNT,
      margin: 0,
      spacing: 0,
    },
    {
      firstgid: LIMEZU_COUNT + 1,
      name: 'house_extra',
      image: '../public/assets/tiles/house_extra.png',
      imagewidth: 22 * T,
      imageheight: T,
      tilewidth: T,
      tileheight: T,
      columns: 22,
      tilecount: 22,
      margin: 0,
      spacing: 0,
    },
  ],
};

writeFileSync(new URL('../maps/house.tmj', import.meta.url), JSON.stringify(map) + '\n');
console.log(`maps/house.tmj: ${W}x${H} tiles, ${AREAS.length} areas, ${furniture.length} pieces of furniture`);
if (stuck.length) {
  console.error(`Can't walk from the porch to: ${stuck.join(', ')}`);
  process.exit(1);
}
