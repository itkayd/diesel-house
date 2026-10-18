# CLAUDE.md — Diesel House build brief

**Read `FIXES.md` first (do it before anything else)**, then `NEXT.md`, then **`UPDATE.md`**, **`LEVELS.md`** and **`REDESIGN.md`** (v3 redesign: octagon house, Disco/Library/Lounge, skins, animals — read it last, it wins on layout and look; look decided: 16 px "A" now, isometric "C" is the end goal, so follow its **iso-ready rules**, §5) (v2: hallway whisper + walkie-talkie, mini-games, challenges — Phases 9–14). Newer files win where they differ. Open bugs and their owning phase: **`BUGS.md`**. **Going public and paid (18 Oct 2026):** read **`LICENSES.md`** (only commercial-safe assets may ship), **`STORE.md`** (coins, gems, buyable characters, Diesel+, Season Pass, server-authoritative economy) and **`design/review/UI-REVIEW.md`** + `design/store/store.html` (store UI target). They win on anything about money, licences or the store.

**Visual target for v2 (Phases 9–14 and FIXES 4–6): `design/game/v2.html`** — open it in a browser, log in with `admin` / `admin`. It shows the agreed UX: XP chip under the zone pill, map/challenges/settings buttons, walkie button (hold or T) in the hallway, purple whisper circle, emote picker, tap-a-friend menu, games table (west end of the hallway) and noticeboard, Dice / RPS / Quick Draw, challenges sheet, level-up overlay, profile with guest code + badges, Sound / Mic / Room settings tabs, mic help states, "Reconnecting…" pill, first-run tips, and "Who's where" map with tap-to-walk. Source: `design/game/v2.template.html`; cropped sprites in `design/game/v2-img/` (medals atlas = 12 × 48 px in `BADGES` order, dice strip = 7 × 32 px: faces 1–6 then ?, Kenney emotes sheet = 16 px cells, coordinates in the `EMO` table). Sounds in the mock are synthesized; use the real packs per FIXES #7. The NPCs and `admin/admin` login are mock-only — do not ship them.

Read `CONCEPT.md` and `ASSETS.md` before starting. Build in phases. Finish one phase, confirm its "Done when" test passes, commit and push, then stop and tell the user what to test before starting the next phase.

The user is on **Windows** (PowerShell). Give Windows commands.

---

## Stack (locked — do not change without asking)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript | One language front to back |
| Build tool | Vite | |
| 2D engine | Phaser 3 | Tilemaps, sprites, camera, input |
| Map editor | Tiled (`.tmj` JSON export), or generate the map in code | |
| UI overlay | Plain HTML/CSS over the canvas (no React unless needed) | Chat, buttons, toasts |
| Backend | **Supabase** (free tier): Auth, Postgres, Realtime | Logins, rooms, chat, presence, voice signalling |
| Voice | WebRTC peer-to-peer mesh per room (max 8 people) | No media server |
| Signalling | Supabase Realtime broadcast channels | |
| NAT traversal | Google public STUN + **Twilio Network Traversal Service (TURN)** | See "Twilio TURN" below |
| Server code | **Vercel serverless functions** (`/api/*`) only | Used to keep secrets server-side (Twilio token) |
| Hosting | **Vercel** (free tier) | Auto-deploy from the GitHub repo |
| Sound effects | **ElevenLabs** (generated once, saved as files) | Knock, doorbell, join/leave, door open. Claude in claude.ai generates these; just load them from `public/assets/sfx/` |
| Icons / emoji | `lucide`, OpenMoji | See ASSETS.md |

**No live captions.** The user decided against them. Do not add speech recognition.

Do **not** add other paid services, a long-running server or a media server (LiveKit etc.) without asking the user.

### Supabase — ALREADY SET UP (do not create a new project or recreate tables)
- Project: `diesel-house`, ref `adnpeaytzgelqxuvpdyf`, region London (eu-west-2)
- URL: `https://adnpeaytzgelqxuvpdyf.supabase.co`
- Publishable key (safe for the browser): `sb_publishable_Nc4Gqi7dfIN4TqFyNHxFpA_vYzgQjW7`
- Schema is live — see `supabase/migrations/20261012_initial_schema.sql`:
  - `allowed_emails` (invite list, admin-only) + `is_member()` helper
  - `profiles` (display_name, character_index 0–19, colour)
  - `rooms` (room_01…room_08 seeded; owner_id, name, door_state open|knock|locked, mood)
  - `messages` (room chat) and `reactions`
  - RLS on everything; `rooms`, `messages`, `reactions` are in the realtime publication
