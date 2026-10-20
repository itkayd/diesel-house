import type { Skin } from '../characters';
import { CHALLENGE_ICONS, MEDAL_CELLS, medalById, RANK_MEDALS, type Medal } from '../challenges/pool';
import { formatXp, legendStars, progress, rankOf, type Rank } from '../challenges/levels';
import type { BoardRow, Challenge, Progress } from '../net/progress';
import type { CatchRow } from '../net/critters';
import { critterIcon } from '../critters/art';
import { critterById } from '../critters/critters';
import { icon } from './icons';
import { el, openModal } from './modal';
import { hudButtons, overlay } from './overlay';
import { portrait } from './portrait';
import { play } from './sounds';
import { toast } from './toasts';

// Phase 14 on screen (design/game/v2.html): the XP chip under the where-am-I pill (tap: your profile, as in
// the mock, so the top-right row is just map / challenges / settings), the Challenges button
// (trophy, dot while something's left to do), the Challenges sheet (Today / This week), medal toasts,
// the level-up overlay with confetti, and the noticeboard's weekly leaderboard. Numbers come from
// record_events() (src/net/progress.ts); nothing here decides XP.

// A medal from public/assets/ui/medals.png (48 px cells). The ?v= changes whenever the sheet does: Vercel lets
// phones keep /assets/* for a day, and an old, shorter sheet showed the wrong medals.
const MEDALS_URL = `assets/ui/medals.png?v=${MEDAL_CELLS}`;
export function medalEl(m: Medal, size = 48) {
  const s = size / 48;
  const i = el('span', 'v2-medal');
  i.style.cssText = `width:${size}px;height:${size}px;background-image:url(${MEDALS_URL});background-size:${MEDAL_CELLS * 48 * s}px ${48 * s}px;background-position:-${m.cell * 48 * s}px 0`;
  i.setAttribute('role', 'img');
  i.setAttribute('aria-label', m.name);
  return i;
}
const rankMedal = (r: Rank) => RANK_MEDALS.find((m) => m.id === r.id)!;

// "Lv 12" in the rank's colour; Legend adds its stars.
export function levelChip(level: number) {
  const r = rankOf(level);
  const chip = el('span', 'v2-chip v2-lvchip', `Lv ${level.toLocaleString()}`);
  chip.style.background = r.colour;
  const stars = legendStars(level);
  if (stars) chip.append(el('span', 'stars', ` ${stars}`));
  return chip;
}

// ---- HUD: the XP chip and the Challenges button ----

// The level shown while your progress loads: what it was last time on this device.
const LAST_KEY = 'diesel-house.last-progress';
function lastProgress(): { xp: number; streak: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as { xp: number; streak: number } | null;
    return v && Number.isFinite(v.xp) ? v : null;
  } catch {
    return null;
  }
}

export class ProgressHud {
  private chip = el('button', 'v2-xp');
  private btn = el('button', 'dh-iconbtn');
  private dot = el('span', 'dh-badge-dot');
  private state: Progress | null = null;

  constructor(
    private me: () => { character: Skin; guest: boolean },
    private openChallenges: () => void,
    openProfile: () => void,
  ) {
    this.chip.type = 'button';
    this.chip.id = 'xp-chip';
    this.chip.setAttribute('aria-label', 'Your profile, level and streak');
    this.chip.addEventListener('click', openProfile);
    this.btn.type = 'button';
    this.btn.id = 'challenges-button';
    this.btn.setAttribute('aria-label', 'Challenges');
    this.btn.append(icon('trophy'), this.dot);
    this.dot.hidden = true;
    this.btn.addEventListener('click', () => this.openChallenges());
    // After the map button, before settings.
    const row = hudButtons();
    const map = row.querySelector('#map-button');
    if (map) map.after(this.btn);
    else row.prepend(this.btn);
    document.querySelector('#overlay .dh-hud-tl')?.append(this.chip);
    this.render();
  }

