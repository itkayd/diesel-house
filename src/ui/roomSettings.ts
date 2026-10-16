import type { Room } from '../net/rooms';
import { DOORS, icon, MOODS, type DoorState, type Mood } from './icons';
import { el } from './modal';
import { addSettingsSection, sectionLabel } from './settings';

// "Your room" in settings (design/game/mvp.html): name, door, mood. Only shown to a room's owner.
// `myRoom()` is read each time settings opens, so it follows live changes and ownership.
export function addRoomSettings(myRoom: () => Room | null, save: (change: Partial<Pick<Room, 'name' | 'door_state' | 'mood'>>) => Promise<string | null>) {
  addSettingsSection(
    50,
    (box) => {
      const room = myRoom();
      if (!room) return;
      const title = el('div', 'dh-title', 'Your room');
      title.style.fontSize = '17px';
      const status = el('small', 'dh-lede');
      status.id = 'room-save-status';
      status.setAttribute('aria-live', 'polite');
      const saved = async (change: Parameters<typeof save>[0]) => {
        status.textContent = 'Saving…';
        const err = await save(change);
        status.textContent = err ? `Couldn't save: ${err}` : 'Saved';
      };

      const name = el('input', 'dh-input');
      name.id = 'room-name';
      name.maxLength = 32;
      name.value = room.name;
      name.placeholder = 'Name your room';
      const commit = () => {
        const v = name.value.trim().slice(0, 32);
        if (v && v !== myRoom()?.name) void saved({ name: v });
      };
      name.addEventListener('change', commit);
      name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

      const door = el('div', 'seg');
      door.setAttribute('role', 'group');
      door.setAttribute('aria-label', 'Door');
      for (const [k, [ic, label]] of Object.entries(DOORS) as [DoorState, [Parameters<typeof icon>[0], string]][]) {
        const b = el('button');
        b.type = 'button';
        b.id = `door-${k}`;
        b.setAttribute('aria-pressed', String(room.door_state === k));
        b.append(icon(ic), label);
        b.addEventListener('click', () => {
          door.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          void saved({ door_state: k });
        });
        door.append(b);
      }

      const moods = el('div', 'moods');
      moods.setAttribute('role', 'group');
      moods.setAttribute('aria-label', 'Mood');
      for (const [k, [ic, label]] of Object.entries(MOODS) as [Mood, [Parameters<typeof icon>[0], string]][]) {
        const b = el('button', 'dh-mood');
        b.type = 'button';
        b.id = `mood-${k}`;
        b.dataset.mood = k;
        b.setAttribute('aria-pressed', String(room.mood === k));
        b.append(icon(ic), label);
        b.addEventListener('click', () => {
          // Tap the current mood again to clear it.
          const next = b.getAttribute('aria-pressed') === 'true' ? null : k;
          moods.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b && next !== null)));
          void saved({ mood: next });
        });
        moods.append(b);
      }

      const field = (label: HTMLElement, control: HTMLElement) => {
        const f = el('div');
        f.style.cssText = 'display:grid;gap:6px';
        f.append(label, control);
        return f;
      };
      box.style.gap = '12px';
      box.append(
        title,
        field(sectionLabel('Room name', 'room-name'), name),
        field(el('span', 'dh-label', 'Door'), door),
        field(el('span', 'dh-label', 'Mood'), moods),
        status,
      );
    },
    false,
    'room',
  );
}
