// Walking somewhere by itself ("Who's where" map: tap a room or a friend). A grid of 8 px cells over the
// house; a cell is free if the player's feet box (centred on it) touches no wall, furniture base or shut
// door. Breadth-first search with 8 directions (no cutting corners), then only the corners are kept.

export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

const CELL = 8;

export class WalkGrid {
  readonly cols: number;
  readonly rows: number;
  private free: Uint8Array;

  // `feet`: half the player's feet box (the physics body), so paths keep it clear of walls.
  constructor(width: number, height: number, blocked: Rect[], feet: { hw: number; hh: number }) {
    this.cols = Math.ceil(width / CELL);
    this.rows = Math.ceil(height / CELL);
    this.free = new Uint8Array(this.cols * this.rows).fill(1);
    for (const b of blocked) {
      const x0 = Math.max(0, Math.floor((b.x - feet.hw) / CELL));
      const x1 = Math.min(this.cols - 1, Math.floor((b.x + b.w + feet.hw - 0.01) / CELL));
      const y0 = Math.max(0, Math.floor((b.y - feet.hh) / CELL));
      const y1 = Math.min(this.rows - 1, Math.floor((b.y + b.h + feet.hh - 0.01) / CELL));
      for (let r = y0; r <= y1; r++)
        for (let c = x0; c <= x1; c++) {
          // Only block cells whose centre is actually too close (the box test above is a little generous).
          const cx = c * CELL + CELL / 2;
          const cy = r * CELL + CELL / 2;
          if (cx > b.x - feet.hw && cx < b.x + b.w + feet.hw && cy > b.y - feet.hh && cy < b.y + b.h + feet.hh) this.free[r * this.cols + c] = 0;
        }
    }
  }

  private ok(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.free[r * this.cols + c] === 1;
  }

  private cellOf(p: Pt) {
    return { c: Math.floor(p.x / CELL), r: Math.floor(p.y / CELL) };
  }

  // The free cell nearest to a point (the point itself may be inside a sofa).
  private nearestFree(p: Pt, limit = 8) {
    const { c, r } = this.cellOf(p);
    let best: { c: number; r: number } | null = null;
    let bestD = Infinity;
    for (let dr = -limit; dr <= limit; dr++)
      for (let dc = -limit; dc <= limit; dc++) {
        if (!this.ok(c + dc, r + dr)) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) [best, bestD] = [{ c: c + dc, r: r + dr }, d];
      }
    return best;
  }

  // A path from `from` to (as near as possible to) `to`, as corner points, or null if there's no way.
  find(from: Pt, to: Pt): Pt[] | null {
    const s = this.nearestFree(from, 2);
    const g = this.nearestFree(to);
    if (!s || !g) return null;
    const idx = (c: number, r: number) => r * this.cols + c;
    const prev = new Int32Array(this.cols * this.rows).fill(-1);
    const start = idx(s.c, s.r);
    const goal = idx(g.c, g.r);
    prev[start] = start;
    const queue = [start];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let qi = 0; qi < queue.length && prev[goal] < 0; qi++) {
      const cur = queue[qi];
      const c = cur % this.cols;
      const r = Math.floor(cur / this.cols);
      for (const [dc, dr] of dirs) {
        const nc = c + dc;
        const nr = r + dr;
        if (!this.ok(nc, nr) || prev[idx(nc, nr)] >= 0) continue;
        if (dc && dr && !(this.ok(c + dc, r) && this.ok(c, r + dr))) continue; // no squeezing past corners
        prev[idx(nc, nr)] = cur;
        queue.push(idx(nc, nr));
      }
    }
    if (prev[goal] < 0) return null;
    const cells: number[] = [];
    for (let at = goal; at !== start; at = prev[at]) cells.push(at);
    cells.reverse();
    // Keep the corners only.
    const pts: Pt[] = [];
    let lastDir = '';
    for (let i = 0; i < cells.length; i++) {
      const a = i ? cells[i - 1] : start;
      const b = cells[i];
      const dir = `${(b % this.cols) - (a % this.cols)},${Math.floor(b / this.cols) - Math.floor(a / this.cols)}`;
      if (dir !== lastDir && i) pts.push(this.centre(a));
      lastDir = dir;
    }
    pts.push(this.centre(goal));
    return pts;
  }

  private centre(i: number): Pt {
    return { x: (i % this.cols) * CELL + CELL / 2, y: Math.floor(i / this.cols) * CELL + CELL / 2 };
  }
}
