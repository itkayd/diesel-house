import { type RoomId } from '../config';
import type { DiceMsg, EmoteMsg, InviteMsg } from '../net/presence';
import { Duel, type DuelMsg } from '../games/rps';
import { rollText, type Roll } from '../games/dice';
import { randomSeed } from '../games/fair';
import { recordGame } from '../net/games';
import { postMessage } from '../net/chat';
import { play } from '../ui/sounds';
import { savedVolume, saveVolume } from '../prefs';
import { zoneLabel } from '../ui/overlay';
import { toast } from '../ui/toasts';
import { showFriendMenu } from '../ui/friendMenu';
import { EMOTE_EVERY, isEmote, type EmoteId } from '../ui/emotes';
import { WHISPER } from '../scenes/hallway';
import type { HouseScene } from '../scenes/HouseScene';
import { currentUser } from '../net/profile';
import { addFriend, answerFriend, friendOf, isBlocked, isFriend, reportPlayer, setBlock } from '../net/social';
import type { SpotId } from '../games/table';
import { openPlayerProfile } from '../ui/playerProfile';
import { openConversation, type MessagesDeps } from '../ui/messages';

// Being together: the tap-a-friend menu, emotes, dice over your head, and rock-paper-scissors duels.
// (Part of the house scene, split out in REDESIGN.md R1; `this` is the HouseScene.)

// Tapping someone (or Q next to them) opens their menu: volume when we're in a call with them, emotes,
// and a rock-paper-scissors duel.
export function tapAvatar(this: HouseScene, id: string) {
  this.tappedAvatar = true;
  const r = this.remotes.get(id);
  if (!r || !r.active) return;
  const name = r.info.name;
  const room = r.info.zone && r.info.zone !== 'hallway' ? (r.info.zone as RoomId) : null;
  const inCall = !!this.voice?.hasPeer(id) && this.voice.space === room;
  const near = Math.hypot(r.avatar.sprite.x - this.body.center.x, r.avatar.sprite.y - this.body.bottom) <= WHISPER;
  const where = room
    ? room === this.zone
      ? 'In this room with you.'
      : `In ${zoneLabel(room)}. Walk in to hear them.`
    : this.zone === 'hallway' && near
      ? 'You’re close enough to whisper.'
      : 'In the hallway. Get close to whisper.';
  showFriendMenu({
    name,
    character: r.info.character,
    volume: inCall
      ? {
          value: savedVolume(id),
          onChange: (v) => {
            saveVolume(id, v);
            this.voice?.setVolume(id, v);
          },
        }
      : undefined,
    where,
    onEmote: (e) => this.sendEmote(e, id),
    profile: () => this.openProfileOf(id, name),
    duel: this.duel || this.duelInvite ? undefined : () => this.startDuel(id),
    duelOff: 'You’re already in a duel',
    social: {
      // Friends are members (guests come and go).
      friend: currentUser()?.guest || r.info.guest ? null : (friendOf(id)?.status ?? 'none'),
      onFriend: async () => {
        const was = friendOf(id)?.status;
        if (was === 'incoming') {
          await answerFriend(id, true);
          return 'You’re friends now.';
        }
        const now = await addFriend(id, name, r.info.character);
        return now === 'friends' ? 'You’re friends now.' : 'Friend request sent. They’ll see it in Who’s where.';
      },
      onBlock: async () => {
        await setBlock(id, name, true);
        this.blockChanged(id);
      },
      onReport: (reason, details) =>
        reportPlayer(id, reason, details, {
          zone: this.zone,
          their_zone: r.info.zone ?? null,
          near: Math.round(Math.hypot(r.avatar.sprite.x - this.body.center.x, r.avatar.sprite.y - this.body.bottom)),
          their_chat: this.chat?.linesBy(id) ?? [],
          at: new Date().toISOString(),
        }),
    },
  });
}

// Someone was blocked or unblocked: their voice goes quiet (or comes back) straight away, and chat redraws.
export function blockChanged(this: HouseScene, id: string) {
  this.voice?.setVolume(id, isBlocked(id) ? 0 : savedVolume(id));
  this.chat?.refresh();
}

