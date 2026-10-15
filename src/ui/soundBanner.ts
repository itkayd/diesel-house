import { unlockAudio, whenAudioUnlocked } from '../net/audio';
import { icon } from './icons';
import { hudToasts } from './overlay';

let banner: HTMLButtonElement | null = null;

// "Tap to turn on sound" (top-centre, above toasts): when voice joins while sound is still locked, or a
// voice refused to play (iPhone).
export function showSoundBanner() {
  if (banner) return;
  banner = document.createElement('button');
  banner.type = 'button';
  banner.id = 'sound-banner';
  banner.className = 'dh-banner';
  banner.append(icon('volume-2'), 'Tap to turn on sound');
  banner.addEventListener('click', () => unlockAudio());
  hudToasts().prepend(banner);
}

export function hideSoundBanner() {
  banner?.remove();
  banner = null;
}

whenAudioUnlocked(hideSoundBanner);
