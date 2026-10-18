import type { Dir } from '../characters';
import type { PlayerInfo } from '../net/presence';
import type { Avatar } from '../scenes/Avatar';

// Shared numbers and types for the house scene's parts (src/house/*.ts).
export const SPEED = 80; // px per second
export const ZONE_SETTLE_MS = 150; // a zone change counts once you have been in the new zone this long
export const SLOW = 0.5; // joystick half-push speed, as a fraction of SPEED
// Movement messages: one when movement changes, a correction every 500 ms while walking, a heartbeat
// every 15 s while standing still. Other screens extrapolate in between (dead reckoning).
export const CORRECT_EVERY = 500;
export const IDLE_RESEND = 15_000;
export const EXTRAPOLATE_MAX = 750; // ms past the last message we keep walking someone forward (then wait for news)
export const SNAP_OVER = 24; // px: corrections bigger than this jump; smaller ones glide
export const GLIDE_MS = 150; // ms to glide out a small correction
export const STALE_AFTER = 30_000; // ms without any message before someone is hidden (locked phone, closed tab)
export const JOIN_VOICE_AFTER = 300; // ms standing in a room before joining its voice (avoids flapping in doorways)

// Last movement heard from someone, with t already moved onto our clock.
export type Motion = { t: number; x: number; y: number; vx: number; vy: number; dir: Dir };
// clockOffset: smallest (our clock - their clock) seen; maps their timestamps onto our timeline.
// glide: leftover display error from the last correction, faded out over GLIDE_MS.
export type Remote = {
  avatar: Avatar;
  info: PlayerInfo;
  motion: Motion | null;
  glide: { dx: number; dy: number; at: number };
  clockOffset: number;
  lastHeard: number;
  active: boolean;
};
export type Sent = { vx: number; vy: number; dir: Dir; at: number };
