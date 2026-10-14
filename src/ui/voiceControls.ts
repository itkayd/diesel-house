import { createElement, Mic, MicOff } from 'lucide';
import type { VoiceStatus } from '../net/voice';
import { overlay } from './overlay';

type Callbacks = {
  onMute: (muted: boolean) => void;
  onPushToTalk: (on: boolean) => void;
  onTalking: (talking: boolean) => void;
};

const PTT_KEY = 'diesel-house.ptt';

// Mic button + push-to-talk switch + status line, bottom-right. Only visible inside a room.
export class VoiceControls {
  private box: HTMLDivElement;
  private micBtn: HTMLButtonElement;
  private pttInput: HTMLInputElement;
  private statusLine: HTMLDivElement;
  private muted = false;
  private ptt = false;
  private talking = false;

  constructor(private cb: Callbacks) {
    this.box = document.createElement('div');
    this.box.id = 'voice-controls';
    this.box.style.cssText = `position:absolute;right:calc(16px + env(safe-area-inset-right));bottom:calc(24px + env(safe-area-inset-bottom));
      display:none;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font:13px system-ui,sans-serif`;

    this.statusLine = document.createElement('div');
    this.statusLine.style.cssText = 'padding:3px 10px;border-radius:999px;background:rgba(0,0,0,.55)';

    this.micBtn = document.createElement('button');
    this.micBtn.type = 'button';
    this.micBtn.id = 'mic-button';
    this.micBtn.style.cssText = `width:68px;height:68px;border-radius:50%;border:2px solid rgba(255,255,255,.6);pointer-events:auto;
      display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none`;
    this.micBtn.addEventListener('click', () => {
      if (!this.ptt) this.setMuted(!this.muted);
    });
    this.micBtn.addEventListener('pointerdown', (e) => {
      if (!this.ptt) return;
      this.micBtn.setPointerCapture(e.pointerId);
      this.setTalking(true);
    });
    const stop = () => this.ptt && this.setTalking(false);
    this.micBtn.addEventListener('pointerup', stop);
    this.micBtn.addEventListener('pointercancel', stop);

    const pttLabel = document.createElement('label');
    pttLabel.style.cssText =
      'display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,.55);pointer-events:auto;cursor:pointer';
    this.pttInput = document.createElement('input');
    this.pttInput.type = 'checkbox';
    this.pttInput.id = 'ptt-toggle';
    this.pttInput.addEventListener('change', () => {
      this.setPushToTalk(this.pttInput.checked);
      this.pttInput.blur(); // so Space talks instead of toggling the box
    });
    pttLabel.append(this.pttInput, 'Push to talk');

    this.box.append(this.statusLine, pttLabel, this.micBtn);
    overlay().appendChild(this.box);

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

  private setMuted(m: boolean) {
    this.muted = m;
    this.cb.onMute(m);
    this.render();
  }

  private setPushToTalk(on: boolean) {
    this.ptt = on;
    this.pttInput.checked = on;
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
    this.micBtn.replaceChildren(createElement(live ? Mic : MicOff, { width: 30, height: 30 }));
    this.micBtn.style.background = live ? 'rgba(46,160,90,.85)' : this.ptt ? 'rgba(40,40,55,.8)' : 'rgba(190,50,50,.85)';
    const label = this.ptt ? (this.talking ? 'Talking' : 'Hold to talk') : this.muted ? 'Unmute' : 'Mute';
    this.micBtn.setAttribute('aria-label', label);
    this.micBtn.title = this.ptt ? 'Hold to talk (or hold Space)' : label;
  }

  show(status: VoiceStatus) {
    this.box.style.display = status.state === 'off' ? 'none' : 'flex';
    if (status.state === 'joining') this.statusLine.textContent = 'Joining voice…';
    else if (status.state === 'in-room') {
      const others = status.total === 0 ? 'nobody else here' : `${status.connected}/${status.total} connected`;
      this.statusLine.textContent = status.mic === 'blocked' ? `🔇 Mic blocked · listening · ${others}` : `Voice · ${others}`;
    }
  }
}

const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
