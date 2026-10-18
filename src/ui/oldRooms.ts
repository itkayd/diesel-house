import { loadChat } from '../net/chat';
import { el } from './modal';
import { addSettingsSection, sectionLabel } from './settings';

// Settings → Old rooms (REDESIGN.md R3): the 8 personal rooms are gone with the octagon house, but what
// was said in them can still be read, for one release. Members only; nothing can be posted there.

const OLD = Array.from({ length: 8 }, (_, i) => ({ id: `room_0${i + 1}`, name: `Room ${i + 1}` }));

export function addOldRooms() {
  addSettingsSection(
    85,
    (box) => {
      const pick = el('select', 'dh-input');
      pick.id = 'old-room-pick';
      for (const r of OLD) pick.append(new Option(r.name, r.id));
      const read = el('button', 'dh-btn dh-btn--quiet', 'Read');
      read.type = 'button';
      read.id = 'old-room-read';
      const row = el('div', 'dh-row');
      pick.style.flex = '1';
      row.append(pick, read);
      const list = el('div', 'dh-lede');
      list.id = 'old-room-chat';
      list.style.cssText = 'max-height:220px;overflow:auto;display:grid;gap:4px;font-size:14px';
      read.addEventListener('click', async () => {
        read.disabled = true;
        list.textContent = 'Loading…';
        const { messages } = await loadChat(pick.value);
        read.disabled = false;
        list.textContent = '';
        if (!messages.length) return void (list.textContent = 'Nothing was said in this room.');
        for (const m of messages) {
          const when = new Date(m.created_at);
          const line = el('div');
          const who = el('b', '', m.author_name);
          line.append(who, document.createTextNode(` · ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}: ${m.text}`));
          list.append(line);
        }
        list.scrollTop = list.scrollHeight;
      });
      box.append(sectionLabel('Old rooms (read only)', 'old-room-pick'), el('small', 'dh-lede', 'What was said in the 8 old rooms, before the new house.'), row, list);
    },
    true,
  );
}
