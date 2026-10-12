# Diesel House — Concept

## One line
A shared 2D house where 8 friends each own a room. Walk in to hear the conversation, walk out and it goes quiet. Each room has its own text chat.

## The house
- Top-down pixel-art house: one central hallway with 8 rooms off it (4 above, 4 below).
- Each friend is the **resident/owner** of one room.
- **Hallway is silent.** You can see who is in which room, but you can't hear them.

## Core loop
1. Open the app → spawn at the front door in the hallway.
2. See friends' characters moving around in real time.
3. Walk into a room → join that room's voice. Leave → audio stops.
4. The room's chat panel opens while you're inside: type, react, scroll back.

## Resident powers
- **Door state:** Open / Knock to enter / Locked.
- **Knock:** a visitor knocks → owner hears a knock and gets a ping → Let in or Ignore.
- **Moderation:** mute or remove a guest from their room.
- **Mood badge** on the door: gaming, deep talk, music, study, chill, do-not-disturb.
- **Decorate** the room with furniture from the asset packs (later phase).

## Room chat
- Text chat per room, only visible to people inside that room.
- Reactions on messages.
- Recent history persists, so a late joiner can scroll back.
- **No live captions** (decided Oct 2026).

## Sound
- Custom sound effects generated with ElevenLabs: knock, doorbell, door open, someone joins, someone leaves.

## Later features
- Muffled sound when standing right outside a door
- Shared living room as a 9th common space
- "3 people are in X's room" notifications
- Wrap as a phone app (Capacitor)

## Principles
- **Cheap:** free tiers (Supabase, Vercel) plus Twilio TURN at pennies a month; peer-to-peer voice inside rooms; no audio stored.
- **Good quality:** Opus audio, noise suppression on, echo cancellation on; Twilio TURN so voice works on 4G and strict Wi-Fi.
- **Private:** invite-only, 8 accounts.
