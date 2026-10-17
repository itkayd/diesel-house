# UPDATE.md — Diesel House v2: hallway voice, mini-games, challenges

Read this after `CLAUDE.md` and `NEXT.md`. It covers everything **after Phase 8 (deploy)**. Same working rules: one phase at a time, pass its "Done when", commit and push, stop, then give Diesel a short plain-English "how to test" (Windows commands, and say what to try on a phone).

Visual target is still `design/game/mvp.html` + `src/ui/theme.css`. Everything new must look like it belongs in that cosy pixel house: pixel fonts, warm lamp light, chunky 1-px outlines, no emoji in the UI chrome.

---

## 0. What Diesel asked for

1. **Mini-games and challenges** so there's something to *do* together, not just talk.
2. **Talking in the hallway**, but it must feel different from rooms: **whispers** (only people right next to you hear you) and a **walkie-talkie** (hold a button and the whole hallway hears you over a crackly radio).
3. New free pixel packs (downloaded, all CC0) — see section 1.

Keep the core promise intact: **inside a room you hear everyone in that room; rooms never hear the hallway and the hallway never hears rooms.**

---

## 1. New asset packs (Phase 9)

Diesel's zip puts these in `assets/raw/new-packs/` (gitignored, like the other raw packs). All are **Kenney, CC0** (no credit required, but add them to the Credits screen anyway).

| Zip | Use it for |
|---|---|
| `kenney_playing-cards-pack.zip` | **Pixel** playing cards (52 + jokers + backs, small/medium/large) **and pixel dice** (in the tilesheet bottom row) → Higher or Lower, dice rolls |
| `kenney_emotes-pack.zip` | Use **`PNG/Pixel/`** only (8 styles; pick one style and stick to it) → emote bubbles above heads, whisper "…" bubble, "!" for challenges |
| `kenney_ui-pack-pixel-adventure.zip` | Pixel panels, buttons, sliders, progress bars → game windows, challenge board, XP bar, walkie button |
| `kenney_input-prompts-pixel-1-bit.zip` | 1-bit key/button prompts (E, Space, tap, mouse) → "Press E / tap to play" hints at game spots |
| `kenney_interface-sounds.zip` | UI clicks, confirms, errors, toggles |
| `kenney_casino-audio.zip` | Dice rolls, card flips/shuffles, chips → game sounds and "challenge complete" |
| `kenney_boardgame-pack.zip` | Vector style (not pixel). **Only** use the pieces/chips for Tic-Tac-Toe / Connect 4 if scaled down to 16 px and they still read; otherwise draw simple pixel pieces in code |

Tasks:
1. Unzip each into `assets/raw/new-packs/<name>/`.
2. Copy **only the files actually used** into `public/assets/` (`games/`, `emotes/`, `ui/`, `prompts/`, `sfx/`). Prefer the packed tilesheets + an atlas JSON over hundreds of single PNGs.
3. Sounds: convert to `.ogg` + `.mp3` pairs, mono, ≤ 64 kbps, each ≤ 40 KB. Keep total new audio ≤ 600 KB.
4. Add every used file to `assets/manifest.json` and the packs to `ASSETS.md` and the Credits screen.
5. Generate the **walkie-talkie sounds in code** (Web Audio: squelch click + 120 ms filtered noise burst on press and release), so no extra download is needed.

**Done when:** the new sprites/sounds load in `PreloadScene` with no 404s, the build is still < 1.5 MB JS gzip-wise unchanged ±5%, and Credits lists the new packs.

---

## 2. Hallway voice: whisper + walkie-talkie (Phase 10)

### How it should feel
- Walk up to someone in the hallway and **just talk** → they hear you quietly, a bit breathy and muffled, louder the closer you are. Step away and you fade out. That's a **whisper**.
- Hold the **walkie button** (bottom right, pixel walkie icon; desktop key **T**) → *crrk* click + static, and **everyone in the hallway** hears you through a radio filter, at full volume, wherever they stand. Let go → *crrk*. That's the **walkie-talkie**.
- People inside rooms hear **none** of it. People in the hallway hear **none** of the rooms (unchanged).

