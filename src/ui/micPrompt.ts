import { unlockAudio } from '../net/audio';
import { overlay } from './overlay';

const OK_KEY = 'diesel-house.mic-ok';
let declinedThisVisit = false;

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

// Explains why we want the mic before the browser's own prompt appears. Resolves true to go ahead,
// false to just listen. `cancelled` resolves when the player walks out before answering.
export async function askForMic(cancelled: Promise<void>): Promise<boolean> {
  if (await micAlreadyAllowed()) return true;
  if (declinedThisVisit) return false;

  return new Promise((resolve) => {
    const card = document.createElement('div');
    card.id = 'mic-prompt';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-labelledby', 'mic-prompt-title');
    card.className = 'dh-card dh-popover';
    card.style.cssText = 'bottom:calc(120px + env(safe-area-inset-bottom));display:grid;gap:10px;text-align:center';
    const title = document.createElement('div');
    title.id = 'mic-prompt-title';
    title.textContent = 'Diesel House needs your mic to talk in rooms';
    title.className = 'dh-title';
    title.style.fontSize = '18px';
    const body = document.createElement('div');
    body.textContent = 'Your voice only goes to people in the same room. You can mute any time.';
    body.className = 'dh-muted';
    body.style.fontSize = '14px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;justify-content:center;margin-top:4px';
    const button = (text: string, primary: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.className = primary ? 'dh-btn primary' : 'dh-btn';
      return b;
    };
    const yes = button('Turn on mic', true);
    yes.id = 'mic-prompt-yes';
    const no = button('Just listen', false);
    no.id = 'mic-prompt-no';
    row.append(no, yes);
    card.append(title, body, row);
    overlay().appendChild(card);

    const done = (ok: boolean) => {
      card.remove();
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
    void cancelled.then(() => card.isConnected && done(false));
  });
}
