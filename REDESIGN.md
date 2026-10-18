# REDESIGN.md — Diesel House v3: one real house, better foundations, great UX (18 Oct 2026)

Read after `CLAUDE.md`, `FIXES.md`, `NEXT.md`, `UPDATE.md`, `LEVELS.md`. **This file wins for anything about layout, rooms, art style, skins, animals and UI.** Same working rules: plan → one phase at a time → pass "Done when" → commit + push → stop and give Diesel a short how-to-test (Windows commands, phone steps).

**Look decided (R2, 18 Oct): build in A ("Cosy LimeZu+", 16 px) now; the end goal is C (isometric).** Every phase from R3 on follows the "iso-ready" rules in §5 so the switch to isometric (Phase R6) is a new renderer and new art, not a rewrite. Diesel said: "do not do anything without planning."

---

## 0. What Diesel asked for
1. Seriously upgrade the UX. Fix lots of bugs and make the foundations solid, so things are easy to change and edit later.
2. Make it feel like **one house**, not a grid of boxes.
3. **No more 8 personal rooms.** Every room is a **shared themed space** with no owners (decided 18 Oct): Disco, Library, Lounge, Gaming room, Café, Garden and Rooftop. Diesel: "mix it and match it".
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

## 2. The new house (layout Option A — octagon Great Hall, 7 shared rooms)

Sketch: **`design/redesign/floorplan_octagon.png`**

**Decision (18 Oct): no private rooms and no owners.** The house is the Great Hall plus 7 themed rooms anyone can use. The 8 personal rooms (`room_01..08`) are retired.

