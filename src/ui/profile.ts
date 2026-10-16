import { myGuestCode, newGuestCode, setGuestCode, type GuestCode } from '../net/guestCodes';
import { currentUser } from '../net/profile';
import { myVisit } from '../net/visit';
import { cleanName, DOMAIN, NAME_MAX } from '../shared/members';
import { icon, type IconName } from './icons';
import { el, openModal } from './modal';
import { portrait } from './portrait';
import { toast } from './toasts';

// Profile (design/game/v2.html `showProfile`): opened from the HUD button or by tapping your own name tag.
// Members: portrait (tap to change character), editable display name, level / streak / XP (placeholders
// until challenges arrive in Phase 14), and tabs About · Guest code · Badges. Guests: a smaller card with
// whose guest they are and how long their visit lasts.

// Badges (order matches public/assets/ui/medals.png, 12 × 48 px). All locked until Phase 14.
export const BADGES = [
  { id: 'first_knock', name: 'First knock', how: "Knock on a friend's door." },
  { id: 'night_owl', name: 'Night owl', how: 'Be in the house after midnight.' },
  { id: 'high_roller', name: 'High roller', how: 'Roll a double six at the games table.' },
  { id: 'duelist', name: 'Duelist', how: 'Win 3 rock-paper-scissors duels.' },
  { id: 'fast_hand', name: 'Fastest hand', how: 'Win a round of Quick Draw.' },
  { id: 'over_out', name: 'Over and out', how: 'Use the walkie 3 times.' },
  { id: 'steady', name: 'Slow & steady', how: 'Keep a 7-day streak.' },
  { id: 'host', name: 'Party host', how: 'Have 4 people in your room at once.' },
  { id: 'lvl5', name: 'Level 5', how: 'Reach level 5.' },
  { id: 'legend', name: 'House legend', how: 'Reach level 10.' },
  { id: 'decor', name: 'Home maker', how: 'Name your room.' },
  { id: 'social', name: 'Social butterfly', how: 'Send emotes to 3 different friends.' },
];

export type ProfileContext = {
  name: string;
  character: number;
  ownedRoom: string | null; // label of the room you own
  host: string | null; // guests: the member who invited you (if known already)
  changeCharacter: () => void;
  rename: (name: string) => Promise<void> | void;
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
  chips.append(el('span', 'v2-chip gold', 'Lv 1'), el('span', 'v2-chip', '0-day streak'));
  right.append(nm, chips);
  me.append(face(ctx.character, () => (close(), ctx.changeCharacter())), right);

  // XP bar (placeholder until Phase 14).
  const xp = el('div');
  xp.style.cssText = 'display:grid;gap:6px';
  const meta = el('div', 'v2-meta');
  meta.append(el('span', '', '0 / 100 XP to level 2'), el('span', '', 'Challenges coming soon'));
  const bar = el('div', 'v2-bar');
  bar.style.height = '12px';
  const fill = el('b');
  fill.style.width = '0%';
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
    ['badges', 'award', 'Badges', () => badges(body)],
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
    ctx.ownedRoom ? fact('door-open', 'Owns ', bold(ctx.ownedRoom)) : fact('door-open', 'No room of your own yet'),
    fact('calendar', 'Joined with an invite from Diesel on ', bold(day(user.joinedAt))),
    fact('clock', 'Signed in ', bold(time(user.signedInAt))),
    fact('award', bold('0'), ` of ${BADGES.length} badges`),
  );
  const login = loginName(user.email);
  if (login && login !== ctx.name.toLowerCase()) facts.append(fact('info', 'You sign in as ', bold(login)));
  const stats = el('div', 'v2-stats');
  for (const [n, label] of [['1', 'Level'], ['0', 'Day streak'], ['0', 'Games won']]) {
    const s = el('div', 'v2-stat');
    s.append(el('b', '', n), el('span', '', label));
    stats.append(s);
  }
  body.append(facts, stats);
}

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

function badges(body: HTMLElement) {
  const grid = el('div', 'v2-badges');
  const info = el('div', 'v2-badgeinfo', 'Tap a badge to see how to earn it.');
  info.id = 'badge-info';
  BADGES.forEach((b, i) => {
    const btn = el('button', 'v2-badge locked');
    btn.type = 'button';
    btn.dataset.badge = b.id;
    const medal = el('span', 'v2-medal');
    medal.style.cssText = `background-image:url(assets/ui/medals.png);background-size:576px 48px;background-position:-${i * 48}px 0`;
    btn.append(medal, el('span', '', b.name));
    btn.addEventListener('click', () => {
      grid.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
      info.replaceChildren(bold(b.name), ` · Locked. ${b.how}`);
    });
    grid.append(btn);
  });
  body.append(grid, info, el('p', 'v2-note', 'Badges, XP and streaks start counting when challenges arrive.'));
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
