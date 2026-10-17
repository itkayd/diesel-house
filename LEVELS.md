# LEVELS.md — Levelling system (17 Oct 2026)

Part of **Phase 14** (`UPDATE.md` §5). Where this file and `UPDATE.md` differ on levels, **this file wins**.

**Rule from Diesel: there is no max level.** Nothing in the code, database or UI may assume a cap.

---

## 1. The curve

Everyone starts at **Level 1 with 0 XP**.

- **Levels 1 → 21:** each level costs 100 XP more than the last (100, 200, 300 … 2,000). Same as the v2 mock, so early levels come quickly.
- **Level 21 onwards:** every level costs a **flat 2,000 XP**, forever. This keeps level-ups coming at a steady pace instead of turning into a wall.

Total XP needed to *reach* level L:

```
xpFor(L) = 50 * (L - 1) * L              if L <= 21
xpFor(L) = 21000 + 2000 * (L - 21)       if L > 21
```

| Level | Total XP | XP to next level |
|---|---|---|
| 1 | 0 | 100 |
| 2 | 100 | 200 |
| 5 | 1,000 | 500 |
| 10 | 4,500 | 1,000 |
| 15 | 10,500 | 1,500 |
| 20 | 19,000 | 2,000 |
| 21 | 21,000 | 2,000 |
| 30 | 39,000 | 2,000 |
| 50 | 79,000 | 2,000 |
| 100 | 179,000 | 2,000 |

Rough pace for a friend who does most challenges (~130 XP/day): Level 5 in about a week, Level 10 in about a month, Level 20 in about 5 months, then a new level roughly every 2 weeks with no end.

### Code (one function each side — keep them identical)
- `src/challenges/levels.ts`: `xpFor(level)`, `levelOf(xp)` (direct formula, no loops: solve the quadratic below 21,000 XP, divide above it), `progress(xp) → { level, intoLevel, levelSize, pct }`.
- SQL: `public.level_for_xp(xp bigint) returns int` (immutable), used by `record_events` to set `profiles.level`.
- Unit test both against the table above, plus 99, 100, 20,999, 21,000, 22,999, 23,000 and 10,000,000 XP.

## 2. Storage (no caps anywhere)
- `profiles.xp` → **`bigint`**, `profiles.level` → `int`, both default to 0 / 1. No `check (level <= …)` constraints.
- `profiles.level` is always derived from `xp` by `level_for_xp()` inside the RPC — never written by the client.
- XP only comes from the server-side `record_events` RPC (already planned in `UPDATE.md` §5), which keeps the per-kind daily caps so nobody can farm levels from the console.

## 3. Ranks (a title every 10 levels, never-ending)
| Levels | Title | Badge colour |
|---|---|---|
| 1–9 | Visitor | cream |
| 10–19 | Housemate | lamp (`--lamp`) |
| 20–29 | Regular | ok green |
| 30–39 | Keyholder | sky blue |
| 40–49 | Landlord | purple |
| 50+ | Legend | gold, plus **one star per 50 levels** (50 = ★, 100 = ★★, 150 = ★★★ …) |

Show the title on the profile sheet and in the level-up overlay. The name-tag badge shows just the number in the rank colour. Each rank also has its own **medal** — see section 7.

## 4. Display rules for big numbers
- Level badge on name tags and the HUD XP chip must fit **3+ digits** (test with level 999) without overflowing.
- XP shown with thousands separators in the viewer's locale (`toLocaleString()`), e.g. "23,450 XP".
- Progress bar always uses XP *within* the current level (`intoLevel / levelSize`), so it never stalls visually at high levels.
- Several level-ups at once (e.g. a big weekly reward): play the level-up overlay **once**, showing the final level ("Level 22 → 24").

## 5. Rewards (cosmetic only, nothing that gives an advantage in games)
- Every level: level-up overlay + sound, confetti for people in the same room.
- Every 5 levels: a new name-tag frame colour to choose from on the profile.
- Every 10 levels: new rank title + rank medal (section 7).
- Every 50 levels: a Legend star on the Legend medal.
- Later (ask Diesel first): room decorations unlocked by level.

## 6. Leaderboard
Weekly leaderboard stays on **XP earned this week** (from `xp_ledger`), not total level, so newer friends can still win a week. Show each person's level and rank badge next to their name.

