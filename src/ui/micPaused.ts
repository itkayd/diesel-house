import { icon } from './icons';
import { el } from './modal';
import { play } from './sounds';

// "Mic paused" chip (bottom-right, above the buttons). After you leave a room the mic is kept for a short
// while, switched off, so walking straight into another room doesn't ask again (iPhone shows its banner
// every time). The phone's orange mic light stays on meanwhile, so this says why, counts down, and a tap
// lets the mic go at once.
export class MicPausedChip {
  private chip = el('button', 'dh-mic-paused');
  private left = el('span', 'left');
  private until = 0;
  private timer = 0;

  constructor(private release: () => void) {
    this.chip.type = 'button';
    this.chip.id = 'mic-paused';
    this.chip.hidden = true;
    this.chip.append(icon('mic-off', { width: 16 }), el('span', 't', 'Mic paused'), this.left, el('span', 'x', 'Turn off'));
    this.chip.addEventListener('click', () => {
      play('click', 0.3);
      this.release();
      this.set(null);
    });
    document.querySelector('#overlay .dh-hud')?.append(this.chip);
  }

  set(until: number | null) {
    clearInterval(this.timer);
    this.until = until ?? 0;
    this.chip.hidden = !until;
    if (!until) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((this.until - Date.now()) / 1000));
      this.left.textContent = `${s}s`;
      this.chip.setAttribute('aria-label', `Mic paused, still held for ${s} seconds. Tap to turn it off now.`);
      if (!s) this.set(null);
    };
    tick();
    this.timer = window.setInterval(tick, 1000);
  }
}
