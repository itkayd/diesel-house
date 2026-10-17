// Critters (see supabase/migrations/20261028_critters.sql and 20261029_more_critters.sql): every 2-minute
// slot there's a 75% chance critters turn up around the house, one per person in the house plus a
// coin-flip extra (up to 8). Which ones come from the slot number, with the same maths as
// public.critter_at(), so every browser agrees without sending anything; where they stand comes from the
// same numbers (other hashes). Keep CRITTERS in step with public.critter_defs.

export const SLOT_MS = 120_000;
export const CRITTERS = [
  { id: 'cat', name: 'Cat', xp: 5, weight: 24 },
  { id: 'dog', name: 'Dog', xp: 5, weight: 24 },
  { id: 'duck', name: 'Duck', xp: 5, weight: 18 },
  { id: 'frog', name: 'Frog', xp: 8, weight: 12 },
  { id: 'bunny', name: 'Bunny', xp: 8, weight: 10 },
  { id: 'owl', name: 'Owl', xp: 15, weight: 6 },
  { id: 'fox', name: 'Fox', xp: 15, weight: 4 },
  { id: 'medal', name: 'Lost medal', xp: 25, weight: 2 },
] as const;
export type CritterId = (typeof CRITTERS)[number]['id'];
export const critterById = (id: string) => CRITTERS.find((c) => c.id === id);

export const slotAt = (ms: number) => Math.floor(ms / SLOT_MS);

// (slot × multiplier) mod 2^32, exactly (BigInt: the product is bigger than JS numbers hold exactly).
const hash = (slot: number, mult: bigint) => Number((BigInt(slot) * mult) % 4294967296n);

function pick(r: number): CritterId | null {
  let upto = 0;
  for (const c of CRITTERS) {
    upto += c.weight;
    if (upto > r) return c.id;
  }
  return null;
}

// The slot's first critter, or null for a quiet slot (public.critter_for_slot).
export function critterFor(slot: number): CritterId | null {
  const v = hash(slot, 2654435761n);
  if (v % 100 >= 75) return null;
  return pick(Math.floor(v / 100) % 100);
}

export const MAX_CRITTERS = 8;

// Critter number `idx` (0-7) of a slot (public.critter_at): none at all in a quiet slot.
export function critterAt(slot: number, idx: number): CritterId | null {
  if (idx < 0 || idx >= MAX_CRITTERS) return null;
  const first = critterFor(slot);
  if (!first || idx === 0) return first;
  return pick(Math.floor(hash(slot * 8 + idx, 2654435761n) / 100) % 100);
}

// How many: one per person in the house plus a coin-flip extra (3 people: 3 or 4), at most 8.
export const countFor = (slot: number, people: number) => Math.min(MAX_CRITTERS, Math.max(1, people) + (hash(slot, 3266489917n) % 2));

// Which of `n` places critter number `idx` turns up at.
export const placeFor = (slot: number, n: number, idx = 0) => (n > 0 ? hash(idx ? slot * 8 + idx : slot, 2246822519n) % n : 0);

// Places for critters 0 … count-1, all different (a taken place moves on to the next free one).
export function placesFor(slot: number, count: number, n: number) {
  const used = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < Math.min(count, n); i++) {
    let p = placeFor(slot, n, i);
    while (used.has(p)) p = (p + 1) % n;
    used.add(p);
    out.push(p);
  }
  return out;
}
