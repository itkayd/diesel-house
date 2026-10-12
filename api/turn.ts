// Vercel function. Phase 4 fills this in: verify the Supabase user, then fetch
// ICE servers from Twilio's Tokens endpoint using server-side env vars only.
export function GET(): Response {
  return Response.json({ error: 'not implemented' }, { status: 501 });
}
