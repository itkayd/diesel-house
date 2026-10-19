import type { RoomId } from '../config';
import { supabase } from './supabase';

// The rooms' live state (public.rooms, REDESIGN.md R1). Nobody owns a room: names and looks come from
// src/house/rooms.ts; the database keeps what people can change, and changes arrive live via the house
// channel.
//   dnd: someone inside asked for quiet ("Do not disturb"); shown only while someone is in there.
//   games: which games the room's table offers (null: all), UPDATE.md Phase 12.
//   prompts: the room's own Would you rather prompts, "option A|option B" (null: none), Phase 13.
export type Room = {
  id: RoomId;
  active: boolean;
  dnd: boolean;
  dnd_set_by: string | null;
  games?: string[] | null;
  prompts?: string[] | null;
  music?: string | null; // the Disco's jukebox: track id (src/house/jukebox.ts) and when it started
  music_at?: string | null;
  music_by?: string | null;
};

export async function loadRooms(): Promise<Room[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('rooms').select('*') // (music columns once migration 20261105 is applied).order('id');
  if (error) console.warn('Could not load rooms', error.message);
  return (data ?? []) as Room[];
}

// Ask for quiet in a room (or stop asking). Anyone in the house can.
export async function setDnd(room: RoomId, quiet: boolean) {
  if (!supabase) return 'offline';
  const { error } = await supabase.rpc('set_dnd', { room, quiet });
  return error?.message ?? null;
}

// A room's games and prompts. Any member can change them; the database logs who did (room_changes).
export async function setRoomRules(room: RoomId, games: string[] | null, prompts: string[] | null) {
  if (!supabase) return 'offline';
  const { error } = await supabase.rpc('set_room_rules', { room, room_games: games, room_prompts: prompts });
  return error?.message ?? null;
}

// Put a track on the Disco's jukebox, or stop it (null). Anyone in the house can.
export async function setRoomMusic(room: RoomId, track: string | null) {
  if (!supabase) return 'offline';
  const { error } = await supabase.rpc('set_room_music', { room, track });
  return error?.message ?? null;
}
