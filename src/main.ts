import Phaser from 'phaser';
import { PreloadScene } from './scenes/PreloadScene';
import { HouseScene } from './scenes/HouseScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1b24',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [PreloadScene, HouseScene],
});
