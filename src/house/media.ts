// Watch & listen together (Lounge TV, Disco): what's on, read from a pasted link, and where it should
// be now. The room keeps media_kind / media_id and "media_pos seconds at media_at (or paused there)"
// (supabase/migrations/20261106_watch_together.sql); every browser plays it through the official
// YouTube or Spotify player and keeps in step.

export type MediaKind = 'youtube' | 'spotify';
export type Media = { kind: MediaKind; id: string };
export type MediaState = Media & { pos: number; at: number; paused: boolean; by: string | null };
export const SCREEN_ROOMS = ['lounge', 'disco'];

// A YouTube or Spotify link (or a bare YouTube id / spotify: URI) → what to play, or null.
export function parseMediaLink(text: string): Media | null {
  const s = text.trim();
  const sp = s.match(/^spotify:(track|album|playlist|episode):([A-Za-z0-9]{22})$/);
  if (sp) return { kind: 'spotify', id: `${sp[1]}:${sp[2]}` };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return /^[A-Za-z0-9_-]{11}$/.test(s) ? { kind: 'youtube', id: s } : null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]{22})/);
    return m ? { kind: 'spotify', id: `${m[1]}:${m[2]}` } : null;
  }
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/)?.[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { kind: 'youtube', id } : null;
}

// A start time in a YouTube link (t=90, t=1m30s), in seconds.
export function linkStart(text: string): number {
  const t = text.match(/[?&#]t=([0-9hms]+)/)?.[1];
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const [, h, m, sec] = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/) ?? [];
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(sec ?? 0);
}

// Where it should be now (seconds).
export const expectedPos = (m: MediaState, now = Date.now()) => (m.paused ? m.pos : m.pos + Math.max(0, now - m.at) / 1000);

// The room row's columns → a state, or null when nothing's on.
export function mediaOf(r: { media_kind?: string | null; media_id?: string | null; media_pos?: number | null; media_at?: string | null; media_paused?: boolean | null; media_by?: string | null } | undefined): MediaState | null {
  if (!r?.media_kind || !r.media_id || !r.media_at) return null;
  if (r.media_kind !== 'youtube' && r.media_kind !== 'spotify') return null;
  return { kind: r.media_kind, id: r.media_id, pos: r.media_pos ?? 0, at: Date.parse(r.media_at), paused: !!r.media_paused, by: r.media_by ?? null };
}
