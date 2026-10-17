// Critters (see supabase/migrations/20261028_critters.sql): every 2-minute slot there's a 75% chance a
// critter turns up somewhere in the house. Which one comes from the slot number, with the same maths as
// public.critter_for_slot(), so every browser agrees without sending anything; where it stands comes from
// the same slot number (a second hash). Keep CRITTERS in step with public.critter_defs.

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

export function critterFor(slot: number): CritterId | null {
  const v = hash(slot, 2654435761n);
  if (v % 100 >= 75) return null;
  const r = Math.floor(v / 100) % 100;
  let upto = 0;
  for (const c of CRITTERS) {
    upto += c.weight;
    if (upto > r) return c.id;
  }
  return null;
}

// Which of `n` places it turns up at.
export const placeFor = (slot: number, n: number) => (n > 0 ? hash(slot, 2246822519n) % n : 0);
