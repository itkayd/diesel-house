# REDESIGN.md — Diesel House v3: one real house, better foundations, great UX (18 Oct 2026)

Read after `CLAUDE.md`, `FIXES.md`, `NEXT.md`, `UPDATE.md`, `LEVELS.md`. **This file wins for anything about layout, rooms, art style, skins, animals and UI.** Same working rules: plan → one phase at a time → pass "Done when" → commit + push → stop and give Diesel a short how-to-test (Windows commands, phone steps).

**Do not start building until R0 is done and Diesel has picked a look in R2.** Diesel said: "do not do anything without planning."

---

## 0. What Diesel asked for
1. Seriously upgrade the UX. Fix lots of bugs and make the foundations solid, so things are easy to change and edit later.
2. Make it feel like **one house**, not a grid of boxes.
3. New shared rooms: a **Disco**, a **Library** and a **Lounge**.
4. Drop the 4-over-4 layout. Use a **hexagon or another shape, with the hallway as the centre**.
5. **Many character skins** and **many animals**.
6. Pull in 10+ diverse free pixel packs, because the overall look may change.
7. **v3 idea (later, ask first):** fighting ghouls/monsters, using the Sunnyside World pack.

---

## 1. Audit findings (18 Oct, from the code)
| Area | Finding | Fix in |
|---|---|---|
| Rooms hard-coded | `room_01..08` lives in `src/config.ts` (`ROOM_IDS`), `scripts/build-map.mjs`, the DB check `id ~ '^room_0[1-8]$'` and every Realtime policy regex. You can't add the Disco, Library or Lounge cleanly. | R1 |
| Zones are rectangles | `HouseScene.zoneOf()` + tmj rectangles. Odd shapes need polygons. | R1 |
| `HouseScene.ts` = 1,690 lines | Every feature touches one file, so changes keep breaking other things. | R1 |
| Bundle | `main.js` is 1.46 MB (399 kB gzip). Vite warns: `voice.ts` is imported statically by `ui/voiceSettings.ts`, so lazy-loading does nothing. | R1 |
| Floors | The free LimeZu pack has 4 patterned floors; the rest are tinted copies. | R2/R3 |
| Health | `tsc` passes, `vite build` passes, 37 e2e test files exist. Run them all at the start of R0 and record failures. | R0 |
| Local copy | Diesel's laptop repo (`~/diesel-house`) is behind `origin/main` (still at `ed8b9d6`) and has old uncommitted Phase 13 drafts (`src/games/four.ts`, `higherLower.ts`, `prompts.json`, `20261026_room_prompts.sql`, edit to `table.ts`). Those were superseded by what's on GitHub. **Ask Diesel before discarding them**, then `git stash` and `git pull`. | R0 |

---

## 2. The new house (layout Option A — octagon Great Hall)

Sketch: **`design/redesign/floorplan_octagon.png`**

