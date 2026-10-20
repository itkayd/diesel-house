# Going public: the UX rulebook and the next stages (19 Oct 2026)

Diesel House is about to open beyond the first friends. New people arrive knowing nothing, often on a phone, often with nobody else online yet. This file holds the rules every screen must follow and the order of the next stages. It sits beside `UI-REVIEW.md` (the screen-by-screen review) and `STORE.md` (money). Where they disagree on look or flow, this file wins. On money or licences, `STORE.md` and `LICENSES.md` win.

---

## 1. The 12 rules for every screen

1. **Phone first.** Design at 390 × 844 with a thumb, then make desktop better (labels, hover, keys). Nothing may only work with a mouse or a keyboard.
2. **One main action per screen.** It's the gold button, and there's only one gold button. Everything else is quiet (`dh-btn--quiet`) or an icon.
3. **Never a dead end.** Every sheet and pop-up has a close (✕) and a way back, and Esc works on desktop. Closing never loses what you typed or a game in progress.
4. **Plain words.** Short sentences, no jargon ("Mic on", not "Audio stream active"). Say what to do next: "Nobody else is at this table yet. Ask a friend to walk over and open it too."
5. **Teach in place, the first time.** Rules open by themselves the first time you see a game (`rulesFold`), and a ? is always one tap away. Tips appear once and never nag.
6. **Status is always visible.** Where you are, who's here, whether your mic is live, whether you're connected. Never a bare "…": show a skeleton, the last known value, or "Reconnecting…".
7. **Feedback within 100 ms.** Every tap gives a press state, a sound (if sound is on) and, on phones that can, a small buzz. Network actions show they're working and say clearly if they fail.
8. **Tap targets at least 44 × 44 px**, with 8 px between them. Bottom controls never overlap the joystick.
9. **Calm by default.** No flashing, no full-brightness colour cycling, and respect `prefers-reduced-motion`. Loud or bright modes are opt-in in Settings.
10. **Readable.** Text contrast at least 4.5 : 1 (WCAG AA). Body text 14 px or more (12 px only for labels and chips). Pixel font for titles, Atkinson for reading.
11. **Same thing, same look, same place.** Lucide icons only in the HUD, one icon per idea (? = help, ✕ = close, dice = games). The top bar order never changes between rooms.
12. **Empty states invite.** An empty room, table or leaderboard says what you could do there and gives the button to do it.

Before a stage ships, every new or changed screen is checked against this list on a phone and a desktop screenshot. "Done when" for every UI stage includes: no overlaps at 360 px wide, keyboard and screen-reader labels present, nothing broken with sound off or reduced motion on.

## 2. The house rules (the in-game text lives in `src/ui/guide.ts`, step "House rules")

1. Be kind. Treat everyone like a friend of a friend.
2. No bullying, hate, threats or harassment, in voice, chat, names or drawings. Keep it friendly for everyone.
3. Keep private things private: addresses, phone numbers, photos, passwords.
4. Respect quiet: Do not disturb doors and the Library.
5. Play fair: no spamming, no trying to break games.
6. Someone bothering you: turn them down to 0, walk away, tell Diesel. Breaking the rules can cost someone their invite or guest code.

**Needed before the house is truly public** (stage U4 below): a Block and a Report button in every friend menu, a word filter on names, chat and guesses, a report queue for Diesel, and an age rule in the sign-up text (to be decided with Diesel: 13+ or 16+). Until those exist, keep entry to member invites and guest codes.

## 3. The first five minutes (the path every newcomer takes)

1. **Front door:** the login screen says in one line what the house is. Guests type a code, members get an email link.
2. **Pick a character:** the starters, a live preview, then "Keep wearing X".
3. **Arrive on the porch.** The guide opens: 11 short topics, skippable, the house rules last. It's the same guide behind the ? button.
4. **First 60 seconds:** a "Wave hello" hint near the emote button if someone's nearby. If the house is empty, a hint pointing at the map and the arcade instead.
5. **First game:** walking near a GAMES sign shows "Play games". The lobby explains the game with its rules open, and says who's needed.
6. **First win or XP:** a toast that names what happened and where to see it ("+50 XP · your profile").

Each step needs one test in `tests/e2e/` that walks it at phone size.

## 4. The next stages (in order; each ends with phone and desktop screenshots and a how-to-test)

| Stage | What | Done when |
|---|---|---|
| **U1 · Help and rules** (done 19 Oct) | Game handbook (`src/games/rules.ts`): a ? in the games panel, rules folded in every lobby, the handbook from the guide and Settings. Guide: Having fun, Inviting, House rules | Every game's rules reachable in 1 tap from its lobby; guide tests pass |
| **U2 · First run** (done 19 Oct: `src/ui/hints.ts`, `tests/e2e/first-run.mjs`) | Section 3's path: a welcome hint system (one-time, dismissable), an empty-house mode (arcade, critters, "invite a friend" card), and clearer front-door copy | A new phone user reaches a game lobby in under 60 s without help |
| **U3 · HUD and navigation** (done 20 Oct, except the wallet row, which arrives with S2) | The top bar from `design/store/store.html` (zone, Map, Store, Settings; then XP + wallet). Labels and tooltips on desktop. The open items from `UI-REVIEW.md` (U1 camera void, U2 XP skeleton, U3 top bar, U5 banner, U6 name tag, U8 skeleton rows, U10 offline pill, U11 labels) | No item left open in UI-REVIEW §2 |
| **U4 · Social and safety** | Block / Report in the friend menu, a filter on names, chat and guesses, a report queue for Diesel, a friends list with "join them", and "Invite to table" (ping friends to a game) | A blocked person can't be heard, seen chatting or invite you; reports reach Diesel |
| **U5 · Games polish** | A "Ready" step in lobbies, rematch with the same players, end-of-game stats, spectator chat, sound passes per game | Each game feels finished: a start, a middle, a clear end, and an easy "again" |
| **U6 · Accessibility and speed** | An audit against rule 10, screen-reader pass, bigger-text setting, load time under 3 s on 4G, bundle budget | An axe-core scan is clean on the main screens; Lighthouse mobile is 90 or more |
| **S2 · Store** | Per `STORE.md` (VIP passes with gems, no subscription) and `store.html` | Per `STORE.md` |

Already done from `UI-REVIEW.md`: U1 (camera kept over the house; in the hall and porch column it stops under the porch), U2 (XP chip shows the last-known level, or a placeholder bar, never "Lv …"), U4 (soft disco lights), U5 (the room banner sits in the notices stack at the top for 2 s), U6 (partly: your own tag no longer repeats the mic and signal icons; it stays on by default, and Settings → More hides it), U7 (Ninja Adventure picker), U8 (skeleton rows while challenges load), U10 (Offline in red, with "trying again"), U11 (tooltips everywhere, labels beside the icons on desktops 1280 px and wider). U3 (the top bar with coins and gems) waits for the store (S2).
