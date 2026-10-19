import { legacyIndex, type Skin } from '../characters';
import type { RoomId } from '../config';
import { supabase } from './supabase';

// Room chat (public.messages, public.reactions). Only people the door lets in can read or post; members'
// names come from their profiles (see supabase/migrations/*_room_chat.sql). Live updates arrive through
// the house channel (postgres changes) and are passed to ui/chat.ts.

export type Message = {
  id: number;
  room_id: RoomId;
  author_id: string | null; // null once a guest's account has been tidied away
  author_name: string;
  author_character: number; // the old character number (kept one release)
  author_skin?: Skin | null; // the character, by key (missing on messages from before R4)
  author_guest: boolean;
  author_host: string | null; // guests: the member who invited them
  text: string;
  created_at: string;
  kind?: 'text' | 'roll'; // 'roll': a dice roll, shown as a system line
};
export type Reaction = { message_id: number; author_id: string; emoji: string };
export const HISTORY = 100;
export const MAX_LENGTH = 500;

export async function loadChat(room: RoomId): Promise<{ messages: Message[]; reactions: Reaction[] }> {
  if (!supabase) return { messages: [], reactions: [] };
  const { data } = await supabase
    .from('messages')
    .select('*') // (author_skin only exists once migration 20261103 is applied)
    .eq('room_id', room)
    .order('created_at', { ascending: false })
    .limit(HISTORY);
  const messages = ((data ?? []) as Message[]).reverse();
  if (!messages.length) return { messages, reactions: [] };
  const { data: r } = await supabase.from('reactions').select('message_id, author_id, emoji').in('message_id', messages.map((m) => m.id));
  return { messages, reactions: (r ?? []) as Reaction[] };
}

// Guests' name and character go with the message; for members the database uses their profile.
export async function postMessage(room: RoomId, text: string, me: { name: string; character: Skin }, kind: 'text' | 'roll' = 'text') {
  if (!supabase) return 'offline';
  const row = { room_id: room, text, author_name: me.name.slice(0, 24), author_character: legacyIndex(me.character), kind };
  let { error } = await supabase.from('messages').insert({ ...row, author_skin: me.character });
  if (error && /author_skin/.test(error.message)) ({ error } = await supabase.from('messages').insert(row)); // before migration 20261103
  return error?.message ?? null;
}

export async function deleteMessage(id: number) {
  if (!supabase) return 'offline';
  const { error } = await supabase.from('messages').delete().eq('id', id);
  return error?.message ?? null;
}

export async function setReaction(messageId: number, emoji: string, on: boolean) {
  if (!supabase) return 'offline';
  const { error } = on
    ? await supabase.from('reactions').insert({ message_id: messageId, emoji })
    : await supabase.from('reactions').delete().eq('message_id', messageId).eq('emoji', emoji).eq('author_id', (await supabase.auth.getUser()).data.user?.id ?? '');
  return error?.message ?? null;
}
