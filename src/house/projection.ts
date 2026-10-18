// World → screen, in one place (REDESIGN.md §5, iso-ready rules 2 and 3).
//
// World units are "world px": tiles × TILE, the same everywhere (zones, doors, collision, game spots,
// critters, the network). They are never screen pixels. Today the view is plain top-down, so a world
// point and its screen point are the same; Phase R6 swaps these functions for an isometric 2:1
// projection. Code that draws something at a world position, sorts it by depth or turns a tap into a
// world position goes through here.
//
// R6 note: in top-down the physics body sits on your sprite, so your sprite's x/y are your world position.
// In iso the body moves to an invisible world-space object and the sprite follows toScreen() of it.

export const TILE = 16;
export type View = 'topdown' | 'iso';
export const VIEW: View = 'topdown';

export type Pt = { x: number; y: number };

export function toScreen(x: number, y: number): Pt {
  return { x, y };
}

export function toWorld(sx: number, sy: number): Pt {
  return { x: sx, y: sy };
}

// Depth for anything standing on the floor, from its feet (world px): further down the house is in
// front. In iso this becomes x + y.
export function depthOf(x: number, y: number): number {
  void x;
  return y;
}

// Fixed layers: below or above everything standing on the floor (whose depth is depthOf, 0…~2000).
export const DEPTH = {
  rug: 1,
  wallDecor: 2,
  marker: 3, // game spot outlines on the floor
  light: 70_000, // the night tint and light pools, above people and furniture
  plate: 80_000, // door nameplates
  sign: 90_000, // game spot signs
  tag: 100_000, // name tags
  bubble: 100_001,
  badge: 100_002, // radio, whisper dots, crown
  emote: 100_003,
} as const;
