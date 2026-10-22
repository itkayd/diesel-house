// Types for fakeDb.mjs (used by vite.config.ts with DH_LOCAL_DB=1, and the API tests).
import type { SupabaseClient } from '@supabase/supabase-js';
export function fakeDb(opts?: { users?: Record<string, { id: string }> }): SupabaseClient;
export function sql(query: string, role?: string): { data: unknown; error: { code: string; message: string } | null };
