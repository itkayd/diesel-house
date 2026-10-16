import Phaser from 'phaser';
import { animKey, type Dir } from '../characters';
import type { NetQuality } from '../net/netQuality';
import { makeTagIcons, micKey, netKey, type MicIcon } from './tagIcons';

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
  private micImg: Phaser.GameObjects.Image;
  private netImg: Phaser.GameObjects.Image;
  mic: MicIcon | null = null; // shown on the tag (read by automated checks)
  net: NetQuality | null = null;
  private note: string | null = null; // e.g. "mic off", when others can't hear them
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
    makeTagIcons(scene);
    this.micImg = scene.add.image(0, 0, micKey('on')).setOrigin(0, 1).setVisible(false);
    this.netImg = scene.add.image(0, 0, netKey('super')).setOrigin(0, 1).setVisible(false);
    this.tag = scene.add.container(x, y - TAG_GAP, [this.tagBg, this.tagText, this.micImg, this.netImg]).setDepth(100000);
    this.drawTagBg();
    this.animate(false);
  }

  // [name  mic  bars] — icons only when there's something to show.
  private drawTagBg() {
    const text = Math.ceil(this.tagText.width);
    const icons = [this.micImg, this.netImg].filter((i) => i.visible);
    const iconsW = icons.reduce((sum, i) => sum + i.width + 2, 0);
    const w = text + 6 + iconsW;
    const h = Math.max(Math.ceil(this.tagText.height), 8) + 2;
    this.tagBg.clear();
    this.tagBg.fillStyle(EDGE, 1).fillRect(-w / 2 - 1, -h - 1, w + 2, h + 2);
    this.tagBg.fillStyle(PANEL, 0.92).fillRect(-w / 2, -h, w, h);
    const left = -w / 2 + 3;
    this.tagText.setPosition(Math.round(left + text / 2), -1);
    let x = left + text + 2;
    for (const i of icons) {
      i.setPosition(Math.round(x), -2);
      x += i.width + 2;
    }
  }

  // Mic icon: on (green), off/muted (red, crossed), not working (amber, crossed). Null hides it.
  setMic(m: MicIcon | null) {
    if (m === this.mic) return;
    this.mic = m;
    if (m) this.micImg.setTexture(micKey(m));
    this.micImg.setVisible(!!m);
    this.drawTagBg();
  }

  // Connection bars: poor (1 red), strong (2 amber), super strong (3 green). Null hides them.
  setNet(q: NetQuality | null) {
    if (q === this.net) return;
    this.net = q;
    if (q) this.netImg.setTexture(netKey(q));
    this.netImg.setVisible(!!q);
    this.drawTagBg();
  }

  setCharacter(index: number) {
    this.character = index;
    this.animate(this.sprite.anims.currentAnim?.key.includes('-walk-') ?? false);
  }

  setName(name: string) {
    this.name = name;
    const who = !this.guest ? name : this.host ? `${name} · friend of ${this.host}` : `${name} · guest`;
    this.tagText.setText(this.note ? `${who} · ${this.note}` : who);
    this.drawTagBg();
  }

  // Guests (no account) get a muted tag saying whose friend they are ("Sam · friend of Diesel").
  // A short note after the name, like "mic off". Null to clear.
  setNote(note: string | null) {
    if (note === this.note) return;
    this.note = note;
    this.setName(this.name);
  }

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
