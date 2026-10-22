import Phaser from 'phaser';
import { petsOn } from '../net/houseSettings';
import { animKey, asSkin, type Dir, type Skin } from '../characters';
import type { NetQuality } from '../net/netQuality';
import { rankOf } from '../challenges/levels';
import { makeTagIcons, micKey, netKey, type MicIcon } from './tagIcons';
import { DEPTH, depthOf, toWorld } from '../house/projection';
import { isAnimal, type AnimalKey } from '../house/animals';
import { PetSprite } from './animals';

const PANEL = 0x2b2034;
const EDGE = 0x0d0912;
const CREAM = '#fff4e0';
const LAMP = '#f4b860';
const MUTED = '#bcaccb';
const OK = 0x6fdc8c;
// The tag sits just above the head (Ninja Adventure people fill their 16 px frame).
const TAG_GAP = 18;

// A character sprite with a name tag and a speaking ring (design/game/mvp.html .dh-tag / .dh-ring).
// Position is the character's feet.
export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  private tag: Phaser.GameObjects.Container;
  private tagText: Phaser.GameObjects.Text;
  private tagBg: Phaser.GameObjects.Graphics;
  private ring: Phaser.GameObjects.Ellipse;
  private pulse: Phaser.Time.TimerEvent;
  private character: Skin;
  private readonly gap = TAG_GAP;
  private tagWanted = true;
  private isSpeaking = false;
  private name: string;
  private guest = false;
  private host: string | null = null;
  private micImg: Phaser.GameObjects.Image;
  private netImg: Phaser.GameObjects.Image;
  // Phase 14: [Lv] before the name in the rank's colour, and a flame with the day streak after it.
  private lvText: Phaser.GameObjects.Text;
  private stText: Phaser.GameObjects.Text;
  private flameImg: Phaser.GameObjects.Image;
  private lvColour = 0xfff4e0;
  level: number | null = null; // shown on the tag (read by automated checks)
  streak = 0;
  mic: MicIcon | null = null; // shown on the tag (read by automated checks)
  net: NetQuality | null = null;
  private note: string | null = null;
  private radioImg: Phaser.GameObjects.Image | null = null; // on the walkie-talkie
  private whisperImg: Phaser.GameObjects.Image | null = null; // "…" while whispering to us
  private whisperRing: Phaser.GameObjects.Graphics | null = null; // our whisper range (own avatar) // e.g. "mic off", when others can't hear them
  private emoteImg: Phaser.GameObjects.Image | null = null; // an emote popping over their head
  private emoteTimer: Phaser.Time.TimerEvent | null = null;
  emote: string | null = null; // the emote showing (read by automated checks)
  private diceImgs: Phaser.GameObjects.Image[] = []; // a dice roll over their head
  private diceTimer: Phaser.Time.TimerEvent | null = null;
  dice: number[] | null = null; // the roll showing (read by automated checks)
  private crownImg: Phaser.GameObjects.Image | null = null; // won a duel: a crown for 30 s
  private crownTimer: Phaser.Time.TimerEvent | null = null;
  private bubble: Phaser.GameObjects.Container | null = null;
  private bubbleTimer: Phaser.Time.TimerEvent | null = null;
  facing: Dir = 'down';
  private danceTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, character: Skin, name: string, private isMe = false) {
    this.character = asSkin(character);
    this.name = name;
    this.sprite = scene.add.sprite(x, y, 'skins').setOrigin(0.5, 1);

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
    const small = { fontFamily: '"Pixelify Sans", monospace', fontSize: '6px' };
    this.lvText = scene.add.text(0, 0, '', { ...small, color: '#0d0912' }).setOrigin(0, 1).setResolution(8).setVisible(false);
    this.stText = scene.add.text(0, 0, '', { ...small, color: '#ffae6b' }).setOrigin(0, 1).setResolution(8).setVisible(false);
    this.flameImg = scene.add.image(0, 0, 'tag-flame').setOrigin(0, 1).setVisible(false);
    this.tag = scene.add.container(x, y - this.gap, [this.tagBg, this.tagText, this.lvText, this.flameImg, this.stText, this.micImg, this.netImg]).setDepth(DEPTH.tag);
    this.drawTagBg();
    this.animate(false);
  }

  // [name  mic  bars] — icons only when there's something to show.
  // Tapping this tag (your own: opens your profile).
  private tagTap: (() => void) | null = null;
  onTagTap(f: () => void) {
    this.tagTap = f;
    this.tag.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1, 1), Phaser.Geom.Rectangle.Contains);
    this.tag.input!.cursor = 'pointer';
    this.tag.on('pointerdown', () => this.tagTap?.());
    this.drawTagBg();
  }

  private drawTagBg() {
    const text = Math.ceil(this.tagText.width);
    const icons = [this.micImg, this.netImg].filter((i) => i.visible);
    const iconsW = icons.reduce((sum, i) => sum + i.width + 2, 0);
    // Level badge (any number of digits) and streak, when known.
    const lvW = this.lvText.visible ? Math.ceil(this.lvText.width) + 4 : 0;
    const stW = this.stText.visible ? this.flameImg.width + 1 + Math.ceil(this.stText.width) + 2 : 0;
    const w = text + 6 + iconsW + (lvW ? lvW + 2 : 0) + stW;
    const h = Math.max(Math.ceil(this.tagText.height), 8) + 2;
    this.tagBg.clear();
    this.tagBg.fillStyle(EDGE, 1).fillRect(-w / 2 - 1, -h - 1, w + 2, h + 2);
    this.tagBg.fillStyle(PANEL, 0.92).fillRect(-w / 2, -h, w, h);
    if (this.tag?.input) (this.tag.input.hitArea as Phaser.Geom.Rectangle).setTo(-w / 2 - 1, -h - 1, w + 2, h + 2);
    let left = -w / 2 + 3;
    if (lvW) {
      this.tagBg.fillStyle(this.lvColour, 1).fillRect(left - 2, -h + 1, lvW, h - 2);
      this.lvText.setPosition(Math.round(left), -1);
      left += lvW + 2;
    }
    this.tagText.setPosition(Math.round(left + text / 2), -1);
    let x = left + text + 2;
    if (stW) {
      this.flameImg.setPosition(Math.round(x), -2);
      this.stText.setPosition(Math.round(x + this.flameImg.width + 1), -1);
      x += stW;
    }
    for (const i of icons) {
      i.setPosition(Math.round(x), -2);
      x += i.width + 2;
    }
  }

  // Level (in the rank's colour) and day streak on the tag; null level hides both (guests, unknown).
  setProgress(level: number | null, streak = 0) {
    if (level === this.level && streak === this.streak) return;
    this.level = level;
    this.streak = streak;
    this.lvText.setVisible(level !== null).setText(level === null ? '' : String(level));
    if (level !== null) this.lvColour = Number.parseInt(rankOf(level).colour.slice(1), 16);
    const showStreak = level !== null && streak >= 3; // a real streak, not just yesterday and today
    this.stText.setVisible(showStreak).setText(String(streak));
    this.flameImg.setVisible(showStreak);
    this.drawTagBg();
  }

  // Mic icon: on (green), off/muted (red, crossed), not working (amber, crossed). Null hides it.
  setMic(m: MicIcon | null) {
    if (m === this.mic) return;
    this.mic = m;
    if (m) this.micImg.setTexture(micKey(m));
    this.micImg.setVisible(!!m && !this.isMe); // your own mic and connection are on the HUD already
    this.drawTagBg();
  }

  // Connection bars: poor (1 red), strong (2 amber), super strong (3 green). Null hides them, and so does
  // super strong: the tag only mentions a connection worth knowing about.
  setNet(q: NetQuality | null) {
    if (q === this.net) return;
    this.net = q;
    if (q) this.netImg.setTexture(netKey(q));
    this.netImg.setVisible(!!q && q !== 'super' && !this.isMe);
    this.drawTagBg();
  }

  setCharacter(skin: Skin) {
    this.character = asSkin(skin);
    this.animate(this.sprite.anims.currentAnim?.key.includes('-walk-') ?? false);
  }

  setName(name: string) {
    this.name = name;
    const who = !this.guest ? name : this.host ? `${name} · friend of ${this.host}` : `${name} · guest`;
    this.tagText.setText(this.note ? `${who} · ${this.note}` : who);
    this.drawTagBg();
  }

  // Guests (no account) get a muted tag saying whose friend they are ("Sam · friend of Diesel").
  // On the walkie-talkie: a little radio with a green LED above the name tag.
  setRadio(on: boolean) {
    if (on === !!this.radioImg) return;
    if (on) this.radioImg = this.sprite.scene.add.image(0, 0, 'tag-radio').setOrigin(0.5, 1).setDepth(DEPTH.badge);
    else {
      this.radioImg?.destroy();
      this.radioImg = null;
    }
    this.sync();
  }

  // Whispering to us: a "…" bubble over their head (Kenney emote, Pixel Style 1).
  setWhispering(on: boolean) {
    const scene = this.sprite.scene;
    if (on === !!this.whisperImg || (on && !scene.textures.exists('emotes'))) return;
    if (on) this.whisperImg = scene.add.image(0, 0, 'emotes', 'dots3').setOrigin(0.5, 1).setDepth(DEPTH.badge);
    else {
      this.whisperImg?.destroy();
      this.whisperImg = null;
    }
    this.sync();
  }

  // Our own whisper range: a faint dotted circle under us while our whisper mic is open.
  setWhisperRing(radius: number | null) {
    const scene = this.sprite.scene;
    if (!radius) {
      this.whisperRing?.destroy();
      this.whisperRing = null;
      return;
    }
    if (!this.whisperRing) {
      const g = scene.add.graphics();
      const dots = 36;
      for (let i = 0; i < dots; i++) {
        const a = (i / dots) * Math.PI * 2;
        g.fillStyle(0xc99bff, 0.55).fillRect(Math.round(Math.cos(a) * radius) - 1, Math.round(Math.sin(a) * radius * 0.55) - 1, 2, 2);
      }
      this.whisperRing = g;
    }
    this.sync();
  }

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
    this.bubble = scene.add.container(this.sprite.x, this.sprite.y - this.gap - 12, [bg, t]).setDepth(DEPTH.bubble);
    this.bubbleTimer = scene.time.delayedCall(4000, () => {
      this.bubble?.destroy();
      this.bubble = null;
    });
  }

  // An emote (Kenney Emotes frame) pops up over their head for 2.5 s (UPDATE.md Phase 11).
  showEmote(frame: string) {
    const scene = this.sprite.scene;
    if (!scene.textures.exists('emotes')) return;
    this.emoteTimer?.remove();
    this.emoteImg?.destroy();
    this.emote = frame;
    this.emoteImg = scene.add.image(0, 0, 'emotes', frame).setOrigin(0.5, 1).setDepth(DEPTH.emote).setScale(0.2);
    this.sync();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      scene.tweens.add({ targets: this.emoteImg, scale: 1, duration: 220, ease: 'Back.Out' });
    else this.emoteImg.setScale(1);
    this.emoteTimer = scene.time.delayedCall(2500, () => {
      this.emoteImg?.destroy();
      this.emoteImg = null;
      this.emote = null;
    });
  }

  // A dice roll lands over their head for 3 s (d6: the pixel dice; other dice: the total in a bubble).
  showDice(values: number[], sides = 6) {
    const scene = this.sprite.scene;
    this.diceTimer?.remove();
    this.diceImgs.forEach((d) => d.destroy());
    this.diceImgs = [];
    this.dice = values;
    if (sides === 6 && values.length <= 3 && scene.textures.exists('cards')) {
      this.diceImgs = values.map((v) => scene.add.image(0, 0, 'cards', `die_${v}`).setOrigin(0.5, 1).setScale(11 / 32).setDepth(DEPTH.emote));
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        for (const d of this.diceImgs) scene.tweens.add({ targets: d, angle: { from: -40, to: 0 }, duration: 260, ease: 'Back.Out' });
    } else this.say(`rolled ${values.reduce((a, b) => a + b, 0)}`);
    this.sync();
    this.diceTimer = scene.time.delayedCall(3000, () => {
      this.diceImgs.forEach((d) => d.destroy());
      this.diceImgs = [];
      this.dice = null;
    });
  }

  // Won a duel: a little pixel crown over the name tag (30 s).
  setCrown(ms: number) {
    const scene = this.sprite.scene;
    if (!scene.textures.exists('tag-crown')) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x0d0912, 1).fillRect(0, 1, 11, 8);
      g.fillStyle(0xffd75e, 1).fillRect(1, 4, 9, 4).fillRect(1, 2, 1, 2).fillRect(5, 2, 1, 2).fillRect(9, 2, 1, 2);
      g.fillStyle(0xff6b6b, 1).fillRect(5, 5, 1, 1);
      g.generateTexture('tag-crown', 11, 9);
      g.destroy();
    }
    this.crownTimer?.remove();
    this.crownImg ??= scene.add.image(0, 0, 'tag-crown').setOrigin(0.5, 1).setDepth(DEPTH.badge);
    this.sync();
    this.crownTimer = scene.time.delayedCall(ms, () => {
      this.crownImg?.destroy();
      this.crownImg = null;
    });
  }
  get crowned() {
    return !!this.crownImg;
  }

  // Keeps depth sorting, the ring and the name tag in step with the sprite.
  // A pet that follows this person (cosmetic; R4). null: none.
  private pet: PetSprite | null = null;
  setPet(key: AnimalKey | null | undefined) {
    const want = isAnimal(key) ? key : null;
    if ((this.pet?.key ?? null) === want) return;
    this.pet?.destroy();
    this.pet = want ? new PetSprite(this.sprite.scene, want, toWorld(this.sprite.x, this.sprite.y)) : null;
  }
  get petKey() {
    return this.pet?.key ?? null;
  }
  get petPos() {
    return this.pet?.pos ?? null;
  }

  sync() {
    const scene = this.sprite.scene;
    this.pet?.update(toWorld(this.sprite.x, this.sprite.y), this.facing, this.sprite.visible && petsOn(), scene.time.now, scene.game.loop.delta);
    const depth = depthOf(this.sprite.x, this.sprite.y);
    this.sprite.setDepth(depth);
    this.ring.setPosition(this.sprite.x, this.sprite.y - 1).setDepth(depth - 0.5);
    this.tag.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - this.gap));
    this.bubble?.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - this.gap - 12));
    this.radioImg?.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - this.gap - 11)).setVisible(this.sprite.visible);
    this.whisperImg?.setPosition(Math.round(this.sprite.x + (this.radioImg ? 10 : 0)), Math.round(this.sprite.y - this.gap - 11)).setVisible(this.sprite.visible);
    this.whisperRing?.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - 1)).setDepth(depth - 1);
    const top = Math.round(this.sprite.y - this.gap - (this.bubble ? 28 : 11));
    this.diceImgs.forEach((d, i) => d.setPosition(Math.round(this.sprite.x + (i - (this.diceImgs.length - 1) / 2) * 12), top).setVisible(this.sprite.visible));
    this.crownImg?.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y - this.gap - 10)).setVisible(this.sprite.visible && !this.radioImg);
    // Above the chat bubble if there is one, else just above the tag (beside the radio).
    this.emoteImg
      ?.setPosition(Math.round(this.sprite.x - (this.radioImg && !this.bubble ? 10 : 0)), Math.round(this.sprite.y - this.gap - (this.bubble ? 28 : 11)))
      .setVisible(this.sprite.visible);
  }

  // Behind tall furniture: a faint outline of yourself on top, so you never lose your character.
  private ghost: Phaser.GameObjects.Sprite | null = null;
  setGhost(on: boolean) {
    if (!on) {
      this.ghost?.setVisible(false);
      return;
    }
    const s = this.sprite;
    this.ghost ??= s.scene.add.sprite(0, 0, s.texture.key).setOrigin(0.5, 1).setAlpha(0.32).setTintFill(0xfff4e0).setDepth(DEPTH.light - 1);
    this.ghost.setTexture(s.texture.key, s.frame.name).setPosition(s.x, s.y).setFlipX(s.flipX).setScale(s.scaleX, s.scaleY).setVisible(s.visible);
  }

  // On the Disco's dance floor: a little side-to-side sway from the feet (not with reduced motion).
  setDancing(on: boolean) {
    if (on === !!this.danceTween) return;
    if (!on) {
      this.danceTween?.remove();
      this.danceTween = null;
      this.sprite.setAngle(0);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.sprite.setAngle(-6);
    this.danceTween = this.sprite.scene.tweens.add({ targets: this.sprite, angle: 6, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
  get dancing() {
    return !!this.danceTween;
  }

  animate(moving: boolean, dir: Dir = this.facing) {
    this.facing = dir;
    this.sprite.play(animKey(this.character, moving ? 'walk' : 'idle', dir), true);
  }

  setVisible(v: boolean) {
    this.sprite.setVisible(v);
    this.pet?.img.setVisible(v);
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
    this.pet?.destroy();
    this.danceTween?.remove();
    this.pulse.remove();
    this.sprite.destroy();
    this.tag.destroy();
    this.ring.destroy();
    this.bubble?.destroy();
    this.bubbleTimer?.remove();
    this.radioImg?.destroy();
    this.whisperImg?.destroy();
    this.whisperRing?.destroy();
    this.emoteImg?.destroy();
    this.emoteTimer?.remove();
    this.diceImgs.forEach((d) => d.destroy());
    this.diceTimer?.remove();
    this.crownImg?.destroy();
    this.crownTimer?.remove();
  }
}
