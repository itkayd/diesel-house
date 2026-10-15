import type { Voice } from '../net/voice';
import { savedMicDevice } from '../prefs';
import { el } from './modal';
import { addSettingsSection, sectionLabel, switchRow } from './settings';
import type { VoiceControls } from './voiceControls';

// Settings for voice: microphone and push to talk (plus the live voice status while in a room).
export function addVoiceSettings(voice: Voice, controls: VoiceControls) {
  addSettingsSection(10, async (box) => {
    const select = el('select', 'dh-input');
    select.id = 'mic-select';
    const mics = await voice.listMics();
    const current = savedMicDevice();
    // Skip the browser's own 'default'/'communications' aliases; 'System default' covers them.
    for (const m of [{ id: '', label: 'System default' }, ...mics.filter((m) => m.id && m.id !== 'default' && m.id !== 'communications')]) {
      const o = el('option', '', m.label);
      o.value = m.id;
      o.selected = m.id === current;
      select.appendChild(o);
    }
    select.addEventListener('change', () => void voice.setMicDevice(select.value));
    box.append(sectionLabel('Microphone', 'mic-select'), select);
    if (!mics.some((m) => !m.label.startsWith('Microphone '))) box.append(el('small', 'dh-lede', 'Names show up once you have allowed the mic.'));
  });
  addSettingsSection(20, (box) => {
    box.append(switchRow('ptt-toggle', 'Push to talk', 'Hold the mic button or Space to talk', controls.pushToTalk, (on) => controls.setPushToTalk(on)));
    if (voice.room) box.append(el('small', 'dh-lede', controls.statusText));
  });
}
