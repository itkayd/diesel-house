import type { RoomId } from '../config';
import { supabase } from './supabase';

// Room passes (public.room_passes): an owner lets someone into their knock-first or locked room for 12
// hours, or removes them. The database checks them for voice; the game uses them to open the door.

export async function myPasses(userId: string): Promise<Set<RoomId>> {
  const out = new Set<RoomId>();
  if (!supabase) return out;
  const { data } = await supabase.from('room_passes').select('room_id, expires_at').eq('user_id', userId);
  for (const p of data ?? []) if (new Date(p.expires_at).getTime() > Date.now()) out.add(p.room_id as RoomId);
  return out;
}

export async function letIn(room: RoomId, userId: string) {
  if (!supabase) return 'offline';
  const expires = new Date(Date.now() + 12 * 3600_000).toISOString();
  const { error } = await supabase.from('room_passes').upsert({ room_id: room, user_id: userId, granted_at: new Date().toISOString(), expires_at: expires });
  return error?.message ?? null;
}

export async function removeFromRoom(room: RoomId, userId: string) {
  if (!supabase) return 'offline';
  const { error } = await supabase.from('room_passes').delete().eq('room_id', room).eq('user_id', userId);
  return error?.message ?? null;
}
