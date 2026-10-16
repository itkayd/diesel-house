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
`.ogg` + `.mp3` pairs in `public/assets/sfx/` (22 kHz, ~40–50 kbps, ≤ 40 KB each, 155 KB in all) and lists each
one, with its exact source file, in `assets/manifest.json`.

| Pack | By | Used for | Licence |
|---|---|---|---|
| RPG Audio (`kenney_rpg-audio.zip`) | Kenney | Knock (a thump, twice), door opening, footsteps | CC0 |
| Interface Sounds (`kenney_interface-sounds.zip`) | Kenney | Join/leave chimes, click, confirm | CC0 |
| Digital Audio (`kenney_digital-audio.zip`) | Kenney | Doorbell (two-tone), power-up, emote pop | CC0 |
| Music Jingles (`kenney_music-jingles.zip`) | Kenney | Win and lose jingles (8-bit) | CC0 |
| The Essential Retro Video Game Sound Effects Collection [512 sounds] | **Juhani Junkala** | Error, level-up fanfare | CC0 (credited anyway) |
| SoundPack01 | OpenGameArt | Challenge done (rise), coin | CC0 |
| `oga_medals.png` | OpenGameArt | Badge medals: `public/assets/ui/medals.png` (12 × 48 px strip, cropped for design/game/v2.html) | CC0 |

Still to use (UPDATE.md Phase 9+): Kenney emotes, playing cards, UI pack pixel adventure, input prompts, casino audio, boardgame pack.

## Rules
- **Keep the repo private.** LimeZu and finalbossblues terms don't allow public redistribution.
- **Never commercialise** this app with the LimeZu free pack in it. If that changes, buy the full LimeZu pack first.
- Add an in-app **Credits** screen listing LimeZu, finalbossblues, Kenney, Lucide and OpenMoji.

## Scale note
The Kenney pack is 16×16 too, but its palette is slightly different. Prefer LimeZu for anything visible in rooms; use Kenney only for props LimeZu's free pack doesn't have.