  update(p: Progress | null, gained = 0) {
    this.state = p;
    if (p)
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ xp: p.xp, streak: p.streak }));
      } catch {
        // private browsing: no cache
      }
    this.render();
    if (gained > 0) {
      const f = el('span', 'v2-float', `+${gained.toLocaleString()} XP`);
      this.chip.append(f);
      setTimeout(() => f.remove(), 1300);
    }
  }

  render() {
    const who = this.me();
    const p = this.state;
    this.chip.replaceChildren(portrait(who.character, 30));
    const mid = el('span', 'mid');
    // Still loading (or offline): the level from last time, dimmed, or a placeholder bar. Never a bare "…".
    const last = who.guest || p ? null : lastProgress();
    this.chip.classList.toggle('stale', !p && !who.guest);
    if (who.guest || (!p && !last)) {
      mid.append(el('span', 'lv', who.guest ? 'Guest' : 'Lv'));
      if (!who.guest) mid.append(el('span', 'v2-bar v2-bar--skeleton'));
      this.chip.append(mid);
      this.dot.hidden = true;
      this.chip.dataset.level = '';
      this.chip.setAttribute('aria-label', 'Your profile, level and streak');
      return;
    }
    const xp = p?.xp ?? last!.xp;
    const pr = progress(xp);
    this.chip.setAttribute('aria-label', `Your profile: level ${pr.level}, ${pr.pct}% to the next`);
    const lv = el('span', 'lv');
    lv.append(medalEl(rankMedal(rankOf(pr.level)), 16), document.createTextNode(`Lv ${pr.level.toLocaleString()}`));
    const bar = el('span', 'v2-bar');
    const b = el('b');
    b.style.width = `${pr.pct}%`;
    bar.append(b);
    mid.append(lv, bar);
    const days = p?.streak ?? last!.streak;
    const streak = el('span', 'streak');
    streak.append(icon('flame'), document.createTextNode(String(days)));
    streak.title = `${days}-day streak`;
    this.chip.append(mid, streak);
    this.chip.dataset.level = p ? String(pr.level) : '';
    this.dot.hidden = !p || !p.challenges.some((c) => !c.done);
  }
}

// ---- The Challenges sheet ----

export function openChallenges(p: Progress | null, guest: boolean, tab: 'day' | 'week' = 'day', retry?: () => void) {
  const { panel, close } = openModal('challenges', { dismissable: true, label: 'challenges-title' });
  const head = el('div', 'v2-head');
  const h = el('h2', '', 'Challenges');
  h.id = 'challenges-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'challenges-close';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(icon('trophy'), h, x);
  panel.append(head);
  if (guest) {
    panel.append(el('p', 'dh-lede', 'Guests don’t earn XP. Challenges, levels and medals are for members: ask Diesel for an invite to join in.'));
    return;
  }
  if (!p) {
    // Still loading. If nothing comes (offline, a slow network), say so and offer to try again.
    const wait = el('p', 'dh-lede', 'Loading your challenges…');
    const ghosts = el('div', 'v2-list');
    ghosts.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) ghosts.append(el('div', 'v2-item dh-skeleton'));
    panel.append(wait, ghosts);
    setTimeout(() => {
      if (!wait.isConnected) return;
      ghosts.remove();
      wait.textContent = 'Couldn’t load your challenges. Check your connection.';
      if (!retry) return;
      const again = el('button', 'dh-btn dh-btn--quiet', 'Try again');
      again.type = 'button';
      again.id = 'challenges-retry';
      again.addEventListener('click', () => {
        close();
        retry();
      });
      panel.append(again);
    }, 8000);
    return;
  }
  const pr = progress(p.xp);
  const stats = el('div', 'v2-stats');
  const stat = (big: string | Node, small: string) => {
    const s = el('div', 'v2-stat');
    const b = el('b');
    b.append(big);
    s.append(b, el('span', '', small));
    return s;
  };
  stats.append(
    stat(`Lv ${pr.level.toLocaleString()}`, `${pr.toGo.toLocaleString()} XP to go`),
    stat(String(p.streak), 'Day streak'),
    stat(`${p.challenges.filter((c) => c.done).length}/${p.challenges.length}`, 'Done'),
  );
  const tabs = el('div', 'v2-tabs');
  tabs.setAttribute('role', 'tablist');
  const list = el('div', 'v2-list');
  list.id = 'challenges-list';
  const note = el('p', 'v2-note');
  const show = (t: 'day' | 'week') => {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    list.replaceChildren(...p.challenges.filter((c) => c.period === t).map(challengeRow));
    if (t === 'day') {
      const mid = new Date();
      mid.setHours(24, 0, 0, 0);
      const hrs = Math.max(1, Math.ceil((mid.getTime() - Date.now()) / 36e5));
      note.textContent = `New challenges in ${hrs} h (midnight your time). Progress updates within about 30 s.`;
    } else note.textContent = 'New weekly challenges every Monday (your time).';
  };
  for (const [t, ic, label] of [['day', 'sun', 'Today'], ['week', 'calendar-days', 'This week']] as const) {
    const b = el('button');
    b.type = 'button';
    b.dataset.tab = t;
    b.id = `challenges-tab-${t}`;
    b.setAttribute('role', 'tab');
    b.append(icon(ic), label);
    b.addEventListener('click', () => show(t));
    tabs.append(b);
  }
  panel.append(stats, tabs, list, note);
  show(tab);
}

