import { overlay } from './overlay';
import { play } from './sounds';
import { crumb } from '../net/errors';

// A pixel card over a dimmed scrim (design/game/mvp.html `modal()`): picker, settings, mic card, credits.
// On phones the theme turns it into a bottom sheet. Tapping the scrim closes it if `dismissable`, and so
// does Escape. Focus moves into the card when it opens (and stays inside it with Tab), and goes back
// where it was when it closes.
type Opened = { scrim: HTMLDivElement; close: () => void; dismiss: (() => void) | null; back: Element | null };
const stack: Opened[] = [];

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openModal(id: string, opts: { dismissable?: boolean; onDismiss?: () => void; label?: string; quiet?: boolean } = {}) {
  document.getElementById(id)?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'dh-scrim';
  scrim.id = id;
  const panel = document.createElement('div');
  panel.className = 'dh-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;
  if (opts.label) panel.setAttribute('aria-labelledby', opts.label);
  scrim.append(panel);
  const entry: Opened = {
    scrim,
    back: document.activeElement,
    dismiss: opts.dismissable ? () => opts.onDismiss?.() : null,
    close: () => {
      if (!scrim.isConnected) return;
      scrim.remove();
      crumb('closed', id);
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (entry.back instanceof HTMLElement && entry.back.isConnected) entry.back.focus({ preventScroll: true });
    },
  };
  if (opts.dismissable)
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim) {
        entry.close();
        opts.onDismiss?.();
      }
    });
  overlay().append(scrim);
  stack.push(entry);
  crumb('opened', id);
  if (!opts.quiet) play('click', 0.3);
  // Into the card once it has its contents (they're added straight after this returns).
  queueMicrotask(() => {
    if (!scrim.isConnected || panel.contains(document.activeElement)) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus({ preventScroll: true });
  });
  return { scrim, panel, close: entry.close };
}

// Escape closes the top card (if it can be dismissed); Tab stays inside it.
addEventListener('keydown', (e) => {
  const top = stack.filter((o) => o.scrim.isConnected).at(-1);
  if (!top) return;
  if (e.key === 'Escape' && top.dismiss) {
    e.preventDefault();
    e.stopPropagation();
    top.close();
    top.dismiss();
  } else if (e.key === 'Tab') {
    const items = [...top.scrim.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!top.scrim.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
  }
});

// A card is open (walking stops).
export const modalOpen = () => !!document.querySelector('#overlay .dh-scrim');
// A card, the friend menu or the emote bar is open: the game's shortcut keys (E, Q, 1-6, T, Space) wait.
export const keysBlocked = () => !!document.querySelector('#overlay .dh-scrim, #overlay .vol-pop, #overlay .v2-emotebar:not([hidden])');

// Typing in a text box (or a key with Ctrl / Cmd / Alt held): not a game key.
export const notGameKey = (e: KeyboardEvent) =>
  e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && !!e.target.closest('input, textarea, select, [contenteditable]'));

// Little builders used by several screens.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
