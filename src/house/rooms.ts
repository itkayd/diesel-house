// The house as data (REDESIGN.md R1): every area of the house, in one list. The map builder
// (scripts/build-map.mjs: floors, walls, door gaps, furniture, game spots), the zones the game uses
// (who's where, voice, chat, critters, the map) and the door signs all come from here. To add a room,
// add an entry; the database only needs a row in public.rooms with the same id (for its chat).
//
// Coordinates: `polygon` and `door` are in tiles (16 px). A polygon is the area's corners in order; a tile
// belongs to it if its centre is inside. The top two rows along every top edge become wall face (as in
// the LimeZu room builder), the rest is floor. Diagonal edges come out stepped, one tile at a time.
// Furniture x/y are px from the top-left corner of the polygon's bounding box.
//
// No owners (REDESIGN.md §2): rooms have fixed names, anyone can go in; "Do not disturb" replaces knock
// and lock. This first version keeps the old 8-room layout so nothing changes on screen; R3 replaces it
// with the octagon house.
//
// Pure data and maths only (no Phaser, no Vite): `node scripts/build-map.mjs` imports this file too.

export type TilePt = readonly [number, number];
export type VoiceMode = 'room' | 'quiet' | 'music'; // quiet: whisper falloff (Library), music: a jukebox bed (Disco)
export type Side = 'north' | 'south' | 'east' | 'west';
export type WallStyle = 'pink' | 'yellow' | 'mint' | 'wood' | 'brown' | 'red' | 'grey' | 'beige';
export type FloorStyle = 'brick' | 'yellow' | 'teal' | 'herringbone' | 'grey' | 'rose' | 'mauve' | 'stone' | 'slate';
// [sprite key in design/game/sprites.json, x, y, flag]: flag 'wall' hangs on the wall, 'flat' is a rug,
// '#rrggbb' gives off light.
export type Furniture = readonly [key: string, x: number, y: number, flag?: string];

export type Area = {
  polygon: readonly TilePt[];
  wall: WallStyle;
  floor: FloorStyle;
  tint?: string; // colour for the plain grey floors (the free pack's plain floors all look alike)
  furniture: readonly Furniture[];
};

export type RoomDef = Area & {
  id: string; // also the voice / chat / game channel name: voice:<id>, game:<id>
  name: string;
  voice: VoiceMode;
  // The gap through the wall between the room and the hall: its first tile and length. `side` is where the
  // room is, seen from the gap (north: the room is above it).
  door: { x: number; y: number; w: number; side: Side };
  theme: string;
  // Where "Play games" is offered: in front of this piece (a rug makes it a sofa corner with the games
  // that need no table).
  spot?: string;
};

export type HallDef = Area & {
  spawn: { x: number; y: number }; // px, the front door
  spot: string; // the games table
  board: { x: number; y: number; boardX: number; boardY: number }; // the noticeboard: stand at x,y; it hangs at boardX,boardY (px)
};

const WARM = '#f4b860', FIRE = '#ff8a3d', COOL = '#9ec9ff', PINK = '#ffb3c7';

// A rectangle as a polygon (tiles).
const box = (x: number, y: number, w: number, h: number): TilePt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// The hall: the centre of the house (whisper + walkie voice, the games corner and the noticeboard).
export const HALL: HallDef = {
  polygon: box(1, 12, 43, 7),
  wall: 'beige',
  floor: 'grey',
  furniture: [
    ['door_double', 4, 4, 'wall'],
    ['fairy_lights', 112, 2, WARM], ['fairy_lights', 174, 2, WARM], ['fairy_lights', 288, 2, WARM], ['fairy_lights', 350, 2, WARM],
    ['fairy_lights', 464, 2, WARM], ['fairy_lights', 526, 2, WARM], ['fairy_lights', 640, 2, WARM],
    ['picture_c', 504, 14, 'wall'], ['picture_b', 324, 14, 'wall'],
    ['rug_small_red', 172, 58, 'flat'], ['rug_small_red', 352, 58, 'flat'], ['rug_small_red', 532, 58, 'flat'],
    ['plant_palm', 114, 80], ['plant_tree', 314, 87], ['plant_palm', 484, 80], ['plant_tree', 664, 87],
    ['lamp_cream', 210, 34, WARM], ['lamp_cream', 570, 34, WARM],
    // Games corner (UPDATE.md Phase 12): a table and two stools at the west end.
    ['table_wood', 48, 42], ['stool', 42, 70], ['stool', 82, 70],
  ],
  spawn: { x: 48, y: 288 },
  spot: 'table_wood',
  board: { x: 175, y: 240, boardX: 160, boardY: 200 },
};

