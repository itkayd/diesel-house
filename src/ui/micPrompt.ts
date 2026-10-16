import { unlockAudio } from '../net/audio';
import { icon } from './icons';
import { el, openModal } from './modal';

const OK_KEY = 'diesel-house.mic-ok';
let declinedThisVisit = false;

// Tapping a blocked mic button asks again.
export const resetMicDecline = () => (declinedThisVisit = false);

// True if the browser will hand over the mic without asking (already allowed, or allowed here before).
async function micAlreadyAllowed() {
  try {
    if (localStorage.getItem(OK_KEY) === '1') return true;
  } catch {
    // private browsing: fall through to the permissions check
  }
  try {
    const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return p.state === 'granted';
  } catch {
    return false; // older Safari has no permissions query
  }
}

// The mic didn't work: say why, how to fix it on this phone, and offer to try again. Resolves true for
// "Try again".
export type MicProblem = 'denied' | 'busy' | 'none' | 'unsupported';
export function showMicHelp(problem: MicProblem): Promise<boolean> {
  const ua = navigator.userAgent;
  const inApp = /; wv\)|FBAN|FBAV|Instagram|Snapchat|Line\/|WhatsApp|TikTok/i.test(ua);
  const iphone = /iPhone|iPad|iPod/.test(ua);
  const steps: Record<MicProblem, string[]> = {
    denied: inApp
      ? ["This is an app's built-in browser, which can't use the mic.", `Open ${location.host} in ${iphone ? 'Safari' : 'Chrome'} instead.`]
      : iphone
        ? ['Tap aA (or the page icon) next to the web address.', 'Website Settings → Microphone → Allow.', 'Then tap Try again.']
        : ['Tap the icon to the left of the web address.', 'Permissions (or Site settings) → Microphone → Allow.', 'Then tap Try again.'],
    busy: ['Another app is using your microphone: a phone or WhatsApp call, a voice note, or another browser tab.', 'Close it, then tap Try again.'],
    none: ['No microphone was found on this device.', 'Plug one in or connect your headphones, then tap Try again.'],
    unsupported: inApp
      ? ["This is an app's built-in browser, which can't use the mic.", `Open ${location.host} in ${iphone ? 'Safari' : 'Chrome'} instead.`]
      : [`This browser can't use the mic here. Open ${location.host} in ${iphone ? 'Safari' : 'Chrome'}.`],
  };
  const titles: Record<MicProblem, string> = {
    denied: 'Your mic is blocked',
    busy: 'Your mic is busy',
    none: 'No mic found',
    unsupported: "This browser can't use the mic",
  };
  return new Promise((resolve) => {
    const { panel, close } = openModal('mic-help', { dismissable: true, onDismiss: () => resolve(false), label: 'mic-help-title' });
    const title = el('h2', '', titles[problem]);
    title.id = 'mic-help-title';
    const list = el('ol');
    list.style.cssText = 'margin:0;padding-left:20px;display:grid;gap:6px';
    for (const s of steps[problem]) list.append(el('li', 'dh-lede', s));
    const again = el('button', 'dh-btn');
    again.type = 'button';
    again.id = 'mic-help-retry';
    again.append(icon('mic'), 'Try again');
    const listen = el('button', 'dh-btn dh-btn--quiet');
    listen.type = 'button';
    listen.id = 'mic-help-listen';
    listen.append(icon('headphones'), 'Keep listening');
    const buttons = el('div');
    buttons.style.cssText = 'display:grid;gap:10px';
    buttons.append(again, listen);
    panel.append(title, el('p', 'dh-lede', 'People in the room can hear each other, but not you yet.'), list, buttons);
    again.addEventListener('click', () => {
      close();
      resolve(true);
    });
    listen.addEventListener('click', () => {
      close();
      resolve(false);
    });
  });
}

// "Your mic, your call" (design/game/mvp.html `showMicCard`), before the browser's own prompt.
// Resolves true to go ahead, false to just listen. `cancelled` resolves if you walk out first.
export async function askForMic(cancelled: Promise<void>): Promise<boolean> {
  if (await micAlreadyAllowed()) return true;
  if (declinedThisVisit) return false;

  return new Promise((resolve) => {
    const { panel, scrim } = openModal('mic-prompt', { label: 'mic-prompt-title' });
    const title = el('h2', '', 'Your mic, your call');
    title.id = 'mic-prompt-title';
    const body = el(
      'p',
      'dh-lede',
      'Diesel House needs your microphone so people in this room can hear you. You can mute any time, and nothing is recorded.',
    );
    const buttons = el('div');
    buttons.style.cssText = 'display:grid;gap:10px';
    const yes = el('button', 'dh-btn');
    yes.type = 'button';
    yes.id = 'mic-prompt-yes';
    yes.append(icon('mic'), 'Turn on mic');
    const no = el('button', 'dh-btn dh-btn--quiet');
    no.type = 'button';
    no.id = 'mic-prompt-no';
    no.append(icon('headphones'), 'Just listen');
    buttons.append(yes, no);
    panel.append(title, body, buttons);

    const done = (ok: boolean) => {
      scrim.remove();
      resolve(ok);
    };
    yes.addEventListener('click', () => {
      unlockAudio(); // this tap also counts for sound on iPhone
      try {
        localStorage.setItem(OK_KEY, '1');
      } catch {
        // not remembered in private browsing
      }
      done(true);
    });
    no.addEventListener('click', () => {
      unlockAudio();
      declinedThisVisit = true;
      done(false);
    });
    void cancelled.then(() => scrim.isConnected && done(false));
  });
}
