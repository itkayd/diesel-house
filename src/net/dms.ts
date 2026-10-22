import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { devTest } from './mode';
import { isBlocked } from './social';
import type { Skin } from '../characters';

// Private messages (supabase/migrations/20261116_profiles_dms.sql): short notes between two people. The
// database keeps the limits (500 characters, 20 a minute, nothing from someone who blocked you); this
// phone listens only for messages to itself (one Realtime subscription, filtered by Row Level Security).
// Test mode (?test) keeps everything on this device.

export type Dm = { id: number; sender: string; text: string; created_at: string; read_at: string | null };
export type Thread = { id: string; name: string | null; character: Skin | null; last_at: string; last_text: string | null; last_mine: boolean; unread: number };

let me = '';
let channel: RealtimeChannel | null = null;
let unread = 0;
const listeners = new Set<(m: Dm & { recipient: string }) => void>();
const unreadListeners = new Set<(n: number) => void>();
const local: (Dm & { recipient: string })[] = []; // test mode

export const unreadCount = () => unread;
export function onUnread(f: (n: number) => void) {
  unreadListeners.add(f);
  f(unread);
  return () => unreadListeners.delete(f);
}
function setUnread(n: number) {
  unread = Math.max(0, n);
  unreadListeners.forEach((f) => f(unread));
}
export function onDm(f: (m: Dm & { recipient: string }) => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args);
  if (error) throw new Error('Couldn’t reach the house. Try again in a moment.');
  return data as T;
}

export async function startDms(myId: string) {
  me = myId;
  if (!supabase || devTest || channel) return;
  setUnread(await rpc<number>('dm_unread').catch(() => 0));
  channel = supabase
    .channel(`dms-${myId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `recipient=eq.${myId}` }, (p) => {
      const m = p.new as Dm & { recipient: string };
      if (isBlocked(m.sender)) return;
      setUnread(unread + 1);
      listeners.forEach((f) => f(m));
    })
    .subscribe();
}

export async function sendDm(to: string, text: string): Promise<Dm> {
  const t = text.trim().slice(0, 500);
  const fake = { id: Date.now(), sender: me, recipient: to, text: t, created_at: new Date().toISOString(), read_at: null };
  if (!supabase || devTest) {
    local.push(fake);
    return fake;
  }
  const r = await rpc<{ ok: boolean; why?: string; id: number | null }>('send_dm', { to_user: to, body: t });
  if (!r.ok) throw new Error(r.why ?? 'Not sent.');
  return { ...fake, id: r.id ?? fake.id };
}

export async function threads(): Promise<Thread[]> {
  if (!supabase || devTest) return [];
  return rpc<Thread[]>('dm_threads');
}

export async function history(withId: string, beforeId?: number): Promise<Dm[]> {
  if (!supabase || devTest) return local.filter((m) => (m.sender === withId && m.recipient === me) || (m.recipient === withId && m.sender === me));
  return rpc<Dm[]>('dm_history', { with_user: withId, before_id: beforeId ?? null });
}

export async function markRead(withId: string, count: number) {
  if (count) setUnread(unread - count);
  if (!supabase || devTest) return;
  await rpc('dm_read', { with_user: withId }).catch(() => {});
}

// Tests (?test): a message arriving from someone.
export function testIncoming(from: string, text: string) {
  const m = { id: Date.now(), sender: from, recipient: me, text, created_at: new Date().toISOString(), read_at: null };
  local.push(m);
  if (isBlocked(from)) return;
  setUnread(unread + 1);
  listeners.forEach((f) => f(m));
}
if (devTest) (window as unknown as { __dms?: unknown }).__dms = { testIncoming };