function challengeRow(c: Challenge) {
  const row = el('div', 'v2-item' + (c.done ? ' done' : ''));
  row.dataset.challenge = c.id;
  const ic = el('span', 'ic');
  ic.append(icon(c.done ? 'check' : (CHALLENGE_ICONS[c.id] ?? 'award')));
  const mid = el('span');
  mid.style.cssText = 'display:grid;gap:5px;min-width:0';
  const bar = el('span', 'v2-bar' + (c.done ? ' ok' : ''));
  const b = el('b');
  b.style.width = `${(Math.min(c.progress, c.goal) / c.goal) * 100}%`;
  bar.append(b);
  mid.append(el('span', 't', c.title), bar, el('span', 's', `${Math.min(c.progress, c.goal)} / ${c.goal}`));
  row.append(ic, mid, el('span', 'v2-xpchip', `+${c.xp} XP`));
  return row;
}

// ---- Toasts, medal and level-up ----

export function challengeToast(c: { title: string; xp: number }) {
  play('challenge', 0.8);
  toast({ icon: 'trophy', who: 'Challenge done!', what: `${c.title} · +${c.xp} XP`, small: true, ttl: 3400 });
}

export function medalToast(id: string, xp: number) {
  const m = medalById(id);
  if (!m) return;
  play('coin', 0.8);
  const remove = toast({ icon: 'award', who: m.rank ? `New rank: ${m.name}` : `Medal: ${m.name}`, what: xp ? `${m.how} · +${xp} XP` : m.how, ttl: 4200 });
  // Swap the icon for the medal itself.
  const box = document.querySelector('#toasts .dh-toast:last-child');
  box?.firstElementChild?.replaceWith(medalEl(m, 40));
  return remove;
}

// Critters: turned up, caught, got away. The toast's icon is the critter itself.
export function critterToast(id: string, who: string, what: string) {
  const remove = toast({ icon: 'paw-print', who, what, small: true, ttl: 3200 });
  document.querySelector('#toasts .dh-toast:last-child')?.firstElementChild?.replaceWith(critterIcon(id, 28));
  return remove;
}

// Shown once even after several level-ups at once ("Level 22 → 24").
export function levelUpOverlay(from: number, to: number) {
  play('levelup', 0.9);
  const o = el('div', 'v2-lvl');
  o.id = 'level-up';
  const card = el('div', 'card dh-panel');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', `Level up: level ${to}`);
  const r = rankOf(to);
  const newRank = rankOf(from).id !== r.id;
  card.append(el('div', 'k', 'Level up'));
  const n = el('div', 'n', to - from > 1 ? `Lv ${from.toLocaleString()} → ${to.toLocaleString()}` : `Lv ${to.toLocaleString()}`);
  n.style.color = r.colour;
  card.append(n);
  if (newRank) card.append(medalEl(rankMedal(r), 64), el('p', '', `New rank: ${r.title}${legendStars(to) ? ' ' + legendStars(to) : ''}`));
  else card.append(el('p', '', `${r.title}${legendStars(to) ? ' ' + legendStars(to) : ''} · keep hanging out for the next one.`));
  const ok = el('button', 'dh-btn', 'Nice!');
  ok.type = 'button';
  ok.id = 'level-up-ok';
  card.append(ok);
  o.append(card);
  confetti(o, 46);
  const back = document.activeElement;
  const close = () => {
    if (!o.isConnected) return;
    o.remove();
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  };
  o.addEventListener('click', close);
  overlay().append(o);
  ok.focus({ preventScroll: true });
  setTimeout(close, 6000);
}

