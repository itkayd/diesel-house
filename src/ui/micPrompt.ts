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
    card.style.cssText = `position:absolute;left:50%;bottom:calc(120px + env(safe-area-inset-bottom));transform:translateX(-50%);
      width:min(340px,calc(100% - 32px));box-sizing:border-box;padding:16px;border-radius:12px;pointer-events:auto;
      background:rgba(20,15,28,.94);border:2px solid rgba(255,255,255,.2);font:14px/1.4 system-ui,sans-serif;text-align:center`;
    const title = document.createElement('div');
    title.id = 'mic-prompt-title';
    title.textContent = 'Diesel House needs your mic to talk in rooms';
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:6px';
    const body = document.createElement('div');
    body.textContent = 'Your voice only goes to people in the same room. You can mute any time.';
    body.style.cssText = 'opacity:.8;margin-bottom:14px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center';
    const button = (text: string, primary: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = `min-height:44px;padding:0 16px;border-radius:8px;border:0;font:600 15px system-ui,sans-serif;cursor:pointer;
        background:${primary ? '#f4b860' : 'rgba(255,255,255,.12)'};color:${primary ? '#140f1c' : '#fff'}`;
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
