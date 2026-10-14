// Vercel function: GET /api/turn -> { iceServers } with short-lived Twilio TURN credentials.
// Only for signed-in members (Supabase access token in the Authorization header).
// Twilio secrets are server-side env vars only (no VITE_ prefix).

type Env = Record<string, string | undefined>;
type TwilioIceServer = { url?: string; urls?: string; username?: string; credential?: string };

const TTL_SECONDS = 4 * 60 * 60; // credentials last one long hangout

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// True if the bearer token belongs to a signed-in user on the guest list.
async function isMember(request: Request, env: Env): Promise<boolean> {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!token || !url || !key) return false;
  const res = await fetch(`${url}/rest/v1/rpc/is_member`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return res.ok && (await res.json()) === true;
}

export async function handleTurn(request: Request, env: Env, opts: { allowAnonymous?: boolean } = {}): Promise<Response> {
  if (!opts.allowAnonymous && !(await isMember(request, env))) return json({ error: 'not signed in' }, 401);

  const sid = env.TWILIO_ACCOUNT_SID;
  const secret = env.TWILIO_AUTH_TOKEN;
  if (!sid || !secret) return json({ error: 'TURN not configured' }, 503);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Tokens.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ Ttl: String(TTL_SECONDS) }),
  });
  if (!res.ok) return json({ error: `Twilio error ${res.status}` }, 502);

  // Keep every server Twilio returns, including TURN over TCP/TLS on 443 for strict networks.
  const { ice_servers } = (await res.json()) as { ice_servers: TwilioIceServer[] };
  const iceServers = ice_servers.map((s) => ({
    urls: s.urls ?? s.url!,
    ...(s.username ? { username: s.username, credential: s.credential } : {}),
  }));
  return json({ iceServers, ttl: TTL_SECONDS });
}

export function GET(request: Request): Promise<Response> {
  return handleTurn(request, process.env);
}
