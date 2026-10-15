import Phaser from 'phaser';
import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './ui/theme.css';
import { authoriseRealtime, currentSession, isMember, NOT_ON_LIST, signOut, waitForSession } from './net/auth';
import { setUser } from './net/profile';
import { devGuest } from './net/mode';
import { supabase } from './net/supabase';
import { hideLogin, showLogin } from './ui/login';
import { PreloadScene } from './scenes/PreloadScene';
import { HouseScene } from './scenes/HouseScene';

export const NIGHT = '#140f1c';

// Phaser draws text onto canvases, so the pixel font must be loaded before any text is created.
async function fontsReady() {
  await Promise.race([
    Promise.all(['500 16px "Pixelify Sans"', '700 16px "Pixelify Sans"', '16px "Atkinson Hyperlegible"'].map((f) => document.fonts.load(f))),
    new Promise((r) => setTimeout(r, 3000)), // don't hang if a font fails
  ]);
}

// The front door: sign in with a magic link, and only guest-list members get in.
async function signIn() {
  if (!supabase || devGuest) return; // no .env, or dev guest mode for automated tests (dev only)
  let session = await currentSession();
  for (;;) {
    if (!session) {
      showLogin();
      session = await waitForSession();
    }
    if (await isMember()) break;
    await signOut();
    session = null;
    showLogin(NOT_ON_LIST);
  }
  hideLogin();
  setUser({ id: session.user.id, email: session.user.email ?? '' });
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