### Rules (defaults — Diesel can change them later in settings)
| | Whisper | Walkie-talkie |
|---|---|---|
| Who hears | Hallway people within **4 tiles (64 px)** | Everyone in the hallway |
| Volume | Distance falloff: full at ≤ 24 px, 0 at 64 px (smooth curve) | Full |
| Sound effect | Low-pass ~2.5 kHz + gain −6 dB ("whisper") | Band-pass 300–3000 Hz + light waveshaper distortion + noise bed −30 dB |
| Mic | Open (voice activity) while someone is in range; off when nobody is near | Only while the button is held |
| Limit | — | Max **15 s** per press; **one talker at a time** ("Channel busy" red LED on everyone's walkie; button disabled while busy) |
| Visual | Faint dotted ring (64 px) under you while whispering; "…" pixel bubble over a whisperer's head for listeners in range | Walkie icon + green LED over the talker's head; name in a small HUD strip "[radio sprite] Sami" |

### Implementation
- New voice channel **`voice:hallway`** — same WebRTC mesh code as rooms (`src/net/voice.ts`), refactor so a "voice space" can be a room **or** the hallway. Max 8 peers, so a full mesh is fine.
- **Connect only when it matters** (saves bandwidth and Twilio TURN money):
  - Open a peer connection to a hallway person when they're within **96 px**, close it when > **128 px** (hysteresis), **unless** someone is on the walkie, in which case connect to everyone in the hallway for the duration and drop back after 10 s idle.
- **Gate on the sender side**: for each peer, `RTCRtpSender.replaceTrack(micTrack | null)` — send audio only to peers in whisper range, or to all while transmitting on the walkie. Distant peers get nothing (no bytes, no TURN cost).
- **Effects on the receiver side** with Web Audio per remote stream: `source → biquad → waveshaper (walkie only) → gain(distance) → destination`. Distance comes from the positions already in presence (no new messages).
- Walkie floor control over the `voice:hallway` broadcast: `walkie:start {from, t}` / `walkie:end`. If two starts arrive within 300 ms, the lower `t` (then lower id) wins; the loser gets a "busy" buzz. Auto-end after 15 s.
- Supabase **Realtime policy**: allow topic `voice:hallway` for members and admitted guests (same check as `house`). Write it as a new file in `supabase/migrations/` and tell Diesel; Claude in claude.ai applies it.
- Settings → Voice: toggles **"Whisper in the hallway"** (default on) and **"Hear the walkie-talkie"** (default on), plus walkie key binding.
- Mobile: walkie is a big hold button (min 56 px) above the joystick on the right; must work with a thumb while the joystick is held (multi-touch).

**Done when (two devices, ideally one on 4G):**
1. Stand next to each other in the hallway → hear each other quietly and muffled; walk apart → fades to silence by ~4 tiles.
2. Far apart in the hallway, hold walkie → the other hears radio-style audio with click + static; release → stops.
3. A third person inside a room hears nothing from the hallway; hallway people hear nothing from the room.
4. Two people press walkie together → only one transmits, the other sees "Channel busy".
5. `window.__house.msgStats` shows hallway voice adds no new Realtime messages per second while standing still.

---

## 3. Emotes and "tap a friend" menu (Phase 11)

Quick win that the games need anyway.
- Tap/click another character (or press **Q** near them) → small pixel radial/list menu: **Wave, Laugh, Heart, ?, !, Zzz** (emotes from `emotes-pack/PNG/Pixel/<one style>`), **Duel** (RPS, Phase 12), **Volume** (existing popover).
- Emote shows above the sender's head for 2.5 s for everyone who can see them (house channel broadcast, rate-limit 1 per 2 s per person).
- Number keys **1–6** = quick emotes on desktop.

**Done when:** emotes appear on both screens within ~300 ms, spamming is capped, works on phone.

---

## 4. Mini-games (Phases 12–13)

### Where games live
- **Hallway "Games corner"**: at the **west end of the hallway** (x ≈ 60–120, near the front door `door_double`), place an **arcade cabinet** and a **noticeboard** (draw with LimeZu furniture where possible; otherwise a simple pixel cabinet built from the UI pack). Hallway games are quick and loud-free (use emotes + walkie).
- **Room tables**: any room with a table (`table_wood` in room_06, `desk_study` etc.) gets a game spot. The room **owner** decides in "Your room" settings which games are allowed (default: all).
- Walking onto a game spot shows the 1-bit prompt "**E** / tap to play". The game opens as a pixel panel (UI pack) **over** the game world; you stay in the room, so voice keeps working while you play.

### Game framework (build once)
- One Realtime topic per spot: `game:<spotId>` (e.g. `game:room_06`, `game:hall`), broadcast only. Add a Realtime policy like the voice rooms: you can join `game:room_XX` only if `can_enter_room('room_XX')`; `game:hall` for members + guests.
- The player who starts a game is the **host**; the host's browser holds the state and sends **full small state snapshots** on each change (no streaming, no per-frame messages). If the host leaves, the next player (lowest join time) takes over from the last snapshot.
- Randomness (cards, dice) uses a seed the host picks and **reveals at the end** (commit = hash at start), so friends can see nobody rigged it.
- Results saved by the host via RPC `record_game(game, spot, players[], winner_ids[], score_json)` → table `game_results`. Members only write; guests can play but their results don't go on the leaderboard.
- Budget: a whole game round must use **< 60 Realtime messages**. Add it to `msgStats`.

### Phase 12 games (quick, 30 s – 2 min)
1. **Dice** (anywhere, `/roll` button in the game panel or chat command `/roll`, `/roll 2d6`): pixel dice tumble animation from the cards pack tilesheet, result posted to room chat as a system line. Casino dice sound.
2. **Rock-Paper-Scissors Duel** (from the tap-a-friend menu, any zone): both pick secretly within 10 s, simultaneous reveal with a little pixel animation, best of 3. Loser gets a dizzy pixel emote, winner a crown for 30 s.
3. **Quick Draw** (hallway arcade or any table, 2–8 players): host starts, "The lamp will flicker… wait for it" → lamp sprite flickers at a random 2–6 s → first to tap wins. Each client measures its own reaction time from the shared start timestamp (use the existing clock-offset code); early tap = disqualified for that round. 5 rounds, points table.

### Phase 13 games (table games, 3–10 min)
4. **Higher or Lower** (cards, 2–8 players, turn-based): flip a card, current player guesses higher/lower, streak points; bust passes the turn. Pixel cards + flip/shuffle sounds.
5. **Hot Takes / Would You Rather** (any room, 3+ players): shows a prompt card ("Would you rather never use your phone again or never play games again?"), everyone votes A/B secretly, reveal with bars + names. Ship ~120 prompts in `src/games/prompts.json`, family-friendly, no politics/religion. Room owner can add custom prompts. Perfect for talking.
6. **Four in a Row** (2 players at a table): 7×6 grid, pixel pieces, others can watch.

**Done when (each game):** two accounts can play a full round on desktop + phone, spectators see it, a host leaving mid-game hands over cleanly, results appear in `game_results` (members only), and a round stays under the message budget.

---

## 5. Challenges, XP and the noticeboard (Phase 14)

### What friends see
- A **noticeboard** in the hallway Games corner and a **"Challenges" tab** in the HUD (pixel scroll icon): **3 daily** + **3 weekly** challenges, each with a progress bar (UI pack) and XP reward.
- **XP bar + level** next to your name in the HUD; level badge (small pixel number) on your name tag.
- **Weekly leaderboard** on the noticeboard (members only): XP this week, games won, longest streak. Resets Monday 00:00 UTC.
- Completing something → pixel "!" emote over your head, chip sound, toast "Challenge done: Social butterfly +50 XP". Friends in the same room see a small confetti burst.
- **Streak**: visited the house on consecutive days → flame + number on your name tag.

### Starter challenge pool (pick 3 daily / 3 weekly at random per person, seeded by date + user so it's stable for the day)
Daily (10–40 XP): Say hi in 3 different rooms · Spend 15 min in voice with at least 2 friends · Win a Rock-Paper-Scissors duel · Use the walkie-talkie 3 times · Send 5 emotes · React to 5 chat messages · Be the first friend in the house today · Knock on a door and get let in · Play any mini-game · Whisper to someone in the hallway.
Weekly (80–200 XP): Visit every room · Win 5 games · 2 hours in voice this week · Host a game with 4+ players · Play all 6 mini-games · Keep a 4-day streak · Welcome a guest your friend invited · Win Quick Draw with a reaction under 250 ms.

### Implementation
- Definitions live in code: `src/challenges/pool.ts` (id, period daily|weekly, title, goal, xp, event kind, filter).
- The client emits events (`room_enter`, `voice_minutes`, `game_won`, `emote_sent`, `walkie_used`, `whisper_used`, `knock_admitted`, …). They're batched and sent at most **every 30 s** via RPC `record_events(events jsonb)`.
- Server (security-definer RPC, members only):
  - clamps per-kind daily caps (e.g. voice_minutes ≤ 300/day, emote_sent ≤ 50/day) so nobody can farm XP from the console,
  - updates `challenge_progress(user_id, challenge_id, period_key, progress, completed_at)`,
  - appends to `xp_ledger(user_id, amount, reason, created_at)`, and keeps `profiles.xp`, `profiles.level`, `profiles.streak_days`, `profiles.last_visit_date`.
- Level curve: **see `LEVELS.md`** (no max level; +100 XP per level up to level 21, then a flat 2,000 XP per level forever).
- Day boundaries per user's **local** date (friends are in the UK, Middle East and US): the client sends its IANA time zone once; the server stores it on the profile and computes `period_key` with it. Week = ISO week in UTC for the shared leaderboard.
- New tables/RPCs go in one migration file; RLS: users read their own progress; members read everyone's `profiles.xp/level/streak` and the weekly leaderboard view; nobody writes directly (RPC only). Guests: no XP (show "Guests don't earn XP").
- Run the Supabase security advisor afterwards (Claude in claude.ai will).

**Done when:** a fresh account gets 3 + 3 challenges, completing one updates the bar live and awards XP once (not twice on refresh), the console can't award XP directly, the leaderboard shows on the noticeboard, and a day rolls over at local midnight for a test account set to `Asia/Dubai`.

---

## 6. Free-tier budget check (do this at the end of each phase)
- Realtime: games and emotes must not push the monthly estimate over **1.5 M messages** (free is 2 M). Update the estimate table in this file with real `msgStats` numbers.
- TURN: hallway whisper connects only to nearby people; walkie only while someone is transmitting. Note the measured bytes per minute.
- Database: `xp_ledger` and `game_results` grow slowly; add a monthly cleanup of `xp_ledger` rows older than 90 days (keep totals on `profiles`).

### Measured: Phase 13 table games (17 Oct 2026)
Game messages **sent** (the `game` kind in `msgStats`), measured in `tests/e2e/table-games-local.mjs`. Realtime bills 1 per send + 1 per person at the table who receives it.

| Game | Sent per round | Whole game | Billed per game (players + watchers) |
|---|---|---|---|
| Higher or lower (3 players, 3 rounds) | 6–14 per round of turns (max 48 with 8 players) | ~30 | ~90 |
| Would you rather (4 players, 5 prompts) | 7 per prompt (2 × players − 1) | ~35 | ~140 |
| Four in a row (2 players + 1 watcher) | — | 11 for a 7-move win; 30–45 typical; 64 only for a full-board draw | ~40–135 |

Even at 10 table games a night, every night: ~40k billed messages a month, under 3% of the 1.5 M target. TURN: unchanged (games add no voice).

### Measured: Phase 14 challenges and XP (17 Oct 2026)
- `record_events()` is a normal database call (HTTP), **not Realtime**: at most one every 30 s per person while something happens, plus one on arrival. No Realtime cost.
- Realtime adds only: a presence update when your level or streak changes (a few a day), and one "!" emote broadcast per challenge done or level up (≈ 6–10 a day per person). Under 0.1% of the budget.
- `xp_ledger`, daily tallies and old daily challenge rows older than 90 days are deleted by the first visitor of each (UTC) day, inside `record_events()`; totals stay on `profiles`.

### Measured: critters (17 Oct 2026)
- Which critter and where is worked out from the clock on every device: **no messages** to show one.
- A catch is one database call, and everyone in the house gets one Realtime change message for it (at most ~22 critters an hour, so ~22 × people online). Even 8 friends for 4 hours a night: ~700 a night, ~21k a month.

## 7. Order
Phase 9 assets → 10 hallway voice → 11 emotes → 12 quick games → 13 table games → 14 challenges/XP. Stop after each phase for Diesel to test.
