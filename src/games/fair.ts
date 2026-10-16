// Fair randomness for games (UPDATE.md Phase 12): the host picks a secret seed, shares only its hash at
// the start ("commit"), draws every random number from it, and reveals the seed at the end so everyone
// can check the hash matches and nobody changed the dice halfway. Rock-paper-scissors picks use the same
// idea: send the hash of (pick + salt) first, the pick itself once both are locked in.

export function randomSeed() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const checkSeed = async (seed: string, commit: string) => (await sha256(seed)) === commit;

// A small seeded generator (mulberry32): rng() gives 0..1, the same sequence for the same seed.
export function rng(seed: string) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A whole number from lo to hi (both included), from crypto (no seed needed: e.g. your own dice).
export function cryptoInt(lo: number, hi: number) {
  const span = hi - lo + 1;
  const max = Math.floor(0x100000000 / span) * span;
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b);
  while (b[0] >= max);
  return lo + (b[0] % span);
}
