import type { Hallway } from '../scenes/hallway';
import { el } from './modal';
import { addSettingsSection, sectionLabel, switchRow } from './settings';

// Settings → Mic: hallway voice (UPDATE.md Phase 10). Whisper on/off, hearing the walkie-talkie on/off,
// and which key is the walkie on a keyboard. (Its volume is the "Walkie & whisper" slider in Sound.)
const KEYS = ['t', 'r', 'v', 'b', 'g', 'f'];

export function addHallwaySettings(hall: Hallway) {
  addSettingsSection(
    30,
    (box) => {
      box.append(
        el('div', 'dh-label', 'Hallway'),
        switchRow('whisper-toggle', 'Whisper in the hallway', 'People right next to you hear you quietly', hall.whisperOn, (on) => hall.setWhisper(on)),
        switchRow('hear-walkie-toggle', 'Hear the walkie-talkie', 'Anyone in the hallway can call everyone over the radio', hall.hearWalkie, (on) => hall.setHearWalkie(on)),
      );
      const select = el('select', 'dh-input');
      select.id = 'walkie-key';
      for (const k of KEYS) {
        const o = el('option', '', k.toUpperCase());
        o.value = k;
        o.selected = k === hall.walkieKey;
        select.append(o);
      }
      select.addEventListener('change', () => hall.setWalkieKey(select.value));
      box.append(sectionLabel('Walkie-talkie key (hold to talk)', 'walkie-key'), select);
    },
    true,
    'mic',
  );
}
