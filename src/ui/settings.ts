import { icon, type IconName } from './icons';
import { el, openModal } from './modal';
import { hudButtons } from './overlay';

// Settings: a gear button (top-right) opening a card with tabs (design/game/v2.html `showSettings`):
// Sound, Mic, Room (only for room owners), More. Each feature adds its own section with
// addSettingsSection(order, render, divider, tab); a tab's sections render fresh each time it's shown,
// in `order`. A tab whose sections render nothing is hidden.
export type SettingsTab = 'sound' | 'mic' | 'room' | 'more';
const TABS: [SettingsTab, IconName, string][] = [
  ['sound', 'volume-2', 'Sound'],
  ['mic', 'mic', 'Mic'],
  ['room', 'door-open', 'Room'],
  ['more', 'ellipsis', 'More'],
];
type Section = { order: number; divider: boolean; tab: SettingsTab; render: (box: HTMLElement) => void | Promise<void> };
const sections: Section[] = [];
let added = false;
let lastTab: SettingsTab = 'sound';
const cleanups = new Set<() => void>();

export function addSettingsSection(order: number, render: Section['render'], divider = false, tab: SettingsTab = 'more') {
  sections.push({ order, render, divider, tab });
  sections.sort((a, b) => a.order - b.order);
  if (!added) addButton();
}

// Something a section started (a mic meter, say) that must stop when its tab or the sheet closes.
export function onSettingsClose(f: () => void) {
  cleanups.add(f);
}
function runCleanups() {
  for (const f of cleanups) f();
  cleanups.clear();
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

async function renderTab(tab: SettingsTab, into: HTMLElement) {
  runCleanups();
  into.replaceChildren();
  for (const s of sections.filter((x) => x.tab === tab)) {
    if (s.divider && into.childElementCount) into.append(el('div', 'dh-divider'));
    const box = el('div');
    box.style.cssText = 'display:grid;gap:8px';
    into.append(box);
    await s.render(box);
    if (!box.childElementCount) box.remove();
  }
}

// Which tabs have something to show (e.g. Room only for an owner).
async function nonEmptyTabs() {
  const out: SettingsTab[] = [];
  for (const [t] of TABS) {
    if (!sections.some((s) => s.tab === t)) continue;
    const probe = el('div');
    await renderTab(t, probe);
    runCleanups();
    if (probe.childElementCount) out.push(t);
  }
  return out;
}

export async function openSettings(tab?: SettingsTab) {
  if (document.getElementById('settings-sheet')) return;
  const { panel, close } = openModal('settings-sheet', { dismissable: true, label: 'settings-title', onDismiss: runCleanups });
  const head = el('div', 'dh-row');
  const title = el('h2', '', 'Settings');
  title.id = 'settings-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'settings-close';
  x.setAttribute('aria-label', 'Close settings');
  x.append(icon('x'));
  x.addEventListener('click', () => {
    runCleanups();
    close();
  });
  head.append(title, x);
  const bar = el('div', 'v2-tabs');
  bar.setAttribute('role', 'tablist');
  const body = el('div');
  body.id = 'settings-body';
  body.style.cssText = 'display:grid;gap:14px';
  panel.append(head, bar, body);

  const available = await nonEmptyTabs();
  let current = tab && available.includes(tab) ? tab : available.includes(lastTab) ? lastTab : available[0];
  const buttons = TABS.filter(([t]) => available.includes(t)).map(([t, ic, label]) => {
    const b = el('button');
    b.type = 'button';
    b.id = `settings-tab-${t}`;
    b.dataset.tab = t;
    b.setAttribute('role', 'tab');
    b.append(icon(ic), label);
    b.addEventListener('click', () => void show(t));
    return b;
  });
  bar.append(...buttons);
  async function show(t: SettingsTab) {
    current = lastTab = t;
    for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    await renderTab(t, body);
  }
  if (current) await show(current);
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
