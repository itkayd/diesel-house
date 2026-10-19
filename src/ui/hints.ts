import { icon, type IconName } from './icons';
import { isTouchDevice } from './joystick';
import { el } from './modal';
import { hudToasts, overlay } from './overlay';
import { play } from './sounds';

// The first minutes in the house (design/review/UX-RULES.md §3, stage U2): little one-time tips that
// point at a control the first time it matters ("This is your mic…"), and a card when the house is
// empty so a newcomer isn't left standing in a quiet hall. One tip at a time, never over a pop-up, each
// shown once ever (remembered on this device). "Got it" or a tap closes it; it also fades by itself.
// Automated checks don't get them unless they ask (?hints).

const SEEN_KEY = 'diesel-house.hints-seen';
const SHOW_MS = 14_000;
const GAP_MS = 6_000; // between two tips

export type HintId = 'move' | 'map' | 'mic' | 'walkie' | 'wave' | 'games' | 'xp' | 'challenges';
type Hint = { id: HintId; anchor: string; text: string };

export type FirstRunDeps = {
  zone: () => string | null; // 'hallway', a room id, or null (outside)
  moved: () => boolean; // walked anywhere yet
  others: () => number; // people in the house (not us)
  nearby: () => number; // people in the same room (or close by in the hall)
  nearGames: () => boolean;
  member: boolean;
  arcade: () => void;
  invite: () => void;
  map: () => void;
};

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function remember(id: string) {
  const s = seen();
  s.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
  } catch {
    // private browsing: they show again next time
  }
}

export class FirstRun {
  private deps: FirstRunDeps | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private start = Date.now();
  private shown: { hint: Hint; box: HTMLElement; until: number } | null = null;
  private lastClosed = 0;
  private wanted = new Set<HintId>(); // asked for by events (xp)
  private quietAt: number | null = null;
  private quietShown = false;

  get enabled() {
    return !navigator.webdriver || new URLSearchParams(location.search).has('hints');
  }

  begin(deps: FirstRunDeps) {
    if (this.timer || !this.enabled) return;
    this.deps = deps;
    this.start = Date.now();
    this.timer = setInterval(() => this.tick(), 1000);
    addEventListener('resize', () => this.place());
  }

  // Something happened that a tip explains (the first XP).
  notify(id: HintId) {
    if (!seen().has(id)) this.wanted.add(id);
  }

  // Close the tip on screen (Got it, or it ran out).
  dismiss(mark = true) {
    if (!this.shown) return;
    if (mark) remember(this.shown.hint.id);
    this.shown.box.remove();
    this.shown = null;
    this.lastClosed = Date.now();
  }

  private busy() {
    // A pop-up, the guide, a game or a sheet is open: wait.
    return !!document.querySelector('.dh-scrim, .dh-sheet--side:not([hidden]), #arcade');
  }

  private tick() {
    const d = this.deps;
    if (!d) return;
    if (this.shown) {
      const a = document.querySelector<HTMLElement>(this.shown.hint.anchor);
      if (!a || !visible(a) || this.busy()) this.dismiss(false); // its button went away: show it another time
      else if (Date.now() > this.shown.until) this.dismiss();
      else this.place();
      return;
    }
    this.quiet(d);
    if (this.busy() || Date.now() - this.lastClosed < GAP_MS || document.querySelector('.dh-quiet')) return;
    const t = (Date.now() - this.start) / 1000;
    const done = seen();
    const phone = isTouchDevice();
    const zone = d.zone();
    const room = !!zone && zone !== 'hallway';
    const candidates: [boolean, Hint][] = [
      [t > 4 && !d.moved(), { id: 'move', anchor: phone ? '#joystick' : '#where', text: phone ? 'Drag the joystick to walk around.' : 'Walk with WASD or the arrow keys.' }],
      [room, { id: 'mic', anchor: '#mic-button', text: 'This is your mic. Everyone in this room hears you; tap it to mute.' }],
      [d.nearby() > 0, { id: 'wave', anchor: '#emote-button', text: 'Someone’s here! Send a wave to say hi.' }],
      [zone === 'hallway' && d.others() > 0, { id: 'walkie', anchor: '#walkie-button', text: phone ? 'Hold to talk to everyone in the Great Hall.' : 'Hold this (or T) to talk to everyone in the Great Hall.' }],
      [d.nearGames(), { id: 'games', anchor: '#game-prompt', text: 'A games table! Open it and anyone else who opens it can play with you.' }],
      [this.wanted.has('xp'), { id: 'xp', anchor: '#xp-chip', text: 'You earned XP! Tap here for your level, medals and pet.' }],
      [t > 40, { id: 'map', anchor: '#map-button', text: 'Who’s where: see everyone in the house, and tap a room to walk there.' }],
      [t > 120, { id: 'challenges', anchor: '#challenges-button', text: 'Daily and weekly challenges give XP. Have a look.' }],
    ];
    for (const [ok, hint] of candidates) {
      if (!ok || done.has(hint.id)) continue;
      const a = document.querySelector<HTMLElement>(hint.anchor);
      if (!a || !visible(a)) continue;
      this.wanted.delete(hint.id);
      this.show(hint);
      return;
    }
  }

