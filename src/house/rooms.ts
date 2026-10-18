// The house as data (REDESIGN.md §2, R1, R3): every area of the house, in one list. The map builder
// (scripts/build-map.mjs: floors, walls, door gaps, furniture, game spots), the zones the game uses
// (who's where, voice, chat, critters, the map) and the door signs all come from here. To add a room,
// add an entry; the database only needs a row in public.rooms with the same id (for its chat).
//
// The octagon house (floor plan: design/redesign/floorplan_octagon.png): the Great Hall in the middle with
// the front porch below it, and 7 shared rooms around it: Garden (N), Library (NE), Disco (E), Gaming (SE),
// Café (SW), Lounge (W) and Rooftop (NW).
//
// Coordinates are in tiles (world units, REDESIGN.md §5 rule 1; one tile = 16 world px). A polygon is the
// area's corners in order; a tile belongs to it if its centre is inside. The top two rows along every top
// edge become wall face (as in the LimeZu room builder), the rest is floor. Diagonal edges come out stepped,
// one tile at a time. Areas don't touch: there is at least one tile of solid wall between them, and a door
// is the rectangle of tiles that opens a way through (wall, and the wall face of either side, inside it
// becomes floor). Furniture positions are tiles from the top-left corner of the polygon's bounding box
// (halves are fine).
//
// No owners (REDESIGN.md §2): rooms have fixed names, anyone can go in; "Do not disturb" replaces knock
// and lock.
//
// Pure data and maths only (no Phaser, no Vite): `node scripts/build-map.mjs` imports this file too.

export type TilePt = readonly [number, number];
export type VoiceMode = 'room' | 'quiet' | 'music'; // quiet: whisper falloff (Library), music: a jukebox bed (Disco)
export type Side = 'north' | 'south' | 'east' | 'west';
export type WallStyle = 'pink' | 'yellow' | 'mint' | 'wood' | 'brown' | 'red' | 'grey' | 'beige' | 'hedge' | 'skyline';
export type FloorStyle = 'brick' | 'yellow' | 'teal' | 'herringbone' | 'grey' | 'rose' | 'mauve' | 'stone' | 'slate' | 'grass' | 'deck';
// [kind, x, y, flag, footprint]. kind: a name in src/house/art/topdown.json. flag: 'wall' hangs on the wall,
// 'flat' lies on the floor (rugs), 'over' stands on the floor but you can walk over it (stools, tufts),
// 'on' sits on the piece before it (a coffee maker on a counter), '#rrggbb' gives off light. footprint:
// the part that blocks walking, [x, y, w, h] px inside the sprite; without one, the bottom of the sprite.
export type Furniture = readonly [kind: string, x: number, y: number, flag?: string, footprint?: readonly [number, number, number, number]];

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
  // The way in from the hall: a rectangle of tiles (x, y, w, h). `side` is where the room is, seen from the
  // hall (north: the room is above the door).
  door: { x: number; y: number; w: number; h: number; side: Side };
  theme: string;
  outdoor?: boolean; // sky instead of a ceiling: follows the time of day (R3)
  // Where "Play games" is offered: in front of this piece (a rug or blanket makes it a sofa corner with
  // the games that need no table).
  spot?: string;
  dance?: { x: number; y: number; w: number; h: number }; // the Disco's light-up floor (tiles from the bounding box)
  timer?: string; // a shared study timer sits on the first piece of this kind (the Library's desk)
  special?: string; // the day's special is pinned on the first piece of this kind (the Café's fridge)
};

export type HallDef = Area & {
  spawn: { x: number; y: number }; // tiles: the front porch
  spot: string; // the games table
  board: { x: number; y: number; boardX: number; boardY: number }; // the noticeboard: stand at x,y; it hangs at boardX,boardY (tiles)
};

const WARM = '#f4b860', FIRE = '#ff8a3d', COOL = '#9ec9ff', PINK = '#ff8fd0';

