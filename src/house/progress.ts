import Phaser from 'phaser';
import { type RoomId } from '../config';
import { currentUser } from '../net/profile';
import { overlay } from '../ui/overlay';
import { icon } from '../ui/icons';
import { isTouchDevice } from '../ui/joystick';
import { WHISPER } from '../scenes/hallway';
import { Tracker } from '../challenges/tracker';
import { canRecord, weeklyBoard, type Recorded } from '../net/progress';
import { firstRun } from '../ui/hints';
import { challengeToast, confettiAt, levelUpOverlay, medalToast, openChallenges, openNoticeboard, ProgressHud } from '../ui/progressUi';
import { catchBoard } from '../net/critters';
import type { HouseScene } from '../scenes/HouseScene';

// Challenges, XP and levels in the house (UPDATE.md Phase 14): the HUD, toasts, the noticeboard and what counts.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

export function setupProgress(this: HouseScene) {
  const user = currentUser();
  const guest = !!user?.guest;
  this.tracker = new Tracker(canRecord() && !!user && !guest);
  this.progressHud = new ProgressHud(
    () => ({ character: this.character, guest }),
    () => this.openMyChallenges(),
    () => this.openMyProfile(),
  );
  this.tracker.onResult((r) => this.gotProgress(r));
  this.tracker.start();
  // Once a minute: time in voice, a full room of your own, guests to welcome.
  this.time.addEvent({ delay: 60_000, loop: true, callback: () => this.minuteTick() });
}

export function rankInfo(this: HouseScene) {
  return this.progress ? { lv: this.progress.level, st: this.progress.streak } : {};
}

export function gotProgress(this: HouseScene, r: Recorded) {
  const first = !this.progress;
  const prevLevel = this.progress?.level;
  this.progress = r;
  this.progressHud?.update(r, first ? 0 : r.gained);
  if (!first && r.gained > 0) firstRun.notify('xp');
  this.me.setProgress(r.level, r.streak);
  this.presence?.update(this.rankInfo());
  // One after another: challenges, then medals (a new rank shows in the level-up instead), then level up.
  const levelled = r.level > Math.min(r.level_before, prevLevel ?? r.level_before);
  let wait = 0;
  for (const c of r.completed) {
    setTimeout(() => challengeToast(c), wait);
    wait += 900;
  }
  for (const m of r.new_medals) {
    if (levelled && m.id.startsWith('rank_') && m.id !== 'rank_visitor') continue;
    setTimeout(() => medalToast(m.id, m.xp), wait);
    wait += 900;
  }
  if (levelled) setTimeout(() => levelUpOverlay(r.level_before, r.level), wait + 300);
  if (r.completed.length || levelled) this.cheer();
  // Keep an open profile up to date (same tab, where it was scrolled to), unless you're typing your name.
  const prof = document.getElementById('profile');
  const typing = prof?.contains(document.activeElement) && document.activeElement?.matches('input, textarea');
  if (prof && (first || prof.dataset.xp !== String(r.xp)) && !typing) {
    const top = prof.querySelector('.dh-panel')?.scrollTop ?? 0;
    const tab = prof.querySelector('[role="tab"][aria-selected="true"]')?.id;
    this.openMyProfile();
    const again = document.getElementById('profile');
    if (tab && tab !== 'profile-tab-about') (again?.querySelector(`#${tab}`) as HTMLButtonElement | null)?.click();
    if (again) again.querySelector('.dh-panel')!.scrollTop = top;
  }
  document.getElementById('profile')?.setAttribute('data-xp', String(r.xp));
  // Keep an open Challenges sheet up to date (same tab).
  const sheet = document.getElementById('challenges');
  if (sheet) {
    const tab = sheet.querySelector('[aria-selected="true"]')?.getAttribute('data-tab') === 'week' ? 'week' : 'day';
    openChallenges(this.progress, false, tab, () => this.openMyChallenges());
  }
}

// "!" over our head for everyone; friends in the same room also get confetti.
export function cheer(this: HouseScene) {
  if (!this.presence) return;
  this.me.showEmote('exclamation');
  this.presence.sendEmote({ e: 'exclamation', cheer: true });
}

export function confettiOver(this: HouseScene, sprite: Phaser.GameObjects.Sprite) {
  const cam = this.cameras.main;
  const c = this.game.canvas.getBoundingClientRect();
  confettiAt(c.left + (sprite.x - cam.worldView.x) * cam.zoom, c.top + (sprite.y - 32 - cam.worldView.y) * cam.zoom);
}

export function openMyChallenges(this: HouseScene) {
  openChallenges(this.progress, !!currentUser()?.guest, 'day', () => this.openMyChallenges());
  void this.tracker.flush(); // fresh numbers while it's open
}

export async function openBoard(this: HouseScene) {
  const user = currentUser();
  const guest = !!user?.guest;
  openNoticeboard(null, null, user?.id ?? '', guest, () => this.openMyChallenges());
  if (guest) return;
  const [rows, catches] = canRecord() ? await Promise.all([weeklyBoard(), catchBoard()]) : [null, null];
  if (document.getElementById('noticeboard')) openNoticeboard(rows, catches, user?.id ?? '', guest, () => this.openMyChallenges(), 'week', true);
}

export function showBoardPrompt(this: HouseScene, on: boolean) {
  if (on === !!this.boardPrompt) return;
  this.boardPrompt?.remove();
  this.boardPrompt = null;
  if (!on) return;
  const box = document.createElement('div');
  box.className = 'v2-act';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dh-btn';
  b.id = 'board-prompt';
  b.append(icon('clipboard-list'), document.createTextNode('Noticeboard'));
  if (!isTouchDevice()) {
    const k = document.createElement('kbd');
    k.textContent = 'E';
    b.append(k);
  }
  b.addEventListener('click', () => void this.openBoard());
  box.append(b);
  overlay().append(box);
  this.boardPrompt = box;
}

export function minuteTick(this: HouseScene) {
  if (!this.presence || document.hidden) return;
  const room = this.zone && this.zone !== 'hallway' ? (this.zone as RoomId) : null;
  if (room && this.voiceConnected >= 1) this.tracker.emit('voice_min');
  if (room && this.voiceConnected >= 2) this.tracker.emit('voice_min_group');
  // Party starter (REDESIGN.md §2, no owners now): be in a room when it reaches 4 people.
  if (room && !this.partied && this.countIn(room) >= 4) {
    this.partied = true;
    this.tracker.emit('party');
  }
  // A guest in the same place as you: welcomed.
  for (const r of this.remotes.values()) {
    if (r.active && r.info.guest && r.info.zone === this.zone && !this.metGuests.has(r.info.id)) {
      this.metGuests.add(r.info.id);
      this.tracker.emit('guest_met', { u: r.info.id });
    }
  }
}

// Hallway (10 times a second): on the walkie, and whispering to whoever is close while we talk.
export function noticeHallway(this: HouseScene) {
  const hall = this.hallway;
  if (!hall || this.zone !== 'hallway') return;
  if (hall.meTalking && !this.wasOnAir) this.tracker.emit('walkie_used');
  this.wasOnAir = hall.meTalking;
  if (hall.meTalking || !this.me.speaking || !hall.whisperOn) return;
  for (const r of this.remotes.values()) {
    if (!r.active || r.info.zone !== 'hallway' || this.whispered.has(r.info.id)) continue;
    if (Math.hypot(r.avatar.sprite.x - this.player.x, r.avatar.sprite.y - this.player.y) > WHISPER) continue;
    this.whispered.add(r.info.id);
    this.tracker.emit('whisper_used', { u: r.info.id });
  }
}
