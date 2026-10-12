# CLAUDE.md — Diesel House build brief

Read `CONCEPT.md` and `ASSETS.md` before starting. Build in phases. Finish one phase, confirm its "Done when" test passes, commit, then stop and tell the user what to test before starting the next phase.

---

## Stack (free tiers only — target £0/month)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | One language front to back |
| Build tool | Vite | Fast, simple |
| 2D engine | Phaser 3 | Tilemaps, sprites, camera, input |
| Map editor | Tiled (`.tmj` JSON export) | Free, Phaser loads it natively |
| UI overlay | Plain HTML/CSS over the canvas (no React unless needed) | Captions, comments, buttons |
| Backend | Supabase (free tier): Auth, Postgres, Realtime | Logins, rooms, comments, presence, signalling |
| Voice | WebRTC peer-to-peer mesh per room (max 8 people) | No media server needed |
| Signalling | Supabase Realtime broadcast channels | No extra server |
| NAT traversal | Google public STUN + free TURN (Metered / Open Relay) | Voice works on mobile networks |
| Captions | Browser Web Speech API on the speaker's device | No cloud speech-to-text cost |
| Hosting | Vercel (free tier) | Auto-deploy from GitHub |
| Icons / emoji | `lucide`, OpenMoji | Free, see ASSETS.md |

Do **not** add paid services, a custom Node server or a media server (LiveKit etc.) without asking the user.

---

## Rules
- Repo is **private**. Never make it public (asset licences).
- Never commit `.env`. Provide `.env.example` with variable names only.
- Raw zips stay out of git (`assets/raw/*.zip` is in `.gitignore`). Extracted, used assets are committed under `public/assets/`.
- Keep the user informed in plain English. They are not a full-time developer. After each phase, give a short "how to test" list.
- Mobile-first: everything must work in a phone browser (touch controls) as well as desktop (WASD/arrow keys).

---

## Phase 0 — Set up the project folder

1. Find these three zips in the user's **Downloads** folder and copy them into `assets/raw/`:
   - `Modern_Interiors_Free_v2.2.zip`
   - `alliance_chibis_character_collection.zip`
   - `kenney_roguelike-indoors.zip`
   If any is missing, tell the user which one and the link from `ASSETS.md`.
2. Unzip each into `assets/raw/<pack-name>/`.
3. Scaffold Vite + TypeScript + Phaser 3 in the repo root.
4. Create this structure:
   ```
   src/
     scenes/      PreloadScene.ts, HouseScene.ts
     net/         supabase.ts, presence.ts, voice.ts
     ui/          overlay.ts, captions.ts, comments.ts
     config.ts
   public/assets/
     tiles/  characters/  furniture/  ui/
   maps/        house.tmj
   assets/raw/  (gitignored zips + extracted packs)
   ```
5. Copy the tilesets and character sheets the game needs from `assets/raw/` into `public/assets/`.
6. Write `assets/manifest.json` listing every asset used: key, path, frame size, source pack.

**Done when:** `npm run dev` opens a blank Phaser canvas, and the asset folders are populated.

---

## Phase 1 — The house
- Build `maps/house.tmj` (or generate it in code if Tiled isn't available): a central hallway with 8 equal rooms, 4 above and 4 below, each with one door onto the hallway. Use LimeZu floors and walls; furnish with LimeZu first, Kenney second.
- Add an object layer with rectangles named `hallway`, `room_01` … `room_08`, and `spawn`.
- Add collision on walls.
- Camera follows the player and fits nicely on phone and desktop.

**Done when:** the house renders, rooms are clearly separate, and walls block movement.

---

## Phase 2 — Characters and movement
- Use the finalbossblues chibis (16×32 frames, 4-direction walk). Slice the sheet into animations: walk-up/down/left/right and idle.
- Controls: WASD/arrows on desktop, on-screen joystick or tap-to-walk on mobile.
- Character picker on first launch (16 options).

**Done when:** you can pick a character and walk around the house with correct animations.

---

## Phase 3 — Multiplayer presence
- Supabase project + `.env.example` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- Broadcast position about 10 times a second over Supabase Realtime; interpolate other players smoothly.
- Name tag above each character.
- Show which zone each player is in (hallway / room_XX).

**Done when:** two browsers see each other move in real time.

---

## Phase 4 — Voice zones (the core feature)
- Each room = its own WebRTC mesh. Entering a room zone joins it; leaving closes all peer connections for that room.
- Hallway = no audio.
- Signalling over a Supabase Realtime channel per room.
- Audio constraints: `echoCancellation`, `noiseSuppression`, `autoGainControl` all on. Opus.
- Mic permission prompt on first room entry, mute button, push-to-talk option.
- "Speaking" glow under a character when their audio level passes a threshold.
- STUN + TURN config from env vars.

**Done when:** two people in the same room hear each other; one steps into the hallway and the audio stops within a second; it works on a phone on 4G.

---

## Phase 5 — Accounts and room ownership
- Supabase Auth (magic-link email). Invite-only: allowlist of 8 emails in a table.
- `rooms` table: `id (room_01..08)`, `owner_id`, `door_state (open|knock|locked)`, `mood`, `name`.
- Row-level security: only the owner can change their room.
- Settings screen for the owner to name their room.

**Done when:** each friend logs in and sees their own room labelled with their name.

---

## Phase 6 — Doors
- Door sprite shows its state.
- Locked: the door blocks movement for non-owners.
- Knock: walking into the door sends a knock to the owner (toast and sound); the owner taps Let in or Ignore.
- Owner can remove a guest (they're moved to the hallway).
- Mood badge shown above the door.

**Done when:** all three door states behave correctly between two accounts.

---

## Phase 7 — Live captions
- Use the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), continuous, interim results on, on each speaker's own device while they're in a room and unmuted.
- Send **final** results only as caption lines to the room's channel and save them to a `captions` table (`room_id, speaker_id, text, created_at`).
- Captions panel: speaker colour plus name, auto-scroll, scroll back to catch up.
- Graceful fallback if the browser doesn't support speech recognition (show "captions not available on this browser" for that speaker).
- Captions are visible only inside that room.

**Done when:** speech appears as captions for everyone in the room within about 2 seconds, and leaving the room hides them.

---

## Phase 8 — Comments and reactions
- Tap a caption line → react (OpenMoji set) or comment.
- `comments` table: `caption_id, author_id, text | reaction, created_at`.
- Realtime updates; comments thread under the caption line.

**Done when:** comments and reactions appear live for everyone in the room.

---

## Phase 9 — Deploy
- Connect the repo to Vercel, set env vars, deploy.
- Add the deploy URL to Supabase Auth redirect URLs.
- Credits screen (see `ASSETS.md`).

**Done when:** all 8 friends can open the URL on their phones, log in and hang out.

---

## Later (ask before starting)
Muffled sound outside doors, decorating rooms, clips, shared living room, notifications, Capacitor phone app.
