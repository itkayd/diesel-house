# LICENSES.md — commercial-safe asset audit (18 Oct 2026)

Diesel House is going **public and paid** (see `STORE.md`). From now on, **only ship assets we're allowed to sell with.** This file wins over `ASSETS.md` on licensing. Update both when an asset changes.

Verdicts:
- ✅ **Safe**: CC0, or a licence that allows commercial use.
- ⚠️ **Fix**: allowed only with credit, or needs a check.
- ❌ **Replace before launch.**

---

## 1. What the live game ships today (`public/assets/`)

| Shipped file(s) | Source | Licence | Verdict | Action |
|---|---|---|---|---|
| `tiles/limezu_room_builder.png`, `furniture/limezu_interiors.png`, `characters/limezu_*` (4 people), login scene | LimeZu **Modern Interiors Free** | Free version is **non-commercial** (our own `ASSETS.md` says so) | ❌ | **Buy the full pack** ($1.50–3, [limezu.itch.io/moderninteriors](https://limezu.itch.io/moderninteriors)). It allows commercial use, requires credit plus a link to limezu.itch.io, and forbids resale. Or replace with Ninja Adventure / Bitglow / Cozy 165+ |
| `characters/chibis_a.png`, `chibis_b.png` (16 starter characters) | finalbossblues Modern Chibis | No formal licence. Author's comments only: "do whatever you want", but don't redistribute and "uncool" to feed to AI | ❌ (too informal for a paid app) | **Replace with Ninja Adventure characters** (CC0, top-down, with attack, jump and death, matching what the house is building towards) |
| `furniture/house_v3.png`, `tiles/house_extra.png` | Bitglow LRK, Cozy Interior 165+, Ninja Adventure, Disco ball, drawn in code | Commercial OK, no resale; CC0 | ✅ | Keep. Credits screen |
| `furniture/kenney_roguelike_indoor.png` | Kenney Roguelike Indoors | CC0 | ✅ | — |
| `ui/ui-pack.png`, `emotes/*`, `prompts/*`, `games/cards.*` | Kenney | CC0 | ✅ | — |
| `sfx/*` | Kenney audio packs, Juhani Junkala, SoundPack01 | CC0 | ✅ | — |
| `ui/medals.png` | OpenGameArt `oga_medals` | CC0 (per ASSETS.md) | ⚠️ | Re-check the OGA page before launch and save a screenshot of the licence into `design/licences/` |
| Fonts: Pixelify Sans, Atkinson Hyperlegible | Google Fonts | OFL | ✅ | — |
| `lucide` icons | npm | ISC | ✅ | — |
| OpenMoji reactions | npm | CC BY-SA 4.0 | ⚠️ | Credit on the Credits screen (already listed). Don't edit the emoji art |
| ElevenLabs sounds (planned in CLAUDE.md) | — | Commercial use depends on the ElevenLabs plan | ⚠️ | None ship today (all sfx are Kenney). Only add ElevenLabs audio made on a paid plan |

## 2. Raw packs in `assets/raw/redesign-packs/` (v3 handoff)

| Pack | Licence | Verdict |
|---|---|---|
| Ninja Adventure (pixel-boy) | CC0 | ✅ Core pack: 93 characters (90 with **Attack, Jump, Dead, Item, Special1/2, Walk, Idle**), 66 monsters, 20 bosses, FX, weapons, items |
| Cozy Interior 165+ (Sleepless Poetry) | Commercial OK, no resale | ✅ |
| Pixel Interior LRK (Bitglow) | Commercial OK, no resale or standalone redistribution | ✅ |
| feyza5 Book/Coffee/Alchemy shops | Commercial OK, no resale, no AI-derivatives | ✅ (32 px, not used) |
| Graduation Cat LITE | Commercial OK, no resale | ✅ (32 px, not used) |
| Assorted Disco (OGA) | CC0 | ✅ |
| Kenney Isometric Library | CC0 | ✅ |
| Forest animals (inkBubi, OGA) | CC0 | ✅ |
| Sunnyside World | Commercial OK, no resale, no AI training | ✅ |
| lumeish iso furniture | CC-BY-SA 4.0 | ⚠️ Credit "lumeish"; any edited sprites stay CC-BY-SA |
| **Pixel Wanderer animals (free)** | **Non-commercial only** | ❌ **Don't ship.** Use Ninja Adventure's 26 animals plus the forest animals instead |
| **Cute Fantasy (free)** | **Non-commercial only** | ❌ **Don't ship** |
| **Cozy Reading Nook** | Unclear (LICENSE file missing from zip) | ❌ until the author confirms by email |

## 3. New packs for fighting, movement and the store (18 Oct 2026)

Raw files go in `assets/raw/v4-packs/` (gitignored). Verified on each pack's page on 18 Oct 2026.

| # | Pack | What's in it | View / size | Licence | Use for |
|---|---|---|---|---|---|
| N1 | [Pixel Adventure 1](https://pixelfrog-assets.itch.io/pixel-adventure-1) (Pixel Frog) | 4 heroes: **jump, double jump, wall jump, fall, hit, run**; fruit, traps, platforms | Side-view, 32 px | **CC0** | Side-view mini-games (platform race, Ghoul-night bonus rounds) |
| N2 | [Tiny Swords](https://pixelfrog-assets.itch.io/tiny-swords) (Pixel Frog): "old version CC0" + Free Pack | Warrior, Lancer, Archer, Monk, Pawns with **attack** animations; buildings, FX | Top-down, 64 px grid | Old version **CC0**; new Free Pack: commercial OK, no resale | Event skins and Ghoul night co-op enemies/heroes |
| N3 | [16×16 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii) (0x72) | Heroes (knight, elf, wizard, lizard, dwarf), many monsters, weapons, idle and run (no attack frames; swing the weapon sprite in code) | Top-down, 16 px | **CC0** | Ghoul night monsters, weapon sprites |
| N4 | [Legend Main Character](https://foozlecc.itch.io/legend-main-character) (Foozle) | **Sword attacks 1–3, bow attacks, block shield, swing hammer, throw, death**, in 4 directions, 3 colours | Top-down | **CC0** | Combat move reference / premium "Legend" skin set |
| N5 | [Tiny RPG Character (free Soldier & Orc)](https://zerie.itch.io/tiny-rpg-character-asset-pack) (Zerie) | Idle, walk, **attack, hurt, death** | Side-view, 100 px | Commercial OK, no resale or AI | Arena duel mini-game |
| N6 | [Brackeys Platformer Bundle](https://brackeysgames.itch.io/brackeys-platformer-bundle) | Knight, slime, tiles, coins, music, sfx | Side-view | **CC0** | Platform mini-game |
| N7 | [Top Down Adventure Assets](https://opengameart.org/content/top-down-adventure-assets) (ansimuz) | 4-direction player, 10 NPCs, 2 tilesets, 5 chiptune tracks | Top-down, 16 px | **CC0** | **Disco music** (CC0 chiptunes), NPCs |
| N8 | [Square Characters 8-dir](https://opengameart.org/content/hand-drawn-square-characters-animated-8-directions-top-down-free-cc0) (rgsdev) | Base, hero, skeleton, monster: walk, **jump**, death/explosion, 8 directions | Top-down, 128 px | **CC0** | Experimental "big jump" emote; probably not core |
| N9 | [Kenney Pixel Platformer](https://kenney.nl/assets/pixel-platformer) | Platformer tiles + characters | Side-view, 18 px | **CC0** | Platform mini-game |
| N10 | [Kenney Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) | Heroes, monsters, weapons, potions, chests | Top-down, 16 px | **CC0** | Store items (chests, potions), Ghoul night loot |
| N11 | [Kenney 1-Bit Pack](https://kenney.nl/assets/1-bit-pack) | 1,000+ icons (coins, gems, keys, hearts, UI glyphs) | 16 px | **CC0** | Store and currency icons |
| N12 | [Kenney Game Icons](https://kenney.nl/assets/game-icons) | UI icons (cart, lock, star, plus, gift…) | Vector/PNG | **CC0** | Store UI buttons |
| N13 | [Kenney Particle Pack](https://kenney.nl/assets/particle-pack) | Sparkles, stars, smoke, magic | PNG | **CC0** | Purchase confetti, level-up, hit effects |
| N14 | [Gems / Coins Free](https://laredgames.itch.io/gems-coins-free) (La Red Games) | **Animated** gold/silver/red coins + yellow/blue/grey/red/green gems | 16 px | **CC0** | **Gems and Coins currency icons** (spinning) |
| N15 | [Spinning coin](https://opengameart.org/content/spinning-coin-anim) (rzuf) | Spinning coin sheet + frames | — | **CC0** | Backup coin icon |

**Rejected after checking:**
- Mystic Woods free: non-commercial.
- Cute Fantasy: non-commercial.
- Sprout Lands: non-commercial.
- Pixel Crawler (Anokolisa): terms not visible, and they sit on Google Drive.
- Animated spinning gems (Code Inferno): CC-BY 3.0 and 60 MB; credit needed, and too big.
- Mana Seed: paid, licence restrictions.

## 4. Character plan for selling (links to `STORE.md` §3)
- **One style:** Ninja Adventure 16 px. Every playable character is a Ninja-format sheet: 4 directions × Walk, Idle, Attack, Jump, Dead, Item, Special.
- Starter characters (free) and shop characters (coins/gems) all come from Ninja's 93, plus recolours we make ourselves. Recolours of CC0 art are ours to sell.
- **Exclusive / limited characters:** commission an artist in the same format. Get a written licence that assigns us full commercial rights. This is the long-term "our own style" moat.
- Monsters and bosses (Ninja's 86) become **event skins** ("Ghoul night: play as a Ghoul") and Ghoul night enemies.
- Side-view packs (N1, N5, N6, N9) are for **mini-games only**, never the house, so the house keeps one consistent look.

## 5. Rules for every new asset
1. Before adding an asset, record its source URL, author, licence and date checked in `assets/manifest.json` (`licence`, `commercial: true|false`, `credit`).
2. A CI check (add in the store phase) fails the build if any shipped asset has `commercial: false` or no licence.
3. Save a screenshot of each licence page in `design/licences/<pack>.png`. Licence pages change, and this is our proof.
4. Never redistribute raw packs: the repo stays private, raw zips stay gitignored.
5. The Credits screen lists every pack that asks for or appreciates credit: LimeZu (required once bought), lumeish, OpenMoji, Juhani Junkala, Pixel Frog, Zerie, Bitglow, Sleepless Poetry, ansimuz, Foozle, 0x72, Kenney, pixel-boy.

## 6. Before launch: licence to-do
- [ ] Buy the LimeZu full pack, or remove every `limezu_*` file (tiles, furniture, 4 characters, login scene).
- [x] Replace the 16 chibis with Ninja Adventure starters. Migrate `profiles.character_index` → `character_key` (see `STORE.md` §3.4). Done in R4 (19 Oct 2026): chibi and LimeZu character files removed; migration `20261103_character_key.sql`.
- [ ] Remove Pixel Wanderer, Cute Fantasy and Reading Nook from anything shipped, including the R2 mock-ups in `public/mockups/`.
- [ ] Re-check the medals licence and save proof.
- [ ] Add the `commercial` flag to the manifest, plus the CI check.
- [ ] Update `ASSETS.md`, the Credits screen and the store listing text.