## 7. Medals (linked to levels both ways)

Medals are the badges already in the profile (`src/ui/profile.ts`, sprites in `public/assets/ui/medals.png`, OpenGameArt `oga_medals.png`, CC0). Levels and medals feed each other:

1. **Levels → rank medals.** Reaching each rank awards that rank's medal.
2. **Medals → XP.** Earning any medal for the first time gives a one-off XP bonus, which moves you towards the next level.

### 7.1 Rank medals (new, one per rank)
| Medal | Awarded at | Medal style |
|---|---|---|
| Visitor | Level 1 (everyone, on first visit) | plainest / darkest medal |
| Housemate | Level 10 | bronze |
| Regular | Level 20 | silver |
| Keyholder | Level 30 | gold |
| Landlord | Level 40 | the most ornate medal on the sheet |
| Legend | Level 50 | star / crown medal, with **star pips drawn in code** under it: one ★ per 50 levels (★ at 50, ★★ at 100 …). Above 5 stars show "★ × 7" so it never runs out of room. |

- Crop 6 medals from `assets/raw/new-packs/oga_medals.png` (48 px cells) that read as a clear plain → bronze → silver → gold → fancy progression. If the sheet hasn't got enough matching ones, reuse one medal shape and tint it in code with the rank colours from section 3.
- Append them to the strip as **cells 12–17** so the existing 12 achievement medals keep their positions (`public/assets/ui/medals.png` becomes 18 × 48 px). Update `assets/manifest.json`.
- Profile: a **"Rank" row** above the Badges grid showing all 6 rank medals — earned ones in colour, the next one as a silhouette with "Level 30 · 4,000 XP to go".
- Your current rank medal appears small (16 px) on the HUD XP chip next to your level, and on the weekly leaderboard next to each name.
- Level-up overlay: when the new level starts a new rank, show the new medal big with the title ("New rank: Keyholder").

### 7.2 Replace the old level badges
The mock's `lvl5` ("Level 5") and `legend` ("House legend — reach level 10") achievement badges overlap with ranks. **Remove both**; the rank medals replace them. Their two medal sprites (cells 8 and 9) can be reused for new achievements later. That leaves **10 achievement medals**.

### 7.3 XP for achievement medals (one-off, first time only)

(Updated 18 Oct for REDESIGN.md: rooms have no owners, so "Home maker", "First knock" and "Party host" became the three new medals below. They reuse the same medal sprites.)
| Medal | XP |
|---|---|
| House tour (visit all 7 rooms) | 25 |
| Dance machine (2 min on the Disco floor) | 25 |
| Social butterfly | 50 |
| Over and out (walkie 3×) | 50 |
| Night owl | 50 |
| High roller (double six) | 75 |
| Fastest hand (win Quick Draw) | 75 |
| Duelist (win 3 RPS duels) | 100 |
| Party starter (be in a room when it reaches 4 people) | 150 |
| Slow & steady (7-day streak) | 200 |
| **Total** | **800** |

Rank medals give **no** XP (they come *from* XP, so no loops).

### 7.4 Storage and rules
- New table `user_medals(user_id uuid, medal_id text, earned_at timestamptz default now(), primary key (user_id, medal_id))`. RLS: members can read everyone's medals; nobody writes directly.
- Medals are awarded only inside the `record_events` RPC (achievement medals from events, rank medals whenever `level_for_xp()` crosses 10, 20, 30, 40, 50). The primary key means a medal — and its XP — can only ever be given once, even on refresh or replay.
- Achievement medal XP goes into `xp_ledger` with reason `medal:<id>` so it shows on the weekly leaderboard like any other XP.
- Guests: medals and XP don't apply (same as the rest of Phase 14).
- Toast on earning: medal sprite + name + "+75 XP", medal sound, then the level-up overlay if the bonus caused a level-up (medal toast first, level-up second).

**Done when:** the Phase 14 "Done when" in `UPDATE.md` passes, the unit tests above pass on both TS and SQL, a test account with 10,000,000 XP shows level 5,010 correctly on the name tag, HUD and profile, no code path rejects a level over 100, a test account crossing level 30 gets the Keyholder medal exactly once, the Legend medal shows ★★ at level 100, and earning "Party starter" adds exactly 150 XP once (not again on refresh).
