# Diesel House — Concept

## One line
A shared 2D house where 8 friends each own a room. Walk in to hear the conversation, walk out and it goes quiet. Talk is captioned live, and comments attach to what was said.

## The house
- Top-down pixel-art house: one central hallway with 8 rooms off it (4 above, 4 below).
- Each friend is the **resident/owner** of one room.
- **Hallway is silent.** You can see who is in which room, but you can't hear them.

## Core loop
1. Open the app → spawn at the front door in the hallway.
2. See friends' characters moving around in real time.
3. Walk into a room → join that room's voice. Leave → audio stops.
4. Captions of everyone speaking appear in a side panel for that room only.
5. Tap any caption line to react or comment on that exact moment.

## Resident powers
- **Door state:** Open / Knock to enter / Locked.
- **Knock:** a visitor knocks → owner gets a ping → owner lets them in or ignores.
- **Moderation:** mute or remove a guest from their room.
- **Mood badge** on the door: gaming, deep talk, music, study, chill, do-not-disturb.
- **Decorate** the room with furniture from the asset packs (later phase).

## Captions & comments
- Captions are generated **on each speaker's own device** (browser speech recognition) and sent as text. No cloud speech-to-text bill.
- Caption lines show the speaker's name and colour and arrive as finished sentences, not flickering word by word.
- Comments and reactions attach to a caption line ("reply to a moment").
- Room transcripts persist so a late joiner can scroll back and catch up.
- Transcripts and comments are **only visible inside that room**.

## Later features
- Muffled sound when standing right outside a door
- Clips: save a stretch of transcript plus a short audio snippet as a quote card
- Shared living room as a 9th common space
- "3 people are in X's room" notifications
- Wrap as a phone app (Capacitor)

## Principles
- **Cheap:** free tiers only; no audio stored except clips; peer-to-peer voice inside rooms.
- **Good quality:** Opus audio, noise suppression on, echo cancellation on.
- **Private:** invite-only, 8 accounts.
