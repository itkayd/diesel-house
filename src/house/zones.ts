import { bounds, doorGap, HALL, roomDef, ROOMS, tileIn, zoneGrid, type Area } from './rooms';

// Which part of the house a point is in (REDESIGN.md R1): worked out once per tile from the room
// polygons in rooms.ts (so odd shapes work), then a lookup per frame. A room's door gap counts as the
// room, so stepping through the door puts you in it.

export type Box = { x: number; y: number; w: number; h: number }; // px
const T = 16;

export class Zones {
  private grid: (string | null)[];
  readonly ids: string[] = ['hallway', ...ROOMS.map((r) => r.id)];

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.grid = zoneGrid(cols, rows);
  }

  // The zone at a point (px), or null in a wall.
  at(x: number, y: number): string | null {
    const tx = Math.floor(x / T);
    const ty = Math.floor(y / T);
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return null;
    return this.grid[ty * this.cols + tx];
  }

  private area(zone: string): Area | undefined {
    return zone === 'hallway' ? HALL : roomDef(zone);
  }

  // The area's bounding box (px), without its door gap.
  box(zone: string): Box | null {
    const a = this.area(zone);
    if (!a) return null;
    const b = bounds(a.polygon);
    return { x: b.x * T, y: b.y * T, w: b.w * T, h: b.h * T };
  }

  // The area's outline (px), for drawing it (the Who's where map).
  outline(zone: string): { x: number; y: number }[] {
    return (this.area(zone)?.polygon ?? []).map(([x, y]) => ({ x: x * T, y: y * T }));
  }

  // The middle of the area's floor (below the wall face), px: where "walk to this room" aims.
  floorCentre(zone: string): { x: number; y: number } | null {
    const a = this.area(zone);
    if (!a) return null;
    const b = bounds(a.polygon);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let ty = b.y; ty < b.y + b.h; ty++)
      for (let tx = b.x; tx < b.x + b.w; tx++)
        if (tileIn(a.polygon, tx, ty) && tileIn(a.polygon, tx, ty - 1) && tileIn(a.polygon, tx, ty - 2)) {
          sx += tx + 0.5;
          sy += ty + 0.5;
          n++;
        }
    return n ? { x: (sx / n) * T, y: (sy / n) * T } : null;
  }

  // Floor tiles to colour for an area's tint: its own tiles, plus its door gap (which shows its floor).
  tintTiles(zone: string): [number, number][] {
    const a = this.area(zone);
    if (!a) return [];
    const out: [number, number][] = [];
    const b = bounds(a.polygon);
    for (let ty = b.y; ty < b.y + b.h; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) if (tileIn(a.polygon, tx, ty)) out.push([tx, ty]);
    const r = roomDef(zone);
    if (r) out.push(...doorGap(r).map(([tx, ty]) => [tx, ty] as [number, number]));
    return out;
  }
}
