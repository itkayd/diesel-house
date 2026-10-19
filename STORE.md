# STORE.md — Store, currencies, characters and Diesel+ (18 Oct 2026)

How Diesel House makes money. Read with `LICENSES.md` (only commercial-safe assets in the store) and `design/review/UI-REVIEW.md` (where the store sits in the UI). This file wins on anything about money, currencies, prices or ownership.

**Golden rules**
1. **Cosmetic only.** Nothing you buy helps you win a game or level up faster. XP, levels and medals stay earned.
2. **The server decides everything.** The client never calculates a price, a balance or ownership. It asks, then shows what the server says.
3. **No loot boxes or gacha.** Every item has a fixed, visible price.
4. **Integers only.** Gems and coins are whole numbers. Money is stored in pence. There are no floats anywhere in the economy.
5. **Every change to a balance is a ledger row.** The balance is a cache of the ledger, so one can always be rebuilt from the other.

---

## 1. Two currencies

| | **Coins** (earned) | **Gems** (premium) |
|---|---|---|
| Icon | Spinning gold coin `MonedaD.png` (N14 Gems/Coins, CC0) | Spinning blue gem `spr_coin_azu.png` (N14) |
| How you get them | Playing: daily login, challenges, games, critter catches, Ghoul night, levelling up | Buying gem packs; Diesel+; Season Pass; small rewards (every 5 levels) |
| Can you buy them with money? | **No** | Yes |
| Spend on | Common characters, common pets, basic decor, emotes | Rare/Epic/Limited characters, voice effects, frames, house themes, Season Pass |
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
| Catch a critter | 10 (rare: 50) | 150 / day |
| Level up | 100 × new level ÷ 10, rounded, min 50 | — |
| Ghoul night | 50–300 by contribution | per event |

**Target:** an active free player earns about **400 coins a day** (hard cap 800), so a Common character (2,000 coins) takes about 5 days. Measure this in the beta and tune it. All numbers live in one config table, `economy_config`, never hard-coded in the client.

## 2. Gem packs (real money)

UK prices include VAT. "Net to us" is after 20% VAT and the store's 15% cut.

| Pack | Gems | Price | Gems per £ | Bonus | Net to us |
|---|---|---|---|---|---|
| Handful | 100 | £0.99 | 101 | — | ~£0.70 |
| Pouch | 550 | £4.99 | 110 | +9% | ~£3.53 |
| Chest ★ "most popular" | 1,200 | £9.99 | 120 | +19% | ~£7.08 |
| Vault | 2,600 | £19.99 | 130 | +29% | ~£14.16 |
| Treasury | 7,000 | £49.99 | 140 | +39% | ~£35.41 |
| **Starter offer** (once per account, first 7 days) | 600 + 1 Rare character | £2.99 | — | — | ~£2.12 |

**Correction to the earlier revenue estimate:** UK VAT (20%) comes out of every sale on top of the store cut. Plan on roughly **70% of the sticker price** reaching us.

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
| House decor | 200–2,000 coins / 50–400 gems | For your Diesel+ house |
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

## 4. Diesel+ (subscription)

**£4.99/month or £39.99/year** (the annual price saves 33%).
- **400 gems every month**, granted on each successful renewal (not at sign-up plus renewal, to stop double grants).
- **+25% coins** from every source. The daily cap rises by 25% too, so it's still capped.
- An exclusive monthly item, which you keep forever once claimed in that month.
- Your own **house** to decorate and open to the public.
- Host rooms of up to **50 people** (free users: 12).
- Supporter badge on your name tag.
- Members keep everything they bought or claimed if they cancel. The house goes "closed" but its decor isn't deleted.

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
inventory(user_id, item_id, source ('starter'|'coins'|'gems'|'pass'|'event'|'gift'|'sub'),
          acquired_at, primary key (user_id, item_id))
purchases(id, user_id, provider ('stripe'|'apple'|'google'), provider_txn_id unique,
          product_id, pence int, currency text, gems_granted int, status ('paid'|'refunded'|'chargeback'),
          raw jsonb, created_at)
subscriptions(user_id pk, provider, status, current_period_end, last_grant_period text)
season_progress(user_id, season_id, xp, premium bool, claimed int[] , primary key(user_id, season_id))
```

### 5.2 RPCs (all `security definer`, members only, guests can't spend)

| RPC | What it does |
|---|---|
| `wallet()` | Returns `{coins, gems: gems_free+gems_paid, locked}` |
| `buy_item(item_id, idempotency_key)` | In **one transaction**: lock the wallet row `FOR UPDATE`, then check the item is active and in its window, not already owned, and that funds are sufficient (**price read from `catalog_items`; anything the client sends is ignored**). Spend `gems_free` first, then `gems_paid`. Write ledger row(s), insert into inventory, return the new wallet. The same `idempotency_key` returns the first result without charging again |
| `grant(user, currency, amount, reason, ref, idempotency_key)` | Internal only (earn events, Diesel+, pass rewards). Called by other RPCs or by server webhooks with the service key, never by clients |
| `claim_pass_tier(season, tier)` | Checks XP ≥ tier × 1000, premium if needed, and not already in `claimed`; grants the reward |
| `set_character(key)` | Must own it (or it's a starter) |
| `try_on(key)` | Returns a signed 60-second token. The client shows the skin only locally |

### 5.3 Real-money flow (never trust the client)
1. The client opens checkout: Stripe Checkout on web, App Store / Play billing in the phone apps. **Digital goods inside iOS/Android apps must use store billing.**
2. **Only the server grants gems**, from verified webhooks or server notifications in a Vercel function `/api/payments/*`: check the signature, then upsert `purchases` by `provider_txn_id` (unique, so a repeat webhook does nothing), then `grant(...)`.
3. The client polls `wallet()` or listens on the user's own Realtime channel for the new balance, then shows "+1,200 gems" and confetti (Kenney Particle Pack).
4. **Refund or chargeback** webhook: mark the purchase `refunded`, then debit `gems_paid` by `gems_granted`. If that would go negative, allow the negative balance and set `wallets.locked = true`. A locked wallet can't buy until it's back to ≥ 0. Items already bought are kept (simpler and fairer); repeat abusers get flagged for moderation.
5. Subscription renewals use the same pattern. `last_grant_period` (e.g. `2026-11`) stops a second monthly grant.

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
- **Featured** (1 hero item, changes weekly), **Daily** (4 items, change at the player's local midnight), **Characters** (full catalogue), **Pets**, **Style** (frames, voice effects, emotes), **House** (Diesel+ decor), **Gems** (packs + Diesel+).
- Rotations are rows in `store_rotations(slot, item_id, starts_at, ends_at)` in **UTC**, and the server returns only what's live. Countdown timers use server time (we already have clock-offset code from presence).

## 7. Build order (a new phase "S", after the licence clean-up)
1. **S1** Licence clean-up (`LICENSES.md` §6) + Ninja characters + the `character_key` migration.
2. **S2** Wallet, ledger, catalog, `buy_item`, coin earning; the shop UI with coins only; tests from §5.4.
3. **S3** Stripe (web) gem packs + webhooks + refunds. Test mode first: Stripe test keys only, Diesel adds live keys himself.
4. **S4** Diesel+ subscription.
5. **S5** Season Pass.
6. **S6** App store billing, when the Capacitor apps happen.
