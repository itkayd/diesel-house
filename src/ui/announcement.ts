import { onHouseSettings } from '../net/houseSettings';
import { icon } from './icons';
import { el } from './modal';
import { hudToasts } from './overlay';

// The admin page's announcement (house_settings.announcement): a banner at the top for everyone in the
// house until it runs out. ✕ hides it on this device (the same message doesn't come back this visit).
const HIDDEN = 'diesel-house.announcement-hidden';
let box: HTMLElement | null = null;
let timer = 0;

export function startAnnouncements() {
  onHouseSettings((s) => show(s.announcement?.text?.trim() ?? '', s.announcement?.until ?? null));
}

function show(text: string, until: string | null) {
  box?.remove();
  box = null;
  clearTimeout(timer);
  const left = until ? new Date(until).getTime() - Date.now() : Infinity;
  if (!text || left <= 0) return;
  try {
    if (sessionStorage.getItem(HIDDEN) === text) return;
  } catch {
    // private browsing: always shown
  }
  box = el('div', 'dh-announce');
  box.id = 'announcement';
  box.setAttribute('role', 'status');
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.setAttribute('aria-label', 'Hide this message');
  x.append(icon('x'));
  x.addEventListener('click', () => {
    try {
      sessionStorage.setItem(HIDDEN, text);
    } catch {
      // nothing kept
    }
    box?.remove();
    box = null;
  });
  box.append(icon('info'), el('span', '', text), x);
  hudToasts().prepend(box);
  if (left < 2 ** 31) timer = window.setTimeout(() => show('', null), left);
}
