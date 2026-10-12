import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload() {
    // Asset loading is wired up in Phase 1 from assets/manifest.json.
  }

  create() {
    this.scene.start('House');
  }
}
