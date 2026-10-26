import type { Section } from '../main';
import { act, api, btn, card, field, h, input, sectionHead, skeleton, toggle, when } from '../kit';
import { TABLE_GAMES } from '../../games/catalog';

type Settings = {
  games_off: string[];
  arcade: { enabled: boolean };
  animals: { enabled: boolean; rooms_off: string[] };
  pets: { enabled: boolean };
  critters: { enabled: boolean };
  announcement: { text: string; until: string | null };
};

// House-wide switches (house_settings): the game reads them live, so a change shows for everyone within a
// second or two, no reload.
export const house: Section = {
  id: 'house',
  label: 'House switches',
  icon: 'sliders',
  async render(main) {
    main.append(sectionHead('House switches', 'Turn things on and off for everyone. Changes show in the house within a couple of seconds.'), skeleton(3));
    const [s, rooms] = await Promise.all([api<Settings>('settings'), api<{ id: string; name: string }[]>('rooms')]);
    main.lastElementChild?.remove();
    const set = (setting: keyof Settings, value: unknown, done: string) => act(null, () => api('setting-set', { setting, value }), done);

    // Announcement: a banner across the top of everyone's screen.
    const text = h('textarea', { class: 'adm-area', maxlength: 200, id: 'announce-text', placeholder: 'e.g. Quiz night in the Lounge at 8!' }, s.announcement?.text ?? '') as HTMLTextAreaElement;
    const hours = input({ type: 'number', min: 1, step: 1, value: 24, inputmode: 'numeric', id: 'announce-hours', 'aria-label': 'Hours to show it' });
    const live = s.announcement?.text && (!s.announcement.until || new Date(s.announcement.until).getTime() > Date.now());
    const announce = card(
      'Announcement',
      'megaphone',
      h('p', { class: 'adm-hint' }, live ? `Showing now${s.announcement.until ? `, until ${when(s.announcement.until)}` : ''}.` : 'Nothing showing. Write a line and everyone in the house sees it at the top of the screen.'),
      field('Message', text),
      field('Show it for (hours)', hours),
      h(
        'div',
        { class: 'adm-inline' },
        btn('Show to everyone', () => {
          const until = new Date(Date.now() + Math.max(1, Number(hours.value) || 24) * 3600_000).toISOString();
          void set('announcement', { text: text.value.trim(), until }, text.value.trim() ? 'Announcement is showing.' : 'Announcement cleared.');
        }, { icon: 'megaphone', kind: 'gold', id: 'announce-go' }),
        btn('Clear', () => {
          text.value = '';
          void set('announcement', { text: '', until: null }, 'Announcement cleared.');
        }, { kind: 'ghost', id: 'announce-clear' }),
      ),
    );

    // Games switched off everywhere.
    const off = new Set(s.games_off ?? []);
    const games = h(
      'div',
      { class: 'adm-chips', id: 'games-off' },
      ...[...TABLE_GAMES, { id: 'hideseek', label: 'Hide and seek' }].map((g) => {
        const b = h('button', { type: 'button', class: 'adm-chip', 'aria-pressed': String(!off.has(g.id)), 'data-game': g.id }, g.label);
        b.addEventListener('click', () => {
          if (off.has(g.id)) off.delete(g.id);
          else off.add(g.id);
          b.setAttribute('aria-pressed', String(!off.has(g.id)));
          void set('games_off', [...off], off.has(g.id) ? `${g.label} is off everywhere.` : `${g.label} is back on.`);
        });
        return b;
      }),
    );

    // Animals, per room.
    const roomsOff = new Set(s.animals?.rooms_off ?? []);
    const animalRooms = h(
      'div',
      { class: 'adm-chips', id: 'animal-rooms' },
      ...rooms.map((r) => {
        const b = h('button', { type: 'button', class: 'adm-chip', 'aria-pressed': String(!roomsOff.has(r.id)) }, r.name);
        b.addEventListener('click', () => {
          if (roomsOff.has(r.id)) roomsOff.delete(r.id);
          else roomsOff.add(r.id);
          b.setAttribute('aria-pressed', String(!roomsOff.has(r.id)));
          s.animals = { enabled: s.animals?.enabled !== false, rooms_off: [...roomsOff] };
          void set('animals', s.animals, roomsOff.has(r.id) ? `No animals in the ${r.name}.` : `Animals are back in the ${r.name}.`);
        });
        return b;
      }),
    );

    main.append(
      announce,
      h(
        'div',
        { class: 'adm-grid' },
        card(
          'Games',
          'games',
          h('p', { class: 'adm-hint' }, 'Lit = on. Tap a game to switch it off at every table (rooms can also switch games off for their own table).'),
          games,
          toggle('Night Raid arcade', s.arcade?.enabled !== false, (on) => void set('arcade', { enabled: on }, on ? 'Night Raid is on.' : 'Night Raid is off.'), 'The arcade cabinets and Games → Arcade.', 'switch-arcade'),
        ),
        card(
          'Animals and critters',
          'paw',
          toggle('Animals wander in rooms', s.animals?.enabled !== false, (on) => {
            s.animals = { enabled: on, rooms_off: [...roomsOff] };
            void set('animals', s.animals, on ? 'Animals are back.' : 'Animals are hidden everywhere.');
          }, undefined, 'switch-animals'),
          field('Rooms with animals (lit = yes)', animalRooms),
          toggle('Pets follow their owners', s.pets?.enabled !== false, (on) => void set('pets', { enabled: on }, on ? 'Pets are on.' : 'Pets are off.'), undefined, 'switch-pets'),
          toggle('Critters to catch for XP', s.critters?.enabled !== false, (on) => void set('critters', { enabled: on }, on ? 'Critters are on.' : 'Critters are off.'), 'Change what each critter is worth in Critters & challenges.', 'switch-critters'),
        ),
      ),
    );
  },
};
