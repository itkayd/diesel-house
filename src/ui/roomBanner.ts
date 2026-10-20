import { hudToasts } from './overlay';
import { el } from './modal';

// A room's name at the top of the screen for a moment as you walk in ("Lounge · 2 here, voice on"), like
// a level title. It sits in the notices stack (never on top of one, never mid-floor), never takes taps,
// and goes by itself.
let timer: ReturnType<typeof setTimeout> | null = null;

export function roomBanner(name: string, sub: string) {
  document.getElementById('room-banner')?.remove();
  if (timer) clearTimeout(timer);
  const b = el('div', 'dh-room-banner');
  b.id = 'room-banner';
  b.setAttribute('role', 'status');
  b.append(el('b', '', name), el('span', '', sub));
  hudToasts().prepend(b);
  timer = setTimeout(() => b.remove(), 2600);
}