// Emotes (UPDATE.md Phase 11): over our head for everyone who can see us, at most one per 2 s.
export function sendEmote(this: HouseScene, e: EmoteId, to?: string) {
  const now = Date.now();
  if (now - this.lastEmote < EMOTE_EVERY || !this.presence) return;
  this.lastEmote = now;
  this.me.showEmote(e);
  play('emote', 0.6);
  this.presence.sendEmote(to ? { e, to } : { e });
  this.tracker.emit('emote_sent', to ? { u: to } : {});
}

export function receiveEmote(this: HouseScene, m: EmoteMsg) {
  const r = this.remotes.get(m.from);
  if (!r || !isEmote(m.e) || isBlocked(m.from)) return;
  // Same cap on the way in, so a modified client can't flood everyone's screen.
  const now = Date.now();
  if (now - (this.lastEmoteFrom.get(m.from) ?? 0) < EMOTE_EVERY - 300) return;
  this.lastEmoteFrom.set(m.from, now);
  r.avatar.showEmote(m.e);
  if (r.avatar.sprite.visible) play('emote', m.to === this.presence?.id ? 0.6 : 0.3);
  // A friend in our room finished a challenge or levelled up: a little confetti over them.
  if (m.cheer && r.info.zone === this.zone && this.zone !== 'hallway' && r.avatar.sprite.visible) this.confettiOver(r.avatar.sprite);
}

// Dice (UPDATE.md Phase 12): over our head for everyone, and in a room a line in the chat.
export function rollDice(this: HouseScene, r: Roll) {
  const now = Date.now();
  if (now - this.lastRoll < 1500 || !this.presence) return;
  this.lastRoll = now;
  this.me.showDice(r.values, r.sides);
  play('dice_throw', 0.7);
  this.tracker.emit('game_played', { u: 'dice' });
  if (r.n === 2 && r.sides === 6 && r.values[0] === 6 && r.values[1] === 6) this.tracker.emit('double_six');
  this.presence.sendDice({ v: r.values, s: r.sides });
  const room = this.zone && this.zone !== 'hallway' ? (this.zone as RoomId) : null;
  if (room) void postMessage(room, rollText(r), { name: this.name, character: this.character }, 'roll');
}

export function receiveDice(this: HouseScene, m: DiceMsg) {
  const r = this.remotes.get(m.from);
  if (!r || !Array.isArray(m.v) || m.v.length < 1 || m.v.length > 6 || isBlocked(m.from)) return;
  const sides = Math.max(2, Math.min(100, Number(m.s) || 6));
  const v = m.v.map((x) => Math.max(1, Math.min(sides, Math.round(Number(x) || 1))));
  r.avatar.showDice(v, sides);
  if (r.avatar.sprite.visible) play('dice_throw', 0.4);
}

// Rock-paper-scissors duel: invite, wait for yes, then both open the duel card.
export function startDuel(this: HouseScene, id: string) {
  const r = this.remotes.get(id);
  if (!r || !this.presence) return;
  if (this.duel || this.duelInvite) {
    toast({ icon: 'swords', id: 'duel-busy', who: 'You’re already in a duel', what: 'Finish or cancel it first.', small: true, ttl: 2500 });
    return;
  }
  const duelId = randomSeed().slice(0, 12);
  this.presence.sendDuel({ k: 'invite', id: duelId, from: this.presence.id, to: id });
  this.duelInvite = { id: duelId, to: id, timer: setTimeout(() => this.cancelInvite('no answer'), 20_000) };
  toast({
    icon: 'swords',
    id: 'duel-wait',
    who: `Challenged ${r.info.name}`,
    what: 'Rock paper scissors. Waiting for them…',
    ttl: 0,
    actions: [{ label: 'Cancel', id: 'duel-cancel', onClick: () => this.cancelInvite('cancelled') }],
  });
}

