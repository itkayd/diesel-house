import { crumb, logIssue } from '../net/errors';
import { hudBottomLeft } from './overlay';

const MAX = 36; // px the knob can travel from the centre
const DEADZONE = 6; // px

const sticks = new Set<Joystick>();

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// On-screen joystick for phones (a faint ring that lights up while held). `vector` is -1..1 on each axis;
// its length is how far it's pushed.
//
// It must never get stuck. Phones sometimes lose the "finger lifted" event (a system swipe, a pop-up, the
// browser taking the touch for a scroll, iPhone Chrome in particular), and a joystick that kept its last
// direction and ignored every new touch was the worst bug in the game. So:
//  - a new touch on the joystick always takes over, whatever happened to the last one;
//  - the end of the touch is caught anywhere on the page (pointer and touch events), not only on the ring;
//  - whenever the browser lists the fingers on the screen and ours isn't among them, it lets go;
//  - with no finger on the screen at all, it lets go within a moment (a safety net);
//  - switching app, locking the phone or the page losing focus lets go.
export class Joystick {
  readonly vector = { x: 0, y: 0 };
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;
  private touchId: number | null = null; // the matching Touch identifier (iPhone)
  private fingers = 0; // touches on the screen right now (from document touch events)
  lastEvent = 0; // when our finger was last heard from (ms)
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.base = document.createElement('div');
    this.base.className = 'dh-joy';
    this.base.id = 'joystick';
    this.base.setAttribute('aria-hidden', 'true'); // touch-only control; keyboard players use WASD/arrows
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.base.appendChild(this.knob);
    hudBottomLeft().appendChild(this.base);

    // A finger (or the mouse, in tests) goes down on the ring: it's ours now, even if an old touch was
    // never released.
    this.base.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        if (this.pointerId !== null && this.pointerId !== e.pointerId) this.release('taken over: the last touch never ended');
        this.pointerId = e.pointerId;
        this.touchId = null; // learnt from the touchstart that follows (pointer events come first)
        try {
          this.base.setPointerCapture(e.pointerId);
        } catch {
          // already gone (a very quick tap): the move/up listeners below still work
        }
        this.base.classList.add('on');
        crumb('joystick down');
        this.startWatchdog();
        this.move(e.clientX, e.clientY);
      },
      { passive: false },
    );
    this.base.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault(); // no scrolling, zoom or long-press menu from the joystick
        const t = e.changedTouches[0];
        if (t) this.touchId = t.identifier;
      },
      { passive: false },
    );
    this.base.addEventListener('contextmenu', (e) => e.preventDefault());

    // Moves and ends, wherever the finger is by then.
    addEventListener('pointermove', (e) => e.pointerId === this.pointerId && this.move(e.clientX, e.clientY), { passive: true });
    const end = (e: PointerEvent) => e.pointerId === this.pointerId && this.release();
    addEventListener('pointerup', end, true);
    addEventListener('pointercancel', end, true);
    this.base.addEventListener('lostpointercapture', end);

    // Touch events as a second opinion (iPhone): our touch ended, or isn't on the screen any more.
    const track = (e: TouchEvent) => {
      this.fingers = e.touches.length;
      if (this.pointerId === null) return;
      const ending = e.type === 'touchend' || e.type === 'touchcancel';
      // Our own finger lifting: a normal release.
      if (ending && (this.touchId === null ? e.touches.length === 0 : [...e.changedTouches].some((t) => t.identifier === this.touchId))) return void this.release();
      if (this.touchId !== null) {
        const ours = [...e.touches].find((t) => t.identifier === this.touchId);
        if (!ours) return void this.release('our touch was gone from the screen');
        this.lastEvent = Date.now();
        if (e.type === 'touchmove') this.move(ours.clientX, ours.clientY);
      } else if (e.touches.length === 0) this.release('no finger on the screen');
    };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) document.addEventListener(type, track, { passive: true, capture: true });

    // Asking for the microphone (walking into a room) can bring up the iPhone's permission sheet, and the
    // touch on the joystick may never hear its end. If the request took long enough to have shown the
    // sheet and nothing was heard from our finger meanwhile, let go (one tap takes it back).
    const md = navigator.mediaDevices;
    if (md?.getUserMedia && !(md.getUserMedia as { dhWrapped?: boolean }).dhWrapped) {
      const real = md.getUserMedia.bind(md);
      const wrapped = async (c?: MediaStreamConstraints) => {
        const asked = Date.now();
        try {
          return await real(c);
        } finally {
          // Only after a slow request (a permission sheet you had to tap): a quick, already-allowed mic
          // must not stop someone holding the joystick steady as they walk into a room.
          if (Date.now() - asked > 700) for (const j of sticks) if (j.active && j.lastEvent < asked) j.release('a mic permission sheet swallowed the touch');
        }
      };
      (wrapped as { dhWrapped?: boolean }).dhWrapped = true;
      md.getUserMedia = wrapped;
    }
    sticks.add(this);

    // Never stay stuck: let go when the app is switched, the phone sleeps or the page goes away.
    addEventListener('blur', () => this.release());
    addEventListener('pagehide', () => this.release());
    document.addEventListener('visibilitychange', () => document.hidden && this.release());
  }

  get active() {
    return this.pointerId !== null;
  }

  // `why`: set when a safety net let go (not a normal lift of the finger): logged for the admin page.
  release(why?: string) {
    if (this.pointerId !== null) {
      crumb('joystick up', why);
      if (why) logIssue('warning', `Joystick let go: ${why}`, { extra: { vector: { ...this.vector } } });
    }
    if (this.pointerId !== null)
      try {
        if (this.base.hasPointerCapture?.(this.pointerId)) this.base.releasePointerCapture(this.pointerId);
      } catch {
        // the browser already dropped it
      }
    this.pointerId = null;
    this.touchId = null;
    this.vector.x = this.vector.y = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('on');
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  // Safety net: held, but no finger on the screen and nothing heard for a moment: let go.
  private startWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.lastEvent = Date.now();
    this.watchdog = setInterval(() => {
      if (this.pointerId === null) return;
      const touchy = navigator.maxTouchPoints > 0;
      if (touchy && this.fingers === 0 && Date.now() - this.lastEvent > 600) this.release('watchdog: held with no finger down');
    }, 300);
  }

  private move(clientX: number, clientY: number) {
    this.lastEvent = Date.now();
    const r = this.base.getBoundingClientRect();
    let dx = clientX - (r.left + r.width / 2);
    let dy = clientY - (r.top + r.height / 2);
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
