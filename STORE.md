# STORE.md — Store, currencies, characters and VIP (18 Oct 2026, updated 19 Oct)

How Diesel House makes money. Read with `LICENSES.md` (only commercial-safe assets in the store) and `design/review/UI-REVIEW.md` (where the store sits in the UI). This file wins on anything about money, currencies, prices or ownership.

**Decision (19 Oct 2026):** **no subscription for now** (Diesel+ is paused). Money comes from **gem packs**, and gems buy **VIP Passes** and items. **Everything social is free for everyone:** voice, chat, every room, games, inviting friends, and your own house.

**Golden rules**
1. **Free to hang out, pay to show off.** Nothing you buy helps you win a game, and **XP is the same for everyone**. VIP gets more daily catches, but catches beyond the free limit give coins and collection progress, not XP (§4.2). Levels and medals stay earned.
2. **The server decides everything.** The client never calculates a price, a balance or ownership. It asks, then shows what the server says.
3. **No loot boxes or gacha.** Every item has a fixed, visible price.
4. **Integers only.** Gems and coins are whole numbers. Money is stored in pence. There are no floats anywhere in the economy.
5. **Every change to a balance is a ledger row.** The balance is a cache of the ledger, so one can always be rebuilt from the other.

---

## 1. Two currencies

| | **Coins** (earned) | **Gems** (premium) |
|---|---|---|
| Icon | Spinning gold coin `MonedaD.png` (N14 Gems/Coins, CC0) | Spinning blue gem `spr_coin_azu.png` (N14) |
| How you get them | Playing: daily login, challenges, games, critter catches, Ghoul night, levelling up | Buying gem packs; Season Pass; small rewards (every 5 levels) |
| Can you buy them with money? | **No** | Yes |
| Spend on | Common characters, common pets, basic decor, emotes | **VIP Passes**, Rare/Epic/Limited characters, voice effects, frames, house themes, Season Pass |
| Expire? | Never | Never (say so on the gem pack screen) |

Each item has **one** price, in coins or in gems, never both, so the shop is never confusing.

### 1.1 Coin earning (server-side, through the existing `record_events` RPC and its caps)

| Source | Coins | Daily cap |
|---|---|---|
| Daily visit | 50 (streak day 7+: 100) | once |
| Daily challenge done | 40–120 (by difficulty) | 3 challenges |
| Weekly challenge done | 200–400 | 3 / week |
| Win a mini-game | 20 | 200 / day from games |
| Play a mini-game (lose) | 5 | included in the cap above |
| Catch a critter | 10 (rare: 50) | **15 catches / day free, 40 / day VIP** (§4.2) |
| Level up | 100 × new level ÷ 10, rounded, min 50 | — |
| Ghoul night | 50–300 by contribution | per event |

**Target:** an active free player earns about **400 coins a day** (hard cap 800), so a Common character (2,000 coins) takes about 5 days. Measure this in the beta and tune it. All numbers live in one config table, `economy_config`, never hard-coded in the client.

## 2. Gem packs (real money)

UK prices include VAT. **Web only for now (§8), so payments go through Stripe and no app store takes a cut.** "Net to us" is after 20% VAT and Stripe's UK card fee (≈1.5% + 20p).

| Pack | Gems | Price | Gems per £ | Bonus | Net to us |
|---|---|---|---|---|---|
| Handful | 100 | £0.99 | 101 | — | ~£0.61 (the 20p fee hurts tiny packs; consider £1.99 / 210 as the smallest) |
| Pouch | 550 | £4.99 | 110 | +9% | ~£3.88 |
| Chest ★ "most popular" | 1,200 | £9.99 | 120 | +19% | ~£7.98 |
| Vault | 2,600 | £19.99 | 130 | +29% | ~£16.16 |
| Treasury | 7,000 | £49.99 | 140 | +39% | ~£40.71 |
| **Starter offer** (once per account, first 7 days) | 600 + 1 Rare character | £2.99 | — | — | ~£2.25 |

