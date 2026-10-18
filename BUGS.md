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

## Open
| # | Bug | Severity | Steps to reproduce | Phase |
|---|---|---|---|---|
| 4 | **Phones keep old pictures for up to a day** after an update. Vercel caches `/assets/*` for 24 h and most picture files keep the same name, so a changed sheet shows the old one with the new layout (this caused the wrong Visitor medal). Medals are fixed with `?v=`; the rest aren't. | Medium | Change a sheet in `public/assets/`, deploy, open on a phone that visited the day before. | R1 (give every picture a version or a hashed name, from the manifest) |
| 5 | **Big download:** `main.js` is 1.46 MB (401 kB zipped). Vite warns that `voice.ts` is imported both statically (`ui/voiceSettings.ts`) and lazily, so lazy loading does nothing. Slower first load on 4G. | Medium | `npm run build` and read the size and warning. | R1 (target < 250 kB zipped) |
| 6 | **`HouseScene.ts` is about 1,700 lines.** Every feature touches it, so a fix in one place often breaks another. | Medium (risk) | — | R1 (split into `house/*` modules, no behaviour change) |
| 7 | **Rooms are hard-coded** as `room_01..08` in `config.ts`, the map builder, a database check and every Realtime policy regex. The new themed rooms can't be added cleanly. | Medium (blocks R3) | — | R1 (rooms as data, new migration) |
| 8 | **Zones are rectangles**, so the octagon house's diagonal rooms can't be described. | Medium (blocks R3) | — | R1 (polygon zones + lookup grid) |
| 9 | **Daily progress rows are never tidied.** `tidy_progress(date)` (in `20261027_challenges_xp.sql`) was not applied to the live database because the connector can't run deletes. Tables grow slowly; nothing breaks. | Low | `select count(*) from challenge_progress;` grows every day. | Diesel applies it in claude.ai (it asks to confirm the delete) |
| 10 | **Most automated tests can't run in the cloud.** 30 of 36 test files sign in to the real house, and most hard-code Edge. | Low (process) | Run `tests/e2e/run-all.mjs` in a Claude Code cloud session. | R1 (every test takes `DH_CHROMIUM`; split "offline" and "live" tests) |
| 11 | **Old `catches` table** is no longer used (catches moved to `critter_catches`) but is still there, with an unindexed foreign key. | Low | Supabase performance advisor. | Later migration (drop it; tell Diesel first) |
| 12 | **Leaked-password protection is off** in Supabase Auth. Members sign in with a name and password, so this is worth switching on. | Low | Supabase security advisor. | Diesel: Supabase dashboard → Authentication → Passwords |
| 13 | **No way to see errors on friends' phones.** If something breaks on someone's phone, nobody finds out unless they tell Diesel. | Medium | — | R1 (`client_errors` table + small error catcher) |
| 14 | **Diesel's laptop copy is behind GitHub** and has old, unsaved Phase 13 drafts (`src/games/four.ts`, `higherLower.ts`, `prompts.json`, `20261026_room_prompts.sql`, an edit to `table.ts`). These were replaced by what's on GitHub. | Medium (confusing) | `git status` in `%USERPROFILE%\diesel-house`. | R0, Diesel (see below) |

### #14: bring the laptop up to date (Windows PowerShell)
Only after Diesel says the old drafts can go. `stash` keeps a copy you can get back later.
```powershell
cd $env:USERPROFILE\diesel-house
git stash push -u -m "old Phase 13 drafts"
git pull
```
To get the drafts back later: `git stash list`, then `git stash apply stash@{0}`.