// A rectangle as a polygon (tiles).
const box = (x: number, y: number, w: number, h: number): TilePt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// The Great Hall: an octagon in the middle of the house, with the front porch sticking out below.
// Whisper + walkie voice, the games corner, the noticeboard and the whisper rug.
export const HALL: HallDef = {
  polygon: [[35, 26], [47, 26], [54, 33], [54, 41], [47, 48], [44, 48], [44, 53], [38, 53], [38, 48], [35, 48], [28, 41], [28, 33]],
  wall: 'beige',
  floor: 'grey',
  tint: '#d9c3a0',
  furniture: [
    ['fairy_lights', 6.9, 0.1, WARM], ['fairy_lights', 10.2, 0.1, WARM], ['fairy_lights', 14.1, 0.1, WARM],
    ['picture_sunset', 15.8, 0.3, 'wall'], ['clock_round', 17.7, 0.4, 'wall'],
    ['rug_runner', 12.5, 17.4, 'flat'],
    // The whisper rug in the middle, sofas around it.
    ['rug_oval_cream', 10.6, 13, 'flat'],
    ['sofa_beige', 10.8, 10.3], ['armchair_beige', 8.8, 13.6], ['armchair_beige', 15.4, 13.6], ['table_small_oval', 12.4, 14.4, 'over'],
    // Games corner (UPDATE.md Phase 12): a table and two stools, up on the right.
    ['rug_red_wide', 15.2, 3.6, 'flat'], ['table_wood', 16, 3.8], ['stool', 16, 6.4, 'over'], ['stool', 18.2, 6.4, 'over'],
    ['plant_big', 6, 2.2], ['plant_big', 19.4, 2.2], ['plant_round', 2.6, 12.6], ['plant_round', 22.4, 12.6],
    ['lamp_floor', 4.4, 7, WARM], ['lamp_floor', 21, 7, WARM], ['lamp_tripod', 4.6, 16.4, WARM], ['lamp_tripod', 20.6, 16.4, WARM],
    ['bookcase_low', 1.4, 9], ['cabinet_books', 19.2, 13.4],
    // The front porch: a mat, plants and a lantern by the front door.
    ['rug_small_red', 11.5, 25, 'flat'], ['plant_tall', 10.2, 22.4], ['plant_tall', 14.8, 22.4], ['lamp_cream', 10.4, 25, WARM],
  ],
  spawn: { x: 13, y: 24.6 },
  spot: 'table_wood',
  board: { x: 9.4, y: 3.2, boardX: 8.4, boardY: 0.45 },
};

