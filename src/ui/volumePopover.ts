import { createElement, Volume1, Volume2, VolumeX } from 'lucide';
import { overlay } from './overlay';

let pop: HTMLDivElement | null = null;

// Small card with a volume slider for one person. Tap the character again, or anywhere else, to close.
export function showVolumePopover(name: string, value: number, onChange: (v: number) => void) {
  closeVolumePopover();
  pop = document.createElement('div');
  pop.id = 'volume-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Volume for ${name}`);
  pop.className = 'dh-card dh-popover';
  pop.style.top = 'calc(max(12px, env(safe-area-inset-top)) + 60px)';
  const title = document.createElement('div');
  title.textContent = name;
  title.className = 'dh-title';
  title.style.cssText = 'font-size:17px;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px';
  const icon = document.createElement('span');
  icon.style.cssText = 'display:flex;flex:none';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(value * 100));
  slider.id = 'volume-slider';
  slider.setAttribute('aria-label', `Volume for ${name}`);
  slider.className = 'dh-range';
  slider.style.flex = '1';
  const pct = document.createElement('span');
  pct.style.cssText = 'width:40px;text-align:right;font-variant-numeric:tabular-nums';
  const render = () => {
    const v = Number(slider.value);
    pct.textContent = `${v}%`;
    icon.replaceChildren(createElement(v === 0 ? VolumeX : v < 50 ? Volume1 : Volume2, { width: 20, height: 20 }));
  };
  slider.addEventListener('input', () => {
    render();
    onChange(Number(slider.value) / 100);
  });
  render();
  row.append(icon, slider, pct);
  pop.append(title, row);
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