  private show(hint: Hint) {
    const box = el('div', 'dh-hint');
    box.id = `hint-${hint.id}`;
    box.setAttribute('role', 'status');
    const ok = el('button', 'dh-hint-ok', 'Got it');
    ok.type = 'button';
    ok.addEventListener('click', () => this.dismiss());
    box.append(el('span', 't', hint.text), ok);
    overlay().append(box);
    this.shown = { hint, box, until: Date.now() + SHOW_MS };
    // Using the thing it points at is as good as "Got it".
    const a = document.querySelector<HTMLElement>(hint.anchor);
    a?.addEventListener('pointerdown', () => this.shown?.box === box && this.dismiss(), { once: true });
    this.place();
    play('click', 0.25);
  }

  // Next to its button: above it when the button is in the lower half of the screen, else below.
  private place() {
    if (!this.shown) return;
    const a = document.querySelector<HTMLElement>(this.shown.hint.anchor);
    if (!a) return;
    const r = a.getBoundingClientRect();
    const box = this.shown.box;
    const w = Math.min(260, innerWidth - 24);
    box.style.width = `${w}px`;
    const cx = r.left + r.width / 2;
    const left = Math.max(12, Math.min(innerWidth - w - 12, cx - w / 2));
    box.style.left = `${left}px`;
    box.style.setProperty('--arrow', `${Math.max(14, Math.min(w - 14, cx - left))}px`);
    const below = r.top + r.height / 2 < innerHeight / 2;
    box.classList.toggle('below', below);
    if (below) {
      box.style.top = `${r.bottom + 12}px`;
      box.style.bottom = '';
    } else {
      box.style.bottom = `${innerHeight - r.top + 12}px`;
      box.style.top = '';
    }
  }

  // Nobody else here for a while: a card with things to do on your own (once a visit).
  private quiet(d: FirstRunDeps) {
    if (this.quietShown) return;
    if (d.others() > 0) {
      this.quietAt = null;
      return;
    }
    this.quietAt ??= Date.now();
    if (Date.now() - this.quietAt < 20_000 || this.busy() || this.shown) return;
    try {
      if (sessionStorage.getItem('diesel-house.quiet-shown')) return void (this.quietShown = true);
      sessionStorage.setItem('diesel-house.quiet-shown', '1');
    } catch {
      // fine: shown once for this page
    }
    this.quietShown = true;
    const card = el('div', 'dh-toast dh-quiet');
    card.id = 'quiet-card';
    card.setAttribute('role', 'status');
    const ico = el('span', 'dh-guide-ico');
    ico.append(icon('moon'));
    const text = el('div');
    text.append(el('div', 'who', 'Quiet in here right now'), el('div', 'what', 'Nobody else is in. A few things to do while you wait:'));
    const acts = el('div', 'actions dh-quiet-acts');
    const btn = (id: string, ic: IconName, label: string, run: () => void, main = false) => {
      const b = el('button', main ? 'dh-btn' : 'dh-btn dh-btn--quiet');
      b.type = 'button';
      b.id = id;
      b.append(icon(ic), document.createTextNode(label));
      b.addEventListener('click', () => {
        card.remove();
        run();
      });
      return b;
    };
    acts.append(btn('quiet-arcade', 'gamepad-2', 'Play Night Raid', d.arcade, true));
    if (d.member) acts.append(btn('quiet-invite', 'ticket', 'Invite a friend', d.invite));
    acts.append(btn('quiet-map', 'map', 'Explore', d.map));
    const x = el('button', 'dh-iconbtn dh-quiet-x');
    x.type = 'button';
    x.id = 'quiet-close';
    x.setAttribute('aria-label', 'Close');
    x.append(icon('x'));
    x.addEventListener('click', () => card.remove());
    card.append(ico, text, acts, x);
    hudToasts().append(card);
    setTimeout(() => card.remove(), 45_000);
  }
}

const visible = (e: HTMLElement) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;

export const firstRun = new FirstRun();
