import { blockedList, onSocial, setBlock } from '../net/social';
import { icon } from './icons';
import { el } from './modal';
import { addSettingsSection, sectionLabel } from './settings';
import { toast } from './toasts';

// Settings → More → Blocked people: who you've blocked, with Unblock (src/net/social.ts).
let added = false;
export function addBlockedSettings(unblocked: (id: string) => void) {
  if (added) return;
  added = true;
  addSettingsSection(
    85,
    (box) => {
      const list = el('div', 'v2-list');
      list.id = 'blocked-list';
      const draw = () => {
        const people = blockedList();
        list.replaceChildren();
        if (!people.length) {
          list.append(el('p', 'v2-note', 'Nobody. To block someone, tap them in the house and choose Block.'));
          return;
        }
        for (const p of people) {
          const row = el('div', 'v2-item');
          row.dataset.blocked = p.id;
          const name = el('span', 't', p.name);
          name.style.flex = '1';
          const undo = el('button', 'dh-btn dh-btn--quiet');
          undo.type = 'button';
          undo.append(icon('rotate-ccw', { width: 18 }), document.createTextNode('Unblock'));
          undo.addEventListener('click', () => {
            undo.disabled = true;
            setBlock(p.id, p.name, false).then(
              () => {
                unblocked(p.id);
                toast({ icon: 'check', who: `${p.name} is unblocked`, what: 'You’ll hear them and see their chat again.', small: true, ttl: 3000 });
              },
              (e) => {
                undo.disabled = false;
                toast({ icon: 'info', who: 'Not changed', what: (e as Error).message, small: true, ttl: 3000 });
              },
            );
          });
          row.append(icon('volume-x', { width: 18 }), name, undo);
          list.append(row);
        }
      };
      draw();
      onSocial(draw);
      box.append(sectionLabel('Blocked people', 'blocked-list'), list);
    },
    true,
    'more',
  );
}
