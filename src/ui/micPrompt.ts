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
