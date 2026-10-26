import { currentUser } from '../net/profile';
import { recordGame } from '../net/games';
import { gameOn } from '../net/houseSettings';
import { devTest } from '../net/mode';
import { refreshWallet } from '../net/store';
import type { HideSpot } from '../scenes/houseLook';
import { icon } from '../ui/icons';
import { el } from '../ui/modal';
import { overlay } from '../ui/overlay';
import { play } from '../ui/sounds';
import { toast } from '../ui/toasts';
import { DEPTH } from './projection';
import { HS, HsHost, hiders, nearSpot, stillHiding, validState, type HsAct, type HsMsg, type HsState } from './hideSeekRules';
import type { HouseScene } from '../scenes/HouseScene';

// Hide and seek, the whole house (rules: src/house/hideSeekRules.ts). Start it from the games table; everyone
// in the house is asked to join. One seeker counts with their eyes shut while the others hide: get into a
// cupboard, behind the sofa, among the plants (stand next to it, tap Hide), or just find a dark corner. Then the
// seeker walks the house with a torch: they only see people close to them, find anyone they walk into, and
// search furniture to find whoever's inside. In the last 45 s hiding places rustle now and then. Hiders win if
// anyone's still hidden when time's up; the seeker wins by finding everyone.

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class HideSeek {
  s: HsState | null = null;
  private v = 0; // version of the last state we accepted (per round)
  private host: HsHost | null = null;
  private endsAt = 0; // local time the current phase ends
  private bar: HTMLElement | null = null;
  private torch: HTMLElement | null = null;
  private count: HTMLElement | null = null;
  private spots = new Map<string, HideSpot>();
  private tagged = new Map<string, number>();
  private searchAt = 0;
  private rustleAt = 0;
  private hostMissing = 0;
  private shown = ''; // what the bar shows now (only redraw when it changes)
  private lastSeen = ''; // the last find we played a sound for
  private wasActive = false;

  constructor(private scene: HouseScene) {
    for (const sp of scene.look.hideSpots) this.spots.set(sp.id, sp);
    if (devTest) (window as unknown as { __hs?: unknown }).__hs = this;
  }

  private get me() {
    return this.scene.presence?.id ?? currentUser()?.id ?? 'me';
  }
  get active() {
    return !!this.s && (this.s.phase === 'hide' || this.s.phase === 'seek');
  }
  private playing(id = this.me) {
    return !!this.s?.players.some((p) => p.id === id);
  }
  private isSeeker() {
    return !!this.s && this.s.seeker === this.me;
  }
  private hidden(id = this.me) {
    return !!this.s && id in this.s.hidden;
  }
  // You can't move: the seeker while counting, or a hider inside something.
  frozen() {
    if (!this.s) return false;
    return (this.s.phase === 'hide' && this.isSeeker()) || (this.active && this.hidden());
  }

  // ---- The network ----
  private send(m: HsMsg) {
    this.scene.presence?.sendHideSeek(m);
  }
  receive(raw: unknown) {
    const m = raw as HsMsg;
    if (!m || typeof m !== 'object') return;
    if (m.k === 'hello') {
      if (this.host && this.s) this.send({ k: 'snap', v: this.v, s: this.s });
      return;
    }
    if (m.k === 'act') {
      if (this.host && typeof m.from === 'string' && m.a && typeof m.a === 'object') this.host.act(m.from, m.a);
      return;
    }
    if (m.k !== 'snap' || typeof m.v !== 'number') return;
    if (m.s === null) {
      if (this.s && !this.host) this.take(null);
      return;
    }
    if (!validState(m.s)) return;
    // Someone else's round while we host one: the older round wins, so there's only ever one.
    if (this.host && m.s.round !== this.s?.round) {
      if (m.s.round < (this.s?.round ?? '')) {
        this.host = null;
      } else return this.send({ k: 'snap', v: this.v, s: this.s });
    }
    if (this.s && m.s.round === this.s.round && m.v <= this.v) return;
    this.v = m.v;
    this.take(m.s);
  }
  private act(a: HsAct) {
    if (this.host) this.host.act(this.me, a);
    else this.send({ k: 'act', from: this.me, a });
  }

  // A new state (ours as host, or the host's).
  private take(s: HsState | null) {
    const before = this.s;
    this.s = s;
    if (s) this.endsAt = Date.now() + s.left;
    if (!s) {
      if (before && before.phase !== 'end' && !this.host) toast({ icon: 'eye', id: 'hs-off', who: 'Hide and seek called off', small: true, ttl: 2500 });
      this.reset();
      return;
    }
    // Someone started a round: ask everyone who isn't in it yet.
    if (s.phase === 'lobby' && !this.playing() && (!before || before.round !== s.round)) {
      const host = s.players.find((p) => p.id === s.host)?.name ?? 'Someone';
      toast({ icon: 'eye', id: 'hs-invite', who: `${host} is starting Hide and seek`, what: 'The whole house can play. Join?', ttl: 20_000, actions: [{ label: 'Join', id: 'hs-join-toast', onClick: () => this.join() }, { label: 'Not now', quiet: true }] });
    }
    if (before?.phase !== s.phase) this.phaseChanged(s);
    if (s.last && `${s.round}:${s.last.at}` !== this.lastSeen) {
      this.lastSeen = `${s.round}:${s.last.at}`;
      const who = s.players.find((p) => p.id === s.last!.id)?.name ?? 'Someone';
      if (s.last.k === 'empty') {
        if (this.isSeeker()) play('error', 0.3);
      } else {
        play('coin', 0.5);
        toast({ icon: 'search', id: 'hs-found', who: s.last.id === this.me ? 'You’ve been found!' : `${who} found`, what: s.last.k === 'tagged' ? 'Caught in the open.' : 'Found hiding.', small: true, ttl: 2000 });
      }
    }
    this.shown = '';
  }

  private phaseChanged(s: HsState) {
    const seeker = s.players.find((p) => p.id === s.seeker)?.name ?? 'Someone';
    if (s.phase === 'hide' && this.playing()) {
      play('powerup', 0.5);
      if (this.isSeeker()) toast({ icon: 'eye-off', id: 'hs-role', who: 'You’re the seeker', what: `Count to ${HS.hideMs / 1000} while everyone hides.`, small: true, ttl: 3000 });
      else toast({ icon: 'footprints', id: 'hs-role', who: `${seeker} is seeking. Hide!`, what: 'Stand next to a cupboard, sofa, bookcase or plant and tap Hide.', ttl: 5000 });
    }
    if (s.phase === 'seek' && this.playing()) {
      play('confirm', 0.5);
      if (this.isSeeker()) toast({ icon: 'flashlight', id: 'hs-role', who: 'Ready or not, here I come!', what: 'Walk into people to find them. Search furniture to check inside.', ttl: 4000 });
    }
    if (s.phase === 'end') this.ended(s);
  }

  private ended(s: HsState) {
    if (!this.playing()) return;
    const won = s.winners.includes(this.me);
    play(won ? 'powerup' : 'click', 0.6);
    this.scene.tracker.emit('game_played', { u: 'hideseek' });
    if (won) this.scene.tracker.emit('game_won', { u: 'hideseek' });
    refreshWallet(3000);
  }

  // ---- What you can do ----
  start() {
    if (!gameOn('hideseek')) return toast({ icon: 'eye', who: 'Hide and seek is switched off for now', small: true, ttl: 2500 });
    if (this.s && this.s.phase !== 'end') {
      if (!this.playing() && this.s.phase === 'lobby') return this.join();
      return toast({ icon: 'eye', id: 'hs-busy', who: 'A round is already on', what: 'Join the next one.', small: true, ttl: 2500 });
    }
    const me = { id: this.me, name: this.scene.name };
    this.v = 0;
    this.host = new HsHost(
      me,
      (s) => {
        this.v++;
        this.send({ k: 'snap', v: this.v, s });
        if (s === null) {
          this.host = null;
          this.take(null);
        } else this.take(s);
      },
      (id) => this.where(id),
      (id) => this.spots.get(id) ?? null,
      (s) => void recordGame('hideseek', 'house', s.players.map((p) => p.id), s.winners, { found: s.found.length, of: hiders(s).length }),
    );
    this.v++;
    this.send({ k: 'snap', v: this.v, s: this.host.s });
    this.take(this.host.s);
    toast({ icon: 'eye', id: 'hs-lobby', who: 'Hide and seek: asking the house', what: `It starts in ${HS.lobbyMs / 1000} s, or tap Start when people have joined.`, small: true, ttl: 3500 });
  }
  join() {
    if (!this.s || this.s.phase !== 'lobby' || this.playing()) return;
    document.getElementById('hs-invite')?.remove();
    this.act({ t: 'join', name: this.scene.name });
  }
  private where(id: string) {
    if (id === this.me) return { x: this.scene.player.x, y: this.scene.player.y };
    const r = this.scene.remotes.get(id);
    return r ? { x: r.avatar.sprite.x, y: r.avatar.sprite.y } : null;
  }
  // The hiding place next to you, if any.
  private spotHere() {
    const p = { x: this.scene.player.x, y: this.scene.player.y };
    let best: HideSpot | null = null;
    let bd = Infinity;
    for (const sp of this.spots.values()) {
      if (!nearSpot(p, sp)) continue;
      const d = Math.hypot(sp.x + sp.w / 2 - p.x, sp.y + sp.h / 2 - p.y);
      if (d < bd) [best, bd] = [sp, d];
    }
    return best;
  }

  // ---- Every frame ----
  frame() {
    this.host?.tick();
    const s = this.s;
    if (s && !this.host && this.s?.host && !this.scene.remotes.has(s.host) && s.host !== this.me) {
      // The host has left the house: give it a few seconds (phones blip), then it's over.
      this.hostMissing ||= Date.now();
      if (Date.now() - this.hostMissing > 6000) {
        this.hostMissing = 0;
        this.take(null);
        return;
      }
    } else this.hostMissing = 0;
    // Someone in the round left the house: the host takes them out.
    if (this.host && s && s.phase !== 'end') for (const p of s.players) if (p.id !== this.me && !this.scene.remotes.has(p.id)) this.host.gone(p.id);
    this.applyVisibility();
    this.drawHud();
    if (!s) return;
    // The seeker finds anyone they walk into.
    if (s.phase === 'seek' && this.isSeeker()) {
      const me = this.where(this.me)!;
      for (const p of stillHiding(s)) {
        if (this.hidden(p.id)) continue;
        const at = this.where(p.id);
        if (!at || Math.hypot(at.x - me.x, at.y - me.y) > HS.tagRange) continue;
        if (Date.now() - (this.tagged.get(p.id) ?? 0) < 1000) continue;
        this.tagged.set(p.id, Date.now());
        this.act({ t: 'tag', id: p.id });
      }
    }
    // The last stretch: hiding places rustle now and then (everyone sees it).
    const left = this.endsAt - Date.now();
    if (s.phase === 'seek' && left < HS.rustleFrom && Date.now() - this.rustleAt > 8000) {
      this.rustleAt = Date.now();
      for (const spot of Object.values(s.hidden)) this.rustle(spot);
    }
  }

  private rustle(id: string) {
    const sp = this.spots.get(id);
    if (!sp) return;
    const t = this.scene.add.text(sp.x + sp.w / 2, sp.y - 6, '…', { fontFamily: 'Pixelify Sans', fontSize: '14px', color: '#fff4e0', stroke: '#0d0912', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(DEPTH.emote);
    t.setName('hs-rustle');
    this.scene.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 1400, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
  }

  // Who you can see: hiders inside something are invisible to everyone; the seeker only sees close by.
  private applyVisibility() {
    const s = this.s;
    const on = this.active;
    if (!on) {
      if (this.wasActive) {
        for (const r of this.scene.remotes.values()) r.avatar.setVisible(r.active);
        this.scene.me.sprite.setAlpha(1);
      }
      this.wasActive = false;
      return;
    }
    this.wasActive = true;
    const torch = s!.phase === 'seek' && this.isSeeker();
    const me = this.where(this.me)!;
    for (const [id, r] of this.scene.remotes) {
      if (!r.active) continue;
      let v = !(id in s!.hidden);
      if (v && torch && !s!.found.includes(id)) {
        const d = Math.hypot(r.avatar.sprite.x - me.x, r.avatar.sprite.y - me.y);
        v = d <= HS.torch;
      }
      if (r.avatar.sprite.visible !== v) r.avatar.setVisible(v);
    }
    this.scene.me.sprite.setAlpha(this.hidden() ? 0.4 : 1);
  }

  // ---- The screen: the bar at the top, the seeker's dark, the counting screen ----
  private drawHud() {
    const s = this.s;
    const host = overlay();
    if (!s) {
      this.bar?.remove();
      this.torch?.remove();
      this.count?.remove();
      this.bar = this.torch = this.count = null;
      return;
    }
    const left = Math.max(0, this.endsAt - Date.now());
    // The seeker's torch: dark everywhere except a circle around them.
    const torch = s.phase === 'seek' && this.isSeeker();
    if (torch) {
      if (!this.torch) {
        this.torch = el('div', 'hs-torch');
        this.torch.id = 'hs-torch';
        host.prepend(this.torch);
      }
      const cam = this.scene.cameras.main;
      const x = (this.scene.player.x - cam.worldView.x) * cam.zoom;
      const y = (this.scene.player.y - 8 - cam.worldView.y) * cam.zoom;
      const r = HS.torch * cam.zoom;
      this.torch.style.background = `radial-gradient(circle at ${x}px ${y}px, transparent ${r * 0.75}px, rgba(8,5,14,.55) ${r}px, rgba(8,5,14,.96) ${r * 1.35}px)`;
    } else {
      this.torch?.remove();
      this.torch = null;
    }
    // The seeker counting.
    const counting = s.phase === 'hide' && this.isSeeker();
    if (counting) {
      if (!this.count) {
        this.count = el('div', 'hs-count');
        this.count.id = 'hs-count';
        this.count.setAttribute('role', 'status');
        host.append(this.count);
      }
      const n = String(Math.ceil(left / 1000));
      if (this.count.dataset.n !== n) {
        this.count.dataset.n = n;
        const big = el('b', '', n);
        this.count.replaceChildren(icon('eye-off', { width: 40, height: 40 }), el('span', 'who', 'You’re the seeker'), big, el('span', 'what', 'Eyes shut! Everyone is hiding…'));
      }
    } else {
      this.count?.remove();
      this.count = null;
    }
    // The bar.
    const near = s.phase === 'hide' || s.phase === 'seek' ? this.spotHere() : null;
    const key = [s.phase, Math.ceil(left / 1000), s.players.length, s.found.length, this.hidden(), near?.id ?? '', this.playing()].join('|');
    if (key === this.shown && this.bar) return;
    this.shown = key;
    if (!this.bar) {
      this.bar = el('div', 'hs-bar dh-panel');
      this.bar.id = 'hs-bar';
      host.append(this.bar);
    }
    const line = el('div', 'hs-line');
    const title = el('b', '');
    title.append(icon(s.phase === 'seek' ? 'flashlight' : 'eye', { width: 18, height: 18 }), s.phase === 'lobby' ? 'Hide and seek' : s.phase === 'hide' ? 'Hide!' : s.phase === 'seek' ? 'Seeking' : 'Round over');
    const time = el('span', 'hs-time', s.phase === 'end' ? '' : fmt(left));
    time.id = 'hs-time';
    line.append(title, time);
    const sub = el('div', 'hs-sub');
    sub.id = 'hs-sub';
    const acts = el('div', 'hs-acts');
    const btn = (id: string, label: string, ic: Parameters<typeof icon>[0], f: () => void, quiet = false) => {
      const b = el('button', `dh-btn${quiet ? ' dh-btn--quiet' : ''}`);
      b.type = 'button';
      b.id = id;
      b.append(icon(ic, { width: 18 }), label);
      b.addEventListener('click', f);
      acts.append(b);
    };
    const seekerName = s.players.find((p) => p.id === s.seeker)?.name ?? 'Someone';
    const hidingCount = stillHiding(s).length;
    if (s.phase === 'lobby') {
      sub.textContent = `${s.players.map((p) => p.name).join(', ')} ${s.players.length === 1 ? 'is' : 'are'} in. Starts by itself when time's up.`;
      if (s.host === this.me) {
        btn('hs-start', `Start (${s.players.length})`, 'play', () => this.act({ t: 'start' }));
        (acts.lastElementChild as HTMLButtonElement).disabled = s.players.length < 2;
        btn('hs-stop', 'Call off', 'x', () => this.act({ t: 'stop' }), true);
      } else if (this.playing()) btn('hs-leave', 'Leave', 'log-out', () => this.act({ t: 'leave' }), true);
      else btn('hs-join', 'Join', 'eye', () => this.join());
    } else if (s.phase === 'hide' || s.phase === 'seek') {
      if (!this.playing()) sub.textContent = `${seekerName} is seeking · ${hidingCount} hiding. Watch, or join the next round.`;
      else if (this.isSeeker()) {
        sub.textContent = s.phase === 'hide' ? 'Wait for it…' : `${hidingCount} still hiding. Walk into people; search furniture.`;
        if (s.phase === 'seek' && near) btn('hs-search', `Search ${near.kind}`, 'search', () => this.search(near.id));
      } else if (s.found.includes(this.me)) sub.textContent = `You were found. ${hidingCount} still hiding: watch ${seekerName} look.`;
      else if (this.hidden()) {
        sub.textContent = `You’re hiding in ${this.spots.get(s.hidden[this.me])?.kind ?? 'there'}. Stay still!`;
        btn('hs-unhide', 'Come out', 'footprints', () => this.act({ t: 'unhide' }), true);
      } else {
        sub.textContent = near ? 'Good spot. Get in?' : `${seekerName} is ${s.phase === 'hide' ? 'counting' : 'looking'}. Hide next to furniture, or keep out of the light.`;
        if (near) {
          const taken = Object.values(s.hidden).includes(near.id);
          btn('hs-hide', taken ? 'Someone’s in there' : `Hide in ${near.kind}`, 'eye-off', () => this.act({ t: 'hide', spot: near.id }));
          (acts.lastElementChild as HTMLButtonElement).disabled = taken;
        }
      }
      if (s.host === this.me) btn('hs-stop', 'End', 'x', () => this.act({ t: 'stop' }), true);
    } else {
      const won = s.winners.includes(this.me);
      const names = [...(won ? ['You'] : []), ...s.winners.filter((id) => id !== this.me).map((id) => s.players.find((p) => p.id === id)?.name ?? 'Someone')];
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
      sub.textContent = !names.length
        ? 'Nobody won this time.'
        : s.winners.includes(s.seeker ?? '')
          ? s.seeker === this.me ? 'You found everyone! You win.' : `${seekerName} found everyone!`
          : `${list} stayed hidden: ${won ? 'you win!' : `${names.length === 1 ? 'wins' : 'win'}!`}`;
      if (s.host === this.me || !this.playing()) btn('hs-again', 'Play again', 'rotate-ccw', () => this.again(), true);
    }
    this.bar.replaceChildren(line, sub, ...(acts.childElementCount ? [acts] : []));
  }

  private search(spot: string) {
    if (Date.now() - this.searchAt < 1200) return;
    this.searchAt = Date.now();
    play('click', 0.4);
    this.act({ t: 'search', spot });
  }
  private again() {
    if (this.host) {
      this.host = null;
      this.take(null);
    }
    this.start();
  }

  private reset() {
    this.s = null;
    this.endsAt = 0;
    this.tagged.clear();
    this.shown = '';
  }

  // Joined the house: ask whether a round is on.
  hello() {
    this.send({ k: 'hello', from: this.me });
  }
}

