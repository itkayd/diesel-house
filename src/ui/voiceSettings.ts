import type { Voice } from '../net/voice';
import { savedMicDevice } from '../prefs';
import { addSettingsSection, sectionLabel, switchRow } from './settings';
import type { VoiceControls } from './voiceControls';

// Settings sections for voice: microphone, push to talk, and the live voice status.
export function addVoiceSettings(voice: Voice, controls: VoiceControls) {
  addSettingsSection(10, async (box) => {
    const select = document.createElement('select');
    select.id = 'mic-select';
    select.className = 'dh-select';
    const mics = await voice.listMics();
    const current = savedMicDevice();
    // Skip the browser's own 'default'/'communications' aliases; 'System default' covers them.
    for (const m of [{ id: '', label: 'System default' }, ...mics.filter((m) => m.id && m.id !== 'default' && m.id !== 'communications')]) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      o.selected = m.id === current;
      select.appendChild(o);
    }
    select.addEventListener('change', () => void voice.setMicDevice(select.value));
    box.append(sectionLabel('Microphone', 'mic-select'), select);
    if (!mics.some((m) => !m.label.startsWith('Microphone '))) {
      const hint = document.createElement('div');
      hint.className = 'dh-muted';
      hint.style.fontSize = '13px';
      hint.textContent = 'Names show up once you have allowed the mic.';
      box.append(hint);
    }
  });
  addSettingsSection(20, (box) => {
    box.append(
      switchRow('ptt-toggle', 'Push to talk (hold the mic button or Space)', controls.pushToTalk, (on) => controls.setPushToTalk(on)),
    );
    if (voice.room) {
      const s = document.createElement('div');
      s.className = 'dh-muted';
      s.style.fontSize = '13px';
      s.textContent = controls.statusText;
      box.append(s);
    }
  });
}
