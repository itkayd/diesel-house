import { overlay } from './overlay';
import { el } from './modal';

// A room's name across the middle of the screen for a moment as you walk in ("Lounge · 2 here, voice
// on"), like a level title. It never takes taps, and goes by itself.
let timer: ReturnType<typeof setTimeout> | null = null;

export function roomBanner(name: string, sub: string) {
  document.getElementById('room-banner')?.remove();
  if (timer) clearTimeout(timer);
  const b = el('div', 'dh-room-banner');
  b.id = 'room-banner';
  b.setAttribute('role', 'status');
  b.append(el('b', '', name), el('span', '', sub));
  overlay().append(b);
  timer = setTimeout(() => b.remove(), 2600);
}
