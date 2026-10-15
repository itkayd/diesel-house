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

// Invite codes look like "K7QM-3XPH": no 0/O or 1/I/L, so they're easy to read out.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
