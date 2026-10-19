export const TILE_SIZE = 16;
// Rooms are data now (src/house/rooms.ts): a room id is any id listed there.
export { ROOM_IDS } from './house/rooms';
export type RoomId = string;
export type Zone = 'hallway' | RoomId;

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Watch & listen together (YouTube / Spotify on the Lounge TV and Disco screen) is built but held back for
// the big update. Flip to true to switch it on; the e2e test turns it on with ?test&fakemedia.
export const WATCH_TOGETHER = false;
