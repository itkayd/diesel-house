import type { Section } from '../main';
import { act, api, badge, btn, card, field, h, input, sectionHead, skeleton, toggle } from '../kit';
import { TABLE_GAMES } from '../../games/catalog';

type Room = { id: string; name: string; active: boolean; dnd: boolean; games: string[] | null; prompts: string[] | null; music: string | null; media: string | null };

// Every room: its name, Do not disturb, which games its table offers, its conversation prompts, and a
// stop button for music or a shared video.
export const rooms: Section = {
  id: 'rooms',
  label: 'Rooms',
  icon: 'house',
  async render(main) {
    main.append(sectionHead('Rooms', 'Changes reach everyone in the house straight away.'), skeleton(3));
    const list = await api<Room[]>('rooms');
    main.lastElementChild?.remove();
    const grid = h('div', { class: 'adm-grid', id: 'room-list' });
    main.append(grid);
    for (const r of list) grid.append(roomCard(r));
  },
};

function roomCard(r: Room) {
  const save = (patch: Record<string, unknown>, done: string, b: HTMLButtonElement | null = null) => act(b, () => api('room-update', { room: r.id, patch }), done);
  const name = input({ value: r.name, maxlength: 24, 'aria-label': `${r.name} name`, id: `room-name-${r.id}` });
  const prompts = h('textarea', { class: 'adm-area', 'aria-label': 'Conversation prompts', id: `room-prompts-${r.id}`, placeholder: 'One per line. Empty: the house’s own.' }, (r.prompts ?? []).join('\n')) as HTMLTextAreaElement;
  const allowed = new Set(r.games ?? TABLE_GAMES.map((g) => g.id));
  const games = h(
    'div',
    { class: 'adm-chips', role: 'group', 'aria-label': 'Games at this room’s table' },
    ...TABLE_GAMES.map((g) => {
      const b = h('button', { type: 'button', class: 'adm-chip', 'aria-pressed': String(allowed.has(g.id)), 'data-game': g.id }, g.label);
      b.addEventListener('click', () => {
        if (allowed.has(g.id)) allowed.delete(g.id);
        else allowed.add(g.id);
        b.setAttribute('aria-pressed', String(allowed.has(g.id)));
      });
      return b;
    }),
  );
  const playing = [r.music ? badge(`Music: ${r.music}`, 'info') : null, r.media ? badge(`Sharing ${r.media}`, 'info') : null].filter(Boolean) as HTMLElement[];
  return card(
    r.name,
    r.dnd ? 'moon' : 'house',
    h('div', { class: 'adm-chips' }, badge(r.id), r.dnd ? badge('Do not disturb', 'warn') : null, ...playing),
    field('Name', h('div', { class: 'adm-inline' }, name, btn('Save', () => void save({ name: name.value }, 'Room renamed.'), { small: true }))),
    toggle('Do not disturb', r.dnd, (on) => void save({ dnd: on }, on ? 'Do not disturb is on.' : 'Do not disturb is off.'), 'Others see it on the door and are asked before they walk in.', `room-dnd-${r.id}`),
    field('Games at the table', games),
    h('div', { class: 'adm-inline' }, btn('Save games', () => void save({ games: allowed.size === TABLE_GAMES.length ? null : [...allowed] }, 'Games saved.'), { small: true }), btn('All games', () => {
      for (const b of games.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', 'true');
        allowed.add(b.dataset.game!);
      }
    }, { small: true, kind: 'ghost' })),
    field('Conversation prompts', prompts, 'Shown on the table now and then. One per line.'),
    h('div', {}, btn('Save prompts', () => {
      const lines = prompts.value.split('\n').map((l) => l.trim()).filter(Boolean);
      void save({ prompts: lines.length ? lines : null }, 'Prompts saved.');
    }, { small: true })),
    r.music || r.media
      ? h('div', { class: 'adm-inline' }, r.music ? btn('Stop the music', () => void save({ stop_music: true }, 'Music stopped.'), { icon: 'music', small: true, kind: 'danger' }) : null, r.media ? btn('Stop the shared video', () => void save({ stop_media: true }, 'Stopped.'), { icon: 'tv', small: true, kind: 'danger' }) : null)
      : null,
  );
}
