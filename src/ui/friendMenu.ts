import type { Skin } from '../characters';
import { emoteGrid, type EmoteId } from './emotes';
import { icon } from './icons';
import { el } from './modal';
import { overlay } from './overlay';
import { portrait } from './portrait';
import { toast } from './toasts';
import type { ReportReason } from '../net/social';

let pop: HTMLDivElement | null = null;

export type FriendMenu = {
  name: string;
  character: Skin;
  // Set when we're in a voice call with them: their volume slider.
  volume?: { value: number; onChange: (v: number) => void };
  // Otherwise a line on where they are ("In Diesel's room. Walk in to hear them.").
  where?: string;
  onEmote: (id: EmoteId) => void;
  profile?: () => void; // open their profile (src/ui/playerProfile.ts)
  // Rock-paper-scissors (UPDATE.md Phase 12). Without it the button says why not.
  duel?: () => void;
  duelOff?: string;
  // U4: friends, block, report. `friend` null: not possible here (guests can't have friends).
  social?: {
    friend: 'none' | 'friends' | 'incoming' | 'outgoing' | null;
    onFriend: () => Promise<string>; // ask / say yes; returns what to say
    onBlock: () => Promise<void>;
    onReport: (reason: ReportReason, details: string) => Promise<void>;
  };
};

const REASONS: [ReportReason, string][] = [
  ['harassment', 'Bullying or harassment'],
  ['hate', 'Hate or threats'],
  ['spam', 'Spamming'],
  ['cheating', 'Cheating'],
  ['other', 'Something else'],
];

// Tap a friend (or press Q next to them), UPDATE.md Phase 11 / design/game/v2.html `friendMenu`:
// face and name, their volume (in a call) or where they are, emotes, Duel (rock paper scissors).
// Tap anywhere else to close.
export function showFriendMenu(m: FriendMenu) {
  closeFriendMenu();
  // A card opened while this was on its way (it waits for the friend status): don't pop up over it.
  if (document.querySelector('.dh-scrim')) return;
  pop = el('div', 'dh-panel vol-pop');
  pop.id = 'friend-menu';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', m.name);
  const head = el('div', 'dh-row');
  head.style.minHeight = '0';
  const who = el('div');
  who.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:0';
  const b = el('b', '', m.name);
  b.style.cssText = 'font-family:var(--font-display);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  who.append(portrait(m.character, 32), b);
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.style.cssText = 'width:44px;height:44px';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', closeFriendMenu);
  head.append(who, x);
  pop.append(head);
  if (m.profile) {
    const go = m.profile;
    const pb = el('button', 'dh-btn dh-btn--quiet');
    pb.type = 'button';
    pb.id = 'friend-profile';
    pb.append(icon('user-round', { width: 18 }), document.createTextNode('Profile · Message'));
    pb.addEventListener('click', () => {
      closeFriendMenu();
      go();
    });
    pop.append(pb);
  }
  if (m.volume) {
    const row = el('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center';
    const slider = el('input', 'dh-range');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(m.volume.value * 100));
    slider.id = 'volume-slider';
    slider.setAttribute('aria-label', `${m.name}'s volume`);
    const change = m.volume.onChange;
    slider.addEventListener('input', () => change(Number(slider.value) / 100));
    row.append(icon('volume-1', { width: 18 }), slider, icon('volume-2', { width: 18 }));
    pop.append(row);
  } else if (m.where) {
    const p = el('p', 'v2-note', m.where);
    p.id = 'friend-where';
    p.style.margin = '0';
    pop.append(p);
  }
  pop.append(
    el('div', 'dh-label', 'Send an emote'),
    emoteGrid((id) => {
      closeFriendMenu();
      m.onEmote(id);
    }),
  );
  const acts = el('div', 'acts');
  const duel = el('button', 'dh-btn dh-btn--quiet');
  duel.type = 'button';
  duel.id = 'friend-duel';
  const startDuel = m.duel;
  duel.disabled = !startDuel;
  duel.title = startDuel ? 'Rock paper scissors, best of three' : (m.duelOff ?? '');
  duel.append(icon('swords', { width: 18 }), document.createTextNode('Duel'));
  if (startDuel)
    duel.addEventListener('click', () => {
      closeFriendMenu();
      startDuel();
    });
  acts.append(duel);
  const soc = m.social;
  if (soc?.friend !== null && soc?.friend !== undefined) {
    const f = el('button', 'dh-btn dh-btn--quiet');
    f.type = 'button';
    f.id = 'friend-add';
    const label = { none: 'Add friend', friends: 'Friends', incoming: 'Accept friend', outgoing: 'Request sent' }[soc.friend];
    f.append(icon(soc.friend === 'friends' ? 'check' : 'user-round', { width: 18 }), document.createTextNode(label));
    f.disabled = soc.friend === 'friends' || soc.friend === 'outgoing';
    f.addEventListener('click', () => {
      f.disabled = true;
      soc.onFriend().then(
        (said) => {
          closeFriendMenu();
          toast({ icon: 'users', who: m.name, what: said, small: true, ttl: 3000 });
        },
        (e) => {
          f.disabled = false;
          toast({ icon: 'info', who: 'Not sent', what: (e as Error).message, small: true, ttl: 3500 });
        },
      );
    });
    acts.append(f);
  }
  pop.append(acts);
  if (soc) {
    const safety = el('div', 'acts dh-friend-safety');
    const block = el('button', 'dh-btn dh-btn--quiet');
    block.type = 'button';
    block.id = 'friend-block';
    block.append(icon('volume-x', { width: 18 }), document.createTextNode('Block'));
    block.addEventListener('click', () => confirmBlock(m.name, soc.onBlock));
    const report = el('button', 'dh-btn dh-btn--quiet');
    report.type = 'button';
    report.id = 'friend-report';
    report.append(icon('info', { width: 18 }), document.createTextNode('Report'));
    report.addEventListener('click', () => reportForm(m.name, soc.onReport));
    safety.append(block, report);
    pop.append(safety);
  }
  // Why Duel is greyed out, said where a phone user can see it (a title only shows on hover).
  if (!startDuel && m.duelOff) {
    const why = el('p', 'v2-note', m.duelOff);
    why.style.margin = '0';
    pop.append(why);
  }
  overlay().appendChild(pop);
  // Close on the next tap outside the card (after this tap has finished).
  setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);
}