// Today's 8 rooms: 4 above the hall, 4 below, each 10 x 10 tiles with a 2-tile door.
const top = (i: number) => ({ polygon: box(1 + i * 11, 1, 10, 10), door: { x: 5 + i * 11, y: 11, w: 2, side: 'north' as const } });
const bottom = (i: number) => ({ polygon: box(1 + i * 11, 20, 10, 10), door: { x: 5 + i * 11, y: 19, w: 2, side: 'south' as const } });

export const ROOMS: readonly RoomDef[] = [
  {
    id: 'room_01', name: 'Room 1', voice: 'room', theme: 'lounge', ...top(0), wall: 'pink', floor: 'brick', spot: 'rug_blue',
    furniture: [['window_curtain', 22, 4, 'wall'], ['picture_land', 120, 10, 'wall'], ['sofa_grey', 56, 33], ['rug_blue', 60, 62, 'flat'],
      ['plant_palm', 4, 30], ['lamp_cream', 140, 33, WARM], ['armchair_red', 14, 78], ['plant_small', 142, 128]],
  },
  {
    id: 'room_02', name: 'Room 2', voice: 'room', theme: 'fireside', ...top(1), wall: 'mint', floor: 'stone', tint: '#a9c6ff', spot: 'rug_red',
    furniture: [['fireplace', 64, 10, FIRE], ['picture_a', 24, 10, 'wall'], ['picture_b', 124, 10, 'wall'], ['rug_red', 50, 58, 'flat'],
      ['armchair_red', 34, 62], ['armchair_red', 110, 62], ['sofa_red', 64, 94], ['lamp_red', 8, 36, WARM], ['plant_tree', 138, 130]],
  },
  {
    id: 'room_03', name: 'Room 3', voice: 'room', theme: 'study', ...top(2), wall: 'yellow', floor: 'teal', spot: 'desk_study',
    furniture: [['map_world', 14, 8, 'wall'], ['aquarium', 70, 14, COOL], ['desk_study', 8, 36], ['desk_study', 124, 36], ['rug_green', 68, 72, 'flat'],
      ['stool', 40, 72], ['stool', 106, 72], ['sofa_brown', 64, 92], ['lamp_blue', 8, 100, COOL], ['plant_small', 142, 130]],
  },
  {
    id: 'room_04', name: 'Room 4', voice: 'room', theme: 'library', ...top(3), wall: 'brown', floor: 'rose', tint: '#c4e3a4', spot: 'desk_study',
    furniture: [['bookshelf', 6, 8], ['bookshelf_2', 40, 8], ['map_world', 112, 10, 'wall'], ['desk_study', 112, 40], ['globe', 143, 38],
      ['rug_beige', 42, 82, 'flat'], ['armchair_red', 22, 80], ['lamp_cream', 90, 60, WARM], ['plant_tree', 140, 128]],
  },
  {
    id: 'room_05', name: 'Room 5', voice: 'room', theme: 'lounge', ...bottom(0), wall: 'grey', floor: 'yellow', spot: 'rug_olive',
    furniture: [['window_red', 16, 6, 'wall'], ['picture_c', 124, 10, 'wall'], ['plant_small', 8, 40], ['rug_olive', 68, 92, 'flat'],
      ['sofa_brown', 14, 124], ['sofa_white', 54, 126], ['lamp_red', 140, 40, PINK], ['plant_palm', 132, 126]],
  },
  {
    id: 'room_06', name: 'Room 6', voice: 'room', theme: 'kitchen', ...bottom(1), wall: 'red', floor: 'mauve', tint: '#dcbcff', spot: 'table_wood',
    furniture: [['picture_a', 24, 10, 'wall'], ['bookshelf_2', 122, 8], ['rug_red', 50, 88, 'flat'], ['table_wood', 61, 90], ['chair_a', 42, 96],
      ['chair_c', 103, 96], ['lamp_cream', 8, 40, WARM], ['plant_pot', 12, 140]],
  },
  {
    id: 'room_07', name: 'Room 7', voice: 'room', theme: 'bedroom', ...bottom(2), wall: 'beige', floor: 'herringbone', spot: 'rug_small_red',
    furniture: [['bed_big', 8, 38], ['wardrobe', 128, 4], ['mirror', 106, 8, 'wall'], ['rug_small_red', 60, 118, 'flat'], ['dresser', 120, 132],
      ['plant_pot', 10, 140], ['lamp_table', 52, 40, WARM]],
  },
  {
    id: 'room_08', name: 'Room 8', voice: 'room', theme: 'bedroom', ...bottom(3), wall: 'wood', floor: 'slate', tint: '#ffcf8f', spot: 'rug_small_blue',
    furniture: [['picture_land', 24, 10, 'wall'], ['window_curtain', 120, 4, 'wall'], ['dresser', 10, 36], ['bed_blue', 118, 40],
      ['rug_small_blue', 68, 110, 'flat'], ['plant_palm', 130, 124], ['lamp_blue', 8, 120, COOL]],
  },
];

