import type { VoiceStatus } from '../net/voice';
import { icon } from './icons';
import { hudBottomRight } from './overlay';
import { keysBlocked, notGameKey } from './modal';

type Callbacks = {
  onMute: (muted: boolean) => void;
  onPushToTalk: (on: boolean) => void;
  onTalking: (talking: boolean) => void;
  onBlockedTap: () => void; // mic is blocked: ask again
};

const PTT_KEY = 'diesel-house.ptt';
const LONG_PRESS = 500; // ms
// What the button shows. The last five are problems: others can't hear you, and tapping helps fix it.
type MicState = 'live' | 'muted' | 'ptt' | 'talking' | 'off' | 'blocked' | 'nomic' | 'busy' | 'silent';
const LABELS: Record<MicState, string> = {
  live: 'Mute',
  muted: 'Unmute',
  ptt: 'Hold to talk',
  talking: 'Talking',
  off: 'Mic off (listening only): tap to turn it on',
  blocked: 'Mic blocked: tap to fix',
  nomic: 'No mic found: tap for help',
  busy: 'Mic busy (another app): tap to fix',
  silent: 'Mic silent: tap to fix',
};
// Always-visible caption under the button.
const CAPTIONS: Record<MicState, string> = {
  live: 'Mic on',
  muted: 'Muted',
  ptt: 'Hold to talk',
  talking: 'Talking',
  off: 'Mic off',
  blocked: 'Mic blocked',
  nomic: 'No mic found',
  busy: 'Mic busy',
  silent: 'Mic silent',
};
const PROBLEMS: MicState[] = ['off', 'blocked', 'nomic', 'busy', 'silent'];

// The big mic button (bottom-right, only inside a room), as in design/game/mvp.html. Its corner square
// shows the voice connection (green ok, amber connecting, red blocked); long-press or hover for detail.
export class VoiceControls {
  private box: HTMLDivElement;
  private micBtn: HTMLButtonElement;
  private detail: HTMLDivElement;
  private conn: 'ok' | 'warn' | 'error' = 'warn';
  private muted = false;
  private ptt = false;
  private talking = false;
  private blocked = false;
  private problem_: MicState | null = null; // set while the mic isn't reaching anyone
  private caption: HTMLDivElement;
  private pressTimer = 0;
  private longPressed = false;

