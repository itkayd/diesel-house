# Assets — sources, licences, credits

All art is free. Three packs are merged into one pixel-art style (16×16 tiles, characters 16×32).

| Pack | Zip file | Source | Used for | Licence |
|------|----------|--------|----------|---------|
| Modern Interiors (free version) by LimeZu | `Modern_Interiors_Free_v2.2.zip` | https://limezu.itch.io/moderninteriors | Floors, walls, living-room furniture, room builder, 4 animated characters | Free for **non-commercial** use only. See LICENSE.txt in the zip. |
| 16-Char Sprite Collection (Modern Chibis, Asset Alliance) by finalbossblues | `alliance_chibis_character_collection.zip` | https://finalbossblues.itch.io/16-char-sprite-collection-modern-chibis-asset-alliance | 16 player characters with 4-direction walk cycles (16×32 frames) | Free. Artist asks: don't redistribute directly (link back instead) and don't feed to AI. |
| Roguelike Indoors by Kenney | `kenney_roguelike-indoors.zip` | https://kenney.nl/assets/roguelike-indoors | Extra furniture and props | CC0 (public domain) |

## Code-installed (no download)

| Package | Used for | Licence |
|---------|----------|---------|
| `lucide` | UI icons (mic, mute, lock, knock, captions, settings) | ISC |
| OpenMoji (`openmoji`) | Reaction emojis | CC BY-SA 4.0 — credit required |

## Sound effects and badges (v2, all CC0)

Unzipped in `assets/raw/new-packs/` (gitignored). `scripts/build-sfx.mjs` picks the sounds below, makes small mono
`.ogg` + `.mp3` pairs in `public/assets/sfx/` (22 kHz, ~40–50 kbps, ≤ 40 KB each, 222 KB in all) and lists each
one, with its exact source file, in `assets/manifest.json`. `scripts/build-v2-assets.mjs` cuts the game art below
into small packed sheets with Phaser atlas JSON (also listed in the manifest). The walkie-talkie click and static
are made in code (`src/ui/radioSfx.ts`).

| Pack | By | Used for | Licence |
|---|---|---|---|
| RPG Audio (`kenney_rpg-audio.zip`) | Kenney | Knock (a thump, twice), door opening, footsteps | CC0 |
| Interface Sounds (`kenney_interface-sounds.zip`) | Kenney | Join/leave chimes, click, confirm | CC0 |
| Digital Audio (`kenney_digital-audio.zip`) | Kenney | Doorbell (two-tone), power-up, emote pop | CC0 |
| Music Jingles (`kenney_music-jingles.zip`) | Kenney | Win and lose jingles (8-bit) | CC0 |
| The Essential Retro Video Game Sound Effects Collection [512 sounds] | **Juhani Junkala** | Error, level-up fanfare | CC0 (credited anyway) |
| SoundPack01 | OpenGameArt | Challenge done (rise), coin | CC0 |
| `oga_medals.png` | OpenGameArt | Badge medals: `public/assets/ui/medals.png` (12 × 48 px strip, cropped for design/game/v2.html) | CC0 |
| Casino Audio (`kenney_casino-audio.zip`) | Kenney | Dice shake and throw, card place / flip / shuffle, chips | CC0 |
| Playing Cards Pack (`kenney_playing-cards-pack.zip`) | Kenney | Pixel cards (52, backs, jokers) and 7 dice faces: `public/assets/games/cards.png` + `.json` (32 px cells, medium tilemap) | CC0 |
| Emotes Pack (`kenney_emotes-pack.zip`) | Kenney | Emote bubbles, Pixel **Style 1** only (as the v2 mock): `public/assets/emotes/emotes.png` + `.json` (16 px) | CC0 |
| Input Prompts Pixel 1-bit (`kenney_input-prompts-pixel-1-bit.zip`) | Kenney | Q, E, T, Space, tap and mic prompts (white): `public/assets/prompts/prompts.png` + `.json` | CC0 |
| UI Pack Pixel Adventure (`kenney_ui-pack-pixel-adventure.zip`) | Kenney | Panels, buttons, bars (small tiles, thick outline): `public/assets/ui/ui-pack.png`, 16 px spritesheet | CC0 |
| Boardgame Pack (`kenney_boardgame-pack.zip`) | Kenney | Not used: its pieces are 64 px vector art that doesn't read at 16 px, so Four in a Row draws pixel pieces in code; its sounds duplicate Casino Audio | CC0 |

## Rules
- **Keep the repo private.** LimeZu and finalbossblues terms don't allow public redistribution.
- **Never commercialise** this app with the LimeZu free pack in it. If that changes, buy the full LimeZu pack first.
- Add an in-app **Credits** screen listing LimeZu, finalbossblues, Kenney, Lucide and OpenMoji.

## Scale note
The Kenney pack is 16×16 too, but its palette is slightly different. Prefer LimeZu for anything visible in rooms; use Kenney only for props LimeZu's free pack doesn't have.
