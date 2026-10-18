import Phaser from 'phaser';
import { PreloadScene } from './scenes/PreloadScene';
import { HouseScene } from './scenes/HouseScene';
import { reportError } from './net/errors';

// The game itself (Phaser and the house). main.ts starts downloading this file straight away but only
// runs it after you're signed in, so the login screen doesn't wait for Phaser (about 1.2 MB).

const NIGHT = '#140f1c';

// Phaser only asks for the next frame after the current one finishes, so a single error in any frame
// (a bad network message, a tween on a destroyed sprite…) used to freeze the whole game until a reload.
// Skip that frame instead, and log (and report) each different error once. (BUGS.md #1)
const frameErrors = new Set<string>();
function keepLooping(game: Phaser.Game) {
  const step = game.step;
  game.step = function (time: number, delta: number) {
    try {
      step.call(this, time, delta);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (frameErrors.size < 50 && !frameErrors.has(msg)) {
        frameErrors.add(msg);
        console.error('Frame skipped after an error:', e);
        reportError(`Frame skipped: ${msg}`, e instanceof Error ? e.stack : undefined);
      }
    }
  };
}

export function startGame() {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: NIGHT,
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [PreloadScene, HouseScene],
    callbacks: { postBoot: keepLooping },
  });
}