  constructor(private cb: Callbacks) {
    this.box = document.createElement('div');
    this.box.id = 'voice-controls';
    this.box.style.cssText = 'position:relative;display:none';
    this.detail = document.createElement('div');
    this.detail.id = 'voice-status';
    this.detail.className = 'dh-pill dh-voice-detail';
    this.micBtn = document.createElement('button');
    this.micBtn.type = 'button';
    this.micBtn.id = 'mic-button';
    this.micBtn.className = 'dh-mic';
    this.caption = document.createElement('div');
    this.caption.id = 'mic-caption';
    this.caption.className = 'dh-mic-caption';

    this.micBtn.addEventListener('click', () => {
      if (this.longPressed) return; // that press only showed the detail
      if (this.problem_) return this.cb.onBlockedTap();
      if (!this.ptt) this.setMuted(!this.muted);
    });
    let held: number | null = null; // the finger holding push-to-talk (other fingers can use the joystick)
    this.micBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.longPressed = false;
      if (this.ptt && !this.problem_) {
        if (held !== null) return;
        held = e.pointerId;
        this.micBtn.setPointerCapture(e.pointerId);
        this.setTalking(true);
        return;
      }
      this.pressTimer = window.setTimeout(() => {
        this.longPressed = true;
        this.showDetail(true);
      }, LONG_PRESS);
    });
    const release = (e?: PointerEvent) => {
      if (e && held !== null && e.pointerId !== held) return;
      held = null;
      clearTimeout(this.pressTimer);
      if (this.longPressed) setTimeout(() => this.showDetail(false), 1500);
      if (this.ptt) this.setTalking(false);
    };
    this.micBtn.addEventListener('pointerup', release);
    this.micBtn.addEventListener('pointercancel', release);
    this.micBtn.addEventListener('lostpointercapture', release);
    // Never left talking: let go when the app is switched or the phone sleeps.
    addEventListener('blur', () => release());
    addEventListener('pagehide', () => release());
    document.addEventListener('visibilitychange', () => document.hidden && release());
    this.micBtn.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && this.showDetail(true));
    this.micBtn.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && this.showDetail(false));
    this.micBtn.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menu on phones

    this.box.append(this.detail, this.micBtn, this.caption);
    hudBottomRight().appendChild(this.box);

    // Space bar = hold to talk on desktop (only in push-to-talk mode).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.ptt && !e.repeat && !isTyping(e)) {
        e.preventDefault();
        this.setTalking(true);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.ptt && !isTyping(e)) {
        e.preventDefault();
        this.setTalking(false);
      }
    });
    window.addEventListener('blur', () => this.ptt && this.setTalking(false));

    let saved = false;
    try {
      saved = localStorage.getItem(PTT_KEY) === '1';
    } catch {
      // not remembered in private browsing
    }
    this.setPushToTalk(saved);
  }

  // What the caption under the button says ("Mic on", "Mic blocked"…), and whether it's a problem.
  get captionText() {
    return CAPTIONS[this.state];
  }
  get problem() {
    return this.problem_;
  }

  get pushToTalk() {
    return this.ptt;
  }

  get statusText() {
    return this.detail.textContent ?? '';
  }

  private showDetail(on: boolean) {
    this.detail.style.visibility = on ? 'visible' : 'hidden';
  }

  private setMuted(m: boolean) {
    this.muted = m;
    this.cb.onMute(m);
    this.render();
  }

  setPushToTalk(on: boolean) {
    this.ptt = on;
    this.talking = false;
    try {
      localStorage.setItem(PTT_KEY, on ? '1' : '0');
    } catch {
      // not remembered in private browsing
    }
    this.cb.onPushToTalk(on);
    this.cb.onTalking(false);
    this.render();
  }

  private setTalking(t: boolean) {
    if (t === this.talking) return;
    this.talking = t;
    this.cb.onTalking(t);
    this.render();
  }

  private get state(): MicState {
    if (this.problem_) return this.problem_;
    if (this.ptt) return this.talking ? 'talking' : 'ptt';
    return this.muted ? 'muted' : 'live';
  }

  private render() {
    const s = this.state;
    this.micBtn.dataset.state = s;
    const conn = document.createElement('span');
    conn.className = 'dh-conn';
    conn.dataset.s = this.conn;
    this.micBtn.replaceChildren(icon(s === 'live' || s === 'ptt' || s === 'talking' ? 'mic' : 'mic-off'), conn);
    this.micBtn.setAttribute('aria-label', LABELS[s]);
    this.micBtn.title = this.ptt && !this.problem_ ? 'Hold to talk (or hold Space)' : LABELS[s];
    this.caption.textContent = CAPTIONS[s];
    this.caption.dataset.state = s;
    this.caption.dataset.problem = String(PROBLEMS.includes(s));
  }

  show(status: VoiceStatus) {
    this.box.style.display = status.state === 'off' ? 'none' : 'block';
    if (status.state === 'joining') {
      this.detail.textContent = 'Joining voice…';
      this.conn = 'warn';
    } else if (status.state === 'in-room') {
      const others = status.total === 0 ? 'nobody else here' : `${status.connected}/${status.total} connected`;
      this.blocked = status.mic === 'blocked';
      const p = status.problem;
      this.problem_ = status.silent
        ? 'silent'
        : !this.blocked
          ? null
          : p === 'declined' ? 'off' : p === 'none' ? 'nomic' : p === 'busy' ? 'busy' : 'blocked';
      this.detail.textContent = this.problem_ ? `${CAPTIONS[this.problem_]} · listening · ${others}` : `Voice · ${others}`;
      this.conn = this.problem_ ? 'error' : status.connected < status.total ? 'warn' : 'ok';
    }
    this.render();
  }
}

// Space is for the page while typing, in a window, or on a focused button (it presses it).
const isTyping = (e: KeyboardEvent) => notGameKey(e) || keysBlocked() || e.target instanceof HTMLButtonElement;
