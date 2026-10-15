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
  banner.style.cssText = `position:absolute;left:50%;top:calc(max(12px,env(safe-area-inset-top)) + 64px);transform:translateX(-50%);
    display:flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border-radius:999px;border:2px solid #f4b860;background:rgba(20,15,28,.94);color:#fff;
    font:600 15px system-ui,sans-serif;pointer-events:auto;cursor:pointer`;
  banner.addEventListener('click', () => unlockAudio());
  overlay().appendChild(banner);
}

export function hideSoundBanner() {
  banner?.remove();
  banner = null;
}

whenAudioUnlocked(hideSoundBanner);
