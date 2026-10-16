# FIXES.md — Friend feedback round 1 (16 Oct 2026)

Do this **before Phase 9 in `UPDATE.md`**. Friends tested the live site; these are their reports:

> "Laggy, zooms in randomly, I have to reload every time. But the game is smooth and voice quality is good."
> "I can't speak, I can only hear and move."
> "Issue with zooming and moving the joystick: sometimes it highlights and copies the text and it locks the joystick."
> "It lags and I have to reload multiple times to see my friends."

Fix in this order, **one commit per numbered item**, run the e2e tests after each, push, then give Diesel a short "how to test on a phone" list (plain English).

---

## 1. Random zoom ("zooms in randomly, have to reload")
- Cause: `fitCamera` runs on every Phaser `resize`. On phones the address bar showing/hiding and the keyboard opening fire `resize`, so the zoom jumps anywhere between 2 and 4.
- Use **whole-number zoom only** (2, 3 or 4; this also keeps the pixels sharp).
- Only re-fit on `orientationchange`, or when width/height change by more than 20%.
- Ignore resizes while `visualViewport` is shrunk by the on-screen keyboard (chat input focused).
- Re-centre the camera on the player after any re-fit.

**Test:** on iPhone Safari and Android Chrome, scroll the address bar in and out, open and close chat. The zoom must not change.

## 2. Joystick selects text and locks
- Add `user-select:none`, `-webkit-user-select:none` and `-webkit-touch-callout:none` to the whole game UI. Allow selection only in the chat input, the chat messages and code fields.
- Block `contextmenu` (long-press) over the game.
- In the joystick, `preventDefault` on `pointerdown`/`touchstart` (with `passive:false` listeners).
- Release the joystick on `lostpointercapture`, `pointercancel`, window `blur`, `visibilitychange` and `pagehide`, so it can never stay stuck.
- Never let the joystick and the walkie/talk buttons steal each other's pointers (multi-touch).

**Test:** hold the joystick for 10 s, drag your thumb off it and across text, switch apps and come back. Nothing is highlighted and the player stops.

## 3. Lag / "have to reload to see my friends"
- When the tab comes back (`visibilitychange` to visible, `pageshow`, `online`), check the Realtime socket. If it is dead or more than 10 s stale:
  1. resubscribe the `house` channel,
  2. re-track presence,
  3. ask everyone for a fresh position (one `sync` broadcast; everyone replies once with their current position),
  4. rejoin the voice room.
- Show a small pixel "Reconnecting…" pill while this happens. **Never** ask the user to reload.
- Remove players not heard from in 30 s, and bring them back as soon as they send anything.
- Wire in the connection-quality monitor from the WIP commit (`ed6287f`).
- Count reconnects in `window.__house.msgStats`.

**Test:** put a phone to sleep for 2 minutes, wake it, and see everyone again within 3 s with no reload.

## 4. "I can only hear, I can't speak"
- Make the mic state obvious on the HUD mic button: **on / muted / blocked / no mic found / silent**.
- If blocked, open the existing mic-help sheet. Add a **Try again** button that calls `getUserMedia` again from a tap.
- If the track ends, or goes silent for 20 s while unmuted, recover automatically. Show a toast if that fails.
- Make sure push-to-talk isn't on by default on phones. Default to open mic with the mute button.

**Test:** on a phone, deny the mic, then allow it from the help sheet; the friend hears you without a reload.

## 5. Sound settings
New **Sound** section in Settings, saved per device in `localStorage` (wrapped in try/catch):
- **Sliders:** Master, Voices, Game sounds, Music/jingles, plus "Walkie & whisper" once Phase 10 exists.
- **Toggles:** Sound effects on/off, Door and knock sounds, Join/leave chimes, Mute everything when the tab is hidden.
- **Mic:** device picker, live input level meter ("say something"), and a mic test that records 3 s and plays it back.
- **Speaker:** output picker where `setSinkId` is supported.
- Keep the per-person volume popover and link to it: "Change one friend's volume: tap them".
- All game sounds go through **one Web Audio bus** with a `GainNode` per category, so the sliders apply everywhere.

**Test:** each slider changes only its category, settings survive a reload, and the mic test plays back your voice.

## 6. Profile
New **Profile** button on the HUD. Tapping your own name tag also opens it.
- Show: character portrait (tap to change character), display name (editable), the room you own, date joined, last seen.
- **Your guest code**: the member's `guest_codes` code, with **Copy** and **Share** (Web Share API, falling back to copy), an on/off switch and **Make a new code**. One line of help: "Friends you share this with can visit as guests for 12 hours."
- **How you joined**: invite codes are stored only as a fingerprint, so show "Joined with an invite from Diesel on <date>". Never try to show the original code.
- **XP, level and streak** placeholders, plus a **Badges** grid with locked silhouettes. Design the layout now; it reads real data once Phase 14 lands.
- Guests get a smaller profile: name, character, "Guest of <member>" and time left.
- Pixel panel style from `theme.css`. Must work on a 360 px wide phone.

**Test:** on a phone, open Profile, copy and share your guest code, rename yourself, and change character.

## 7. New sound and badge packs
Already in `assets/raw/new-packs/` (gitignored). **All CC0.**

| File | Use for |
|---|---|
| `kenney_music-jingles.zip` | 8-bit jingles: level-up, challenge done, game win/lose |
| `kenney_rpg-audio.zip` | Footsteps, doors, cloth, coins → doors, knocks, walking |
| `kenney_digital-audio.zip` | Retro beeps, zaps, power-ups → UI and game events |
| `The Essential Retro Video Game Sound Effects Collection [512 sounds].zip` (Juhani Junkala) | Main 8-bit SFX library; pick what fits |
| `SoundPack01.zip` | Level up, power up, coin sounds |
| `oga_medals.png` | Pixel medals / achievements sheet for badges |

- Copy **only what you use** into `public/assets/`: sfx as small `.ogg` + `.mp3`, mono, ≤ 64 kbps; badges as one atlas.
- Add them to `assets/manifest.json`, `ASSETS.md` and the Credits screen. Credit Juhani Junkala even though the pack is CC0.
- Replace the code-generated placeholder sounds wherever a better file exists.

---

If any fix needs a database change, write a new file in `supabase/migrations/` and tell Diesel; Claude in claude.ai applies it.