**Rule of thumb:** on the web, about **80% of the sticker price** reaches us after VAT and Stripe. If native apps come later, store billing drops that to about 70%.

## 3. Characters (buyable)

### 3.1 The catalogue
All characters use **one format**, Ninja Adventure 16 px (`LICENSES.md` §4): 4 directions × Idle, Walk, Attack, Jump, Dead, Item, Special. Every character can do the "crazy moves" (jump emote, attack in Ghoul night, a dramatic death in duels).

| Rarity | How many at launch | Price | ≈ £ | Source |
|---|---|---|---|---|
| **Starter** (free) | 12 | Free | — | Ninja Adventure |
| **Common** | 30 | 2,000 coins | (free) | Ninja Adventure |
| **Rare** | 30 | 400 gems | £3.60 | Ninja Adventure + our recolours |
| **Epic** | 15 | 800 gems | £7.30 | Ninja + recolour + special effect (sparkle trail, unique idle) |
| **Limited** (seasonal) | 2–4 per season | 1,500 gems, or a Season Pass reward | £13.60 | Commissioned art (we own it) |
| **Event** (monsters and bosses) | Rotating | Earned in Ghoul night, or 600 gems for 1 week | — | Ninja monsters |

Rules:
- Each character is owned once. Owning it unlocks it on every device.
- Every character comes with its matching **Faceset** portrait (Ninja provides one) for the profile, the chat and the leaderboard.
- **Try it on:** tap a locked character to wear it for 60 seconds, for yourself only. Others still see your current character. It's the best seller for cosmetics.
- Limited characters return at most once a year, and the shop says so honestly ("Back next Halloween").

### 3.2 Other items

| Kind | Price | Notes |
|---|---|---|
| Pets (follow you) | Common 3,000 coins · Rare 400 gems | Ninja's 26 animals + forest animals (CC0) |
| Emotes | 800 coins or 100 gems (by item) | Kenney emotes pack + jump/attack moves |
| Voice effects (radio, echo, deep, robot, chipmunk) | 250 gems | Web Audio filters on *your own* voice. The listener can turn them off |
| Name-tag frames | 150 gems | |
| House decor | 200–2,000 coins / 50–400 gems | For **your house**: every player has one, free (§4.3) |
| House themes (Neon, Haunted, Beach) | 1,200 gems | |
| Room boost (top of the public list for 1 h) | 100 gems | Max 1 active per user |
| **Season Pass** (8 weeks) | 400 gems **or** £3.99 | Free track + premium track |

### 3.3 Season Pass maths
- 40 tiers. Each tier = 1,000 season XP. Season XP comes from the same events as normal XP, 1:1, separate counter.
- **Free track:** 300 coins every other tier and 3 Common characters.
- **Premium track:** 1 Limited character (tier 40), 2 Epic, 4 Rare, 1 pet, 2 frames, 3 emotes, and **500 gems back** spread over tiers 5–35. Finishing the pass therefore pays for the next one, which keeps players coming back. Nothing in it helps you win.
- An active player (about 4,000 XP/week) finishes in about 10 weeks, so the season lasts 8 weeks plus a 2-week **catch-up boost** (×1.5 season XP in the last 14 days). Tune in the beta.

### 3.4 Data changes for characters
- `profiles.character_index smallint` → **`profiles.character_key text`** (e.g. `ninja.boy`, `ninja.cavegirl`). Migration maps old indexes to the new starters. Keep `character_index` one release for older clients, then drop it.
- `catalog_items` row for every character, with `kind = 'character'`, `rarity`, `price_coins` | `price_gems`, `sheet` (atlas path), `face`, `available_from` / `available_to`, `active`.
- Changing your character checks `inventory` server-side (RPC `set_character(key)`), so a hacked client can't wear an unowned skin. Other clients render whatever `character_key` the server holds.

## 4. VIP (bought with gems, no subscription)

