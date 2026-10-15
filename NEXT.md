# NEXT.md — Review + revised plan (15 Oct 2026)

Read this together with `CLAUDE.md`. Where the two disagree, **this file wins** (it's newer). Same working rules as before: one phase at a time, pass its "Done when" test, commit and push, stop, give the user a short "how to test" list in plain English with Windows commands.

---

## 1. Where the project stands

| Phase | Status | Notes |
|---|---|---|
| 0 Setup | Done | Builds clean: `tsc` passes, `vite build` passes |
| 1 House | **Partly done** | Layout, walls, zones, camera work. **No furniture**, and 4 floors render wrong (see 3.4) |
| 2 Characters | Done | 20 characters (16 chibis + 4 LimeZu), joystick, mouse-hold walking, picker |
| 3 Presence | Done | Broadcast positions, clock-offset interpolation, stale hiding — good work |
| 4 Voice | Done | Mesh per room, TURN retry, hello/maintain safety net, PTT, speaking glow — good work |
| 5–8 | Not started | Revised below |

Live Supabase check (15 Oct): 1 email on the allowlist, 0 profiles, 0 room owners, **0 Realtime access policies**. Security advisor shows only two expected notices (`allowed_emails` has no policies on purpose; `is_member()` is callable on purpose).

---

## 2. Order of work

1. **Phase 4.5 — Fixes** (section 3). Small, do first.
2. **Phase 4.6 — Visual pass** (section 4). Makes the house feel like the login screen.
3. **Phase 5 — Accounts** (revised, section 5). Includes locking down Realtime.
4. **Phase 6 — Doors, knocks, sounds** (revised).
5. **Phase 7 — Room chat** (revised).
6. **Phase 8 — Deploy** (revised).

---

## 3. Phase 4.5 — Fixes

### 3.1 Cut Realtime message use (budget risk — most important)
Supabase Free = **2 million Realtime messages per month**, and a broadcast counts **1 for the send + 1 per person who receives it**.
Today a moving player sends ~10 positions/second. Rough month: 4 friends online 3 h a night, walking 15% of the time → about 6 sends/s × 4 = 24 msgs/s → **~7–8 million/month**. That blows the free tier.

Change movement to **event-based + dead reckoning**:
- Send a `move` message only when input changes: start, stop, or direction/velocity changes (include `x, y, vx, vy, dir, t`).
- While moving in a straight line, send a correction at most every **500 ms**.
- On stop, send the final position once.
- Receivers extrapolate from the last `x,y,vx,vy` and glide to corrections (keep the existing clock-offset idea; snap if error > 24 px, otherwise ease over ~150 ms).
- Joystick: quantise the vector to 8 directions × 2 speeds before deciding "input changed", or analog jitter will spam messages.
- Keep the 5 s idle heartbeat but raise it to **15 s**; presence already tells us who's online.
- Add a dev-only counter (`window.__house.msgStats`) of messages sent/received per minute, and a test that a 10 s straight walk sends ≤ 25 messages.

**Done when:** remote movement still looks smooth with 200 ms added latency (Chrome DevTools throttling), and the counter shows ≥ 4× fewer messages than before for the same walk.

### 3.2 iPhone audio unlock
`voice.join()` calls `AudioContext.resume()` from a timer, not a tap. iOS Safari keeps the context suspended, so speaking glows die and remote `<audio>` can stay silent.
- On the first `pointerdown`/`keydown` anywhere, create/resume the AudioContext and play a silent buffer.
- If voice joins while audio is still locked, show a one-tap banner: "Tap to turn on sound".
- Mic permission: show a short explainer card the first time someone enters a room ("Diesel House needs your mic to talk in rooms") before calling `getUserMedia`.

**Done when:** on an iPhone, entering a room after only using the joystick still plays other people's voices.

### 3.3 Voice quality tweaks (cheap wins)
- Munge Opus in the SDP: `useinbandfec=1; usedtx=1; maxaveragebitrate=32000; stereo=0`. DTX cuts bandwidth when quiet; FEC helps Middle East / mobile links.
- Per-person volume: tap a speaking character → small popover with a volume slider (store per person in `localStorage`).
- Mic picker in a settings sheet (`enumerateDevices`), remembered per device.
- When the Supabase socket reconnects, re-subscribe the room channel and send a fresh `hello` (today a dropped socket leaves voice half-alive until `maintain()` catches it).

### 3.4 Floor tile bug
In `scripts/build-map.mjs` the "flat" floors (`grey 198`, `rose 99`, `mauve 133`, `stone 167`, `slate 201`) all render as the same flat taupe/grey — rooms 2, 4, 6, 8 look identical. The indices point at the wrong blocks.
- Render `limezu_room_builder.png` with tile numbers overlaid (save as `design/tileset-index.png`), pick the right blocks, fix the table.
- Give each of the 8 rooms a clearly different floor + wall pair.

### 3.5 Small things
- Bundle is > 500 kB: lazy-load the voice module and Supabase client after the picker (`import()`), not a blocker.
- Remove leftover blank line at end of `Presence` class; `pagehide` should also `untrack()` presence.
- Free-tier Supabase pauses after a week with no activity. Add a Vercel Cron (`vercel.json`, daily) hitting `/api/ping` that runs a trivial read. Free.

---

## 4. Phase 4.6 — Visual pass

**Visual target: `design/game/mvp.html`** (open it in a browser). It's a playable mock built from the real sprites, with `theme.css` (copy to `src/ui/theme.css`), `sprites.json` + `furniture_atlas.png` (furniture rects), and the room furniture recipes in `build_mvp.py`. Match it; where it differs from the text below, the mock wins on looks.

The login screen (`design/login/login.html`) is cosy and pixel-styled; the game itself is bare floors with `system-ui` labels and emoji dots. Make the game match the login.

### 4.1 Design tokens (copy from the login design — single source of truth)
Create `src/ui/theme.css` and load it in `index.html`. Replace every inline colour/font in `src/ui/*` with these.
```
--night: #140f1c;  --panel: #2b2034;  --panel-edge: #0d0912;
--wood: #7a4b31;   --lamp: #f4b860;   --lamp-deep: #c9822f;
--cream: #fff4e0;  --muted: #bcaccb;  --error: #ff8f7a;
--ok: #6fdc8c;
--font-display: "Pixelify Sans", "Courier New", monospace;   (titles, buttons, room names)
--font-body: "Atkinson Hyperlegible", system-ui, sans-serif;   (chat, small text)
--radius: 6px; --border: 2px solid var(--panel-edge);
--shadow: 0 2px 0 var(--panel-edge), inset 0 1px 0 rgba(255,255,255,.08);
```
- Self-host the two fonts in `public/assets/fonts/` (woff2) so there's no Google Fonts call. Phaser text uses the same families; wait for `document.fonts.ready` before creating text.
- Panels: `--panel` background, 2 px dark edge, small radius — "pixel card" look, no glassy blur.
- Page background `--night` instead of `#1b1b24`.

### 4.2 The house
- **Furnish all 8 rooms and the hallway** (finish Phase 1). Put furniture in a new `furniture` tile layer (+ `furniture_top` drawn above players for things you walk behind, e.g. plant tops, lamp heads). Collision on the solid parts only. Load `limezu_interiors.png` (and Kenney as backup) in `PreloadScene`.
  - Each room gets a starter theme matching the mood list: gaming (desk, monitor, beanbag), music (speakers, records), study (bookshelf, desk lamp), chill (sofa, rug, plant), deep talk (two armchairs, coffee table, fireplace if available), D&D (round table, chairs), plus two "blank" rooms with a bed and rug.
  - Hallway: front door at the spawn end, rug runner down the middle, plants, a shoe rack, wall pictures between doors.
- **Doors**: draw an actual door sprite in each doorway (closed / ajar). Phase 6 adds states; for now show them open.
- **Lighting / mood**: a dark `--night` multiply overlay on the whole map at ~25%, with soft warm light pools (`--lamp`, additive, low alpha) on lamps and doorways. Rooms with people inside get slightly brighter — you can "see" which rooms are lively from the hallway.
- **Room nameplates** above each door (pixel sign, `--font-display`), not text floating in the middle of the floor. Until Phase 5 show "Room 1…8".
- **Occupancy on the door**: little head icons (up to 4, then "+3") on each nameplate showing who's inside. This is the key hallway feature from `CONCEPT.md` ("see who is in which room").
- **Name tags**: pixel font, `--panel` pill with 1 px edge, cream text; hide your own tag (optional setting).
- **Speaking glow**: replace the flat green ellipse with a soft pulsing ring (2-frame or tweened scale), colour `--ok`.
- Small walking dust puff and a footstep tick sound (quiet) — optional.

### 4.3 HUD layout (phone first)
```
┌──────────────────────────────────────┐
│ [Room name · 3 here]      [⚙] [👤]   │  top bar: where you are + count; settings; profile/character
│                                      │
│              (game)                  │
│                                      │
│ (joystick)          [chat]  [ MIC ]  │  bottom: joystick left; chat + mic right (mic biggest)
└──────────────────────────────────────┘
```
- Merge the zone badge and the "3 in the house" badge into one top-left pill.
- "Change character" moves into the profile button (sheet with name + character + mic picker + PTT toggle + sign out later).
- Voice status becomes a small dot on the mic button (green connected / amber connecting / red blocked) with detail on long-press, instead of the text line.
- Push-to-talk toggle moves into settings; mic button stays.
- Use `lucide` icons everywhere; no emoji in the HUD.
- All tap targets ≥ 44 px; respect safe areas (already done — keep it).

### 4.4 Character picker
- Restyle as a pixel card matching the login card.
- Show the 20 characters in a grid with a gentle idle animation on the selected one, and a "Done" button instead of "tap a character to finish" (today, tapping a face immediately closes the picker — easy to mis-tap).
- Name field first, character second, then Done.

**Done when (4.6):** side-by-side screenshots of the login screen and the hallway look like the same app; every room has furniture and a different floor; you can tell from the hallway which rooms have people in them; tests still pass.

---

## 5. Phase 5 — Accounts and room ownership (revised)

Everything in `CLAUDE.md` Phase 5 still applies (magic link, port `design/login/login.html` exactly into `src/ui/login.ts`, guest-list message). Additions:

### 5.1 Identity
- Use `auth.uid()` as the player id everywhere: presence key, voice peer id, `PosMsg.id`. Remove `crypto.randomUUID()` in `Presence`.
- Same person in two tabs/devices: presence key stays the user id; treat the newest connection as "the" player and show a toast in the older tab: "You opened Diesel House somewhere else" (then disconnect its voice).
- On first sign-in, upsert `profiles` (display_name + character_index from the picker / local prefs). Move name + character out of `localStorage` into `profiles`; keep localStorage only as a cache.
- Admin note for the user: only **1** email is on the guest list right now. Give him the SQL to add the other 7 (or a tiny admin page later).

### 5.2 Lock down Realtime (security — must do in this phase)
There are **no Realtime policies**, so anyone with the publishable key (it's in the repo and the browser bundle) can join `house` and `voice:room_xx`, watch positions, and send fake voice signals. Fix with Realtime Authorization:
- New migration `supabase/migrations/2026xxxx_realtime_auth.sql`: policies on `realtime.messages` for `authenticated`:
  - `select` (receive) and `insert` (send) on topic `house` for broadcast + presence when `public.is_member()`.
  - `voice:room_XX` topics: members only, **and** not blocked by the door (see 6.2).
- Client: create every channel with `{ config: { private: true, ... } }` and call `supabase.realtime.setAuth()` after login and on token refresh.
- Tell the user to switch off **"Allow public access"** in Supabase → Realtime settings once the policies are live (Claude in claude.ai can apply the migration).
- Verify the voice signalling payloads are only accepted from senders whose `from` equals their real user id (receivers can check against presence keys).

### 5.3 Rooms
- Owners assigned by admin (unchanged). Room nameplate shows `rooms.name` or "<owner name>'s room".
- Owner settings sheet: room name, mood, door state (door state wired in Phase 6).
- Subscribe to `rooms` changes so renames/moods update live for everyone.

**Done when:** each friend logs in, sees their own room labelled; a browser with only the publishable key and no login cannot receive `house` broadcasts (add an e2e test for this).

---

## 6. Phase 6 — Doors, knocks, sounds (revised)

As in `CLAUDE.md`, plus:

### 6.1 New table (migration)
```
room_passes (room_id text references rooms, user_id uuid references profiles,
             granted_at timestamptz default now(), expires_at timestamptz,
             primary key (room_id, user_id))
```
RLS: members read; only the room owner inserts/deletes rows for their room. Passes expire after 12 h (or when the owner clears them).

### 6.2 Server-enforced doors
- Realtime policy for `voice:room_XX`: allowed if `door_state = 'open'`, or caller is the owner, or caller has a live `room_passes` row. So a locked/knock room can't be listened to by poking the API — not just blocked by the client.
- Client also blocks movement through a locked door for non-owners (collision body on the door tile).

### 6.3 Knock flow
- Walking into a knock-door sends a `knock` broadcast on `house` to the owner (rate-limit: 1 per 10 s per visitor).
- Owner: toast with the visitor's face + name, knock sound, buttons **Let in** / **Not now**. Let in → insert `room_passes` row → visitor gets "Come in!" toast + door_open sound and can walk in.
- If the owner isn't online, the visitor sees "Nobody's home".
- **Remove guest**: owner taps a guest → "Remove" deletes their pass and broadcasts `kick`; the guest is moved to just outside the door in the hallway and their voice leaves.

### 6.4 Sounds
- Load `knock`, `doorbell`, `door_open`, `join`, `leave` from `public/assets/sfx/` (folder is **empty** right now — tell the user to ask Claude in claude.ai to generate them with ElevenLabs; skip silently until they exist).
- Play `join`/`leave` only for people entering/leaving **your** room, quietly.
- Master volume + "sound effects on/off" in settings.

### 6.5 Mood badge
Pixel badge on the nameplate (lucide icon + colour per mood). Owner changes it from the settings sheet.

---

## 7. Phase 7 — Room chat (revised)

As in `CLAUDE.md`, plus:
- Chat opens as a **bottom sheet** on phones (half height, drag up to full), a right-side panel on desktop. Hidden in the hallway.
- Unread dot on the chat button while you're in the room.
- Messages: author face (character portrait) + name + local time; group consecutive messages from the same person.
- Long-press (phone) / hover (desktop) → reaction bar with 6 OpenMoji (👍 😂 🔥 ❤️ 😮 👀) and "delete" on your own messages.
- Late joiners get the last 100 messages (index already exists).
- Typing in chat must never move the character (keys already aren't captured — keep it that way and add a test).
- Optional: speech bubble above a character for 4 s when they send a short message (< 40 chars) — fun in the house view.

---

## 8. Phase 8 — Deploy (revised)

As in `CLAUDE.md`, plus:
- Env vars on Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `TWILIO_ACCOUNT_SID`, and prefer a **Twilio API key** (`TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`) over the main auth token; update `api/turn.ts` to use it if set.
- `vercel.json`: daily cron for `/api/ping` (3.5), security headers, `Permissions-Policy: microphone=(self)`.
- PWA basics: `manifest.webmanifest`, icon, "Add to Home Screen" so it opens full-screen on phones.
- Credits screen from `ASSETS.md` (reachable from settings).
- Final test with a friend abroad on mobile data (Middle East or US), as `CLAUDE.md` says.

---

## 9. Later (ask the user first)
Muffled voice just outside a door, decorating rooms, shared living room, "3 people are in X's room" push notifications, Capacitor phone app.

## 10. Do not
- Change the stack, add paid services, or add a media server.
- Add live captions / speech recognition.
- Make the repo public.
