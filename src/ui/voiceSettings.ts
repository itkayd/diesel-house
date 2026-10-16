import { Voice } from '../net/voice';
import { savedMicDevice, savedSpeaker } from '../prefs';
import { icon } from './icons';
import { el } from './modal';
import { addSettingsSection, onSettingsClose, sectionLabel, switchRow } from './settings';
import type { VoiceControls } from './voiceControls';

// Settings → Mic (design/game/v2.html): your mic's state (with Try again when it isn't reaching anyone),
// microphone picker, a live input meter, a 3-second record-and-play-back test, speaker picker (where the
// browser allows it) and push to talk.
const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };

export function addVoiceSettings(voice: Voice, controls: VoiceControls, onFix: () => void) {
  addSettingsSection(
    10,
    (box) => {
      const state = el('div', 'dh-row');
      state.id = 'mic-state';
      const txt = el('span', 'txt', controls.captionText);
      txt.append(el('small', '', controls.problem ? 'People in your room can\'t hear you yet.' : 'People in your room can hear you when the mic button is green.'));
      state.append(txt);
      if (controls.problem) {
        const fix = el('button', 'dh-btn');
        fix.type = 'button';
        fix.id = 'mic-fix';
        fix.style.cssText = 'min-height:36px;font-size:13px';
        fix.append(icon('refresh-cw'), 'Try again');
        fix.addEventListener('click', onFix);
        state.append(fix);
      }
      if (voice.room) box.append(state);
    },
    false,
    'mic',
  );

  addSettingsSection(
    11,
    async (box) => {
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
      if (!mics.some((m) => !m.label.startsWith('Microphone '))) box.append(el('small', 'v2-note', 'Names show up once you have allowed the mic.'));

      // Live input level: the room's mic if we're in one, otherwise a short-lived one just for this tab.
      const meter = el('div', 'v2-meter');
      meter.id = 'mic-meter';
      const bars = Array.from({ length: 16 }, () => el('i'));
      meter.append(...bars);
      box.append(sectionLabel('Input level · say something'), meter);
      let own: MediaStream | null = null;
      let ctx: AudioContext | null = null;
      let timer = 0;
      const start = async () => {
        let stream = voice.micStream;
        if (!stream) {
          own = await navigator.mediaDevices?.getUserMedia(MIC).catch(() => null);
          stream = own;
        }
        if (!stream) return;
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        timer = window.setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          const lit = Math.min(16, Math.round(Math.sqrt(sum / buf.length) * 160));
          bars.forEach((b, i) => (b.className = i < lit ? (i > 11 ? 'on hot' : 'on') : ''));
          meter.dataset.level = String(lit);
        }, 90);
      };
      void start();
      onSettingsClose(() => {
        clearInterval(timer);
        void ctx?.close().catch(() => {});
        own?.getTracks().forEach((t) => t.stop());
      });

      // Record 3 s and play it back.
      const test = el('button', 'dh-btn dh-btn--quiet');
      test.type = 'button';
      test.id = 'mic-test';
      const idle = () => test.replaceChildren(icon('audio-lines'), 'Test: record 3 s and play back');
      idle();
      test.addEventListener('click', async () => {
        const stream = voice.micStream ?? own ?? (await navigator.mediaDevices?.getUserMedia(MIC).catch(() => null));
        if (!stream || typeof MediaRecorder === 'undefined') {
          test.textContent = "Couldn't use the mic";
          return void setTimeout(idle, 2000);
        }
        test.disabled = true;
        test.textContent = 'Recording 3 s…';
        const rec = new MediaRecorder(new MediaStream(stream.getAudioTracks().map((t) => t.clone())));
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = () => {
          rec.stream.getTracks().forEach((t) => t.stop());
          const audio = new Audio(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })));
          const speaker = savedSpeaker();
          if (speaker) void (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(speaker).catch(() => {});
          test.textContent = 'Playing it back…';
          audio.onended = () => {
            test.disabled = false;
            idle();
          };
          void audio.play().catch(() => {
            test.disabled = false;
            idle();
          });
        };
        rec.start();
        setTimeout(() => rec.state === 'recording' && rec.stop(), 3000);
      });
      box.append(test);

      // Speaker (where the browser lets us choose).
      if (Voice.speakerChoice) {
        const speakers = await voice.listSpeakers();
        if (speakers.length > 1) {
          const out = el('select', 'dh-input');
          out.id = 'speaker-select';
          const now = savedSpeaker();
          for (const s of [{ id: '', label: 'System default' }, ...speakers.filter((s) => s.id && s.id !== 'default' && s.id !== 'communications')]) {
            const o = el('option', '', s.label);
            o.value = s.id;
            o.selected = s.id === now;
            out.appendChild(o);
          }
          out.addEventListener('change', () => voice.setSpeaker(out.value));
          box.append(sectionLabel('Speaker', 'speaker-select'), out);
        }
      }
    },
    true,
    'mic',
  );

  addSettingsSection(
    20,
    (box) => {
      box.append(switchRow('ptt-toggle', 'Push to talk', 'Hold the mic button or Space to talk. Off: your mic is open, tap to mute.', controls.pushToTalk, (on) => controls.setPushToTalk(on)));
      if (voice.room) box.append(el('small', 'v2-note', controls.statusText));
    },
    true,
    'mic',
  );
}
