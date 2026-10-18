# BUGS.md — bug list (REDESIGN.md Phase R0, 18 Oct 2026)

Each bug has steps to reproduce, a severity and the phase that owns it. **R0 fixes the crashers and the
"have to reload" bugs**; the rest wait for their phase. Add new ones at the bottom with the next number.

Severity: **High** = freezes, loses data or locks someone out · **Medium** = something visibly wrong or
broken, with a workaround · **Low** = rough edge.

## Where this list came from
- **Supabase logs (last 24 h):** no Postgres errors, no Realtime errors. 56 failed calls (404) to
  `record_events`, `catch_critter`, `weekly_board`, `catch_board` and `/catches`, all between 19:32 and
  20:53 on 17 Oct, before those database changes were applied. None since: fixed.
- **Supabase advisors:** only the warnings we expect (security-definer functions callable by signed-in
  users, on purpose; anonymous sign-in is used for guests). See #11, #12.
- **Vercel runtime errors (7 days):** none.
- **Automated checks:** 41 checks in the 6 tests that run without the live house all pass
  (`resilience`, `table-games-local`, `critters`, `progress`, `whos-where`, `voice-volume`). The other
  30 test files sign in to the real house and use Edge, so they only run on Diesel's laptop (#10).
- **Diesel and friends:** _still to collect._ Send rough notes (what you did, what happened, which phone).

## Fixed in R0
| # | Bug | Severity | Steps to reproduce (before) | Fix |
|---|---|---|---|---|
| 1 | **The whole game froze** after any error in a single frame (e.g. a bad network message, or an effect on a sprite that was just removed). Only a reload helped. | High | Any error thrown while drawing a frame. `tests/e2e/resilience.mjs` forces one: before the fix the game stopped at frame 6 and you couldn't move. | `src/main.ts` `keepLooping`: a frame with an error is skipped and logged once; the next frame runs as normal. Test: `resilience.mjs`. |
| 2 | **Sign out could get stuck** on a weak connection: the button did nothing and the page never reloaded. | Medium | Settings → Sign out with the phone offline. | `HouseScene` sign-out: the button disables and the page always reloads, even if signing out fails. |
| 3 | **A weak signal at start-up signed you out** and said "That account isn't part of this house any more". The membership check failed, and a failure was read as "no". | High | Open the site on bad 4G / lift Wi-Fi so the `is_member` call fails. | `net/auth.ts` `hasAccess` returns "unknown" on a network or server error. `main.ts` keeps trying (1, 2, 4, 8 s…) with "Can't reach the house… trying again" on screen, and only signs out on a real "no". |

## Fixed in R1
| # | Bug | Severity | Fix |
|---|---|---|---|
| 4 | **Phones kept old pictures for up to a day** after an update (Vercel cached all of `/assets/*` for 24 h; this caused the wrong Visitor medal). | Medium | `vercel.json`: Vite's own files (with a fingerprint in the name) are cached for a year; pictures and sounds in `/assets/<folder>/` are checked again on each visit (a tiny "not changed" reply when they haven't). |
| 5 | **Big download:** `main.js` was 1.46 MB (401 kB zipped); `voice.ts` couldn't load separately. | Medium | The login screen's file is now about 6 kB zipped. The game (`src/game.ts`) downloads while you sign in; Phaser is in a file of its own that phones keep between updates; voice, the games and chat load after the picker. |
| 6 | **`HouseScene.ts` was about 1,700 lines.** | Medium (risk) | Split into `src/house/*.ts` (one file per part, none over about 240 lines), moved word for word. The scene file is now about 200 lines. |
| 7 | **Rooms were hard-coded** (`room_01..08`) in the code, the map builder, a database check and every Realtime rule. | Medium | `src/house/rooms.ts` lists the rooms; the map builder, zones, door signs, voice, chat and games all read it. Database: any short room id, channel access looks the room up in `rooms` (`20261030_shared_rooms.sql`). Checked by adding a test room (with a diagonal wall) in `rooms.ts` alone: it had walls, a door, its name, voice, chat, the map and a games spot. |
| 8 | **Zones were rectangles.** | Medium | Polygons in `rooms.ts`, looked up per tile (`src/house/zones.ts`). |
| 14 | **Diesel's laptop copy was behind GitHub** with old Phase 13 drafts. | Medium | Diesel stashed the drafts (`git stash list` to see them) and pulled. |
| 13 | **No way to see errors on friends' phones.** | Medium | `src/net/errors.ts` sends uncaught errors and skipped frames to the `client_errors` table (each message once per visit, at most 20 an hour each). Diesel: Supabase dashboard → Table Editor → `client_errors`. |

## Open
| # | Bug | Severity | Steps to reproduce | Phase |
|---|---|---|---|---|
| 9 | **Daily progress rows are never tidied.** `tidy_progress(date)` (in `20261027_challenges_xp.sql`) was not applied to the live database because the connector can't run deletes. Tables grow slowly; nothing breaks. | Low | `select count(*) from challenge_progress;` grows every day. | Diesel applies it in claude.ai (it asks to confirm the delete) |
| 10 | **Most automated tests can't run in the cloud.** 30 of 36 test files sign in to the real house, and most hard-code Edge. | Low (process) | Run `tests/e2e/run-all.mjs` in a Claude Code cloud session. | R1 (every test takes `DH_CHROMIUM`; split "offline" and "live" tests) |
| 11 | **Old `catches` table** is no longer used (catches moved to `critter_catches`) but is still there, with an unindexed foreign key. | Low | Supabase performance advisor. | Later migration (drop it; tell Diesel first) |
| 12 | **Leaked-password protection is off** in Supabase Auth. Members sign in with a name and password, so this is worth switching on. | Low | Supabase security advisor. | Diesel: Supabase dashboard → Authentication → Passwords |
| 15 | **Old owner leftovers in the database** (`rooms.owner_id`, `door_state`, `mood`, the `room_passes` table and the "owner updates own room" rule). Nothing uses them since R1; kept one release so older copies of the game don't break. | Low | Supabase table editor. | After R3, a migration drops them (ask Diesel first) |

