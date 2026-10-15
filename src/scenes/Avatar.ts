import Phaser from 'phaser';
import { animKey, type Dir } from '../characters';

const PANEL = 0x2b2034;
const EDGE = 0x0d0912;
const CREAM = '#fff4e0';
const OK = 0x6fdc8c;
const TAG_GAP = 33; // px above the feet

// A character sprite with a name tag and a speaking ring. Position is the character's feet.
export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  private tag: Phaser.GameObjects.Container;
  private tagText: Phaser.GameObjects.Text;
  private tagBg: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Ellipse;
  private pulse: Phaser.Tweens.Tween;
  private character: number;
  private tagWanted = true;
  private isSpeaking = false;
  facing: Dir = 'down';

  constructor(scene: Phaser.Scene, x: number, y: number, character: number, name: string) {
    this.character = character;
    this.sprite = scene.add.sprite(x, y, 'chibis_a').setOrigin(0.5, 1);

    // Soft ring at the feet while talking: pulses gently (or sits still if reduced motion is on).
    this.ring = scene.add.ellipse(x, y - 1, 20, 8, OK, 0.25).setStrokeStyle(1.5, OK, 0.95).setVisible(false);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.pulse = scene.tweens.add({
      targets: this.ring,
      scaleX: reduce ? 1 : 1.2,
      scaleY: reduce ? 1 : 1.2,
      alpha: reduce ? 1 : 0.55,
      duration: 450,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      paused: true,
    });

    this.tagText = scene.add
      .text(0, 0, name, { fontFamily: '"Pixelify Sans", monospace', fontSize: '8px', color: CREAM })
      .setOrigin(0.5, 1)
      .setResolution(6);
    this.tagBg = scene.add.graphics();
    this.tag = scene.add.container(x, y - TAG_GAP, [this.tagBg, this.tagText]).setDepth(100000);
    this.drawTagBg();
    this.animate(false);
  }

  private drawTagBg() {
    const w = Math.ceil(this.tagText.width) + 6;
    const h = Math.ceil(this.tagText.height) + 1;
    this.tagBg.clear();
    this.tagBg.fillStyle(EDGE, 1).fillRoundedRect(-w / 2 - 1, -h - 1, w + 2, h + 2, 2.5);
    this.tagBg.fillStyle(PANEL, 0.95).fillRoundedRect(-w / 2, -h, w, h, 2);
    this.tagText.setPosition(0, 0.5);
  }

  setCharacter(index: number) {
    this.character = index;
    this.animate(this.sprite.anims.currentAnim?.key.includes('-walk-') ?? false);
  }

  setName(name: string) {
    this.tagText.setText(name);
    this.drawTagBg();
  }

  setTagVisible(v: boolean) {
    this.tagWanted = v;
    this.tag.setVisible(v && this.sprite.visible);
  }

  setPosition(x: number, y: number) {
    this.sprite.setPosition(x, y);
    this.sync();
  }

  // Keeps depth sorting, the ring and the name tag in step with the sprite.
  sync() {
    this.sprite.setDepth(this.sprite.y);
    this.ring.setPosition(this.sprite.x, this.sprite.y - 1).setDepth(this.sprite.y - 0.5);
    this.tag.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - TAG_GAP));
  }

  animate(moving: boolean, dir: Dir = this.facing) {
    this.facing = dir;
    this.sprite.play(animKey(this.character, moving ? 'walk' : 'idle', dir), true);
  }

  setVisible(v: boolean) {
    this.sprite.setVisible(v);
    this.tag.setVisible(v && this.tagWanted);
    if (!v) this.setSpeaking(false);
  }

  setSpeaking(on: boolean) {
    this.isSpeaking = on && this.sprite.visible;
    this.ring.setVisible(this.isSpeaking);
    if (this.isSpeaking) this.pulse.resume();
    else this.pulse.pause();
  }

  get speaking() {
    return this.isSpeaking;
  }

  destroy() {
    this.pulse.remove();
    this.sprite.destroy();
    this.tag.destroy();
    this.ring.destroy();
  }
}
