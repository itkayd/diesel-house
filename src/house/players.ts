import { guestSkin } from '../characters';
import type { MoveMsg, PlayerInfo } from '../net/presence';
import { play } from '../ui/sounds';
import { Avatar } from '../scenes/Avatar';
import type { HouseScene } from '../scenes/HouseScene';
import { CORRECT_EVERY, IDLE_RESEND, EXTRAPOLATE_MAX, SNAP_OVER, GLIDE_MS, STALE_AFTER, Motion } from './consts';

// Other people: arriving and leaving, their movement (dead reckoning and glide), and sending ours.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

export function addRemote(this: HouseScene, p: PlayerInfo) {
  if (p.guest) p = { ...p, character: guestSkin(p.character) };
  const avatar = new Avatar(this, 0, 0, p.character, p.name);
  avatar.setVisible(false); // shown once we know where they are
  avatar.setPet(p.guest ? null : p.pet);
  avatar.setGuest(!!p.guest);
  avatar.setProgress(p.guest ? null : (p.lv ?? null), p.st ?? 0);
  this.showHost(p);
  queueMicrotask(() => this.showMicNote(p.id));
  avatar.sprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.tapAvatar(p.id));
  this.remotes.set(p.id, { avatar, info: p, motion: null, glide: { dx: 0, dy: 0, at: 0 }, clockOffset: Infinity, lastHeard: 0, active: false });
  this.sendMove(true); // so the newcomer sees us straight away
  const early = this.earlyMoves.get(p.id);
  this.earlyMoves.delete(p.id);
  if (early) this.receiveMove(early);
  this.showPresenceStatus('online');
}

// The nearest visible person within `range` px, if any.
export function nearestRemote(this: HouseScene, range: number) {
  let best: string | null = null;
  let bestD = range;
  for (const [id, r] of this.remotes) {
    if (!r.active || !r.avatar.sprite.visible) continue;
    const d = Math.hypot(r.avatar.sprite.x - this.body.center.x, r.avatar.sprite.y - this.body.bottom);
    if (d <= bestD) [best, bestD] = [id, d];
  }
  return best;
}

export function removeRemote(this: HouseScene, id: string) {
  if (this.duel?.them.id === id) this.duel.gone();
  if (this.duelInvite?.to === id) this.cancelInvite('left');
  this.earlyMoves.delete(id);
  this.remotes.get(id)?.avatar.destroy();
  this.remotes.delete(id);
  this.showPresenceStatus('online');
}

export function updateRemote(this: HouseScene, p: PlayerInfo) {
  const r = this.remotes.get(p.id);
  if (!r) return;
  if (p.guest) p = { ...p, character: guestSkin(p.character) };
  if (r.info.character !== p.character) r.avatar.setCharacter(p.character);
  if (r.info.name !== p.name) r.avatar.setName(p.name);
  r.avatar.setPet(p.guest ? null : p.pet);
  r.avatar.setGuest(!!p.guest);
  r.avatar.setProgress(p.guest ? null : (p.lv ?? null), p.st ?? 0);
  // Levelled up while in our room: confetti.
  if (p.lv && r.info.lv && p.lv > r.info.lv && r.info.zone === this.zone && this.zone !== 'hallway' && r.avatar.sprite.visible) this.confettiOver(r.avatar.sprite);
  this.showHost(p);
  r.info = { ...p, zone: r.info.zone, mic: r.info.mic, net: r.info.net };
  this.showMicNote(p.id); // zone from position updates is fresher than presence
}

