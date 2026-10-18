import { myGuestCode, newGuestCode, setGuestCode, type GuestCode } from '../net/guestCodes';
import { currentUser } from '../net/profile';
import { myVisit } from '../net/visit';
import { cleanName, DOMAIN, NAME_MAX } from '../shared/members';
import { icon, type IconName } from './icons';
import { el, openModal } from './modal';
import { portrait } from './portrait';
import { toast } from './toasts';
import { ACHIEVEMENTS, RANK_MEDALS, type Medal } from '../challenges/pool';
import { formatXp, legendStars, progress as levelProgress, rankOf, xpFor } from '../challenges/levels';
import type { Progress } from '../net/progress';
import { levelChip, medalEl } from './progressUi';

// Profile (design/game/v2.html `showProfile`): opened from the HUD button or by tapping your own name tag.
// Members: portrait (tap to change character), editable display name, level / rank / streak / XP
// (Phase 14, LEVELS.md), and tabs About · Guest code · Badges (rank medals and achievement medals).
// Guests: a smaller card with whose guest they are and how long their visit lasts (no XP).

export type ProfileContext = {
  name: string;
  character: number;
  host: string | null; // guests: the member who invited you (if known already)
  changeCharacter: () => void;
  rename: (name: string) => Promise<void> | void;
  progress: Progress | null; // null while it's loading (or offline)
  gamesWon: () => Promise<number | null>;
};

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'unknown');
const time = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'just now');

// The name you sign in with (your account login is made from it; see src/shared/members.ts).
function loginName(email: string) {
  const hex = email.endsWith(`@${DOMAIN}`) ? email.slice(2, -(DOMAIN.length + 1)) : '';
  try {
    return new TextDecoder().decode(new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16))));
  } catch {
    return null;
  }
}

function head(title: string, close: () => void) {
  const h = el('div', 'v2-head');
  const t = el('h2', '', title);
  t.id = 'profile-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'profile-close';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', close);
  h.append(t, x);
  return h;
}

function fact(ic: IconName, ...parts: (string | Node)[]) {
  const d = el('div');
  const s = el('span');
  s.append(...parts);
  d.append(icon(ic), s);
  return d;
}
const bold = (t: string) => el('b', '', t);

function face(character: number, onTap: () => void) {
  const b = el('button', 'big');
  b.type = 'button';
  b.id = 'profile-face';
  b.setAttribute('aria-label', 'Change character');
  const pen = el('span', 'pen');
  pen.append(icon('pencil'));
  b.append(portrait(character, 72), pen);
  b.addEventListener('click', onTap);
  return b;
}

export function openProfile(ctx: ProfileContext) {
  const user = currentUser();
  if (!user) return;
  if (user.guest) return void openGuestProfile(ctx);
  const { panel, close } = openModal('profile', { dismissable: true, label: 'profile-title' });

  // Who you are: portrait, name, level / streak.
  const me = el('div', 'v2-me');
  const right = el('div');
  right.style.cssText = 'display:grid;gap:8px;min-width:0';
  const nm = el('div', 'nm');
  const input = el('input', 'dh-input');
  input.id = 'profile-name';
  input.maxLength = NAME_MAX;
  input.value = ctx.name;
  input.setAttribute('aria-label', 'Display name');
  input.setAttribute('autocomplete', 'nickname');
  input.addEventListener('change', async () => {
    const n = cleanName(input.value).slice(0, NAME_MAX);
    if (!n || n === ctx.name) return void (input.value = ctx.name);
    await ctx.rename(n);
    ctx.name = n;
    toast({ icon: 'check', id: 'name-saved', who: 'Name saved', what: `Friends now see "${n}".`, small: true, ttl: 1800 });
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  nm.append(input);
  const chips = el('div');
  chips.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const p = ctx.progress;
  const pr = levelProgress(p?.xp ?? 0);
  const rank = rankOf(pr.level);
  const stars = legendStars(pr.level);
  chips.id = 'profile-chips';
  chips.append(levelChip(pr.level), el('span', 'v2-chip', rank.title + (stars ? ` ${stars}` : '')), el('span', 'v2-chip', `${p?.streak ?? 0}-day streak`));
  chips.lastElementChild!.setAttribute('style', 'background:#ffae6b');
  right.append(nm, chips);
  me.append(face(ctx.character, () => (close(), ctx.changeCharacter())), right);

  // XP within this level (the bar never stalls at high levels).
  const xp = el('div');
  xp.style.cssText = 'display:grid;gap:6px';
  const meta = el('div', 'v2-meta');
  meta.id = 'profile-xp';
  meta.append(
    el('span', '', p ? `${pr.intoLevel.toLocaleString()} / ${pr.levelSize.toLocaleString()} XP to level ${(pr.level + 1).toLocaleString()}` : 'Loading your XP…'),
    el('span', '', p ? `${formatXp(p.xp)} in all` : ''),
  );
  const bar = el('div', 'v2-bar');
  bar.style.height = '12px';
  const fill = el('b');
  fill.style.width = `${pr.pct}%`;
  bar.append(fill);
  xp.append(meta, bar);

  // Tabs.
  const tabs = el('div', 'v2-tabs');
  tabs.setAttribute('role', 'tablist');
  const body = el('div');
  body.id = 'profile-body';
  body.style.cssText = 'display:grid;gap:12px';
  const TABS: [string, IconName, string, () => void | Promise<void>][] = [
    ['about', 'id-card', 'About', () => about(body, ctx)],
    ['code', 'ticket', 'Guest code', () => guestCode(body, user.id)],
    ['badges', 'award', 'Badges', () => badges(body, ctx.progress)],
  ];
  const buttons = TABS.map(([id, ic, label, render]) => {
    const b = el('button');
    b.type = 'button';
    b.id = `profile-tab-${id}`;
    b.setAttribute('role', 'tab');
    b.append(icon(ic), label);
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      body.replaceChildren();
      void render();
    });
    return b;
  });
  tabs.append(...buttons);
  panel.append(head('Profile', close), me, xp, tabs, body);
  buttons[0].click();
}

