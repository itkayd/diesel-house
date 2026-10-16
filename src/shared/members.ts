// Shared by the browser (sign-in) and the server functions (join, door list).
// Members sign in with a name + password. Supabase accounts need an email-shaped login, so each name maps
// to a made-up address nobody can receive mail at (the .invalid domain is reserved for exactly this).
// No email is ever sent to it.

export const NAME_MIN = 1;
export const NAME_MAX = 24;
export const PASSWORD_MIN = 8;
const DOMAIN = 'members.diesel-house.invalid';

export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ');

// Same name, any capitalisation or spacing, means the same person.
export function memberLogin(name: string) {
  const key = cleanName(name).toLowerCase();
  const hex = [...new TextEncoder().encode(key)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `m-${hex}@${DOMAIN}`;
}

export const isMemberLogin = (email: string | undefined) => !!email && email.endsWith(`@${DOMAIN}`);

// Invite and guest codes look like "ABCD-1234": four letters (no I, L or O, so they can't be mistaken for
// numbers), then four digits. `random(n)` returns a whole number from 0 to n-1.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export function makeCode(random: (n: number) => number) {
  const letters = Array.from({ length: 4 }, () => CODE_LETTERS[random(CODE_LETTERS.length)]).join('');
  const digits = Array.from({ length: 4 }, () => random(10)).join('');
  return `${letters}-${digits}`;
}
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
