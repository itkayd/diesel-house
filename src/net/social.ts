import { supabase } from './supabase';
import { devTest } from './mode';
import { logIssue } from './errors';
import type { Skin } from '../characters';

// Friends, blocks and reporting someone (supabase/migrations/20261115_social.sql, UX-RULES U4).
// Blocking someone: you stop hearing them, their chat lines are hidden, and their emotes, duels and
// game invites don't reach you (they're not told). In test mode (?test) it all stays on this device.

export type Friend = { id: string; name: string | null; character: Skin | null; level: number | null; status: 'friends' | 'incoming' | 'outgoing'; since: string | null; last_seen: string | null };
export type ReportReason = 'harassment' | 'hate' | 'spam' | 'cheating' | 'other';

let friends: Friend[] = [];
const blocked = new Map<string, string>(); // id -> name
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

export const isBlocked = (id: string | null | undefined) => !!id && blocked.has(id);
export const blockedList = () => [...blocked].map(([id, name]) => ({ id, name }));
export const friendList = () => friends;
export const friendOf = (id: string) => friends.find((f) => f.id === id) ?? null;
export const isFriend = (id: string) => friendOf(id)?.status === 'friends';
export function onSocial(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export async function loadSocial() {
  if (!supabase || devTest) return;
  const { data, error } = await supabase.rpc('my_social');
  if (error) return;
  const d = data as { friends: Friend[]; blocked: { id: string; name: string | null }[] };
  friends = d.friends ?? [];
  blocked.clear();
  for (const b of d.blocked ?? []) blocked.set(b.id, b.name ?? 'someone');
  changed();
}

async function call<T = { ok: boolean; why?: string; status?: string }>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  if (!supabase || devTest) return null;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    logIssue('problem', `Social: ${fn} failed`, { extra: { error: error.message } });
    throw new Error('Couldn’t reach the house. Try again in a moment.');
  }
  return data as T;
}

export async function setBlock(id: string, name: string, on: boolean) {
  await call('set_block', { who: id, on_off: on });
  if (on) {
    blocked.set(id, name);
    friends = friends.filter((f) => f.id !== id);
  } else blocked.delete(id);
  changed();
}

// Ask to be friends (or say yes, if they already asked you). Returns the new status.
export async function addFriend(id: string, name: string, character: Skin | null): Promise<Friend['status']> {
  const r = await call<{ ok: boolean; why?: string; status?: 'friends' | 'pending' }>('friend_request', { who: id });
  if (r && !r.ok) throw new Error(r.why ?? 'Couldn’t send that.');
  const was = friendOf(id);
  const status: Friend['status'] = r?.status === 'friends' || was?.status === 'incoming' ? 'friends' : 'outgoing';
  friends = [...friends.filter((f) => f.id !== id), { id, name, character, level: was?.level ?? null, status, since: status === 'friends' ? new Date().toISOString() : null, last_seen: null }];
  changed();
  return status;
}

// Yes or no to a request, or end a friendship / cancel your own request (yes = false).
export async function answerFriend(id: string, yes: boolean) {
  await call('friend_answer', { who: id, yes });
  friends = yes ? friends.map((f) => (f.id === id ? { ...f, status: 'friends' as const, since: new Date().toISOString() } : f)) : friends.filter((f) => f.id !== id);
  changed();
}

export async function reportPlayer(id: string, reason: ReportReason, details: string, context: Record<string, unknown>) {
  const r = await call('report_player', { who: id, reason, details, context });
  if (r && !r.ok) throw new Error(r.why ?? 'Couldn’t send that.');
}

// Tests (?test): pretend the database said so.
export function testSocial(f: Friend[], b: { id: string; name: string }[] = []) {
  friends = f;
  blocked.clear();
  for (const x of b) blocked.set(x.id, x.name);
  changed();
}
if (devTest) (window as unknown as { __social?: unknown }).__social = { testSocial, isBlocked, friendList, blockedList };