function about(body: HTMLElement, ctx: ProfileContext) {
  const user = currentUser()!;
  const facts = el('div', 'v2-facts');
  facts.append(
    fact('calendar', 'Joined with an invite from Diesel on ', bold(day(user.joinedAt))),
    fact('clock', 'Signed in ', bold(time(user.signedInAt))),
    fact('award', bold(String(ACHIEVEMENTS.filter((m) => earned(ctx.progress, m)).length)), ` of ${ACHIEVEMENTS.length} badges`),
  );
  const login = loginName(user.email);
  if (login && login !== ctx.name.toLowerCase()) facts.append(fact('info', 'You sign in as ', bold(login)));
  const stats = el('div', 'v2-stats');
  stats.id = 'profile-stats';
  const p = ctx.progress;
  const won = el('b', '', '…');
  for (const [n, label] of [[levelProgress(p?.xp ?? 0).level.toLocaleString(), 'Level'], [String(p?.streak ?? 0), `Day streak · best ${p?.best_streak ?? 0}`], [won, 'Games won']] as const) {
    const s = el('div', 'v2-stat');
    s.append(typeof n === 'string' ? el('b', '', n) : n, el('span', '', label));
    stats.append(s);
  }
  body.append(facts, stats);
  void ctx.gamesWon().then((n) => (won.textContent = n === null ? '–' : n.toLocaleString()));
}

const earned = (p: Progress | null, m: Medal) => !!p?.medals.some((x) => x.id === m.id);

async function guestCode(body: HTMLElement, me: string) {
  const status = el('p', 'v2-note');
  let gc: GuestCode | null = await myGuestCode(me);
  const render = () => {
    body.replaceChildren();
    if (!gc) {
      const make = el('button', 'dh-btn');
      make.type = 'button';
      make.id = 'profile-make-code';
      make.append(icon('ticket'), 'Make my guest code');
      make.addEventListener('click', async () => {
        const r = await newGuestCode(me, false);
        if (typeof r === 'string') status.textContent = r;
        else {
          gc = r;
          render();
        }
      });
      body.append(el('p', 'v2-note', 'Friends you share this with can visit as guests for 12 hours.'), make, status);
      return;
    }
    const box = el('div', 'v2-codebox' + (gc.enabled ? '' : ' off'));
    const row = el('div', 'dh-row');
    row.style.minHeight = '0';
    const sw = el('input', 'dh-switch');
    sw.type = 'checkbox';
    sw.id = 'profile-code-on';
    sw.checked = gc.enabled;
    sw.setAttribute('aria-label', 'Guests can use my code');
    sw.addEventListener('change', async () => {
      const err = await setGuestCode(me, { enabled: sw.checked });
      if (err) {
        sw.checked = !sw.checked;
        status.textContent = `Couldn't save: ${err}`;
      } else {
        gc = { ...gc!, enabled: sw.checked };
        box.classList.toggle('off', !sw.checked);
      }
    });
    row.append(el('span', 'dh-label', 'Your guest code'), sw);
    const code = el('div', 'v2-code dh-selectable', gc.code);
    code.id = 'profile-code';
    const btns = el('div', 'btns');
    const copyBtn = el('button', 'dh-btn');
    copyBtn.type = 'button';
    copyBtn.id = 'profile-copy';
    copyBtn.append(icon('copy'), 'Copy');
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(gc!.code);
        toast({ icon: 'copy', id: 'code-copied', who: 'Copied', what: `${gc!.code} is on your clipboard.`, small: true, ttl: 1600 });
      } catch {
        status.textContent = `Copy didn't work here: your code is ${gc!.code}`;
      }
    };
    copyBtn.addEventListener('click', () => void copy());
    const share = el('button', 'dh-btn dh-btn--quiet');
    share.type = 'button';
    share.id = 'profile-share';
    share.append(icon('share-2'), 'Share');
    share.addEventListener('click', async () => {
      const text = `Come and hang out at Diesel House: open ${location.origin}, tap "Come in as a guest" and use my code ${gc!.code}.`;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Diesel House', text });
          return;
        } catch (e) {
          if ((e as DOMException).name === 'AbortError') return; // closed the share sheet
        }
      }
      await copy();
    });
    btns.append(copyBtn, share);
    box.append(row, code, btns);
    const fresh = el('button', 'dh-btn dh-btn--quiet');
    fresh.type = 'button';
    fresh.id = 'profile-new-code';
    fresh.append(icon('refresh-cw'), 'Make a new code');
    fresh.addEventListener('click', async () => {
      const r = await newGuestCode(me, true);
      if (typeof r === 'string') status.textContent = r;
      else {
        gc = r;
        render();
        toast({ icon: 'refresh-cw', id: 'code-new', who: 'New code made', what: 'The old one stops working straight away.', small: true, ttl: 2000 });
      }
    });
    body.append(box, el('p', 'v2-note', 'Friends you share this with can visit as guests for 12 hours. Turn it off to stop new guests.'), fresh, status);
  };
  render();
}

