# UI review: the store, the wallet and the overall UI (18 Oct 2026)

Screenshots in this folder come from the live code (`?test` mode, commit `8d495b0`), on a 390 × 844 phone and a 1280 × 800 desktop. The store target is **`design/store/store.html`**: open it in a browser and click around. It's a working mock-up of the HUD wallet, the store, character previews (walk / attack / jump) and the buy-confirm maths.

Severity: **P1** fix before the store ships · **P2** fix in the store phase · **P3** polish.

---

## 1. What works well (keep it)
- One clear visual language: pixel frames, lamp-gold accent, Pixelify + Atkinson. The store mock reuses it exactly.
- The Settings sheet (sliders with % and test buttons, plain-English toggles) is the best screen in the game.
- "Who's where" is a great feature: a clear octagon map with a live critter hint and tap-to-walk. It turns into the room browser later.
- Tap targets are ≥ 44 px almost everywhere.

## 2. Problems found

| # | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| U1 | P1 | Phone, Great Hall (`phone_hall.jpg`) | The camera shows **half a screen of empty starry void** below the porch. The house looks small and unfinished on a phone | Clamp the camera to the house bounds, centre the player vertically, and zoom so the house fills the width on phones |
| U2 | P1 | XP chip (all screens) | Shows **"Lv …"** with no bar while loading, and stays like that offline | Skeleton bar + last-known level from cache; never a bare "…" |
| U3 | P1 | Top bar on phone | Zone pill + 3 buttons + XP chip use about **15% of the screen height** at 44 px with large gaps, and adding Coins + Gems would push it to 3 rows | Use the layout in `store.html`: row 1 = zone pill + Map + **Store** + Settings; row 2 = XP chip + Coins + Gems chips (36 px). Challenges move into the Store/Profile area or a bottom-bar button |
| U4 | P1 | Disco (`desktop_disco.jpg`) | The dance floor is **fully saturated at full brightness**, against the plan's photosensitivity default (REDESIGN §9) | Default to a soft, slow cycle at 60% saturation; "Disco lights: full" in Settings; respect `prefers-reduced-motion` |
| U5 | P2 | Disco, room banner | The "Disco · Nobody else here yet" banner **sits on top of the dance floor at low contrast**, and the room is named three times (top pill, wooden sign, banner) | Show the banner for 2 s on entry, then fade it. Put it above the HUD, not mid-floor |
| U6 | P2 | Name tag | Your name tag covers the floor and other sprites. The mute icon inside it is tiny | Keep tags 1 px smaller, hide your own by default (setting exists), show icons at 2× scale |
| U7 | P1 | Character picker (`phone_profile.jpg`) | Shows the 20 old chibis/LimeZu people. **Not licensed for selling** (`LICENSES.md`), and there's no locked/owned/price state | Replace with Ninja Adventure characters and the store card layout: rarity border, Owned / Wearing / price, "Try on" |
| U8 | P2 | Challenges sheet | "Loading your challenges…" plain text in a tall empty sheet | Skeleton rows; show the coin reward on each challenge now that challenges pay coins |
| U9 | P2 | Bottom controls (phone) | Joystick bottom-left, emote + walkie bottom-right, chat only in rooms. Fine, but there's **no way into the store** without the top bar | Store lives in the top bar (gold bag). The gem chip "+" also opens Gems |
| U10 | P3 | "Offline" status | Grey on dark, easy to miss | Use the `--error` colour + "Reconnecting…" pill (already designed) |
| U11 | P3 | Desktop top-right | 4 icon buttons with no labels | Tooltips on hover; labels at ≥ 1280 px width |

## 3. Store UI rules (all shown in `store.html`)
1. **Wallet chips are always visible** in the HUD: Coins (no "+", because they can't be bought) and Gems (with "+", which opens the Gems tab). Numbers are formatted `toLocaleString()` with thousands separators.
2. Store tabs: **Featured · Characters · Pets · Style · House · Gems**. Featured has one hero item with a countdown (server time) and a "Daily" row.
3. **Cards:** face portrait, name, a rarity tag in the rarity colour (common `--muted`, rare `#7fb2ff`, epic `#c99bff`, limited `--lamp`, event `--error`), then the price **or** Owned / Wearing.
4. **The confirm sheet always shows the maths:**
   - You have *n*
   - Price − *p*
   - After = *n − p*
   - If *n − p < 0*: show "need *x* more" in red, and the button becomes **the cheapest gem pack that covers the gap** (or "Earn *x* more coins" for coin items).
5. **Preview moves** (Walk / Attack / Jump) on every character before buying. **Try it on** for 60 s.
6. **The buy button disables on tap** and shows "Buying…". The client sends an idempotency key and waits for the server's wallet. Only the server's numbers are shown afterwards.
7. **After buying:** a toast ("Knight unlocked"), a coin/gem chip pulse, confetti (Kenney Particle Pack), a "Wear now" button.
8. **Gems tab:**
   - Packs with **real price incl. VAT** and the bonus %, with "Most popular" on £9.99.
   - The Diesel+ card under the packs.
   - Small print: "Prices include VAT. Gems never expire. Items are cosmetic."
9. **Never** show gem prices converted to £ on items (it's confusing and not required), and never use timers that pressure a purchase, other than honest rotation countdowns.
10. **Errors in plain English:**
    - "Not enough gems: you need 350 more"
    - "That item's gone from the shop. Nothing was charged"
    - "Payment didn't go through. Nothing was charged"

## 4. Logic checklist for the UI layer (pairs with STORE.md §5.4)
- [ ] All displayed balances come from `wallet()` or the user's Realtime wallet channel. There's no local arithmetic except the confirm-sheet preview, which is clearly labelled "After".
- [ ] The preview uses the price from the **catalog row the client just fetched**. If the server answers with a different price ("price changed"), refresh the card and ask again.
- [ ] One buy at a time: a global `busy` flag, and the button disabled until the server responds or 10 s passes. On a timeout, call `wallet()` and `inventory()` before letting the user retry, with the same idempotency key.
- [ ] A locked wallet (after a refund) shows "Your gem balance is negative after a refund. Top up to keep shopping" and hides Buy buttons.
- [ ] Guests see the store read-only: "Members can shop. Ask your host for an invite".
- [ ] Number formatting via one helper `fmtAmount(n)` (en-GB grouping), with no `toFixed` anywhere except the real-money price, which comes as a pre-formatted string from the payment provider or the catalog.

## 5. Order of work
U1, U2, U3, U4 and U7 come with the store phase (S1/S2 in `STORE.md` §7). The rest go in the R5 polish pass.