- Positions and voice signalling use **Realtime broadcast/presence channels**, not tables.
- Any schema change → new migration file in `supabase/migrations/` and tell the user; Claude in claude.ai applies it.

### Friends are worldwide (UK, Middle East, USA)
- Voice is peer-to-peer, so audio goes directly between friends; distance adds some delay but no server hop.
- Twilio TURN: use the `global` edge URLs Twilio returns (they route to the nearest region). Keep all TURN URLs Twilio returns, **including TURN over TCP/TLS on port 443**. Some Middle East networks restrict VoIP/UDP, and 443 TLS is the route most likely to get through.
- Set `iceTransportPolicy: 'all'`; if a connection fails within 10 s, retry once with `iceTransportPolicy: 'relay'` (forces TURN).
- Supabase is in London. Signalling and position updates from the US/Middle East add about 100–200 ms; interpolate positions smoothly so movement doesn't look jumpy.
- Show times (chat timestamps, "last seen") in each viewer's **local time zone**; store everything in UTC.
- Test Phase 4 with at least one friend abroad, not just two devices on the same Wi-Fi.

### Twilio TURN
- Create `api/turn.ts` (Vercel function) that calls Twilio's Tokens endpoint (`POST /2010-04-01/Accounts/{SID}/Tokens.json`) with `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` (or an API key) and returns `ice_servers`.
- Require a logged-in Supabase user (check the access token) before returning credentials.
- The client fetches `/api/turn` before creating peer connections and passes the result as `iceServers`.
- Twilio secrets are **server-side env vars only** (no `VITE_` prefix). Never expose them to the browser.

---

## Rules
- Repo is **private** (`itkayd/diesel-house`). Never make it public (asset licences).
- Never commit `.env`. Provide `.env.example` with variable names only.
- Raw zips stay out of git (`assets/raw/*.zip` is in `.gitignore`). Extracted, used assets are committed under `public/assets/`.
- Keep the user informed in plain English. They are not a full-time developer. After each phase, give a short "how to test" list.
- Mobile-first: everything must work in a phone browser (touch controls) as well as desktop (WASD/arrow keys).