function confetti(into: HTMLElement, n: number) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cols = ['#f4b860', '#ffd36b', '#6fdc8c', '#9ec9ff', '#ff9fb2', '#c99bff'];
  for (let i = 0; i < n; i++) {
    const c = el('i', 'v2-conf');
    c.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-duration:${1.6 + Math.random() * 1.4}s;animation-delay:${Math.random() * 0.6}s`;
    into.append(c);
  }
}

// A small burst over someone in the world (a friend in your room finished something), at screen x/y.
export function confettiAt(x: number, y: number) {
  const box = el('div', 'v2-burst');
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  confetti(box, 14);
  overlay().append(box);
  setTimeout(() => box.remove(), 3200);
}

// ---- Noticeboard: this week's top housemates ----

// rows / catches null: still loading, or (`failed`) they couldn't be loaded.
export function openNoticeboard(rows: BoardRow[] | null, catches: CatchRow[] | null, me: string, guest: boolean, seeChallenges: () => void, tab: 'week' | 'catches' = 'week', failed = false) {
  const { panel, close } = openModal('noticeboard', { dismissable: true, label: 'noticeboard-title' });
  const head = el('div', 'v2-head');
  const h = el('h2', '', 'Noticeboard');
  h.id = 'noticeboard-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'noticeboard-close';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(icon('clipboard-list'), h, x);
  panel.append(head);
  if (guest) {
    panel.append(el('p', 'dh-lede', 'The leaderboard is for members. Guests don’t earn XP.'));
    return;
  }
  const tabs = el('div', 'v2-tabs');
  tabs.setAttribute('role', 'tablist');
  const label = el('div', 'dh-label');
  const list = el('div', 'v2-list');
  list.id = 'board-list';
  const note = el('p', 'v2-note');
  const show = (t: 'week' | 'catches') => {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    list.replaceChildren();
    if (t === 'week') {
      label.textContent = 'This week’s top housemates';
      note.textContent = 'Resets every Monday at 00:00 UTC.';
      if (!rows) list.append(el('p', 'v2-note', failed ? 'Couldn’t load the board. Check your connection and open it again.' : 'Loading the board…'));
      else if (!rows.length) list.append(el('p', 'v2-note', 'Nobody has earned XP this week yet.'));
      rows?.forEach((r, i) => {
        const sub = `Lv ${r.level.toLocaleString()} · ${r.wins_week} win${r.wins_week === 1 ? '' : 's'} · ${r.best_streak}-day best streak`;
        list.append(boardRow(i, r.user_id, r.display_name, r.character_key ?? r.character_index, r.level, sub, formatXp(r.xp_week), r.xp_week > 0, me));
      });
    } else {
      label.textContent = 'Today’s catches';
      note.textContent = 'Critters turn up around the house every few minutes: walk into one to catch it. Resets at 00:00 UTC.';
      if (!catches) list.append(el('p', 'v2-note', failed ? 'Couldn’t load today’s catches. Try again in a moment.' : 'Loading today’s catches…'));
      else if (!catches.length) list.append(el('p', 'v2-note', 'Nothing caught yet today. Keep an eye out!'));
      catches?.forEach((r, i) => {
        const row = boardRow(i, r.user_id, r.display_name, r.character_key ?? r.character_index, r.level, `${r.caught} caught`, `+${formatXp(r.xp)}`, true, me);
        // What they caught: a little row of critters (the latest 8).
        const pets = el('span', 'v2-pets');
        r.critters.slice(-8).forEach((c) => {
          const ic = critterIcon(c, 16);
          ic.title = critterById(c)?.name ?? c;
          pets.append(ic);
        });
        row.querySelector('.s')?.append(' ', pets);
        list.append(row);
      });
    }
  };
  for (const [t, ic, text] of [['week', 'trophy', 'This week'], ['catches', 'paw-print', 'Today’s catches']] as const) {
    const b = el('button');
    b.type = 'button';
    b.dataset.tab = t;
    b.id = `board-tab-${t}`;
    b.setAttribute('role', 'tab');
    b.append(icon(ic), text);
    b.addEventListener('click', () => show(t));
    tabs.append(b);
  }
  const go = el('button', 'dh-btn');
  go.type = 'button';
  go.id = 'board-challenges';
  go.append(icon('trophy'), 'See your challenges');
  go.addEventListener('click', () => {
    close();
    seeChallenges();
  });
  panel.append(tabs, label, list, note, go);
  show(tab);
}

function boardRow(i: number, id: string, name: string, character: Skin | number, level: number, sub: string, chip: string, top: boolean, me: string) {
  const row = el('div', 'v2-board-row' + (id === me ? ' me' : ''));
  row.dataset.player = id;
  const who = el('b');
  who.append(medalEl(rankMedal(rankOf(level)), 16), document.createTextNode(` ${name}${id === me ? ' (you)' : ''}`));
  const mid = el('span');
  mid.style.cssText = 'display:grid;gap:2px;min-width:0';
  mid.append(who, el('span', 's', sub));
  row.append(el('span', 'rk' + (i < 3 && top ? ' top' : ''), String(i + 1)), portrait(character, 32), mid, el('span', 'v2-xpchip', chip));
  return row;
}