export const ROOMS: readonly RoomDef[] = [
  {
    id: 'garden', name: 'Garden', voice: 'room', theme: 'garden', outdoor: true,
    polygon: box(34, 12, 14, 13), door: { x: 40, y: 25, w: 2, h: 3, side: 'north' },
    wall: 'hedge', floor: 'grass', spot: 'picnic_blanket',
    furniture: [
      ['tree_round', 0.2, 0.8], ['tree_pine', 11.8, 0.8], ['tree_trunk', 0.2, 8.6], ['tree_round_b', 11.8, 8.4],
      ['pond', 8.2, 2.6, undefined, [3, 6, 42, 38]],
      ['picnic_blanket', 3, 2.6, 'flat'],
      ['fire_pit', 4.6, 6.6, FIRE, [3, 8, 26, 20]], ['log_bench', 3.4, 9.2], ['log_bench', 3.4, 5.4],
      ['lantern_post', 2.2, 10.2, WARM], ['lantern_post', 10.8, 6.4, WARM],
      ['bush', 2.4, 2], ['bush_b', 10.6, 10.6], ['bush', 12.6, 6.4], ['rock', 7.6, 9.4],
      ['grass_tuft', 6.6, 4.4, 'over'], ['grass_tuft_b', 9, 8.2, 'over'], ['grass_tuft', 1.4, 6, 'over'], ['grass_tuft_b', 12.2, 4.6, 'over'],
    ],
  },
  {
    id: 'library', name: 'Library', voice: 'quiet', theme: 'library', timer: 'desk_study',
    polygon: [[49, 10], [66, 10], [66, 29], [52, 29], [49, 26]], door: { x: 50, y: 27, w: 2, h: 6, side: 'north' },
    wall: 'wood', floor: 'herringbone',
    furniture: [
      ['bookcase_full', 0.4, 0], ['bookcase_bright', 2.5, 0], ['bookcase_tv', 4.6, 0], ['bookcase_dark', 6.7, 0], ['bookcase_bright_tv', 8.8, 0],
      ['bookcase_full', 10.9, 0], ['bookcase_bright', 13, 0], ['bookcase_dark', 15.1, 0],
      // Reading nook: two armchairs on a rug, a lamp between.
      ['rug_red_pattern', 1.2, 4.4, 'flat'], ['armchair_beige', 1.6, 5], ['armchair_beige', 4.6, 5], ['lamp_floor', 3.4, 4.2, WARM], ['table_small_oval', 2.8, 7.4, 'over'],
      // Study desks with lamps (the study timer sits on the first, R3).
      ['desk_study', 9.6, 4.2], ['lamp_desk', 10, 3.7, 'on'], ['desk_study', 12.8, 4.2], ['lamp_desk_pink', 13.2, 3.7, 'on'], ['globe', 15.4, 4.3],
      // The long reading table.
      ['rug_cream_wide', 6.2, 9.4, 'flat'], ['table_long', 7, 10], ['chair_wood_right', 6, 10.8, 'over'], ['chair_wood_left', 13, 10.8, 'over'], ['lamp_desk', 9.4, 9.6, 'on'],
      ['bookcase_low', 14.6, 13.6], ['bookcase_low_bright', 11.6, 15.6], ['plant_tall', 15.6, 8.6], ['plant_big', 5.6, 15.4], ['lamp_tripod', 15.8, 11.4, WARM],
    ],
  },
  {
    id: 'disco', name: 'Disco', voice: 'music', theme: 'disco',
    polygon: box(55, 30, 20, 15), door: { x: 54, y: 36, w: 1, h: 2, side: 'east' },
    wall: 'grey', floor: 'slate', tint: '#9a86d6',
    dance: { x: 5, y: 5, w: 10, h: 6 },
    furniture: [
      ['dj_booth', 7.5, 2.1], ['speaker_tall', 5.6, 1.6], ['speaker_tall', 13.8, 1.6],
      ['jukebox', 1.4, 1.2, PINK], ['lamp_blue', 3.4, 1.8, COOL], ['lamp_blue', 16.6, 1.8, COOL], ['plant_palm', 18.4, 1.6],
      ['sofa_red', 1, 12.4], ['sofa_red', 17, 12.4], ['armchair_red', 3.4, 12.4], ['armchair_red', 15.6, 12.4],
      ['table_small_oval', 1.4, 8.4, 'over'], ['table_small_oval', 17.4, 8.4, 'over'],
      ['picture_c', 11, 0.3, 'wall'], ['picture_b', 3.4, 0.3, 'wall'],
    ],
  },
  {
    id: 'gaming', name: 'Gaming room', voice: 'room', theme: 'gaming', spot: 'table_long_dark',
    polygon: [[51, 46], [66, 46], [66, 63], [49, 63], [49, 48]], door: { x: 49, y: 44, w: 2, h: 6, side: 'south' },
    wall: 'mint', floor: 'teal',
    furniture: [
      ['arcade_red', 4.4, 0.1], ['arcade_blue', 5.6, 0.1], ['arcade_purple', 6.8, 0.1],
      ['tv', 10.4, 0.3, 'wall'], ['tv_stand', 10.6, 1.4], ['beanbag_pink', 10, 4.4], ['beanbag_teal', 12, 4.4], ['beanbag_yellow', 14, 4.2],
      // The big games table (all the table games, UPDATE.md Phase 12-13).
      ['rug_red_pattern', 4.4, 8, 'flat'], ['table_long_dark', 5.2, 8.6], ['chair_dark_right', 4.2, 9.4, 'over'], ['chair_dark_left', 11.2, 9.4, 'over'],
      ['arcade_blue', 15.4, 8], ['arcade_red', 15.4, 10.4],
      ['bookcase_low', 1.2, 14.4], ['plant_round', 15.6, 15], ['plant_big', 1, 4.4], ['lamp_floor', 14.8, 1.2, PINK], ['lamp_tripod', 1.4, 11.4, WARM],
    ],
  },
  {
    id: 'cafe', name: 'Café', voice: 'room', theme: 'cafe', spot: 'table_round_white', special: 'fridge_cream',
    polygon: [[16, 46], [31, 46], [33, 48], [33, 63], [16, 63]], door: { x: 31, y: 44, w: 2, h: 6, side: 'south' },
    wall: 'yellow', floor: 'brick',
    furniture: [
      // The counter along the back wall, with the coffee things on it, and the fridge with the daily special.
      ['counter_long', 1, 1.2], ['coffee_maker', 2, 0.9, 'on'], ['cup', 3.2, 1.2, 'on'], ['toaster', 4.6, 1.1, 'on'], ['microwave', 6.2, 0.9, 'on'],
      ['sink_counter', 6.8, 1.2], ['fridge_cream', 9.4, 0.4], ['wall_shelf', 11.4, 0.4, 'wall'], ['clock_square', 2.8, 0.1, 'wall'],
      // Bistro tables.
      ['table_round_white', 3, 6], ['chair_white_right', 2, 6.4, 'over'], ['chair_white_left', 5.2, 6.4, 'over'],
      ['table_round_white', 9, 6], ['chair_white_right', 8, 6.4, 'over'], ['chair_white_left', 11.2, 6.4, 'over'],
      ['table_round_white', 3, 11], ['chair_white_right', 2, 11.4, 'over'], ['chair_white_left', 5.2, 11.4, 'over'],
      ['table_round_white', 9, 11], ['chair_white_right', 8, 11.4, 'over'], ['chair_white_left', 11.2, 11.4, 'over'],
      ['plant_big', 0.6, 15], ['plant_round', 14.4, 15], ['vase_flowers', 3.8, 5.6, 'on'], ['lamp_cream', 13.8, 4.4, WARM], ['lamp_cream', 0.6, 8.4, WARM],
    ],
  },
  {
    id: 'lounge', name: 'Lounge', voice: 'room', theme: 'lounge', spot: 'table_round_wood',
    polygon: box(8, 30, 19, 15), door: { x: 27, y: 36, w: 1, h: 2, side: 'west' },
    wall: 'pink', floor: 'yellow',
    furniture: [
      ['fireplace_brick', 7.8, 0, FIRE], ['bookcase_full', 0.6, 0], ['bookcase_tv', 2.7, 0], ['tv_wall', 14, 0.5, 'wall'], ['soundbar', 14.2, 1.6, 'wall'],
      ['rug_cream_pattern', 6.4, 4, 'flat'], ['armchair_beige', 5.4, 4.4], ['armchair_grey', 11.4, 4.4], ['sofa_beige', 7.6, 7.2],
      ['sofa_grey_lrk', 13.6, 4.4], ['table_small_oval', 14.4, 6.8, 'over'],
      // The second games table.
      ['table_round_wood', 2.6, 9.4], ['chair_dark_right', 1.4, 9.8, 'over'], ['chair_dark_left', 4.8, 9.8, 'over'],
      ['plant_big', 17.6, 1.6], ['plant_round', 0.6, 12.4], ['lamp_floor', 5, 1.6, WARM], ['lamp_tripod', 12.8, 1.6, WARM], ['lamp_desk', 14.6, 6.4, 'on'],
      ['candle', 9.4, 0.6, 'wall'],
    ],
  },
  {
    id: 'rooftop', name: 'Rooftop', voice: 'room', theme: 'rooftop', outdoor: true,
    polygon: [[16, 10], [33, 10], [33, 26], [30, 29], [16, 29]], door: { x: 30, y: 27, w: 2, h: 6, side: 'north' },
    wall: 'skyline', floor: 'deck',
    furniture: [
      ['fairy_lights', 1.5, 0.2, WARM], ['fairy_lights', 6, 0.2, WARM], ['fairy_lights', 10.5, 0.2, WARM], ['fairy_lights', 14, 0.2, WARM],
      ['telescope', 1.2, 2.2], ['deck_chair', 4, 3], ['deck_chair', 5.4, 3], ['deck_chair', 9.6, 3], ['deck_chair', 11, 3],
      ['table_round_white', 7, 6.6], ['chair_white_right', 6, 7, 'over'], ['chair_white_left', 9.2, 7, 'over'],
      ['beanbag_pink', 2, 9.6], ['beanbag_teal', 4, 10.2], ['beanbag_yellow', 12.4, 9.6],
      ['plant_big', 15.4, 2], ['plant_round', 0.4, 6], ['bush', 15.6, 7], ['bush_b', 0.4, 14.6], ['plant_tall', 6, 15.4],
      ['lantern_post', 15.6, 11, WARM], ['lantern_post', 1, 12, WARM],
      ['stairs_up', 13.6, 15.4, 'flat'],
    ],
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

// All the tiles of a door's rectangle.
export function doorTiles(d: RoomDef['door']): TilePt[] {
  const out: TilePt[] = [];
  for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) out.push([x, y]);
  return out;
}

// The tiles of a door that belong to neither side (the gap through the wall): they count as the room.
export function doorGap(r: RoomDef): TilePt[] {
  return doorTiles(r.door).filter(([x, y]) => !tileIn(HALL.polygon, x, y) && !ROOMS.some((o) => tileIn(o.polygon, x, y)));
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
  for (const r of ROOMS) for (const [tx, ty] of doorGap(r)) if (tx < cols && ty < rows) grid[ty * cols + tx] = r.id;
  return grid;
}
