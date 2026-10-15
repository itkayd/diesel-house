import { icon } from './icons';
import { el } from './modal';
import { overlay } from './overlay';
import { portrait } from './portrait';

let pop: HTMLDivElement | null = null;

// Per-person volume card (design/game/mvp.html `openVolume`): face, name, close, slider.
// Tap anywhere else to close.
export function showVolumePopover(
  name: string,
  character: number,
  value: number,
  onChange: (v: number) => void,
  extra?: { label: string; id: string; onClick: () => void },
) {
  closeVolumePopover();
  pop = el('div', 'dh-panel vol-pop');
  pop.id = 'volume-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Volume for ${name}`);
  const head = el('div', 'dh-row');
  head.style.minHeight = '0';
  const who = el('div');
  who.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:0';
  const b = el('b', '', name);
  b.style.cssText = 'font-family:var(--font-display);overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  who.append(portrait(character, 32), b);
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.style.cssText = 'width:36px;height:36px';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', closeVolumePopover);
  head.append(who, x);
  const row = el('div');
  row.style.cssText = 'display:flex;gap:10px;align-items:center';
  const slider = el('input', 'dh-range');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(value * 100));
  slider.id = 'volume-slider';
  slider.setAttribute('aria-label', `${name}'s volume`);
  slider.addEventListener('input', () => onChange(Number(slider.value) / 100));
  row.append(icon('volume-1', { width: 18 }), slider, icon('volume-2', { width: 18 }));
  pop.append(head, row);
  if (extra) {
    const b = el('button', 'dh-btn dh-btn--danger', extra.label);
    b.type = 'button';
    b.id = extra.id;
    b.addEventListener('click', () => {
      closeVolumePopover();
      extra.onClick();
    });
    pop.append(b);
  }
  overlay().appendChild(pop);
  // Close on the next tap outside the card (after this tap has finished).
  setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);
}

function outside(e: PointerEvent) {
  if (pop && !pop.contains(e.target as Node)) closeVolumePopover();
}

export function closeVolumePopover() {
  window.removeEventListener('pointerdown', outside, true);
  pop?.remove();
  pop = null;
}

export const volumePopoverOpen = () => !!pop;