- **Great Hall** at the centre, an **octagon** (8 faces). Every room opens off it, so it reads as one house. The games corner, noticeboard, walkie, whispering, and the rug/whisper zone in the middle all move here.
- **North face → Library** (shared). **East face → Disco** (shared, bigger wing). **West face → Lounge** (shared, bigger wing). **South face → Front porch** (spawn, front door).
- **The 4 diagonal faces each open onto 2 friend rooms → 8 friend rooms** (owners keep their rooms; map `room_01..08` onto the new slots in order).
- Pixel tiles are square, so **diagonal walls are stepped** (1 tile across, 1 tile down) with a dedicated corner tile. They must look intentional, not jagged. Diagonal friend rooms in the sketch are drawn thin; make them at least 9 × 9 tiles inside.
- Option B (true hexagon in isometric view) was rejected for now: it means a full engine rewrite and far fewer assets. The isometric packs (#8, #9) are downloaded only so R2 can show what it would look like.

### Shared rooms (new)
| Room | Voice | Look & features |
|---|---|---|
| **Disco** | Open room voice, **music bed** (owner-less, anyone can start/stop a track from a jukebox) | Flashing dance floor (code-driven tile colours), spinning glitter ball, coloured light sweeps (additive Phaser lights), DJ booth. Dance emote loops while you stand on the floor. Never plays music into other rooms. |
| **Library** | **Quiet voice**: whisper-style falloff like the hallway (no full-room mesh) | Bookshelves, reading nooks, lamps, a "study timer" (shared Pomodoro on a desk). Warm low light. |
| **Lounge** | Open room voice | Sofas, rug, fireplace, a TV that shows a shared "watch party" link card (link only, no video streaming), board-game table → reuse the table games. |

Shared rooms have **no owner**. Door is always open. Any member can use them; guests can too (same as the hall).

---

## 3. Foundations (Phase R1 — do before any visuals)
1. **Rooms become data.** Add `src/house/rooms.ts`, one list of `{ id, kind: 'private'|'shared', name, voice: 'room'|'quiet'|'music', polygon, door, floor, wall, theme }`. Everything (map build, zone lookup, voice, chat, games spots, "Who's where") reads from it.
2. **Database.** New migration: drop the `room_0[1-8]` check. Allow ids `^[a-z0-9_]{3,32}$`, add a `kind` column, seed `disco`, `library`, `lounge`. Rewrite the Realtime policies to look up the `rooms` table instead of using a regex (`exists (select 1 from rooms where id = substr(topic, 7))` + `can_enter_room`). Shared rooms: `can_enter_room` returns true for members and admitted guests.
3. **Polygon zones.** Zones come from polygons (Tiled polygon objects or `rooms.ts`), checked with `Phaser.Geom.Polygon.Contains`, plus a cached tile → zone lookup grid so it stays fast.
4. **Split `HouseScene.ts`** into modules: `house/map.ts` (load, layers, collision), `house/zones.ts`, `house/players.ts` (avatars, interpolation), `house/doors.ts`, `house/lighting.ts`, `house/input.ts`, `house/hud-bridge.ts`. Target: no file over ~400 lines. **No behaviour change.** All existing e2e tests must still pass.
5. **Bundle.** Fix the `voice.ts` static import (move the shared types into `net/voiceTypes.ts`). Lazy-load games, admin, chat and profile. Target main chunk < 250 kB gzip.
6. **Map builder.** Rewrite `scripts/build-map.mjs` to generate the house from `rooms.ts` (polygons → floors, stepped walls, door gaps, furniture recipes per room theme). Keep `npm run map`.
7. **Error reporting.** Add a tiny client error catcher (`window.onerror` + unhandled rejections) that writes to a new `client_errors` table (rate-limited RPC, members only). Diesel can then see real bugs from friends' phones.

**Done when:** the current game looks and behaves the same, every e2e test passes, the main chunk is < 250 kB gzip, and adding a test room in `rooms.ts` makes it show up with working voice, chat and doors without touching any other file.

---

## 4. Phase R0 — Audit and bug list (first, small)
- Ask Diesel for his and his friends' bug list (rough notes are fine). Pull Vercel runtime errors and Supabase logs/advisors. Run `npm test` / `tests/e2e/run-all.mjs` and record failures.
- Write `BUGS.md`: each bug with steps to reproduce, severity and an owning phase. Fix the **crashers and "have to reload" bugs** in R0. Leave the rest for their phases.

---

## 5. Phase R2 — Choose the look (unpack, compare, decide)
1. Unzip every pack in `assets/raw/redesign-packs/` (see section 8) into its own folder.
2. Make a **contact sheet per pack** (`design/redesign/contact_<pack>.png`) with tile size and licence on it. One already exists: `design/redesign/contact_downloaded.png` (disco, forest animals, coffee shop).
3. Build **3 small playable mock-ups** (like `design/game/v2.html`), each showing the Great Hall + Disco + Library corner with one character walking:
   - **A. "Cosy LimeZu+"**: current LimeZu 16 px style, extended with Cozy Interior 165+, bitglow and Ninja Adventure (all 16 px).
   - **B. "Warm 32"**: 32 px style (feyza5 book/coffee shops, Reading Nook, Graduation Cat). Chunkier and more detailed; characters need 32 px skins.
   - **C. "Isometric"**: Kenney Isometric Library + lumeish, just to see it. Not expected to win.
4. Diesel picks one. **Never mix tile sizes in one view.** If 16 px wins, 32 px packs are only used if scaled art still reads; otherwise drop them.

**Notes from the packs already checked:**
- *Assorted Disco* (#7) is **side-view and large** (DJ 256 × 172, jukebox 96 × 172). It doesn't match top-down. Use only `DanceFloor.png` (tile colours) and `DiscoBall.png` (scaled to 16–32 px). Redraw the DJ booth/jukebox top-down from furniture packs or in code. Skip the bottles: keep it friendly.
- *Forest animals* (#10) are proper 16 px top-down: fox, doe, owl, squirrel, frog, with idle + run in 4 directions. CC0. They're a perfect match for the current style.
- *Coffee Shop* (#4) is 32 px top-down, with good counters, lamps, shelves and a brick/diamond floor. It's great for the Lounge if the 32 px look wins.

---

## 6. Phase R3 — Build the new house
- Generate the octagon house from `rooms.ts` with the chosen pack(s): stepped diagonal walls, distinct floor and wall per room, furniture recipes per theme.
- **Disco**: animated floor (cycle tile tints every beat), glitter ball sprite with rotating light specks, light sweeps, jukebox UI (pick from a few CC0 loops; ask Diesel before adding any music files) and a dance emote.
- **Library**: quiet voice mode (reuse whisper falloff from the hallway code), shelves and nooks, study timer.
- **Lounge**: sofas, fireplace, TV "watch party" card, table-game spot.
- Lighting pass: night tint, warm lamp pools, and brighter rooms when people are inside (keep from NEXT.md §4.2).
- Owners keep their room data: the migration maps `room_01..08` to the new 8 friend slots.

**Done when:** you can walk the whole house on a phone. Each friend room is distinct. Disco, Library and Lounge each work with the right voice mode. Walls (including diagonals) block correctly. "Who's where" and the map show the new shape. Every old e2e test, updated for the new map, passes.

---

## 7. Phase R4 — Skins and animals
### Skins (target **60+ choices**)
- Sources: Ninja Adventure (dozens of 16 px characters, CC0), the existing 20 (chibis + LimeZu), Cute Fantasy free (non-commercial), and Sunnyside humans (check licence). Use only the ones matching the chosen tile size.
- Normalise everything to one sheet format: 4 directions × walk + idle. Build `public/assets/characters/atlas.png` + `atlas.json`, generated by a script in `scripts/`.
- Picker redesign: categories (People, Ninja, Fantasy, Animals-as-avatars), search, a big animated preview, **favourites**, and **"locked until level X"** for some skins. This links to `LEVELS.md` §5: reward skins every 5 levels, with no gameplay advantage.
- Store `character_key` (text) instead of `character_index` (0–19). Add a migration that maps old indexes to keys.

### Animals (the house feels alive)
- Ambient animals wander in fitting places: fox, doe, owl, squirrel, frog (#10); cat, bunny, pig, sheep and more (#11, non-commercial); and Ninja Adventure animals.
- There is already a critters system (`src/critters/`, catching works live). **Extend it** rather than writing a new one: per-room spawn tables (cat in the Lounge, owl in the Library, frog near the porch), and more critters when more people are in.
- **Pets**: each member can adopt one animal that follows them around (cosmetic). It is unlocked by level or a medal and stored on the profile.

**Done when:** the picker shows 60+ skins and works smoothly on a 360 px phone, old profiles keep their character, at least 10 animal types appear around the house, and pets follow their owner for everyone watching.

---

## 8. Packs (downloaded / to download)

Put everything in **`assets/raw/redesign-packs/`** (it's gitignored). Copy only what you use into `public/assets/`, and add each pack to `assets/manifest.json`, `ASSETS.md` and the Credits screen.

| # | Pack | Use | File | Licence | Status (18 Oct, 00:35) |
|---|---|---|---|---|---|
| 1 | [Ninja Adventure](https://pixel-boy.itch.io/ninja-adventure-asset-pack) | Dozens of skins, animals, interiors (16 px) | `Ninja Adventure - Asset Pack.zip` (89 MB) | CC0 | **To download** |
| 2 | [Cozy Interior 165+](https://sleepless-poetry.itch.io/cozy-interior-165-pixel-art-furniture-assets) | 165 furniture pieces (16 px) | `Cozy Interior - 165+ Pixel art furniture assets.zip` | Free, commercial OK, no resale | **To download** |
| 3 | [Pixel Interior LRK](https://bitglow.itch.io/pixelinterior-livingroomkitchen) | Lounge, kitchen, hallway (16 px) | `pixelinterior_LRK_v1.1.zip` | Bitglow licence, commercial OK, no resale | **To download** |
| 4 | [Cozy Interiors 32x32](https://feyza5.itch.io/cozy-library) | Library (book shop), Lounge (coffee shop), alchemy | `Book_Shop_Tiles.zip`, `Coffee_Shop_Tiles.zip`, `Alchemy_Shop_Tiles.zip` | Free, commercial OK, no resale/AI | Coffee Shop ✅ · Book Shop + Alchemy **to download** |
| 5 | [Cozy Reading Nook](https://summerpixl.itch.io/cozy-reading-nook-free-pixel-art-interior-sample) | Library nook (32 px) | `Cozy_Reading_Nook_Free_Sample.zip` | See LICENSE.txt inside | **To download** |
| 6 | [House Interior 32x32 LITE](https://graduation-cat.itch.io/house-interior-tileset-32x32) | Alt 32 px style | `InteriorTilesLITE.png` | Free, commercial OK, no resale | **To download** |
| 7 | [Assorted Disco Pixel Art](https://opengameart.org/node/31404) | Dance floor, disco ball | `GameArtFromMichealMuirden.zip` | CC0 | ✅ |
| 8 | [Kenney Isometric Library](https://kenney-assets.itch.io/isometric-library-tiles) | Option C mock only | `kenney_isometricLibrary.zip` (5.5 MB) | CC0 | **To download** |
| 9 | [Tiny Interior Decoration (Iso)](https://lumeish.itch.io/tiny-interior-decoration-isometric-free) | Option C mock only | `lumeish - furniture pack.zip` | CC-BY-SA 4.0 (credit lumeish) | **To download** |
| 10 | [Forest Animal Pack](https://opengameart.org/node/185579) | Fox, doe, owl, squirrel, frog | `seasons_of_forest_animal_pack_free_v1.zip` | CC0 | ✅ |
| 11 | [Free Pixel Animal Pack](https://pixel-wanderer.itch.io/free-pixel-animal-pack-16x16-weekly-updates) | Cat, bunny, pig, cow, bull, rat, ram, sheep | `Free version.rar` | **Non-commercial only** | **To download** |
| 12 | [Cute Fantasy (free)](https://kenmi-art.itch.io/cute-fantasy-rpg) | Characters + animals | `Cute_Fantasy_Free.zip` | **Non-commercial only**, credit Kenmi | **To download** |
| 13 | [Sunnyside World](https://danieldiggle.itch.io/sunnyside) | v3 combat/ghouls, humans, outdoor | `Sunnyside_World_ASSET_PACK_V2.1.zip` (10 MB) + `Sunnyside World - Human - 4,6,8 way movement - BETA` | Check licence on page/inside zip | **To download** |

Why most are still "to download": on 18 Oct at 00:30, itch.io's download server (its Cloudflare R2 mirror) returned **HTTP 503** for every itch download from Diesel's Chrome. The OpenGameArt files and one itch file came through. On each itch page: **Download Now → "No thanks, just take me to the downloads" → Download**. Save the files to `Downloads`, then move them into `assets/raw/redesign-packs/` (see the PowerShell lines in that folder's `README.md`).

**Licence rule:** packs 11 and 12 are **non-commercial**. Fine for a private friends app, but keep a `commercial: false` flag on them in `assets/manifest.json` so they can be swapped out if Diesel House is ever sold.

---

## 9. Phase R5 — UI/UX pass (after the look is chosen)
- Re-skin all panels from the chosen pack + `theme.css` tokens, so one visual language covers the HUD, sheets, toasts and game panels.
- **Navigation:** "Who's where" becomes a tappable mini-map of the octagon house (tap a room → walk there). Add room previews ("3 in the Disco · music on").
- **First-run:** a 3-step tour: walk, talk, rooms.
- **Feedback everywhere:** every tap gets a sound + visual response; every network wait shows a pixel spinner, never a frozen screen; every error says what to do next.
- **Accessibility:** tap targets ≥ 44 px, contrast AA, reduced-motion setting (turns off disco flashing, which is also a **photosensitivity** concern, so default the disco floor to a slow, soft cycle with no strobing).
- Run the `design:accessibility-review` and `design:ux-copy` skills over the result.

**Done when:** a new friend can log in on a phone and, without help, find a friend, join their room, go to the Disco and play a game. Check by watching one real friend try it.

---

## 10. v3 — later, ask Diesel first: "Ghoul night"
Idea from Diesel: fighting ghouls, using the **Sunnyside World** pack (it has enemies and combat animations).
- A friendly co-op event: on some nights, ghouls (goblins/skeletons) shuffle into the Great Hall and friends tap/attack them together for XP. No deaths or loss, just a fun scramble.
- It would reuse the critters spawn system and the game host/snapshot framework (`games/controller.ts`), and needs a combat-lite input (tap to swing) plus a health bar.
- **Not part of R0–R5.** Write a proper plan and ask before starting.

---

## 11. Order
R0 audit/bugs → R1 foundations → R2 choose look → R3 new house → R4 skins + animals → R5 UI/UX → (v3 ghouls, ask first). Stop after each for Diesel to test. Update the free-tier budget check (`UPDATE.md` §6) at the end of R3 and R4 (disco lights and pets must not add Realtime messages per frame).
