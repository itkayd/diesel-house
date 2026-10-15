import { createElement, Volume2 } from 'lucide';
import { unlockAudio, whenAudioUnlocked } from '../net/audio';
import { overlay } from './overlay';

let banner: HTMLButtonElement | null = null;

// "Tap to turn on sound": shown when voice joins while sound is still locked, or a voice refused to play.
export function showSoundBanner() {
  if (banner) return;
  banner = document.createElement('button');
  banner.type = 'button';
  banner.id = 'sound-banner';
  banner.append(createElement(Volume2, { width: 20, height: 20 }), 'Tap to turn on sound');
  banner.className = 'dh-btn primary';
  banner.style.cssText = `position:absolute;left:50%;top:calc(max(12px,env(safe-area-inset-top)) + 60px);transform:translateX(-50%);
    display:flex;align-items:center;gap:8px;white-space:nowrap`;
  banner.addEventListener('click', () => unlockAudio());
  overlay().appendChild(banner);
}

export function hideSoundBanner() {
  banner?.remove();
  banner = null;
}

whenAudioUnlocked(hideSoundBanner);
