import { supabase } from './supabase';

// A guest's own visit: when it ends and who invited them (public.my_visit()).
export async function myVisit(): Promise<{ expiresAt: Date; host: string | null } | null> {
  if (!supabase) return null;
  const { data } = await supabase.rpc('my_visit');
  const row = (data as { expires_at: string; host_name: string | null }[] | null)?.[0];
  return row ? { expiresAt: new Date(row.expires_at), host: row.host_name } : null;
}
