import type { Room } from '../net/rooms';
import { DOORS, icon, MOODS, type DoorState, type Mood } from './icons';
import { el } from './modal';
import { addSettingsSection, sectionLabel, switchRow } from './settings';

// "Your room" in settings (design/game/mvp.html): name, door, mood. Only shown to a room's owner.
// `myRoom()` is read each time settings opens, so it follows live changes and ownership.
// `tableGames`: for rooms with a game table, the games the owner can switch on and off (UPDATE.md Phase 12).
// The owner's own Would you rather prompts, one per line "option A | option B" (Phase 13, rooms.prompts).
export function addRoomSettings(
  myRoom: () => Room | null,
  save: (change: Partial<Pick<Room, 'name' | 'door_state' | 'mood' | 'games' | 'prompts'>>) => Promise<string | null>,
  tableGames: (room: Room) => { id: string; label: string }[] = () => [],
) {
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
      );
      const games = tableGames(room);
      if (games.length) {
        const list = el('div');
        list.id = 'room-games';
        list.style.cssText = 'display:grid;gap:4px';
        const on = new Set(room.games ?? games.map((g) => g.id));
        for (const g of games)
          list.append(
            switchRow(`room-game-${g.id}`, g.label, '', on.has(g.id), (yes) => {
              if (yes) on.add(g.id);
              else on.delete(g.id);
              // All on is saved as null ("everything", including games added later).
              void saved({ games: games.every((x) => on.has(x.id)) ? null : games.map((x) => x.id).filter((id) => on.has(id)) });
            }),
          );
        box.append(field(el('span', 'dh-label', 'Games at your table'), list));
      }
      box.append(field(sectionLabel('Your Would you rather prompts', 'room-prompts'), promptsEditor(room.prompts ?? [], status, (prompts) => saved({ prompts }))));
      box.append(status);
    },
    false,
    'room',
  );
}

export const MAX_PROMPTS = 50;
const MAX_PROMPT_LEN = 200;

// "Pizza for breakfast | cake for dinner" lines to rooms.prompts ("A|B"), or the first problem.
export function parsePromptLines(text: string): { prompts: string[] } | { error: string } {
  const prompts: string[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { error: `Line ${i + 1} needs two options with one | between them.` };
    const p = `${parts[0]}|${parts[1]}`;
    if (p.length > MAX_PROMPT_LEN) return { error: `Line ${i + 1} is too long (${MAX_PROMPT_LEN} letters at most).` };
    if (!prompts.includes(p)) prompts.push(p);
  }
  if (prompts.length > MAX_PROMPTS) return { error: `That's ${prompts.length} prompts; ${MAX_PROMPTS} at most.` };
  return { prompts };
}

function promptsEditor(current: string[], status: HTMLElement, save: (prompts: string[] | null) => Promise<void>) {
  const wrap = el('div');
  wrap.style.cssText = 'display:grid;gap:6px';
  const area = el('textarea', 'dh-input dh-textarea');
  area.id = 'room-prompts';
  area.rows = 4;
  area.placeholder = 'Pancakes every morning | waffles every night';
  area.value = current.map((p) => p.replace('|', ' | ')).join('\n');
  const hint = el('small', 'dh-lede', 'One per line: option A | option B. They come up in Would you rather at your room’s games spot.');
  let last = area.value;
  area.addEventListener('change', () => {
    if (area.value === last) return;
    const r = parsePromptLines(area.value);
    if ('error' in r) {
      status.textContent = r.error;
      return;
    }
    last = area.value;
    void save(r.prompts.length ? r.prompts : null);
  });
  wrap.append(area, hint);
  return wrap;
}
