import { createElement, Settings, X } from 'lucide';
import { savedMicDevice } from '../prefs';
import { overlay } from './overlay';

type Mic = { id: string; label: string };
type Options = {
  listMics: () => Promise<Mic[]>;
  onMicChange: (id: string) => void;
};

// Gear button (top-right, under "Change character") that opens a settings sheet.
// Phase 4.6 restyles this and moves more controls in here.
export function addSettings(opts: Options) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'settings-button';
  btn.setAttribute('aria-label', 'Settings');
  btn.append(createElement(Settings, { width: 22, height: 22 }));
  btn.style.cssText = `position:absolute;top:calc(max(12px,env(safe-area-inset-top)) + 40px);right:12px;width:44px;height:44px;
    display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;
    pointer-events:auto;cursor:pointer`;
  btn.addEventListener('click', () => void open(opts));
  overlay().appendChild(btn);
}

async function open(opts: Options) {
  if (document.getElementById('settings-sheet')) return;
  const sheet = document.createElement('div');
  sheet.id = 'settings-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-labelledby', 'settings-title');
  sheet.style.cssText = `position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:min(420px,100%);box-sizing:border-box;
    padding:16px 16px calc(20px + env(safe-area-inset-bottom));border-radius:16px 16px 0 0;pointer-events:auto;
    background:rgba(20,15,28,.97);border:2px solid rgba(255,255,255,.2);border-bottom:0;font:14px system-ui,sans-serif`;

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
  const title = document.createElement('h2');
  title.id = 'settings-title';
  title.textContent = 'Settings';
  title.style.cssText = 'margin:0;font-size:18px';
  const close = document.createElement('button');
  close.type = 'button';
  close.id = 'settings-close';
  close.setAttribute('aria-label', 'Close settings');
  close.append(createElement(X, { width: 22, height: 22 }));
  close.style.cssText = 'width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:0;background:none;color:#fff;cursor:pointer';
  close.addEventListener('click', () => sheet.remove());
  head.append(title, close);

  const label = document.createElement('label');
  label.htmlFor = 'mic-select';
  label.textContent = 'Microphone';
  label.style.cssText = 'display:block;margin-bottom:6px;opacity:.8';
  const select = document.createElement('select');
  select.id = 'mic-select';
  select.style.cssText = `width:100%;min-height:44px;padding:0 10px;border-radius:8px;border:2px solid rgba(255,255,255,.25);
    background:#2b2034;color:#fff;font:15px system-ui,sans-serif`;
  const mics = await opts.listMics();
  const current = savedMicDevice();
  // Skip the browser's own 'default'/'communications' aliases; 'System default' covers them.
  for (const m of [{ id: '', label: 'System default' }, ...mics.filter((m) => m.id && m.id !== 'default' && m.id !== 'communications')]) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    o.selected = m.id === current;
    select.appendChild(o);
  }
  select.addEventListener('change', () => opts.onMicChange(select.value));
  const hint = document.createElement('div');
  hint.textContent = mics.some((m) => !m.label.startsWith('Microphone ')) ? '' : 'Names show up once you have allowed the mic.';
  hint.style.cssText = 'margin-top:6px;opacity:.6;font-size:12px';

  sheet.append(head, label, select, hint);
  overlay().appendChild(sheet);
}