export function receiveMove(this: HouseScene, m: MoveMsg) {
  const r = this.remotes.get(m.id);
  if (!r) {
    if (this.earlyMoves.size < 32) this.earlyMoves.set(m.id, m);
    return;
  }
  const now = Date.now();
  r.clockOffset = Math.min(r.clockOffset, now - m.t);
  const motion: Motion = { t: m.t + r.clockOffset, x: m.x, y: m.y, vx: m.vx, vy: m.vy, dir: m.dir };
  if (r.motion && motion.t <= r.motion.t) return; // out of order
  const moved = r.info.zone !== m.zone;
  // Quiet sounds for people coming into or leaving the room you're in.
  if (moved && r.active && this.zone && this.zone !== 'hallway') {
    if (m.zone === this.zone) play('join', 0.5);
    else if (r.info.zone === this.zone) play('leave', 0.5);
  }
  r.info.zone = m.zone;
  const stateChanged = (m.mic !== undefined && m.mic !== r.info.mic) || (m.net !== undefined && m.net !== r.info.net);
  if (m.mic !== undefined) r.info.mic = m.mic;
  if (m.net !== undefined) r.info.net = m.net;
  if (moved || stateChanged) this.showMicNote(m.id);
  r.lastHeard = now;
  if (moved && r.active) this.showPresenceStatus(this.presenceState);
  if (!r.active) {
    r.active = true;
    r.motion = motion;
    r.avatar.setPosition(m.x, m.y);
    r.avatar.setVisible(true);
    this.showPresenceStatus('online');
    return;
  }
  // Where the new message says they are now, versus where we're drawing them: glide small differences
  // away, jump big ones (e.g. a wall stopped them before we heard).
  r.motion = motion;
  const [px, py] = this.predict(motion, now);
  const dx = r.avatar.sprite.x - px;
  const dy = r.avatar.sprite.y - py;
  r.glide = Math.hypot(dx, dy) > SNAP_OVER ? { dx: 0, dy: 0, at: 0 } : { dx, dy, at: now };
}

export function predict(this: HouseScene, m: Motion, now: number): [number, number] {
  const dt = Math.min(Math.max(now - m.t, 0), EXTRAPOLATE_MAX) / 1000;
  return [m.x + m.vx * dt, m.y + m.vy * dt];
}

// Sends our movement only when it changes, plus corrections and a heartbeat (see CORRECT_EVERY).
export function sendMove(this: HouseScene, force = false) {
  if (!this.presence) return;
  // Velocity we're really moving at: input, minus any direction a wall is blocking.
  const b = this.body.blocked;
  let { x: vx, y: vy } = this.body.velocity;
  if ((vx < 0 && b.left) || (vx > 0 && b.right)) vx = 0;
  if ((vy < 0 && b.up) || (vy > 0 && b.down)) vy = 0;
  vx = Math.round(vx);
  vy = Math.round(vy);
  const dir = this.me.facing;
  const now = performance.now();
  const s = this.sent;
  const moving = vx !== 0 || vy !== 0;
  const changed = !s || s.vx !== vx || s.vy !== vy || s.dir !== dir;
  const due = s && now - s.at >= (moving ? CORRECT_EVERY : IDLE_RESEND);
  if (!force && !changed && !due) return;
  this.sent = { vx, vy, dir, at: now };
  // Body position, not the sprite: the sprite only catches up with physics after this update runs.
  const tenth = (n: number) => Math.round(n * 10) / 10; // whole pixels would make corrections wobble back and forth
  this.presence.sendMove({ x: tenth(this.body.center.x), y: tenth(this.body.bottom), vx, vy, dir, zone: this.zone, mic: this.myMic, net: this.myNet });
}

// Draws everyone else where their last message says they should be by now, gliding out corrections.
export function moveRemotes(this: HouseScene) {
  const now = Date.now();
  for (const r of this.remotes.values()) {
    if (r.active && now - r.lastHeard > STALE_AFTER) {
      r.active = false;
      r.motion = null;
      r.avatar.setVisible(false);
      this.showPresenceStatus('online');
    }
    if (!r.active || !r.motion) continue;
    const m = r.motion;
    let [x, y] = this.predict(m, now);
    const k = r.glide.at ? Math.max(0, 1 - (now - r.glide.at) / GLIDE_MS) : 0;
    x += r.glide.dx * k;
    y += r.glide.dy * k;
    const walking = (m.vx !== 0 || m.vy !== 0) && now - m.t < EXTRAPOLATE_MAX;
    // While walking, never step back against the direction of travel: a correction that lands a little
    // behind just holds them for a moment until the prediction catches up (no judder).
    if (walking) {
      const { x: px, y: py } = r.avatar.sprite;
      if (m.vx && (x - px) * Math.sign(m.vx) < 0) x = px;
      if (m.vy && (y - py) * Math.sign(m.vy) < 0) y = py;
    }
    r.avatar.setPosition(x, y);
    r.avatar.animate(walking, m.dir);
  }
}
