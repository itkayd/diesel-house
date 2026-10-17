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

Show the title on the profile sheet and in the level-up overlay. The name-tag badge shows just the number in the rank colour.

## 4. Display rules for big numbers
- Level badge on name tags and the HUD XP chip must fit **3+ digits** (test with level 999) without overflowing.
- XP shown with thousands separators in the viewer's locale (`toLocaleString()`), e.g. "23,450 XP".
- Progress bar always uses XP *within* the current level (`intoLevel / levelSize`), so it never stalls visually at high levels.
- Several level-ups at once (e.g. a big weekly reward): play the level-up overlay **once**, showing the final level ("Level 22 → 24").

## 5. Rewards (cosmetic only, nothing that gives an advantage in games)
- Every level: level-up overlay + sound, confetti for people in the same room.
- Every 5 levels: a new name-tag frame colour to choose from on the profile.
- Every 10 levels: new rank title + badge (adds to the existing "Level 5" and "House legend (level 10)" badges).
- Every 50 levels: a Legend star.
- Later (ask Diesel first): room decorations unlocked by level.

## 6. Leaderboard
Weekly leaderboard stays on **XP earned this week** (from `xp_ledger`), not total level, so newer friends can still win a week. Show each person's level and rank badge next to their name.

**Done when:** the Phase 14 "Done when" in `UPDATE.md` passes, the unit tests above pass on both TS and SQL, a test account with 10,000,000 XP shows level 5,010 correctly on the name tag, HUD and profile, and no code path rejects a level over 100.