export const ROOM_IDS: readonly string[] = ROOMS.map((r) => r.id);
export const roomDef = (id: string) => ROOMS.find((r) => r.id === id);

// ---- Geometry (shared by the map builder and the game) ----

// Is the point (in tiles) inside the polygon? Even-odd rule.
export function insidePolygon(poly: readonly TilePt[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Does tile (tx, ty) belong to the polygon? (Its centre is inside.)
export const tileIn = (poly: readonly TilePt[], tx: number, ty: number) => insidePolygon(poly, tx + 0.5, ty + 0.5);

export function bounds(poly: readonly TilePt[]) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// The tiles of a door gap (through the dividing wall).
export function doorTiles(d: RoomDef['door']): TilePt[] {
  const across = d.side === 'north' || d.side === 'south';
  return Array.from({ length: d.w }, (_, i) => (across ? [d.x + i, d.y] : [d.x, d.y + i]) as TilePt);
}

// The house's size in tiles: everything, plus a one-tile border of wall.
export function houseSize() {
  let w = 0;
  let h = 0;
  for (const a of [HALL, ...ROOMS]) {
    const b = bounds(a.polygon);
    w = Math.max(w, b.x + b.w + 1);
    h = Math.max(h, b.y + b.h + 1);
  }
  return { w, h };
}

// Which area each tile belongs to: a room (its polygon and its door gap), 'hallway', or null (wall).
export function zoneGrid(cols: number, rows: number): (string | null)[] {
  const grid: (string | null)[] = new Array(cols * rows).fill(null);
  for (let ty = 0; ty < rows; ty++)
    for (let tx = 0; tx < cols; tx++) {
      if (tileIn(HALL.polygon, tx, ty)) grid[ty * cols + tx] = 'hallway';
      for (const r of ROOMS) if (tileIn(r.polygon, tx, ty)) grid[ty * cols + tx] = r.id;
    }
  for (const r of ROOMS) for (const [tx, ty] of doorTiles(r.door)) if (tx < cols && ty < rows) grid[ty * cols + tx] = r.id;
  return grid;
}