### 4.1 VIP Pass
| Pass | Gems | ≈ £ (at the £4.99 pack rate) |
|---|---|---|
| VIP 3 days (try it) | 150 | £1.36 |
| VIP 7 days | 300 | £2.72 |
| VIP 30 days | 900 | £8.16 |

- **Never auto-renews.** It's a one-off purchase with gems, so no subscription billing, cancellations or renewal emails. Buying again **adds time** to the end of the current pass (stacks, up to 180 days ahead).
- The **expiry is stored on the server** (`vip_until timestamptz`) and checked on every perk, so the client can't fake VIP. The HUD shows "VIP · 5d left", and the store nudges gently 24 h before it ends.

**What VIP gets you:**
- **40 critter catches a day** instead of 15 (§4.2)
- **+25% coins** from every source. The daily coin cap also rises by 25%, so it's still capped
- **VIP badge** on your name tag, and a **gold name**
- **Bigger house:** 3 rooms instead of 1, and 2× decor slots (§4.3)
- **Host public rooms of 30** (free: 12)
- **VIP shop row:** 2 exclusive items a week, bought with gems
- **VIP corner** in the Disco (a velvet-rope spot on the floor). It's for show only: everyone can still hear and talk

### 4.2 Daily critter catches (free vs VIP)
| | Free | VIP |
|---|---|---|
| Catches per day | **15** | **40** |
| XP per catch | Normal for catches 1–15 | Normal for catches 1–15, **0 XP for 16–40** (coins + collection only) |
| Coins per catch | 10 (rare 50) | 10 (rare 50) +25% |
| Counts towards challenges / medals | Yes | Yes (challenge goals are designed to be reachable within 15) |

- The day resets at **the player's local midnight**, using the same time-zone logic as challenges.
- **This changes live code:** the database currently allows **25 catches a day for everyone**, in `catch_critter`/`critter_catches` (`20261029_more_critters.sql`). A new migration replaces the hard-coded 25 with `economy_config.catch_cap_free` (15) and `catch_cap_vip` (40), read inside the RPC together with `vip_until > now()`.
- The HUD shows "**Catches 7 / 15**". At the limit: "That's your 15 for today. New critters at midnight. VIP gets 40 a day". The message shows **once a day**, never as a pop-up on every critter.

### 4.3 Houses (free for everyone)
- Every player has their own house: **1 room free, 3 rooms with VIP**. Decorate it with decor from the shop or with critters you've caught (display shelf).
- **Open or invite:** set the house to *Private* (only people you invite), *Friends*, or *Public* (listed in the room browser). Invites are a link or a friend tap.
- When VIP ends, extra rooms are **locked, not deleted**: decor stays put and comes back when VIP does.

### 4.4 VIP levels (lifetime, badge only, later)
A small badge tier from total gems ever **bought**: VIP 1 at 500, VIP 2 at 2,500, VIP 3 at 10,000. It's a badge colour only, with no extra power, so it adds status without becoming pay-to-win. Leave it until after launch.

## 5. The economy engine (server-authoritative)

### 5.1 Tables (new migration; RLS: users read their own rows; **nobody writes directly**, only through the RPCs)

```
economy_config(key text pk, value jsonb)                 -- earn rates, caps, prices tuning
catalog_items(id text pk, kind, rarity, price_coins int null, price_gems int null,
              check ((price_coins is null) <> (price_gems is null)),   -- exactly one price
              sheet, face, available_from, available_to, active bool, sort int)
wallets(user_id pk, coins bigint ≥ 0, gems_free bigint ≥ 0, gems_paid bigint,  -- gems_paid may go < 0 only after a refund
        locked bool default false, updated_at)
ledger(id bigserial, user_id, currency ('coins'|'gems_free'|'gems_paid'), delta bigint ≠ 0,
       balance_after bigint, reason text, ref_type text, ref_id text,
       idempotency_key text unique, created_at)
inventory(user_id, item_id, source ('starter'|'coins'|'gems'|'pass'|'event'|'gift'|'vip'),
          acquired_at, primary key (user_id, item_id))
purchases(id, user_id, provider ('stripe'|'apple'|'google'), provider_txn_id unique,
          product_id, pence int, currency text, gems_granted int, status ('paid'|'refunded'|'chargeback'),
          raw jsonb, created_at)
vip(user_id pk, vip_until timestamptz, updated_at)                -- server-only; extended by buy_vip()
houses(owner_id pk, rooms int, visibility ('private'|'friends'|'public'), layout jsonb)
season_progress(user_id, season_id, xp, premium bool, claimed int[] , primary key(user_id, season_id))
```

