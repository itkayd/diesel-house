export const TILE_SIZE = 16;
export const ROOM_IDS = ['room_01', 'room_02', 'room_03', 'room_04', 'room_05', 'room_06', 'room_07', 'room_08'] as const;
export type RoomId = (typeof ROOM_IDS)[number];
export type Zone = 'hallway' | RoomId;

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
