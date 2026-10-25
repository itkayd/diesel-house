import { el } from './modal';
import { addSettingsSection } from './settings';

// Settings → More → Text size (UX-RULES U6): Normal, Bigger or Biggest for every panel, button and message
// (theme.css sizes text as `calc(Npx * var(--ts))`). The page itself can't be pinch-zoomed (a zoomed
// page hid the joystick and the top bar), so this is the way to make things easier to read.
export const TEXT_SIZES = [
  ['normal', 'Normal', 1],
  ['bigger', 'Bigger', 1.15],
  ['biggest', 'Biggest', 1.3],
] as const;
export type TextSize = (typeof TEXT_SIZES)[number][0];
const KEY = 'diesel-house.text-size';

export function savedTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZES.some(([id]) => id === v) ? (v as TextSize) : 'normal';
  } catch {
    return 'normal';
  }
}

export function applyTextSize(size: TextSize = savedTextSize()) {
  const scale = TEXT_SIZES.find(([id]) => id === size)?.[2] ?? 1;
  document.documentElement.style.setProperty('--ts', String(scale));
  document.documentElement.dataset.textSize = size;
}

export function setTextSize(size: TextSize) {
  try {
    localStorage.setItem(KEY, size);
  } catch {
    // private browsing: this visit only
  }
  applyTextSize(size);
}

export function addTextSizeSetting() {
  addSettingsSection(
    20,
    (box) => {
      const label = el('div', 'dh-label', 'Text size');
      label.id = 'text-size-label';
      const row = el('div', 'dh-seg');
      row.id = 'text-size';
      row.setAttribute('role', 'radiogroup');
      row.setAttribute('aria-labelledby', 'text-size-label');
      const now = savedTextSize();
      for (const [id, name, scale] of TEXT_SIZES) {
        const b = el('button', 'dh-seg-btn', name);
        b.type = 'button';
        b.dataset.size = id;
        b.style.fontSize = `${Math.round(15 * scale)}px`;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(id === now));
        b.addEventListener('click', () => {
          setTextSize(id);
          for (const x of row.children) x.setAttribute('aria-checked', String((x as HTMLElement).dataset.size === id));
        });
        row.append(b);
      }
      box.append(label, row, el('p', 'v2-note', 'Makes the text in every panel, button and chat bigger.'));
    },
    false,
    'more',
  );
}
