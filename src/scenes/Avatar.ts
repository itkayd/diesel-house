import Phaser from 'phaser';
import { animKey, type Dir } from '../characters';

// A character sprite with a name tag. Position is the character's feet.
export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  private tag: Phaser.GameObjects.Text;
  private character: number;
  facing: Dir = 'down';

  constructor(scene: Phaser.Scene, x: number, y: number, character: number, name: string) {
    this.character = character;
    this.sprite = scene.add.sprite(x, y, 'chibis_a').setOrigin(0.5, 1);
    this.tag = scene.add
      .text(x, y - 33, name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '8px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setDepth(100000);
    this.animate(false);
  }

  setCharacter(index: number) {
    this.character = index;
    this.animate(this.sprite.anims.currentAnim?.key.includes('-walk-') ?? false);
  }

  setName(name: string) {
    this.tag.setText(name);
  }

  setPosition(x: number, y: number) {
    this.sprite.setPosition(x, y);
    this.sync();
  }

  // Keeps depth sorting and the name tag in step with the sprite.
  sync() {
    this.sprite.setDepth(this.sprite.y);
    this.tag.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - 33));
  }

  animate(moving: boolean, dir: Dir = this.facing) {
    this.facing = dir;
    this.sprite.play(animKey(this.character, moving ? 'walk' : 'idle', dir), true);
  }

  setVisible(v: boolean) {
    this.sprite.setVisible(v);
    this.tag.setVisible(v);
  }

  destroy() {
    this.sprite.destroy();
    this.tag.destroy();
  }
}
