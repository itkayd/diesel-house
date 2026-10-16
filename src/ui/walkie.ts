import { icon } from './icons';
import { hudBottomRight } from './overlay';

// The walkie-talkie button (hallway only; UPDATE.md Phase 10, design/game/v2.html): hold it, or hold the
// walkie key (T by default), to talk to the whole hallway. A small LED shows the channel: green while
// you're on air, red while someone else is (the button then says "Channel busy"). Big enough for a thumb
// (64 px), and it only follows its own finger, so the joystick keeps working at the same time.
// Plus the strip at the top while someone's on air: [radio] Sami.

export type WalkieView = 'idle' | 'talking' | 'busy';
type Callbacks = { press: () => void; release: () => void; key: () => string };

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable]');

export class WalkieButton {
  readonly el: HTMLButtonElement;
  private led: HTMLSpanElement;
  private label: HTMLSpanElement;
  private strip: HTMLDivElement;
  private finger: number | null = null;
  private keyDown = false;
  private view: WalkieView = 'idle';
  private left = 0;

  constructor(private cb: Callbacks) {
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.id = 'walkie-button';
    this.el.className = 'dh-walkie';
    this.el.hidden = true;
    this.led = document.createElement('span');
    this.led.className = 'led';
    this.label = document.createElement('span');
    this.label.className = 'lab';
    this.el.append(icon('radio'), this.led, this.label);
    hudBottomRight().prepend(this.el);

    this.el.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        if (this.finger !== null) return;
        this.finger = e.pointerId;
        this.el.setPointerCapture(e.pointerId);
        this.cb.press();
      },
      { passive: false },
    );
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.finger) return;
      this.finger = null;
      this.cb.release();
    };
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
    this.el.addEventListener('lostpointercapture', up);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if (this.el.hidden || e.repeat || isTyping(e.target) || e.key.toLowerCase() !== this.cb.key()) return;
      e.preventDefault();
      this.keyDown = true;
      this.cb.press();
    });
    addEventListener('keyup', (e) => {
      if (!this.keyDown || e.key.toLowerCase() !== this.cb.key()) return;
      this.keyDown = false;
      this.cb.release();
    });
    // Never left on air: let go when the app is switched or the phone sleeps.
    const letGo = () => {
      if (this.finger === null && !this.keyDown) return;
      this.finger = null;
      this.keyDown = false;
      this.cb.release();
    };
    addEventListener('blur', letGo);
    addEventListener('pagehide', letGo);
    document.addEventListener('visibilitychange', () => document.hidden && letGo());

    this.strip = document.createElement('div');
    this.strip.id = 'walkie-strip';
    this.strip.className = 'dh-pill dh-walkie-strip';
    this.strip.hidden = true;
    document.getElementById('toasts')?.prepend(this.strip);
    this.render();
  }

  setVisible(on: boolean) {
    this.el.hidden = !on;
  }

  // Who's on air (name), and how our button looks.
  show(view: WalkieView, talker: string | null, secondsLeft = 0) {
    if (view === this.view && secondsLeft === this.left && this.strip.dataset.who === (talker ?? '')) return;
    this.view = view;
    this.left = secondsLeft;
    this.strip.dataset.who = talker ?? '';
    this.render();
    this.strip.hidden = !talker;
    if (talker) this.strip.replaceChildren(icon('radio'), document.createTextNode(talker));
  }

  private render() {
    this.el.dataset.state = this.view;
    this.led.dataset.state = this.view;
    const key = this.cb.key().toUpperCase();
    this.label.textContent = this.view === 'busy' ? 'Channel busy' : this.view === 'talking' ? `On air ${this.left}s` : `Hold · ${key}`;
    this.el.setAttribute('aria-label', this.view === 'busy' ? 'Channel busy' : this.view === 'talking' ? 'On air: let go to stop' : `Walkie-talkie: hold to talk to the hallway (or hold ${key})`);
    this.el.title = this.el.getAttribute('aria-label')!;
  }
}
