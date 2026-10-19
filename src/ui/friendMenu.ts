import type { Skin } from '../characters';
import { emoteGrid, type EmoteId } from './emotes';
import { icon } from './icons';
import { el } from './modal';
import { overlay } from './overlay';
import { portrait } from './portrait';

let pop: HTMLDivElement | null = null;

export type FriendMenu = {
  name: string;
  character: Skin;
  // Set when we're in a voice call with them: their volume slider.
  volume?: { value: number; onChange: (v: number) => void };
  // Otherwise a line on where they are ("In Diesel's room. Walk in to hear them.").
  where?: string;
  onEmote: (id: EmoteId) => void;
  // Rock-paper-scissors (UPDATE.md Phase 12). Without it the button says why not.
  duel?: () => void;
  duelOff?: string;
};

// Tap a friend (or press Q next to them), UPDATE.md Phase 11 / design/game/v2.html `friendMenu`:
// face and name, their volume (in a call) or where they are, emotes, Duel (rock paper scissors).
// Tap anywhere else to close.
export function showFriendMenu(m: FriendMenu) {
  closeFriendMenu();
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
  pop.append(acts);
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

function outside(e: PointerEvent) {
  if (pop && !pop.contains(e.target as Node)) closeFriendMenu();
}

export function closeFriendMenu() {
  window.removeEventListener('pointerdown', outside, true);
  pop?.remove();
  pop = null;
}

export const friendMenuOpen = () => !!pop;
