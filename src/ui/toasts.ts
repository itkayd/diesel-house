import { icon, type IconName } from './icons';
import { el } from './modal';
import { hudToasts } from './overlay';
import { portrait } from './portrait';

type Action = { label: string; quiet?: boolean; onClick?: () => void; id?: string };
type Toast = { icon?: IconName; face?: number; who: string; what?: string; actions?: Action[]; small?: boolean; ttl?: number; id?: string };

// Top-centre notices (design/game/mvp.html `toast`): "Sami's room · Voice connected", knocks with
// Let in / Not now, "Room is locked". Returns a function that removes it.
export function toast(t: Toast) {
  const box = el('div', 'dh-toast' + (t.small ? ' dh-toast--small' : ''));
  if (t.id) box.id = t.id;
  box.setAttribute('role', 'status');
  const lead =
    t.face !== undefined
      ? portrait(t.face, 48, 'dh-portrait dh-portrait--lg')
      : icon(t.icon ?? 'door-open', { width: 24, height: 24, style: 'color:var(--lamp)' });
  const text = el('div');
  text.append(el('div', 'who', t.who));
  if (t.what) text.append(el('div', 'what', t.what));
  box.append(lead, text);
  const remove = () => box.remove();
  if (t.actions?.length) {
    const a = el('div', 'actions');
    for (const act of t.actions) {
      const b = el('button', 'dh-btn' + (act.quiet ? ' dh-btn--quiet' : ''), act.label);
      b.type = 'button';
      if (act.id) b.id = act.id;
      b.addEventListener('click', () => {
        remove();
        act.onClick?.();
      });
      a.append(b);
    }
    box.append(a);
  }
  hudToasts().append(box);
  const ttl = t.ttl ?? 4500;
  if (ttl) setTimeout(remove, ttl);
  return remove;
}
