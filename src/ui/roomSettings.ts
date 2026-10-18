import type { Room } from '../net/rooms';
import { DND_ICON, icon } from './icons';
import { el } from './modal';
import { addSettingsSection, sectionLabel, switchRow } from './settings';

// The Room tab in settings (REDESIGN.md R1: nobody owns a room). Shown while you're in a room:
// - "Do not disturb": anyone inside can ask for quiet. The door gets a dark sign and people outside are
//   asked "Go in anyway?" (no hard lock). It goes away when the room empties.
// - The room's table: which games it offers (UPDATE.md Phase 12) and its own Would you rather prompts
//   (Phase 13), one per line "option A | option B". Any member can change these; the database logs who
//   did (room_changes). Guests see the switch but not the rules.
// `here()` is read each time settings opens, so it follows you around the house.
export type RoomHere = { room: Room; name: string; member: boolean };
export function addRoomSettings(
  here: () => RoomHere | null,
  setQuiet: (room: Room, quiet: boolean) => Promise<string | null>,
  saveRules: (room: Room, games: string[] | null, prompts: string[] | null) => Promise<string | null>,
  tableGames: (room: Room) => { id: string; label: string }[] = () => [],
) {
  addSettingsSection(
    50,
    (box) => {
      const h = here();
      if (!h) return;
      const { room } = h;
      const title = el('div', 'dh-title', h.name);
      title.id = 'room-settings-title';
      title.style.fontSize = '17px';
      const status = el('small', 'dh-lede');
      status.id = 'room-save-status';
      status.setAttribute('aria-live', 'polite');
      const saved = async (save: () => Promise<string | null>) => {
        status.textContent = 'Saving…';
        const err = await save();
        status.textContent = err ? `Couldn't save: ${err}` : 'Saved';
      };
      const field = (label: HTMLElement, control: HTMLElement) => {
        const f = el('div');
        f.style.cssText = 'display:grid;gap:6px';
        f.append(label, control);
        return f;
      };
      box.style.gap = '12px';
      const quiet = switchRow('room-dnd', 'Do not disturb', 'Asks people outside before they come in', room.dnd, (on) => void saved(() => setQuiet(room, on)));
      quiet.querySelector('.txt')?.prepend(icon(DND_ICON, { width: 16 }));
      box.append(title, quiet);
      if (!h.member) return box.append(status);

      let games = room.games ?? null;
      let prompts = room.prompts ?? null;
      const table = tableGames(room);
      if (table.length) {
        const list = el('div');
        list.id = 'room-games';
        list.style.cssText = 'display:grid;gap:4px';
        const on = new Set(games ?? table.map((g) => g.id));
        for (const g of table)
          list.append(
            switchRow(`room-game-${g.id}`, g.label, '', on.has(g.id), (yes) => {
              if (yes) on.add(g.id);
              else on.delete(g.id);
              // All on is saved as null ("everything", including games added later).
              games = table.every((x) => on.has(x.id)) ? null : table.map((x) => x.id).filter((id) => on.has(id));
              void saved(() => saveRules(room, games, prompts));
            }),
          );
        box.append(field(el('span', 'dh-label', 'Games at this room’s table'), list));
      }
      // A room with no games spot has no rules to set.
      if (!table.length) return box.append(status);
      box.append(
        field(
          sectionLabel('This room’s Would you rather prompts', 'room-prompts'),
          promptsEditor(prompts ?? [], status, (p) => {
            prompts = p;
            return saved(() => saveRules(room, games, prompts));
          }),
        ),
      );
      box.append(el('small', 'dh-lede', 'Any member can change these. Changes are saved with your name.'), status);
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
  const hint = el('small', 'dh-lede', 'One per line: option A | option B. They come up in Would you rather at this room’s games spot.');
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
