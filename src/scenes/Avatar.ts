import Phaser from 'phaser';
import { animKey, type Dir } from '../characters';

const PANEL = 0x2b2034;
const EDGE = 0x0d0912;
const CREAM = '#fff4e0';
const LAMP = '#f4b860';
const MUTED = '#bcaccb';
const OK = 0x6fdc8c;
const TAG_GAP = 32; // tag sits just above the head (feet - 32)

// A character sprite with a name tag and a speaking ring (design/game/mvp.html .dh-tag / .dh-ring).
// Position is the character's feet.
export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  private tag: Phaser.GameObjects.Container;
  private tagText: Phaser.GameObjects.Text;
  private tagBg: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Ellipse;
  private pulse: Phaser.Time.TimerEvent;
  private character: number;
  private tagWanted = true;
  private isSpeaking = false;
  private name: string;
  private guest = false;
  private host: string | null = null;
  private bubble: Phaser.GameObjects.Container | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  facing: Dir = 'down';

  constructor(scene: Phaser.Scene, x: number, y: number, character: number, name: string, isMe = false) {
    this.character = character;
    this.name = name;
    this.sprite = scene.add.sprite(x, y, 'chibis_a').setOrigin(0.5, 1);

    // Floor ring while talking: a soft green oval that steps bigger and back (or sits still).
    this.ring = scene.add.ellipse(x, y - 1, 18, 7, OK, 0.35).setStrokeStyle(1, OK, 1).setVisible(false);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let big = false;
    this.pulse = scene.time.addEvent({
      delay: 300,
      loop: true,
      paused: true,
      callback: () => {
        big = !big && !reduce;
        this.ring.setScale(big ? 1.25 : 1).setAlpha(big ? 0.7 : 1);
      },
    });

    this.tagText = scene.add
      .text(0, 0, name, { fontFamily: '"Pixelify Sans", monospace', fontSize: '6px', color: isMe ? LAMP : CREAM })
      .setOrigin(0.5, 1)
      .setResolution(8);
    this.tagBg = scene.add.graphics();
    this.tag = scene.add.container(x, y - TAG_GAP, [this.tagBg, this.tagText]).setDepth(100000);
    this.drawTagBg();
    this.animate(false);
  }

  private drawTagBg() {
    const w = Math.ceil(this.tagText.width) + 6;
    const h = Math.ceil(this.tagText.height) + 2;
    this.tagBg.clear();
    this.tagBg.fillStyle(EDGE, 1).fillRect(-w / 2 - 1, -h - 1, w + 2, h + 2);
    this.tagBg.fillStyle(PANEL, 0.92).fillRect(-w / 2, -h, w, h);
    this.tagText.setPosition(0, -1);
  }

  setCharacter(index: number) {
    this.character = index;
    this.animate(this.sprite.anims.currentAnim?.key.includes('-walk-') ?? false);
  }

  setName(name: string) {
    this.name = name;
    this.tagText.setText(!this.guest ? name : this.host ? `${name} · friend of ${this.host}` : `${name} · guest`);
    this.drawTagBg();
  }

  // Guests (no account) get a muted tag saying whose friend they are ("Sam · friend of Diesel").
  setHost(host: string | null) {
    if (host === this.host) return;
    this.host = host;
    this.setName(this.name);
  }

  setGuest(on: boolean) {
    if (on === this.guest) return;
    this.guest = on;
    if (on) this.tagText.setColor(MUTED);
    this.setName(this.name);
  }

  setTagVisible(v: boolean) {
    this.tagWanted = v;
    this.tag.setVisible(v && this.sprite.visible);
  }

  setPosition(x: number, y: number) {
    this.sprite.setPosition(x, y);
    this.sync();
  }

  // A short chat message shown over their head for a few seconds (design/game/mvp.html .dh-bubble).
  say(text: string) {
    const scene = this.sprite.scene;
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    const t = scene.add
      .text(0, 0, text, { fontFamily: '"Atkinson Hyperlegible", sans-serif', fontSize: '6px', color: '#0d0912', wordWrap: { width: 66 }, lineSpacing: 0 })
      .setOrigin(0.5, 1)
      .setResolution(8);
    const w = Math.ceil(t.width) + 8;
    const h = Math.ceil(t.height) + 4;
    const bg = scene.add.graphics();
    bg.fillStyle(EDGE, 1).fillRect(-w / 2 - 1, -h - 1, w + 2, h + 2);
    bg.fillStyle(0xfff4e0, 1).fillRect(-w / 2, -h, w, h);
    t.setPosition(0, -2);
    this.bubble = scene.add.container(this.sprite.x, this.sprite.y - TAG_GAP - 12, [bg, t]).setDepth(100001);
    this.bubbleTimer = scene.time.delayedCall(4000, () => {
      this.bubble?.destroy();
      this.bubble = null;
    });
  }

  // Keeps depth sorting, the ring and the name tag in step with the sprite.
  sync() {
    this.sprite.setDepth(this.sprite.y);
    this.ring.setPosition(this.sprite.x, this.sprite.y - 1).setDepth(this.sprite.y - 0.5);
    this.tag.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - TAG_GAP));
    this.bubble?.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - TAG_GAP - 12));
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
    this.pulse.paused = !this.isSpeaking;
  }

  get speaking() {
    return this.isSpeaking;
  }

  destroy() {
    this.pulse.remove();
    this.sprite.destroy();
    this.tag.destroy();
    this.ring.destroy();
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
  }
}
