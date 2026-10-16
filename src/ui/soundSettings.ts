import { icon, type IconName } from './icons';
import { mixer, type Levels } from './mixer';
import { el } from './modal';
import { addSettingsSection, switchRow } from './settings';
import { play, type Sfx } from './sounds';

// Settings → Sound (design/game/v2.html): volume sliders per category, sound switches, a pointer to the
// per-friend volume. Saved on this device (src/ui/mixer.ts).
const SLIDERS: [keyof Levels, IconName, string, Sfx | null][] = [
  ['master', 'volume-2', 'Master', 'confirm'],
  ['voices', 'users', 'Voices', null],
  ['game', 'gamepad-2', 'Game sounds', 'knock'],
  ['music', 'music', 'Music & jingles', 'levelup'],
];

export function addSoundSettings() {
  addSettingsSection(
    10,
    (box) => {
      for (const [key, ic, label, sample] of SLIDERS) {
        const row = el('div', 'v2-sl');
        const lab = el('span', 'lab', label);
        const range = el('input', 'dh-range');
        range.type = 'range';
        range.id = `vol-${key}`;
        range.min = '0';
        range.max = '100';
        range.value = String(Math.round(mixer.levels[key] * 100));
        range.setAttribute('aria-label', label);
        const val = el('span', 'val', `${range.value}%`);
        range.addEventListener('input', () => {
          mixer.set(key, Number(range.value) / 100);
          val.textContent = `${range.value}%`;
        });
        if (sample) range.addEventListener('change', () => play(sample));
        row.append(lab, icon(ic), range, val);
        if (sample) {
          const b = el('button', 'dh-iconbtn');
          b.type = 'button';
          b.setAttribute('aria-label', `Play a ${label.toLowerCase()} sample`);
          b.append(icon('play'));
          b.addEventListener('click', () => play(sample));
          row.append(b);
        } else row.append(el('span'));
        box.append(row);
      }
    },
    false,
    'sound',
  );
  addSettingsSection(
    11,
    (box) => {
      const s = mixer.levels;
      box.append(
        switchRow('sfx-on', 'Sound effects', 'Clicks, doors, game sounds', s.sfx, (on) => mixer.set('sfx', on)),
        switchRow('sfx-doors', 'Door and knock sounds', '', s.doors, (on) => mixer.set('doors', on)),
        switchRow('sfx-chimes', 'Join and leave chimes', 'When someone comes into or leaves your room', s.chimes, (on) => mixer.set('chimes', on)),
        switchRow('mute-hidden', 'Mute when the tab is hidden', "Silences everything while you're in another app", s.muteHidden, (on) => mixer.set('muteHidden', on)),
      );
      const note = el('p', 'v2-note', "To change one friend's volume, tap them in a room. Saved on this device.");
      box.append(note);
      if (/iPhone|iPad|iPod/.test(navigator.userAgent))
        box.append(el('p', 'v2-note', "On iPhone, voices follow the phone's volume buttons; the other sliders work as normal."));
    },
    true,
    'sound',
  );
}
