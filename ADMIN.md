# ADMIN.md: the admin page, device logs and score checking (22 Oct 2026)

## The admin page (`/admin.html`, `src/admin/`)
- **First time:** pick a username and password (12+ characters) and type the setup passcode (`ADMIN_PASSCODE`
  in Vercel). After that the passcode does nothing; admins sign in with username + password.
- **Security:** two locks. Every `admin_*` database function can only be called by the server
  (`api/admin.ts`, service role); each one checks the session token first. The token lives in an
  HttpOnly, Secure, SameSite=Strict `__Host-` cookie (scripts can't read it), lasts 8 hours, only its
  SHA-256 is stored. 5 wrong passwords lock a username for 15 minutes (10 per network). Requests from
  other sites are refused. Every change goes in the audit log with who made it.
- **Sections:** Dashboard · Players (any level/XP, coins, gems, streak, pet, ban, password, remove,
  history) · Player reports (from Report in the tap-a-friend menu: why, their last chat lines, Ban) ·
  Invites & guests · Rooms · House switches (games, Night Raid, animals per room, pets,
  critters, announcement) · Critters & challenges · Games & scores · Device logs · Admins & audit.
- **House switches** are read live by the game (`src/net/houseSettings.ts`) and enforced by the database
  (`20261114_house_switches.sql`).
- **Trying it locally:** `supabase/tests/run.sh`, then
  `DH_LOCAL_DB=1 ADMIN_PASSCODE=local-setup-123 npx vite --port 5173` and open `/admin.html`
  (the server functions use the local test database). Tests: `tests/api/*.mjs`, `tests/e2e/admin.mjs`.

## Device logs (`src/net/errors.ts`)
Crashes, things the game fixed by itself (warnings), features that failed (problems) and players' own
"Report a problem" (Settings → More). Each carries the device, game facts and the last 40 steps.
On the admin page: open one, "Copy for fixing", paste it to Claude.

## Night Raid scores: proven by replay, no limits
`arcade_start` gives a seed; the game steps 60 times a second and records moves (`RunLog`);
`api/arcade.ts` replays the run with the same engine (`src/games/nightRaidGame.ts`, no `Math.sin`
etc., so every engine agrees) and saves the score it gets via `arcade_record`. Rejected: a different
score, steps or ending; faster than real time; someone else's or a reused run. Listed under
Games & scores. Never add a score cap; keep the engine deterministic (no `Math.random`, no
`Math.sin/cos/exp…`, fixed `TICK`), or old replays stop matching.

## Needs a person (Supabase asks before anything with a delete)
- `supabase/manual/admin_cleanup.sql`: paste into Supabase → SQL Editor → Run.
- `supabase/migrations/20261102_drop_room_owners.sql`: same.
- Supabase → Authentication → Password security: switch on **leaked password protection**.
