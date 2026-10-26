import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './ui/theme.css';
import './ui/skin.css';
import { authoriseRealtime, currentSession, hasAccess, NOT_A_MEMBER, signOut, VISIT_OVER } from './net/auth';
import { setUser } from './net/profile';
import { devTest } from './net/mode';
import { supabase } from './net/supabase';
import { hideLogin, loginDone, showLogin } from './ui/login';
import { installUpdateReload, reloadForUpdate } from './ui/update';
import { installNoSelect, installNoZoom } from './ui/noZoom';
import { applyTextSize } from './ui/textSize';
import { errorReportsReady, installErrorReports } from './net/errors';

installErrorReports();
installUpdateReload();
installNoZoom();
applyTextSize(); // Settings → More → Text size, before anything is drawn
installNoSelect();

// The game (Phaser and the house, the biggest download). Signed in already: straight away. On the login
// screen: once the screen is drawn and the phone has a quiet moment, so the login appears (and answers
// taps) quickly on a slow phone, and the game is usually ready by the time you've typed your password.
let game: Promise<typeof import('./game')> | null = null;
function loadGame() {
  if (!game) {
    game = import('./game');
    game.catch(() => {}); // (handled below, once it's needed)
  }
  return game;
}
const whenIdle = (f: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 2500 }) : setTimeout(f, 1200);

// Phaser draws text onto canvases, so the pixel font must be loaded before any text is created.
async function fontsReady() {
  await Promise.race([
    Promise.all(['500 16px "Pixelify Sans"', '700 16px "Pixelify Sans"', '16px "Atkinson Hyperlegible"'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 3000)), // don't hang if a font fails
  ]);
}

// Ask the house whether we're still allowed in, trying again (with a note on screen) while it can't be
// reached, so a bad connection never signs anyone out.
async function accessWithRetry(guest: boolean) {
  let note: HTMLElement | null = null;
  for (let wait = 1000; ; wait = Math.min(wait * 2, 8000)) {
    const ok = await hasAccess(guest);
    if (ok !== null) {
      note?.remove();
      return ok;
    }
    if (!note) {
      note = document.createElement('div');
      note.id = 'boot-retry';
      note.className = 'dh-boot-note';
      note.setAttribute('role', 'status');
      note.textContent = 'Can’t reach the house. Check your connection — trying again…';
      document.body.append(note);
    }
    await new Promise((r) => setTimeout(r, wait));
  }
}

// The front door: members (name + password), new members (invite code) or guests (no account).
async function signIn() {
  if (!supabase || devTest) return; // no .env, or dev guest mode for automated tests (dev only)
  let session = await currentSession();
  if (session) loadGame();
  for (;;) {
    if (!session) {
      showLogin();
      requestAnimationFrame(() => whenIdle(loadGame));
      await loginDone();
      session = await currentSession();
      if (!session) continue;
    }
    const ok = await accessWithRetry(!!session.user.is_anonymous);
    if (ok) break;
    await signOut(); // a guest whose visit ran out, or an account removed from the house
    showLogin(session.user.is_anonymous ? VISIT_OVER : NOT_A_MEMBER);
    session = null;
  }
  hideLogin();
  setUser({
    id: session.user.id,
    email: session.user.email ?? '',
    guest: !!session.user.is_anonymous,
    joinedAt: session.user.created_at,
    signedInAt: session.user.last_sign_in_at,
  });
  await authoriseRealtime();
  errorReportsReady();
}

void fontsReady()
  .then(signIn)
  .then(async () => {
    let g: typeof import('./game');
    try {
      g = await loadGame();
    } catch (e) {
      // Usually an old copy of the page after an update (its files are gone): load the new one.
      console.warn('Could not load the game', e);
      reloadForUpdate();
      return;
    }
    g.startGame();
  });
