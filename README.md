# Diesel House

A private 2D voice-hangout app for a group of 8 friends.

The app is a top-down house with a hallway and 8 rooms, one owned by each friend. Walk your character into a room and you hear everyone inside. Walk out and it's silent. Each room has its own text chat with reactions.

## Stack
Phaser 3 + TypeScript + Vite · Supabase (auth, database, realtime) · WebRTC voice with Twilio TURN · Vercel hosting · ElevenLabs sound effects

## Files in this repo

| File | What it is |
|------|------------|
| `CLAUDE.md` | Build brief for Claude Code: stack, setup, phases, rules |
| `CONCEPT.md` | Product concept and features |
| `ASSETS.md` | Art packs used, where they come from, licences, credits |

## Status

Planning done, art sourced. Next: Claude Code runs **Phase 0** in `CLAUDE.md`.

## Running cost target

About £0/month at friend-group scale: Supabase and Vercel free tiers, plus Twilio TURN usage (pennies).

## Private repo

The art packs' licences don't allow public redistribution. Keep this repo private.
