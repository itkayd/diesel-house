import { hudBottomLeft } from './overlay';

const MAX = 36; // px the knob can travel from the centre
const DEADZONE = 6; // px

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// On-screen joystick for phones (an octagon, the pixel version of a circle). `vector` is -1..1 on each
// axis; its length is how far it's pushed.
export class Joystick {
  readonly vector = { x: 0, y: 0 };
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;

  constructor() {
    this.base = document.createElement('div');
    this.base.className = 'dh-joy';
    this.base.id = 'joystick';
    this.base.setAttribute('aria-hidden', 'true'); // touch-only control; keyboard players use WASD/arrows
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.base.appendChild(this.knob);
    hudBottomLeft().appendChild(this.base);

    this.base.addEventListener('pointerdown', (e) => {
      this.pointerId = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      this.move(e);
    });
    this.base.addEventListener('pointermove', (e) => e.pointerId === this.pointerId && this.move(e));
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.vector.x = this.vector.y = 0;
      this.knob.style.transform = '';
    };
    this.base.addEventListener('pointerup', release);
    this.base.addEventListener('pointercancel', release);
  }

  private move(e: PointerEvent) {
    const r = this.base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > MAX) {
      dx = (dx / len) * MAX;
      dy = (dy / len) * MAX;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const active = len > DEADZONE;
    this.vector.x = active ? dx / MAX : 0;
    this.vector.y = active ? dy / MAX : 0;
  }
}