function badges(body: HTMLElement, p: Progress | null) {
  const info = el('div', 'v2-badgeinfo', 'Tap a medal to see how to earn it.');
  info.id = 'badge-info';
  const level = levelProgress(p?.xp ?? 0).level;
  const button = (m: Medal, grid: HTMLElement) => {
    const has = earned(p, m);
    const btn = el('button', 'v2-badge' + (has ? '' : ' locked'));
    btn.type = 'button';
    btn.dataset.badge = m.id;
    btn.append(medalEl(m), el('span', '', m.name));
    btn.addEventListener('click', () => {
      body.querySelectorAll('.v2-badge').forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
      const at = p?.medals.find((x) => x.id === m.id)?.at;
      const how = has ? `Earned ${at ? new Date(at).toLocaleDateString() : ''}. ${m.how}` : `Locked. ${m.how}`;
      const togo = !has && m.rank ? ` ${(Math.max(0, xpFor(m.rank) - (p?.xp ?? 0))).toLocaleString()} XP to go.` : '';
      info.replaceChildren(bold(m.name), ` · ${how}${m.xp ? ` (+${m.xp} XP)` : ''}${togo}`);
    });
    grid.append(btn);
  };
  // Rank: every rank medal, earned ones in colour; the Legend medal gets its stars.
  const ranks = el('div', 'v2-rankrow');
  ranks.id = 'profile-ranks';
  RANK_MEDALS.forEach((m) => button(m, ranks));
  const stars = legendStars(level);
  if (stars) ranks.lastElementChild?.querySelector('span:last-child')?.append(` ${stars}`);
  // The next rank to earn, on its own line (it didn't fit inside the little tile on a phone).
  const next = RANK_MEDALS.find((r) => !earned(p, r) && r.rank !== undefined);
  const nextEl = el('p', 'v2-note');
  nextEl.id = 'profile-next-rank';
  if (next) {
    nextEl.append('Next: ', bold(next.name), ` at Lv ${next.rank} · ${Math.max(0, xpFor(next.rank!) - (p?.xp ?? 0)).toLocaleString()} XP to go`);
    ranks.querySelector(`[data-badge="${next.id}"]`)?.classList.add('next');
  }
  const grid = el('div', 'v2-badges');
  ACHIEVEMENTS.forEach((m) => button(m, grid));
  body.append(el('div', 'dh-label', 'Rank'), ranks, ...(next && p ? [nextEl] : []), el('div', 'dh-label', 'Badges'), grid, info);
  if (!p) body.append(el('p', 'v2-note', 'Couldn’t load your medals just now.'));
}

async function openGuestProfile(ctx: ProfileContext) {
  const { panel, close } = openModal('profile', { dismissable: true, label: 'profile-title' });
  const me = el('div', 'v2-me');
  const right = el('div');
  right.style.cssText = 'display:grid;gap:6px';
  const name = el('b', '', ctx.name);
  name.style.cssText = 'font-family:var(--font-display);font-size:20px';
  const chip = el('span', 'v2-chip radio', ctx.host ? `Guest of ${ctx.host}` : 'Guest');
  chip.id = 'profile-guest-of';
  chip.style.justifySelf = 'start';
  right.append(name, chip);
  me.append(portrait(ctx.character, 72), right);
  const left = el('b', '', '…');
  left.id = 'profile-time-left';
  const facts = el('div', 'v2-facts');
  facts.append(fact('timer', 'Your visit ends in ', left), fact('info', 'Guests can talk, chat and play. Ask a friend in the house for an invite to get your own room.'));
  const change = el('button', 'dh-btn dh-btn--quiet');
  change.type = 'button';
  change.id = 'profile-change-character';
  change.append(icon('user-round'), 'Change character');
  change.addEventListener('click', () => (close(), ctx.changeCharacter()));
  panel.append(head('Profile', close), me, facts, change);
  const visit = await myVisit();
  if (visit?.host) chip.textContent = `Guest of ${visit.host}`;
  const mins = visit ? Math.max(0, Math.round((visit.expiresAt.getTime() - Date.now()) / 60000)) : null;
  left.textContent = mins === null ? 'unknown' : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}
