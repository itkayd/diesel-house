import { createElement, Settings, X } from 'lucide';
import { hudButtons, overlay } from './overlay';

// Settings: a gear button (top-right) opening a bottom sheet. Each feature adds its own section with
// addSettingsSection(); sections render fresh every time the sheet opens.
type Section = { order: number; render: (box: HTMLElement) => void | Promise<void> };
const sections: Section[] = [];
let added = false;

export function addSettingsSection(order: number, render: Section['render']) {
  sections.push({ order, render });
  sections.sort((a, b) => a.order - b.order);
  if (!added) addButton();
}

function addButton() {
  added = true;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'settings-button';
  btn.className = 'dh-icon-btn';
  btn.setAttribute('aria-label', 'Settings');
  btn.append(createElement(Settings, { width: 22, height: 22 }));
  btn.addEventListener('click', () => void openSettings());
  hudButtons().appendChild(btn);
}

export async function openSettings() {
  if (document.getElementById('settings-sheet')) return;
  const sheet = document.createElement('div');
  sheet.id = 'settings-sheet';
  sheet.className = 'dh-card dh-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-labelledby', 'settings-title');
  const head = document.createElement('div');
  head.className = 'dh-sheet-head';
  const title = document.createElement('h2');
  title.id = 'settings-title';
  title.className = 'dh-title';
  title.textContent = 'Settings';
  const close = document.createElement('button');
  close.type = 'button';
  close.id = 'settings-close';
  close.className = 'dh-icon-btn dh-sheet-close';
  close.setAttribute('aria-label', 'Close settings');
  close.append(createElement(X, { width: 22, height: 22 }));
  close.addEventListener('click', () => sheet.remove());
  head.append(title, close);
  sheet.append(head);
  overlay().appendChild(sheet);
  for (const s of sections) {
    const box = document.createElement('section');
    box.style.display = 'grid';
    box.style.gap = '6px';
    sheet.append(box);
    await s.render(box);
  }
}

// Helpers for sections.
export function switchRow(id: string, label: string, checked: boolean, onChange: (on: boolean) => void) {
  const row = document.createElement('label');
  row.className = 'dh-switch';
  row.htmlFor = id;
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  input.addEventListener('change', () => {
    onChange(input.checked);
    input.blur(); // so Space (push to talk) doesn't toggle it again
  });
  row.append(text, input);
  return row;
}

export function sectionLabel(text: string, forId?: string) {
  const l = document.createElement('label');
  l.className = 'dh-label';
  l.textContent = text;
  if (forId) l.htmlFor = forId;
  return l;
}
