import Phaser from 'phaser';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './ui/theme.css';
import { authoriseRealtime, currentSession, isGuest, isMember, NOT_A_MEMBER, signOut, VISIT_OVER } from './net/auth';
import { setUser } from './net/profile';
import { devTest } from './net/mode';
import { supabase } from './net/supabase';
import { hideLogin, loginDone, showLogin } from './ui/login';
import { PreloadScene } from './scenes/PreloadScene';
import { HouseScene } from './scenes/HouseScene';
import { installUpdateReload } from './ui/update';

installUpdateReload();

export const NIGHT = '#140f1c';

// Phaser draws text onto canvases, so the pixel font must be loaded before any text is created.
async function fontsReady() {
  await Promise.race([
    Promise.all(['500 16px "Pixelify Sans"', '700 16px "Pixelify Sans"', '16px "Atkinson Hyperlegible"'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 3000)), // don't hang if a font fails
  ]);
}

// The front door: members (name + password), new members (invite code) or guests (no account).
async function signIn() {
  if (!supabase || devTest) return; // no .env, or dev guest mode for automated tests (dev only)
  let session = await currentSession();
  for (;;) {
    if (!session) {
      showLogin();
      await loginDone();
      session = await currentSession();
      if (!session) continue;
    }
    if (session.user.is_anonymous ? await isGuest() : await isMember()) break;
    await signOut(); // a guest whose visit ran out, or an account removed from the house
    showLogin(session.user.is_anonymous ? VISIT_OVER : NOT_A_MEMBER);
    session = null;
  }
  hideLogin();
  setUser({ id: session.user.id, email: session.user.email ?? '', guest: !!session.user.is_anonymous });
  await authoriseRealtime();
}

void fontsReady()
  .then(signIn)
  .then(
    () =>
      new Phaser.Game({
        type: Phaser.AUTO,
        parent: 'game',
        backgroundColor: NIGHT,
        pixelArt: true,
        roundPixels: true,
        scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
        physics: { default: 'arcade', arcade: { debug: false } },
        scene: [PreloadScene, HouseScene],
      }),
  );