export function cancelInvite(this: HouseScene, why: 'no answer' | 'cancelled' | 'declined' | 'busy' | 'left') {
  const inv = this.duelInvite;
  if (!inv) return;
  clearTimeout(inv.timer);
  this.duelInvite = null;
  document.getElementById('duel-wait')?.remove();
  // Tell them, so a late "Play" doesn't open a duel nobody is waiting for.
  if (why === 'cancelled' || why === 'no answer') this.presence?.sendDuel({ k: 'quit', id: inv.id, from: this.presence.id, to: inv.to });
  const name = this.remotes.get(inv.to)?.info.name ?? 'They';
  const who = why === 'busy' ? `${name} is in another duel` : why === 'declined' ? `${name} said not now` : why === 'left' ? `${name} left` : `${name} didn’t answer`;
  if (why !== 'cancelled') toast({ icon: 'swords', who, what: 'Maybe later.', small: true, ttl: 3000 });
}

export function openDuel(this: HouseScene, id: string, them: string, host: boolean) {
  const r = this.remotes.get(them);
  if (!r || !this.presence) return;
  const me = { id: this.presence.id, name: this.name, character: this.character };
  this.duel = new Duel(
    id,
    me,
    { id: them, name: r.info.name, character: r.info.character },
    host,
    {
      send: (m) => this.presence?.sendDuel(m),
      record: (players, winners, score) => void recordGame('rps', 'duel', players, winners, score),
      onEnd: (winner, loser) => this.duelEnded(winner, loser),
      rematch: () => this.startDuel(them),
    },
    () => (this.duel = null),
  );
  this.duel.open();
}

// Everyone sees it: a crown for the winner (30 s), a dizzy swirl for the loser.
export function duelEnded(this: HouseScene, winner: string, loser: string) {
  const av = (id: string) => (id === this.presence?.id ? this.me : this.remotes.get(id)?.avatar);
  av(winner)?.setCrown(30_000);
  av(loser)?.showEmote('swirl');
  const me = this.presence?.id;
  if (me === winner || me === loser) this.tracker.emit('game_played', { u: 'rps' });
  if (me === winner) {
    this.tracker.emit('rps_won');
    this.tracker.emit('game_won', { u: 'rps' });
  }
}

export function receiveDuel(this: HouseScene, m: DuelMsg) {
  if (m.k === 'end') return this.duelEnded(m.winner, m.loser);
  const r = this.remotes.get(m.from);
  if (!r || !this.presence) return;
  const me = this.presence.id;
  if (m.k === 'invite') {
    // Someone you blocked: a plain "not now" (they aren't told why).
    if (isBlocked(m.from)) return this.presence.sendDuel({ k: 'decline', id: m.id, from: me, to: m.from });
    if (this.duel || this.duelInvite) return this.presence.sendDuel({ k: 'decline', id: m.id, from: me, to: m.from, busy: true });
    play('powerup', 0.5);
    const answer = (yes: boolean) => {
      document.getElementById('duel-invite')?.remove();
      this.presence?.sendDuel({ k: yes ? 'accept' : 'decline', id: m.id, from: me, to: m.from });
      if (yes) this.openDuel(m.id, m.from, false);
    };
    toast({
      icon: 'swords',
      id: 'duel-invite',
      who: `${r.info.name} challenges you`,
      what: 'Rock paper scissors, best of three.',
      ttl: 20_000,
      actions: [
        { label: 'Play', id: 'duel-accept', onClick: () => answer(true) },
        { label: 'Not now', id: 'duel-decline', onClick: () => answer(false) },
      ],
    });
    return;
  }
  const inv = this.duelInvite;
  if (inv && m.id === inv.id && m.from === inv.to && (m.k === 'accept' || m.k === 'decline')) {
    if (m.k === 'decline') return this.cancelInvite(m.busy ? 'busy' : 'declined');
    clearTimeout(inv.timer);
    this.duelInvite = null;
    document.getElementById('duel-wait')?.remove();
    return this.openDuel(m.id, m.from, true);
  }
  if (m.k === 'quit' && !this.duel) document.getElementById('duel-invite')?.remove();
  this.duel?.onMessage(m);
}

