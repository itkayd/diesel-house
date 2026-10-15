import { icon } from './icons';
import { el, openModal } from './modal';
import { hudButtons } from './overlay';

// Settings: a gear button (top-right) opening a modal card (design/game/mvp.html `showSettings`).
// Each feature adds its own section with addSettingsSection(); sections render fresh on every open, in
// `order` (10s voice, 30s you, 50s your room, 90s credits/sign out). `divider` draws a line above it.
type Section = { order: number; divider: boolean; render: (box: HTMLElement) => void | Promise<void> };
const sections: Section[] = [];
let added = false;

export function addSettingsSection(order: number, render: Section['render'], divider = false) {
  sections.push({ order, render, divider });
  sections.sort((a, b) => a.order - b.order);
  if (!added) addButton();
}

function addButton() {
  added = true;
  const btn = el('button', 'dh-iconbtn');
  btn.type = 'button';
  btn.id = 'settings-button';
  btn.setAttribute('aria-label', 'Settings');
  btn.append(icon('settings'));
  btn.addEventListener('click', () => void openSettings());
  hudButtons().appendChild(btn);
}

export async function openSettings() {
  if (document.getElementById('settings-sheet')) return;
  const { panel, close } = openModal('settings-sheet', { dismissable: true, label: 'settings-title' });
  const head = el('div', 'dh-row');
  const title = el('h2', '', 'Settings');
  title.id = 'settings-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'settings-close';
  x.setAttribute('aria-label', 'Close settings');
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(title, x);
  panel.append(head);
  for (const s of sections) {
    if (s.divider) panel.append(el('div', 'dh-divider'));
    const box = el('div');
    box.style.cssText = 'display:grid;gap:6px';
    panel.append(box);
    await s.render(box);
    if (!box.childElementCount) box.remove();
  }
}

// A labelled pixel switch row: "Push to talk / Hold the mic button or Space to talk   [==]".
export function switchRow(id: string, label: string, hint: string, checked: boolean, onChange: (on: boolean) => void) {
  const row = el('label', 'dh-row');
  row.htmlFor = id;
  const txt = el('span', 'txt', label);
  if (hint) txt.append(el('small', '', hint));
  const input = el('input', 'dh-switch');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  input.addEventListener('change', () => {
    onChange(input.checked);
    input.blur(); // so Space (push to talk) doesn't toggle it again
  });
  row.append(txt, input);
  return row;
}

export function sectionLabel(text: string, forId?: string) {
  const l = el('label', 'dh-label', text);
  if (forId) l.htmlFor = forId;
  return l;
}