// "Block Sam?" in place of the menu: what it does, then Block or Cancel.
function confirmBlock(name: string, go: () => Promise<void>) {
  if (!pop) return;
  const box = el('div', 'dh-friend-step');
  box.id = 'block-confirm';
  const yes = el('button', 'dh-btn');
  yes.type = 'button';
  yes.id = 'block-yes';
  yes.append(icon('volume-x', { width: 18 }), document.createTextNode(`Block ${name}`));
  const no = el('button', 'dh-btn dh-btn--quiet', 'Cancel');
  no.type = 'button';
  no.addEventListener('click', closeFriendMenu);
  yes.addEventListener('click', () => {
    yes.disabled = true;
    go().then(
      () => {
        closeFriendMenu();
        toast({ icon: 'volume-x', who: `${name} is blocked`, what: 'You won’t hear them or see their chat. Settings → More → Blocked people to undo.', ttl: 4500 });
      },
      (e) => {
        yes.disabled = false;
        toast({ icon: 'info', who: 'Not blocked', what: (e as Error).message, small: true, ttl: 3500 });
      },
    );
  });
  box.append(
    el('b', '', `Block ${name}?`),
    el('p', 'v2-note', 'You won’t hear them, see their chat, or get their emotes, duels and game invites. They aren’t told. You can undo it any time.'),
    yes,
    no,
  );
  swap(box);
  yes.focus();
}

// "Report Sam": why (one tap), a few words, Send. Goes to Diesel with where you are and their last lines.
function reportForm(name: string, send: (reason: ReportReason, details: string) => Promise<void>) {
  if (!pop) return;
  const box = el('div', 'dh-friend-step');
  box.id = 'report-form';
  let reason: ReportReason | null = null;
  const chips = el('div', 'dh-chips');
  const go = el('button', 'dh-btn');
  go.type = 'button';
  go.id = 'report-send-player';
  go.disabled = true;
  go.append(icon('send', { width: 18 }), document.createTextNode('Send to Diesel'));
  for (const [id, label] of REASONS) {
    const c = el('button', 'dh-chip', label);
    c.type = 'button';
    c.dataset.reason = id;
    c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', () => {
      reason = id;
      for (const x of chips.children) x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.reason === id));
      go.disabled = false;
    });
    chips.append(c);
  }
  const text = el('textarea', 'dh-input dh-report-text');
  text.id = 'report-details';
  text.rows = 3;
  text.maxLength = 1000;
  text.placeholder = 'What happened? (optional)';
  const cancel = el('button', 'dh-btn dh-btn--quiet', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeFriendMenu);
  go.addEventListener('click', () => {
    if (!reason) return;
    go.disabled = true;
    send(reason, text.value.trim()).then(
      () => {
        closeFriendMenu();
        toast({ icon: 'check', who: 'Report sent', what: `Thanks. Diesel will look at it. You can also block ${name}.`, ttl: 4000 });
      },
      (e) => {
        go.disabled = false;
        toast({ icon: 'info', who: 'Not sent', what: (e as Error).message, small: true, ttl: 3500 });
      },
    );
  });
  box.append(el('b', '', `Report ${name}`), el('p', 'v2-note', 'What’s wrong? It goes to Diesel with where you are and their last chat lines. They aren’t told.'), chips, text, go, cancel);
  swap(box);
}

// Replace the menu's contents (keeps the header with ✕).
function swap(box: HTMLElement) {
  if (!pop) return;
  const head = pop.firstElementChild;
  pop.replaceChildren(...(head ? [head] : []), box);
}

function outside(e: PointerEvent) {
  if (pop && !pop.contains(e.target as Node)) closeFriendMenu();
}

export function closeFriendMenu() {
  window.removeEventListener('pointerdown', outside, true);
  pop?.remove();
  pop = null;
}

export const friendMenuOpen = () => !!pop;
addEventListener('dh-modal-open', closeFriendMenu);