### 5.2 RPCs (all `security definer`, members only, guests can't spend)

| RPC | What it does |
|---|---|
| `wallet()` | Returns `{coins, gems: gems_free+gems_paid, locked}` |
| `buy_item(item_id, idempotency_key)` | In **one transaction**: lock the wallet row `FOR UPDATE`, then check the item is active and in its window, not already owned, and that funds are sufficient (**price read from `catalog_items`; anything the client sends is ignored**). Spend `gems_free` first, then `gems_paid`. Write ledger row(s), insert into inventory, return the new wallet. The same `idempotency_key` returns the first result without charging again |
| `buy_vip(days, idempotency_key)` | Same locking and ledger as `buy_item`. Price from `economy_config` (3→150, 7→300, 30→900). Sets `vip_until = greatest(vip_until, now()) + days`, refuses past 180 days ahead |
| `catch_critter(slot, idx)` | Existing RPC, now reads the free/VIP cap (§4.2) and gives 0 XP after catch 15 |
| `grant(user, currency, amount, reason, ref, idempotency_key)` | Internal only (earn events, pass rewards). Called by other RPCs or by server webhooks with the service key, never by clients |
| `claim_pass_tier(season, tier)` | Checks XP ≥ tier × 1000, premium if needed, and not already in `claimed`; grants the reward |
| `set_character(key)` | Must own it (or it's a starter) |
| `try_on(key)` | Returns a signed 60-second token. The client shows the skin only locally |

### 5.3 Real-money flow (never trust the client)
1. The client opens checkout: Stripe Checkout on web, App Store / Play billing in the phone apps. **Digital goods inside iOS/Android apps must use store billing.**
2. **Only the server grants gems**, from verified webhooks or server notifications in a Vercel function `/api/payments/*`: check the signature, then upsert `purchases` by `provider_txn_id` (unique, so a repeat webhook does nothing), then `grant(...)`.
3. The client polls `wallet()` or listens on the user's own Realtime channel for the new balance, then shows "+1,200 gems" and confetti (Kenney Particle Pack).
4. **Refund or chargeback** webhook: mark the purchase `refunded`, then debit `gems_paid` by `gems_granted`. If that would go negative, allow the negative balance and set `wallets.locked = true`. A locked wallet can't buy until it's back to ≥ 0. Items already bought are kept (simpler and fairer); repeat abusers get flagged for moderation.

**Optional:** RevenueCat can unify Apple, Google and Stripe receipts. It's free until $2.5k a month in revenue. It's a new paid service once past that, so **ask Diesel first** (CLAUDE.md rule).

### 5.4 Correctness checks (tests the store phase must pass)
- Two `buy_item` calls at the same moment with the same key give **one** charge. With different keys and funds for only one, **exactly one** succeeds and the other returns "Not enough gems".
- After any test run, `sum(ledger.delta)` per user and currency equals the wallet column (a nightly job checks this too, and alerts Diesel on any mismatch).
- Changing a price in `catalog_items` while a buy is in flight charges the price inside the transaction, and the client shows the server's answer.
- The same webhook sent 3 times grants once. A refund after spending makes the wallet negative and locked; a new purchase unlocks it.
- Earned coins respect daily caps across devices and time zones (use the per-user local date, as challenges already do).
- No float anywhere: a lint rule bans `parseFloat` / `toFixed` in `src/store/**` and the SQL uses `bigint`/`int` only.

### 5.5 UK consumer rules (check with a lawyer before launch)
- Show **total prices including VAT**, and the real-money price on every gem pack.
- On web purchases of digital content, the buyer must tick that they want immediate supply and accept that this ends the 14-day cancellation right. App stores handle this for IAP.
- Email or in-app **receipts** for every real-money purchase.
- Spending settings: an optional monthly spend limit the player sets themselves.
- 18+ only at launch (decided in the public plan), so no parental-consent flow is needed yet.

## 6. Shop content and rotation
- **Featured** (1 hero item, changes weekly), **Daily** (4 items, change at the player's local midnight), **VIP** (passes + the 2 weekly VIP items), **Characters** (full catalogue), **Pets**, **Style** (frames, voice effects, emotes), **House** (decor, themes), **Gems** (packs).
- Rotations are rows in `store_rotations(slot, item_id, starts_at, ends_at)` in **UTC**, and the server returns only what's live. Countdown timers use server time (we already have clock-offset code from presence).

## 7. Build order (a new phase "S", after the licence clean-up)
1. **S1** Licence clean-up (`LICENSES.md` §6) + Ninja characters + the `character_key` migration.
2. **S2** Wallet, ledger, catalog, `buy_item`, coin earning; the shop UI with coins only; tests from §5.4.
   **Done 25 Oct 2026:** `20261118_store.sql` (catalogue of the 80 non-starter characters: Common 2,000 coins, Rare 400 gems, Epic 800 gems; `inventory`; `buy_item` with wallet lock, catalogue price, free gems before paid, idempotency key; `my_store`; wearing = starter or owned; coins from playing by triggers on `xp_ledger` / `profiles` / `game_results` under `economy_config` caps, only from the player's own play) and `20261119_admin_shop.sql` (admin Shop section: prices, on sale, earn rates, gifts). Tests: `supabase/tests/store_test.sql`, `store_race.sh` (both §5.4 races), `tests/e2e/store.mjs`. In the game: coins + gems beside the level open the Shop (the character picker with prices, the maths card and one gold Buy). Gem packs (S3) still to come, so gems only come from the admin for now.
3. **S3** Stripe (web) gem packs + webhooks + refunds. Test mode first: Stripe test keys only, Diesel adds live keys himself.
4. **S4** VIP Passes + free/VIP catch caps + houses for everyone (1 room free, 3 VIP).
5. **S5** Season Pass.
6. **S6** App store billing, only if native apps happen later. **For now it's web only** (PC + phones, iPhone through Safari): Stripe on the web, no app-store cut (§8).

## 8. Platforms: PC and phones, web first (19 Oct 2026)
- **One web app** for Windows/Mac (Chrome, Edge, Firefox, Safari) and phones (Android Chrome, **iPhone Safari**). No App Store or Play Store for now. Payments are **Stripe on the web**, so there's no 15–30% store cut (VAT still applies).
- **iPhone (Safari) must-haves:**
  - "Add to Home Screen" install (web app manifest + icons + `display: standalone`), with a one-time tip card explaining how.
  - Unlock audio on the first tap (already done). Voice stops when Safari goes to the background, so show "Voice paused while Diesel House is in the background" and reconnect on return.
  - Use `100dvh` + safe-area insets. Never rely on hover. Inputs of 16 px or more so iOS doesn't zoom.
  - Web push only works for home-screen installs on iOS 16.4+. Treat notifications as a bonus, never required.
- **PC must-haves:** WASD/arrows + mouse click-to-walk; keyboard shortcuts shown in tooltips (E interact, T walkie, Enter chat, B store, Esc close); the layout uses the extra width (chat docked on the right, store as a centred modal instead of a bottom sheet).
- **Test matrix before every release:**
  - iPhone Safari, plus the home-screen install
  - Android Chrome
  - Windows Chrome/Edge
  - Mac Safari
  - one 360 px-wide phone
  - one 4G connection
