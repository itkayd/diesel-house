import type { Section } from '../main';
import { act, api, card, h, input, n, sectionHead, skeleton } from '../kit';

type Critter = { id: string; name: string; xp: number; weight: number; caught_week: number };
type Challenge = { id: string; period: 'day' | 'week'; title: string; kind: string; goal: number; xp: number };

// What each critter is worth and how often it turns up; the daily and weekly challenges.
export const critters: Section = {
  id: 'critters',
  label: 'Critters & challenges',
  icon: 'paw',
  async render(main) {
    main.append(sectionHead('Critters & challenges', 'XP and how often things turn up. Changes apply to the next critter that appears and the next challenge progress.'), skeleton(4));
    const r = await api<{ critters: Critter[]; challenges: Challenge[] }>('critters');
    main.lastElementChild?.remove();
    const total = r.critters.reduce((s, c) => s + c.weight, 0) || 1;

    const critterRows = r.critters.map((c) => {
      const xp = input({ type: 'number', min: 1, step: 1, value: c.xp, inputmode: 'numeric', 'aria-label': `${c.name} XP`, id: `critter-xp-${c.id}` });
      const weight = input({ type: 'number', min: 1, step: 1, value: c.weight, inputmode: 'numeric', 'aria-label': `${c.name} how often`, id: `critter-weight-${c.id}` });
      const save = h('button', { type: 'button', class: 'adm-btn small' }, 'Save');
      save.addEventListener('click', () => void act(save, () => api('critter-update', { critter: c.id, xp: Number(xp.value), weight: Number(weight.value) }), `${c.name} saved.`));
      return h(
        'tr',
        {},
        h('td', { 'data-label': 'Critter' }, h('b', {}, c.name)),
        h('td', { 'data-label': 'XP', class: 'num' }, xp),
        h('td', { 'data-label': 'How often', class: 'num' }, weight),
        h('td', { 'data-label': 'Chance', class: 'num' }, `${Math.round((c.weight / total) * 100)}%`),
        h('td', { 'data-label': 'Caught this week', class: 'num' }, n(c.caught_week)),
        h('td', {}, save),
      );
    });

    const challengeRows = r.challenges.map((c) => {
      const title = input({ value: c.title, maxlength: 80, 'aria-label': 'Title', id: `challenge-title-${c.id}` });
      const goal = input({ type: 'number', min: 1, step: 1, value: c.goal, inputmode: 'numeric', 'aria-label': 'Goal', id: `challenge-goal-${c.id}` });
      const xp = input({ type: 'number', min: 1, step: 1, value: c.xp, inputmode: 'numeric', 'aria-label': 'XP', id: `challenge-xp-${c.id}` });
      const save = h('button', { type: 'button', class: 'adm-btn small' }, 'Save');
      save.addEventListener('click', () => void act(save, () => api('challenge-update', { challenge: c.id, goal: Number(goal.value), xp: Number(xp.value), title: title.value }), 'Challenge saved.'));
      return h(
        'tr',
        {},
        h('td', { 'data-label': 'When' }, c.period === 'day' ? 'Daily' : 'Weekly'),
        h('td', { 'data-label': 'Title' }, title),
        h('td', { 'data-label': 'Goal', class: 'num' }, goal),
        h('td', { 'data-label': 'XP', class: 'num' }, xp),
        h('td', {}, save),
      );
    });

    main.append(
      card(
        'Critters',
        'paw',
        h('p', { class: 'adm-hint' }, '“How often” is a share of all critters: a critter with 20 turns up twice as often as one with 10. To stop critters altogether, use House switches.'),
        h('table', { class: 'adm-table', id: 'critter-table' }, h('thead', {}, h('tr', {}, ...['Critter', 'XP', 'How often', 'Chance', 'Caught this week', ''].map((t) => h('th', {}, t)))), h('tbody', {}, ...critterRows)),
      ),
      card(
        'Challenges',
        'trophy',
        h('table', { class: 'adm-table', id: 'challenge-table' }, h('thead', {}, h('tr', {}, ...['When', 'Title', 'Goal', 'XP', ''].map((t) => h('th', {}, t)))), h('tbody', {}, ...challengeRows)),
      ),
    );
  },
};