| Hall face | Room | Voice | Look & features |
|---|---|---|---|
| Centre | **Great Hall** | Hallway rules (whisper + walkie) | Hub of the house: games corner, noticeboard, rug/whisper zone. |
| S | **Front porch** | Hallway rules | Spawn point and front door. |
| N | **Garden** (back door) | Open room voice | Outdoor: grass, trees, pond, bench, fire pit, night sky + stars. Most animals live here (fox, doe, owl, squirrel, frog). |
| NW | **Rooftop** (stairs up from the hall) | Open room voice | Part of the garden idea: deck chairs, fairy lights, city skyline at night, telescope. |
| NE | **Library** | **Quiet voice**: whisper-style falloff, no full-room mesh | Bookshelves, reading nooks, lamps, shared study timer on a desk. Owl lives here. |
| E (big wing) | **Disco** | Open voice + **music bed** (anyone starts/stops a track from the jukebox) | Dance floor that changes colour, glitter ball, light sweeps, DJ booth, dance emote on the floor. Music never leaks into other rooms. |
| SE | **Gaming room** | Open room voice | Arcade cabinets, consoles/TV, beanbags. **All table games move here** (Dice, RPS, Quick Draw, Higher or Lower, Hot Takes, Four in a Row). |
| SW | **Café / Kitchen** | Open room voice | Coffee-shop look (Coffee Shop pack #4): counter, stools, bistro tables, a fridge with a daily "special". Cat lives here. |
| W (big wing) | **Lounge** | Open room voice | Sofas, rug, fireplace, TV "watch party" card (link only), a second game table. |

- Pixel tiles are square, so **diagonal walls are stepped** (1 tile across, 1 tile down) with a dedicated corner tile. They must look intentional, not jagged. Rooms on the diagonals must be at least 10 × 10 tiles inside.
- With only 7 rooms, each can be bigger and more detailed than the old rooms. Aim for 14 × 12+ tiles, and wings (Disco, Lounge) around 18 × 14.
- **No owners means:**
  - **Doors** are always open. Remove the knock / lock / let-in flow, room passes, "remove guest" and owner room settings.
  - Instead, anyone inside a room can toggle **"Do not disturb"**. The door shows a sign, and people outside get a gentle "They've asked for quiet. Go in anyway?" before entering. No hard lock.
  - **Room names** are fixed (Disco, Library …); no renaming.
  - **Game rules** per room (which games are allowed, custom Hot Takes prompts): any member can edit them from the room's noticeboard, which keeps a simple change log.
  - **Ownership in the DB** (`rooms.owner_id`, `room_passes`, knock broadcasts): stop using it in R1. Leave the columns and tables in place for one release, then drop them in a later migration (tell Diesel first).
- Isometric was first rejected as too big a change. **Diesel has since made it the end goal (R2 decision, §5).** The octagon layout stays: the same `rooms.ts` polygons are drawn top-down now and isometric in R6.

### Knock-on changes to other plans
- **Challenges (`UPDATE.md` §5):** replace "Knock on a door and get let in" with "Dance in the Disco for 2 minutes". Replace the weekly "Visit every room" with "Visit all 7 rooms".
- **Medals (`LEVELS.md` §7.3):** these are already live (`src/challenges/pool.ts`, `20261027_challenges_xp.sql`). Keep the ids so nobody loses a medal they've earned, and only change the name, rule and "how" text: `decor` → **House tour** (visit all 7 rooms), `first_knock` → **Dance machine** (2 min on the Disco floor), `host` → **Party starter** (be in a room when it reaches 4 people). Anyone who already has them keeps them and their XP. Update the award checks in a new migration.
- **Game spots (`UPDATE.md` §4):** `game:room_XX` topics become `game:<roomId>` (e.g. `game:gaming`, `game:lounge`).

## 3. Foundations (Phase R1 — do before any visuals)
1. **Rooms become data.** Add `src/house/rooms.ts`, one list of `{ id, name, voice: 'room'|'quiet'|'music', polygon, door, floor, wall, theme }`. Everything (map build, zone lookup, voice, chat, games spots, "Who's where") reads from it.
2. **Database.** New migration: drop the `room_0[1-8]` check. Allow ids `^[a-z0-9_]{3,32}$`, seed `garden`, `rooftop`, `library`, `disco`, `gaming`, `cafe`, `lounge`, and mark `room_01..08` retired (`active = false`, kept for one release). Rewrite the Realtime policies to look up the `rooms` table instead of using a regex (`exists (select 1 from rooms where id = substr(topic, 7))` + `can_enter_room`). `can_enter_room` becomes: true for members and admitted guests on any active room (no owner or door checks). Add a `dnd` (do-not-disturb) flag + `dnd_set_by`/`dnd_at` on `rooms`; any member inside can set it, and it auto-clears when the room empties.
3. **Polygon zones.** Zones come from polygons (Tiled polygon objects or `rooms.ts`), checked with `Phaser.Geom.Polygon.Contains`, plus a cached tile → zone lookup grid so it stays fast.
4. **Split `HouseScene.ts`** into modules: `house/map.ts` (load, layers, collision), `house/zones.ts`, `house/players.ts` (avatars, interpolation), `house/doors.ts` (now just the do-not-disturb sign), `house/lighting.ts`, `house/input.ts`, `house/hud-bridge.ts`. Target: no file over ~400 lines. **No behaviour change.** All existing e2e tests must still pass.
5. **Bundle.** Fix the `voice.ts` static import (move the shared types into `net/voiceTypes.ts`). Lazy-load games, admin, chat and profile. Target main chunk < 250 kB gzip.
6. **Map builder.** Rewrite `scripts/build-map.mjs` to generate the house from `rooms.ts` (polygons → floors, stepped walls, door gaps, furniture recipes per room theme). Keep `npm run map`.
7. **Error reporting.** Add a tiny client error catcher (`window.onerror` + unhandled rejections) that writes to a new `client_errors` table (rate-limited RPC, members only). Diesel can then see real bugs from friends' phones.

**Done when:** the current game looks and behaves the same apart from the removed owner features (knock/lock/passes/kick/rename are gone; the tests for them are replaced by do-not-disturb tests), every other e2e test passes, the main chunk is < 250 kB gzip, and adding a test room in `rooms.ts` makes it show up with working voice, chat and doors without touching any other file.

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

**Done (18 Oct).** The mock-ups are at `/mockups/` (`public/mockups/`, built by `design/redesign/mockups/build_{a,b,c}.py`).

### Decision: A now, C is the end goal
- **R3 to R5 are built in A:** 16 px, LimeZu walls and floors, LimeZu + Cozy Interior 165+ + bitglow + Ninja Adventure furniture, the disco floor and ball scaled to 16 px. The 32 px packs (#4 feyza5, #5 Reading Nook, #6 Graduation Cat) are dropped from the game.
- **The house will become isometric (C) in Phase R6** (§10a). Until then, nothing may be built in a way that only works top-down.
- **Still open for Diesel:** move everyone to Ninja Adventure skins or keep today's characters as their own group. Ninja skins are top-down only; isometric needs new character art either way (R6.0).

### Iso-ready rules (apply from R3; check them in every review)
1. **World = tiles.** Game logic, zones, doors, collision, game spots, critters, the whisper circle and pathfinding work in tile units on the `rooms.ts` grid. Pixels only appear when drawing.
2. **One projection module**, `src/house/projection.ts`: `toScreen(tx, ty)`, `toWorld(sx, sy)`, `tileSize`. Today it is plain top-down (× 16). Everything that turns world positions into screen positions (sprites, name tags, chat bubbles, emotes, the camera, tap-to-walk, tap-a-friend, the whisper circle) goes through it. In R6 only this module and the renderer change.
3. **One depth rule**, `depthOf(tx, ty, layer)` in the same module: `ty` today, `tx + ty` in iso. No hand-picked `setDepth` numbers for things that stand on the floor (there are 23 `setDepth` calls today; move them over in R3).
4. **Furniture is data**: each item in a room recipe is `{ kind, tile: [x, y], footprint: [w, h], facing }`, not pixel positions. Collision comes from the footprint. A per-look art table (`looks/topdown.ts`, later `looks/iso.ts`) says which sprite draws each `kind` facing each way, so iso art can be added item by item.
5. **The map builder writes data, not just pictures**: floors, walls, doors and furniture as lists from `rooms.ts`; the top-down tile layers are one output. The iso renderer (R6) reads the same lists.
6. **Network messages use world units.** `MoveMsg` sends pixels today; in R3 add tile-unit positions (keep pixels one release so old copies keep working).
7. **Characters and animals** are loaded from one atlas format (R4) with a `facings` field: 4 now (down/up/left/right); iso uses 4 diagonal facings. Code asks the atlas for "the frame facing this way", never for fixed frame numbers.
8. **Movement** goes through one input module that returns a world-space direction. Tap-to-walk uses the existing tile pathfinding (`scenes/pathfind.ts`), which works in both views.
9. **UI never measures the map picture**: the mini-map and "Who's where" draw from `rooms.ts`.
10. Walls that would hide people in iso (front walls) are marked in the data now (`wall.side`), so R6 can cut them away or fade them.

**Notes from the packs already checked:**
- *Assorted Disco* (#7) is **side-view and large** (DJ 256 × 172, jukebox 96 × 172). It doesn't match top-down. Use only `DanceFloor.png` (tile colours) and `DiscoBall.png` (scaled to 16–32 px). Redraw the DJ booth/jukebox top-down from furniture packs or in code. Skip the bottles: keep it friendly.
- *Forest animals* (#10) are proper 16 px top-down: fox, doe, owl, squirrel, frog, with idle + run in 4 directions. CC0. They're a perfect match for the current style.
- *Coffee Shop* (#4) is 32 px top-down, with good counters, lamps, shelves and a brick/diamond floor. It's great for the Lounge if the 32 px look wins.

---

## 6. Phase R3 — Build the new house
- **Look A (16 px), following the iso-ready rules in §5.** Start R3 with `src/house/projection.ts`, depth by `depthOf()`, furniture as data with footprints and tile-unit positions in `MoveMsg`, before drawing any new room.
- Generate the octagon house from `rooms.ts` with the chosen pack(s): stepped diagonal walls, a distinct floor and wall per room, and furniture recipes per theme (section 2 table).
- **Disco:** colour-changing floor (cycle tile tints every beat), glitter ball with rotating light specks, light sweeps, jukebox UI (a few CC0 loops; ask Diesel before adding music files), dance emote.
- **Library:** quiet voice mode (reuse the whisper falloff from the hallway code), shelves and nooks, study timer.
- **Gaming room:** move every game spot here (plus the Lounge's second table). Arcade cabinet = Quick Draw.
- **Café:** counter, stools, daily "special" on the fridge (a fun line, rotates daily).
- **Garden + Rooftop:** outdoor tiles, a day/night sky that follows each viewer's local time, stars, pond, fire pit. The rooftop is reached by stairs from the hall (a short fade between maps, or the same map up a level).
- **Lounge:** sofas, fireplace, TV "watch party" card, game table.
- **Do not disturb:** a sign on the door, the soft warning before entering, and it auto-clears when the room is empty.
- Lighting pass: night tint, warm lamp pools, and rooms with people inside glow brighter from the hall (keep from NEXT.md §4.2).
- Migration: retire `room_01..08`. Old chat history in those rooms stays readable from an "Old rooms" archive in settings for one release.

**Done when:** you can walk the whole house on a phone. All 7 rooms + hall + porch look distinct and work with the right voice mode. Walls (including diagonals) block correctly. Do-not-disturb works between two accounts. A review against the iso-ready rules (§5) finds no new pixel positions in game logic and no hand-set floor depths. "Who's where" and the map show the new shape. The e2e tests, updated for the new map, pass.

## 7. Phase R4 — Skins and animals
### Skins (target **60+ choices**)
- Sources: Ninja Adventure (**93** 16 px characters, CC0), the existing 20 (chibis + LimeZu), Cute Fantasy free (non-commercial), and Sunnyside humans (check licence). Use only the 16 px ones (look A). These are top-down only; iso skins come in R6, so keep the atlas format able to hold diagonal facings (§5 rule 7).
- Normalise everything to one sheet format: 4 directions × walk + idle. Build `public/assets/characters/atlas.png` + `atlas.json`, generated by a script in `scripts/`.
- Picker redesign: categories (People, Ninja, Fantasy, Animals-as-avatars), search, a big animated preview, **favourites**, and **"locked until level X"** for some skins. This links to `LEVELS.md` §5: reward skins every 5 levels, with no gameplay advantage.
- Store `character_key` (text) instead of `character_index` (0–19). Add a migration that maps old indexes to keys.

### Animals (the house feels alive)
- Ambient animals wander in fitting places: fox, doe, owl, squirrel, frog (#10); cat, bunny, pig, sheep and more (#11, non-commercial); and Ninja Adventure animals.
- There is already a critters system (`src/critters/`, catching works live). **Extend it** rather than writing a new one: per-room spawn tables (fox/doe/frog in the Garden, owl in the Library, cat in the Café, pigeon on the Rooftop if a pack has one), and more critters when more people are in.
- **Pets**: each member can adopt one animal that follows them around (cosmetic). It is unlocked by level or a medal and stored on the profile.

**Done when:** the picker shows 60+ skins and works smoothly on a 360 px phone, old profiles keep their character, at least 10 animal types appear around the house, and pets follow their owner for everyone watching.

---

## 8. Packs — all downloaded (18 Oct 2026)

All 13 packs are downloaded. They're in **`assets/raw/redesign-packs/`** on Diesel's laptop (gitignored) and in the handoff zips: `DieselHouse_v3_handoff.zip` (118 MB, original zips) and **`DieselHouse_v3_lite.zip`** (20 MB: packs already unzipped, with audio, preview GIFs and engine projects removed but every image kept; use this one to upload to a chat). Unzip each into its own subfolder. Copy only what you use into `public/assets/`, and add it to `assets/manifest.json` (with a `commercial` flag), `ASSETS.md` and the Credits screen.

Every pack has a contact sheet in `design/redesign/contact_*.png`. **Look at those first**; don't open hundreds of PNGs one by one.

| # | Pack | Size / what's inside | Grid | Licence (checked) | Contact sheet |
|---|---|---|---|---|---|
| 1 | [Ninja Adventure](https://pixel-boy.itch.io/ninja-adventure-asset-pack) | 94 MB · **93 character skins** (each `SpriteSheet.png` 64×112 = 4 dirs × walk + `Faceset.png`), **26 animals** (cats, dogs, horse, pig, frog, parrot, racoon…), **66 monsters + 20 bosses**, house/interior/floor/nature tilesets, FX, UI, music + SFX | 16 px | **CC0** (`LICENSE.txt`) | `ninja_characters`, `ninja_animals`, `ninja_monsters`, `ninja_tilesets` |
| 2 | [Cozy Interior 165+](https://sleepless-poetry.itch.io/cozy-interior-165-pixel-art-furniture-assets) | 165 single-PNG furniture props (living room, kitchen, bedroom, electronics). No walls or floors | 16 px | Commercial OK, no resale/redistribution | `cozy_interior_165` |
| 3 | [Pixel Interior LRK](https://bitglow.itch.io/pixelinterior-livingroomkitchen) | Living room, kitchen, hallway, colour variants | 16 px | Bitglow licence (`license.txt`): personal + commercial, no resale or standalone redistribution | `bitglow_lrk` |
| 4 | [Cozy Interiors 32x32](https://feyza5.itch.io/cozy-library) | Book shop (→ Library), Coffee shop (→ Café), Alchemy shop | 32 px | Commercial OK, no resale, no AI-derivatives | `feyza5_shops`, `downloaded` |
| 5 | [Cozy Reading Nook](https://summerpixl.itch.io/cozy-reading-nook-free-pixel-art-interior-sample) | 12 props: armchair, side table, rug, books, lamp, plant, shelf, window, curtains, floor, wallpaper (1× + 2×) | 32 px | **Unclear**: the page and README defer to a LICENSE file that isn't in the zip. Use only for mock-ups until Diesel asks the author. | `reading_nook` |
| 6 | [House Interior 32x32 LITE](https://graduation-cat.itch.io/house-interior-tileset-32x32) | One sheet: walls, floors, windows, kitchen, bathroom, living, small items | 32 px | Commercial OK, no resale | `graduation_cat` |
| 7 | [Assorted Disco](https://opengameart.org/node/31404) | Side-view, large. Use only `DanceFloor.png` + `DiscoBall.png` | n/a | CC0 | `downloaded` |
| 8 | [Kenney Isometric Library](https://kenney-assets.itch.io/isometric-library-tiles) | Iso library tiles (Option C mock only) | iso | CC0 | `kenney_iso_library` |
| 9 | [Tiny Interior Decoration](https://lumeish.itch.io/tiny-interior-decoration-isometric-free) | 150 tiny iso props (Option C mock only) | iso | CC-BY-SA 4.0: credit lumeish | `lumeish_iso` |
| 10 | [Forest Animal Pack](https://opengameart.org/node/185579) | Fox, doe, owl, squirrel, frog; idle + run in 4 directions | 16 px | CC0 | `downloaded` |
| 11 | [Free Pixel Animal Pack](https://pixel-wanderer.itch.io/free-pixel-animal-pack-16x16-weekly-updates) | Bunny, cat, pig, cow, bull, rat, ram, sheep; idle + move | 16 px | **Non-commercial only** | `animals_pixelwanderer` |
| 12 | [Cute Fantasy (free)](https://kenmi-art.itch.io/cute-fantasy-rpg) | Player, animals, enemies, basic tiles | 16 px | **Non-commercial only**, credit Kenmi | `cute_fantasy` |
| 13 | [Sunnyside World](https://danieldiggle.itch.io/sunnyside) | 49 MB · Human (20 actions incl. ATTACK, HURT, DEATH, ROLL), **Goblin**, **Skeleton** (attack/hurt/death), big 16 px world tileset + 32 px forest, UI. Also `sunnyside_world_chatacter_anim_human_v1.0.aseprite` (4/6/8-way movement beta). Characters are side-facing (left/right), frames 96×64 | 16 px | Commercial OK, credit appreciated, **no resale/repackaging, no AI training** | `sunnyside` |

Not needed: `Godot Project V4.zip` and `GodotProject.zip` (Ninja Adventure's Godot samples), which were also downloaded. They're left out of the handoff.

**What this means for the plan:**
- **Skins (R4):** Ninja Adventure alone gives **93 CC0 skins** in one format, so 60+ is easy. The style is chunky 16 px with big heads, which differs from the current LimeZu/chibi people. **R2 must decide:** move everyone to Ninja-style (one consistent look, recommended), or keep both styles as separate picker categories.
- **Animals (R4):** 26 (Ninja) + 5 (forest) + 8 (Pixel Wanderer) + Cute Fantasy, so **35+ animal types**. Use CC0 ones first.
- **Ghoul night (v3):** Ninja's 66 monsters (top-down, matching the skins) are a better fit than Sunnyside's side-facing goblins/skeletons. Keep Sunnyside as the backup/combat-animation reference.
- **Licence rule:** 11 and 12 are **non-commercial**. 5 is unclear. Tag them `commercial: false` in the manifest so they can be swapped out if Diesel House is ever sold. Never redistribute any pack's raw files: the repo stays private, and raw zips stay out of git.

---

## 9. Phase R5 — UI/UX pass (after the look is chosen)
- Re-skin all panels from the chosen pack + `theme.css` tokens, so one visual language covers the HUD, sheets, toasts and game panels.
- **Navigation:** "Who's where" becomes a tappable mini-map of the octagon house (tap a room → walk there). Add room previews ("3 in the Disco · music on", "Library · do not disturb").
- **First-run:** a 3-step tour: walk, talk, rooms.
- **Feedback everywhere:** every tap gets a sound + visual response; every network wait shows a pixel spinner, never a frozen screen; every error says what to do next.
- **Accessibility:** tap targets ≥ 44 px, contrast AA, reduced-motion setting (turns off disco flashing, which is also a **photosensitivity** concern, so default the disco floor to a slow, soft cycle with no strobing).
- Run the `design:accessibility-review` and `design:ux-copy` skills over the result.

**Done when:** a new friend can log in on a phone and, without help, find a friend, join their room, go to the Disco and play a game. Check by watching one real friend try it.

---

## 10a. Phase R6 — Isometric house (the end goal; plan and ask before starting)
- **R6.0 Art first.** Isometric needs characters, animals and furniture in one iso style. Today there are only lumeish furniture (CC-BY-SA, credit) and Kenney Isometric Library (CC0, scaled down). Find iso character packs with 4 diagonal facings (60+ skins is the R4 target), iso animals and more iso furniture; make contact sheets; check every licence. If no character pack is good enough, stop and tell Diesel the options (commission art, AI-free pixel artists, or fewer skins).
- **R6.1 Renderer.** An iso version of `projection.ts` (2:1 diamonds) and a renderer that draws floors, back walls, cut-away or faded front walls, and furniture from the same data as top-down. Depth by `tx + ty`.
- **R6.2 Controls.** Arrow keys and WASD map to screen directions (up = up the screen), the joystick the same; tap-to-walk unchanged.
- **R6.3 Switch.** A setting to swap views during testing, then make iso the default. Keep top-down for one release.
- The mock-up `public/mockups/c.html` and `design/redesign/mockups/build_c.py` are the reference for colours, wall heights and the disco floor.

**Done when:** the whole house works in iso on a phone with the same features as top-down, and nothing in game logic, chat, voice or games had to change.

---

## 10. v3 — later, ask Diesel first: "Ghoul night"
Idea from Diesel: fighting ghouls, using the **Sunnyside World** pack (it has enemies and combat animations).
- A friendly co-op event: on some nights, ghouls (goblins/skeletons) shuffle into the Great Hall and friends tap/attack them together for XP. No deaths or loss, just a fun scramble.
- It would reuse the critters spawn system and the game host/snapshot framework (`games/controller.ts`), and needs a combat-lite input (tap to swing) plus a health bar.
- **Not part of R0–R5.** Write a proper plan and ask before starting.

---

## 11. Order
R0 audit/bugs → R1 foundations → R2 choose look (done: A now, C later) → R3 new house (in A, iso-ready) → R4 skins + animals → R5 UI/UX → R6 isometric (plan + ask first) → (v3 ghouls, ask first). Stop after each for Diesel to test. Update the free-tier budget check (`UPDATE.md` §6) at the end of R3 and R4 (disco lights and pets must not add Realtime messages per frame).
