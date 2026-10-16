import type { RoomId } from '../config';
import type { DoorState, Mood } from '../ui/icons';
import { supabase } from './supabase';

// The 8 rooms (public.rooms): owner, name, door state, mood. Owners are set by the admin; only the
// owner may change their room (row-level security). Changes arrive live via the house channel.

// games: which games the room's table offers (null: all), UPDATE.md Phase 12.
export type Room = { id: RoomId; owner_id: string | null; name: string; door_state: DoorState; mood: Mood | null; games?: string[] | null };
export const DEFAULT_ROOM_NAME = 'Empty room'; // the table's default

export async function loadRooms(): Promise<Room[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('rooms').select('id, owner_id, name, door_state, mood, games').order('id');
  if (error) console.warn('Could not load rooms', error.message);
  return (data ?? []) as Room[];
}

export async function updateRoom(id: RoomId, change: Partial<Pick<Room, 'name' | 'door_state' | 'mood' | 'games'>>) {
  if (!supabase) return 'offline';
  const { error } = await supabase.from('rooms').update({ ...change, updated_at: new Date().toISOString() }).eq('id', id);
  return error?.message ?? null;
}

// What the door sign says: the room's own name, or "<owner>'s room", or "Empty room".
export function roomLabel(room: Room | undefined, ownerName: string | undefined, fallback: string) {
  if (!room) return fallback;
  if (room.name && room.name !== DEFAULT_ROOM_NAME) return room.name;
  if (ownerName) return `${ownerName}'s room`;
  return DEFAULT_ROOM_NAME;
}
