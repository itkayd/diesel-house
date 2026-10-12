import { overlay } from './overlay';

const SIZE = 120; // base diameter, px
const KNOB = 52;
const MAX = (SIZE - KNOB) / 2; // how far the knob can travel from the centre
const DEADZONE = 0.15;

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// On-screen joystick for phones. `vector` is -1..1 on each axis; length is how far it's pushed.
export class Joystick {
  readonly vector = { x: 0, y: 0 };
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;

  constructor() {
    this.base = document.createElement('div');
    this.base.style.cssText = `position:absolute;left:calc(24px + env(safe-area-inset-left));bottom:calc(24px + env(safe-area-inset-bottom));
      width:${SIZE}px;height:${SIZE}px;border-radius:50%;background:rgba(20,20,30,.35);border:2px solid rgba(255,255,255,.6);
      pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none`;
    this.knob = document.createElement('div');
    this.knob.style.cssText = `position:absolute;left:${(SIZE - KNOB) / 2 - 2}px;top:${(SIZE - KNOB) / 2 - 2}px;width:${KNOB}px;height:${KNOB}px;
      border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none`;
    this.base.appendChild(this.knob);
    overlay().appendChild(this.base);

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
    const active = len / MAX >= DEADZONE;
    this.vector.x = active ? dx / MAX : 0;
    this.vector.y = active ? dy / MAX : 0;
  }
}