### Env vars (`.env.example`)
```
VITE_SUPABASE_URL=https://adnpeaytzgelqxuvpdyf.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_Nc4Gqi7dfIN4TqFyNHxFpA_vYzgQjW7
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Phase 0 — Set up the project folder

1. Find these three zips in the user's **Downloads** folder (`%USERPROFILE%\Downloads`) and copy them into `assets/raw/`:
   - `Modern_Interiors_Free_v2.2.zip`
   - `alliance_chibis_character_collection.zip`
   - `kenney_roguelike-indoors.zip`
   If any is missing, tell the user which one and the link from `ASSETS.md`.
2. Unzip each into `assets/raw/<pack-name>/`.
3. Check Node.js is installed (`node -v`, needs 20+). If not, tell the user to install the LTS from nodejs.org and stop.
4. Scaffold Vite + TypeScript + Phaser 3 in the repo root.
5. Create this structure:
   ```
   src/
     scenes/      PreloadScene.ts, HouseScene.ts
     net/         supabase.ts, presence.ts, voice.ts
     ui/          overlay.ts, chat.ts, toasts.ts
     config.ts
   api/           turn.ts (stub for now)
   public/assets/
     tiles/  characters/  furniture/  ui/  sfx/
   maps/        house.tmj
   assets/raw/  (gitignored zips + extracted packs)
   ```
6. Copy the tilesets and character sheets the game needs from `assets/raw/` into `public/assets/`.
7. Write `assets/manifest.json` listing every asset used: key, path, frame size, source pack.

**Done when:** `npm run dev` opens a blank Phaser canvas, and the asset folders are populated.

---

## Phase 1 — The house
- Build `maps/house.tmj` (or generate it in code): a central hallway with 8 equal rooms, 4 above and 4 below, each with one door onto the hallway. Use LimeZu floors and walls; furnish with LimeZu first, Kenney second.
- Object layer with rectangles named `hallway`, `room_01` … `room_08`, and `spawn`.
- Collision on walls.
- Camera follows the player and fits nicely on phone and desktop.

**Done when:** the house renders, rooms are clearly separate, and walls block movement.

---

## Phase 2 — Characters and movement
- Use the finalbossblues chibis (16×32 frames, 4-direction walk). Slice the sheet into walk-up/down/left/right and idle.
- Controls: WASD/arrows on desktop, on-screen joystick or tap-to-walk on mobile.
- Character picker on first launch (16 options).

**Done when:** you can pick a character and walk around the house with correct animations.

---

## Phase 3 — Supabase + multiplayer presence
- Supabase is already set up (see above). Copy `.env.example` to `.env`; the URL and publishable key are already filled in.
- Broadcast position about 10 times a second over Supabase Realtime; interpolate other players smoothly.
- Name tag above each character.
- Track which zone each player is in (hallway / room_XX).

**Done when:** two browsers see each other move in real time.

---

## Phase 4 — Voice zones (the core feature)
- Each room = its own WebRTC mesh. Entering a room zone joins it; leaving closes all peer connections for that room.
- Hallway = no audio.
- Signalling over a Supabase Realtime channel per room.
- ICE servers: Google STUN + Twilio TURN from `/api/turn` (see above). Fall back to STUN-only if `/api/turn` fails, and log it.
- Audio constraints: `echoCancellation`, `noiseSuppression`, `autoGainControl` all on. Opus.
- Mic permission prompt on first room entry, mute button, push-to-talk option.
- "Speaking" glow under a character when their audio level passes a threshold.

**Done when:** two people in the same room hear each other; one steps into the hallway and the audio stops within a second; it works on a phone on 4G.

---

## Phase 5 — Accounts and room ownership
- Supabase Auth (magic-link email). Invite-only: allowlist of 8 emails in a table.
- **Login screen is already designed: `design/login/login.html`.** Match it exactly (pixel living room at night drawn on a canvas from `public/assets/ui/login_scene.png`, two LimeZu characters idling, flickering fireplace and fairy lights, door glows when you knock, "Knock on the door" card). Port it into `src/ui/login.ts` as the HTML overlay shown before the Phaser game when there's no session. Keep its copy, fonts (Pixelify Sans + Atkinson Hyperlegible) and colours. `design/login/build_scene.py` regenerates the scene PNG.
- If a signed-in user's email is not on the allowlist (`is_member()` returns false), sign them out and show: "That email isn't on the guest list. Ask Diesel to add you."
- `rooms` table: `id (room_01..08)`, `owner_id`, `door_state (open|knock|locked)`, `mood`, `name`.
- Row-level security: only the owner can change their room.
- Settings screen for the owner to name their room.

**Done when:** each friend logs in and sees their own room labelled with their name.

---

## Phase 6 — Doors and sounds
- Door sprite shows its state.
- Locked: the door blocks movement for non-owners.
- Knock: walking into the door sends a knock to the owner (toast and knock sound); the owner taps Let in or Ignore.
- Owner can remove a guest (they're moved to the hallway).
- Mood badge shown above the door.
- Play sound effects from `public/assets/sfx/` (if present): `knock`, `doorbell`, `door_open`, `join`, `leave`. Skip silently if a file is missing.

**Done when:** all three door states behave correctly between two accounts, with sounds.

---

## Phase 7 — Room chat and reactions
- Each room has its own text chat panel, visible only to people inside that room.
- `messages` table: `room_id, author_id, text, created_at`. `reactions` table: `message_id, author_id, emoji`.
- Realtime updates; late joiners see the room's recent history (last 100 messages).
- Tap a message to react (OpenMoji set).
- RLS: only signed-in allowlisted users can read/write.

**Done when:** chat and reactions appear live for everyone in the room, and leaving the room hides the panel.

---

## Phase 8 — Deploy
- Connect the repo to Vercel, set all env vars (including Twilio, server-side only), deploy.
- Add the deploy URL to Supabase Auth redirect URLs.
- Credits screen (see `ASSETS.md`).

**Done when:** all 8 friends can open the URL on their phones, log in and hang out.

---

## Later (ask before starting)
Muffled sound outside doors, decorating rooms, shared living room, notifications, Capacitor phone app.
