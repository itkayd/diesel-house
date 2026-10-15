import { createElement, Mic, MicOff } from 'lucide';
import type { VoiceStatus } from '../net/voice';
import { hudBottomRight } from './overlay';

type Callbacks = {
  onMute: (muted: boolean) => void;
  onPushToTalk: (on: boolean) => void;
  onTalking: (talking: boolean) => void;
};

const PTT_KEY = 'diesel-house.ptt';
const LONG_PRESS = 500; // ms

// The big mic button (bottom-right, only inside a room). A dot on it shows voice status: green connected,
// amber connecting, red mic blocked. Long-press (or hover) shows the detail. Push-to-talk lives in settings.
export class VoiceControls {
  private box: HTMLDivElement;
  private micBtn: HTMLButtonElement;
  private dot: HTMLSpanElement;
  private detail: HTMLDivElement;
  private muted = false;
  private ptt = false;
  private talking = false;
  private pressTimer = 0;
  private longPressed = false;

  constructor(private cb: Callbacks) {
    this.box = document.createElement('div');
    this.box.id = 'voice-controls';
    this.box.style.cssText = 'position:relative;display:none';

    this.detail = document.createElement('div');
    this.detail.id = 'voice-status';
    this.detail.className = 'dh-pill';
    this.detail.style.cssText = 'position:absolute;right:0;bottom:calc(100% + 12px);visibility:hidden;font-family:var(--font-body);font-size:13px';

    this.micBtn = document.createElement('button');
    this.micBtn.type = 'button';
    this.micBtn.id = 'mic-button';
    this.micBtn.className = 'dh-icon-btn';
    this.micBtn.style.cssText = 'width:72px;height:72px;touch-action:none;user-select:none;-webkit-user-select:none;position:relative';
    this.dot = document.createElement('span');
    this.dot.className = 'dh-dot';
    this.dot.style.cssText = 'position:absolute;top:7px;right:7px;width:12px;height:12px';

    this.micBtn.addEventListener('click', () => {
      if (this.longPressed) return; // that press only showed the detail
      if (!this.ptt) this.setMuted(!this.muted);
    });
    this.micBtn.addEventListener('pointerdown', (e) => {
      this.longPressed = false;
      if (this.ptt) {
        this.micBtn.setPointerCapture(e.pointerId);
        this.setTalking(true);
        return;
      }
      this.pressTimer = window.setTimeout(() => {
        this.longPressed = true;
        this.showDetail(true);
      }, LONG_PRESS);
    });
    const release = () => {
      clearTimeout(this.pressTimer);
      if (this.longPressed) setTimeout(() => this.showDetail(false), 1500);
      if (this.ptt) this.setTalking(false);
    };
    this.micBtn.addEventListener('pointerup', release);
    this.micBtn.addEventListener('pointercancel', release);
    this.micBtn.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && this.showDetail(true));
    this.micBtn.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && this.showDetail(false));
    this.micBtn.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menu on phones

    this.box.append(this.detail, this.micBtn);
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

  private render() {
    const live = this.ptt ? this.talking : !this.muted;
    this.micBtn.replaceChildren(createElement(live ? Mic : MicOff, { width: 32, height: 32 }), this.dot);
    this.micBtn.style.background = live ? '#2f7d4a' : this.ptt ? 'var(--panel)' : '#8a2f3a';
    const label = this.ptt ? (this.talking ? 'Talking' : 'Hold to talk') : this.muted ? 'Unmute' : 'Mute';
    this.micBtn.setAttribute('aria-label', label);
    this.micBtn.title = this.ptt ? 'Hold to talk (or hold Space)' : label;
  }

  show(status: VoiceStatus) {
    this.box.style.display = status.state === 'off' ? 'none' : 'block';
    if (status.state === 'joining') {
      this.detail.textContent = 'Joining voice…';
      this.dot.className = 'dh-dot warn';
    } else if (status.state === 'in-room') {
      const others = status.total === 0 ? 'nobody else here' : `${status.connected}/${status.total} connected`;
      this.detail.textContent = status.mic === 'blocked' ? `Mic blocked · listening · ${others}` : `Voice · ${others}`;
      this.dot.className = `dh-dot ${status.mic === 'blocked' ? 'bad' : status.connected < status.total ? 'warn' : 'ok'}`;
    }
  }
}

const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