// "Invite friends to this table" (U4): friends in the house get a ping; with none about, everyone in the
// house (but never someone you blocked). At most one invite every 20 s.
export function inviteToTable(this: HouseScene, spot: SpotId) {
  if (!this.presence) return 'You’re offline';
  const now = Date.now();
  if (now - this.lastInvite < 20_000) return 'Invited just now';
  const here = [...this.remotes.values()].filter((r) => r.active && !isBlocked(r.info.id));
  const friends = here.filter((r) => isFriend(r.info.id));
  const ask = friends.length ? friends : here;
  if (!ask.length) return 'Nobody else is in the house yet';
  if (!this.presence.sendInvite({ to: ask.map((r) => r.info.id), spot, name: this.name })) return 'You’re offline';
  this.lastInvite = now;
  const names = ask.map((r) => r.info.name);
  return names.length <= 2 ? `Invited ${names.join(' and ')}` : `Invited ${names.length} people`;
}

export function receiveInvite(this: HouseScene, m: InviteMsg) {
  const r = this.remotes.get(m.from);
  if (!r || isBlocked(m.from)) return;
  const spot = this.spots.spots.find((s) => s.id === m.spot);
  if (!spot) return;
  const where = m.spot === 'hall' ? 'the Great Hall table' : `the ${zoneLabel(m.spot as RoomId)} table`;
  play('powerup', 0.5);
  toast({
    icon: 'dices',
    id: 'table-invite',
    who: `${r.info.name} wants to play`,
    what: `Come to ${where}.`,
    ttl: 20_000,
    actions: [
      {
        label: 'Go',
        id: 'table-invite-go',
        onClick: () => {
          document.getElementById('table-invite')?.remove();
          if (this.walkTo(spot.x, spot.y)) toast({ icon: 'footprints', who: 'On your way', what: 'Move any way to stop.', small: true, ttl: 1600 });
        },
      },
      { label: 'Not now', id: 'table-invite-no', onClick: () => document.getElementById('table-invite')?.remove() },
    ],
  });
}

// Anyone's profile (src/ui/playerProfile.ts), with Message, Report and Block.
export function openProfileOf(this: HouseScene, id: string, name: string) {
  const me = this.presence?.id ?? '';
  if (id === me) return this.openMyProfile();
  openPlayerProfile(id, name, {
    where: (who) => {
      const r = this.remotes.get(who);
      if (!r?.active) return null;
      return !r.info.zone || r.info.zone === 'hallway' ? 'In the Great Hall now' : `In ${zoneLabel(r.info.zone as RoomId)} now`;
    },
    message: (who, n, character) => openConversation(who, n, character, this.messagesDeps()),
    reportContext: (who) => ({ zone: this.zone, their_zone: this.remotes.get(who)?.info.zone ?? null, their_chat: this.chat?.linesBy(who) ?? [], from: 'profile', at: new Date().toISOString() }),
    blocked: (who) => this.blockChanged(who),
    amGuest: !!currentUser()?.guest,
    // Test mode: their profile from what the house knows.
    fake: (who) => {
      const r = this.remotes.get(who);
      if (!r) return null;
      return { id: who, name: r.info.name, character: r.info.character, pet: r.info.pet ?? null, member: !r.info.guest, me: false, level: r.info.lv ?? 1, xp: 0, streak: r.info.st ?? 0, best_streak: r.info.st ?? 0, joined: new Date().toISOString(), last_on: null, host: null, medals: ['rank_visitor'], arcade_best: 0, games_won: 0, critters: 0, friends: 0, friend: friendOf(who)?.status ?? 'none', blocked: isBlocked(who), banned: false };
    },
  });
}

export function messagesDeps(this: HouseScene): MessagesDeps {
  return {
    me: () => this.presence?.id ?? '',
    nameOf: (who) => {
      const r = this.remotes.get(who);
      return r ? { name: r.info.name, character: r.info.character } : null;
    },
    profile: (who, n) => this.openProfileOf(who, n),
  };
}
