import Phaser from 'phaser';
import { bounds, ROOMS } from './rooms';
import { DEPTH, TILE, toScreen } from './projection';
import { artFrame } from './art';
import type { HouseScene } from '../scenes/HouseScene';
import { savedDiscoBright } from '../prefs';

// The Disco (REDESIGN.md R3): a dance floor that slowly changes colour, a glitter ball with light specks
// sweeping the room, two light beams from the DJ booth, and people swaying while they stand on the floor.
// No strobing (photosensitivity, REDESIGN.md R5): colours drift slowly, and "reduce motion" slows them
// right down and stops the sway. All local: nothing is sent while dancing (a dance minute is counted for
// the Dance machine medal and challenge, sent with the other events every 30 s).
// (Part of the house scene; `this` is the HouseScene.)

const DRAW_EVERY = 160; // ms between floor redraws
const DANCE_MIN_MS = 60_000;

export type DanceFloor = { room: string; x: number; y: number; w: number; h: number }; // world px

export function setupDisco(this: HouseScene) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const r of ROOMS) {
    if (!r.dance) continue;
    const b = bounds(r.polygon);
    const floor: DanceFloor = { room: r.id, x: (b.x + r.dance.x) * TILE, y: (b.y + r.dance.y) * TILE, w: r.dance.w * TILE, h: r.dance.h * TILE };
    this.danceFloors.push(floor);
    const tl = toScreen(floor.x, floor.y);

    // The floor: one square per tile, each drifting round the colour wheel at its own offset.
    const g = this.add.graphics().setDepth(0.5);
    const glow = this.add.graphics().setDepth(DEPTH.light + 1).setBlendMode(Phaser.BlendModes.ADD); // the colour shows through the night
    const draw = () => {
      const t = this.time.now / 1000;
      // Soft by default (UI-REVIEW U4: photosensitivity): calmer colours, slower drift. Settings → More →
      // Bright disco lights for the full show; "reduce motion" keeps it slow either way.
      const bright = savedDiscoBright();
      const speed = reduce ? 4 : bright ? 24 : 10; // degrees of hue per second
      const [sat, light, glowA] = bright ? [0.75, 0.55, 0.16] : [0.45, 0.42, 0.08];
      g.clear();
      glow.clear();
      for (let j = 0; j < r.dance!.h; j++)
        for (let i = 0; i < r.dance!.w; i++) {
          const hue = ((t * speed + i * 38 + j * 64 + ((i * j) % 3) * 50) % 360) / 360;
          const c = Phaser.Display.Color.HSLToColor(hue, sat, light).color;
          const x = tl.x + i * TILE;
          const y = tl.y + j * TILE;
          g.fillStyle(c, 1).fillRect(x, y, TILE, TILE);
          g.fillStyle(0x000000, 0.25).fillRect(x, y + TILE - 1, TILE, 1).fillRect(x + TILE - 1, y, 1, TILE);
          glow.fillStyle(c, glowA).fillRect(x, y, TILE, TILE);
        }
    };
    draw();
    this.time.addEvent({ delay: reduce ? DRAW_EVERY * 4 : DRAW_EVERY, loop: true, callback: draw });

    // The glitter ball over the middle, and its specks of light moving slowly round the room.
    const cx = tl.x + floor.w / 2;
    const cy = tl.y + floor.h / 2;
    const art = artFrame(this, 'disco_ball');
    const ball = this.add.image(cx, tl.y - 22, art?.key ?? 'glow', art?.frame).setDepth(DEPTH.light + 3);
    if (!art) ball.setVisible(false);
    if (!reduce) this.tweens.add({ targets: ball, y: ball.y - 1.5, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const specks = Array.from({ length: 16 }, (_, k) =>
      this.add.rectangle(cx, cy, 2, 2, 0xffffff, 0.6).setDepth(DEPTH.light + 2).setBlendMode(Phaser.BlendModes.ADD).setData('k', k),
    );
    // Two soft beams from the DJ booth, swinging slowly.
    const beams = [0xff8fd0, 0x9ec9ff].map((c) =>
      this.add.image(cx, tl.y - 8, 'glow').setOrigin(0.5, 0).setDisplaySize(36, floor.h + 40).setTint(c).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.light + 2),
    );
    this.events.on('update', () => {
      const t = this.time.now / 1000;
      const spin = reduce ? 0.04 : 0.3;
      for (const s of specks) {
        const k = s.getData('k') as number;
        const a = k * 2.4 + t * spin;
        const rr = 20 + ((k * 37) % (floor.w / 2));
        s.setPosition(cx + Math.cos(a) * rr * 1.3, cy + Math.sin(a) * rr * 0.7).setAlpha(0.35 + 0.25 * Math.sin(t * 2 + k));
      }
      beams.forEach((b, i) => b.setRotation((i ? 1 : -1) * (0.35 + (reduce ? 0 : 0.3 * Math.sin(t * 0.6 + i * 1.7)))));
    });
  }
}

export function onDanceFloor(this: HouseScene, x: number, y: number) {
  return this.danceFloors.some((f) => x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h);
}

// Every frame: who's dancing (sway), and our dance minutes.
export function updateDancing(this: HouseScene, delta: number) {
  const meOn = this.onDanceFloor(this.player.x, this.player.y);
  this.me.setDancing(meOn);
  for (const r of this.remotes.values()) r.avatar.setDancing(r.active && this.onDanceFloor(r.avatar.sprite.x, r.avatar.sprite.y));
  if (!meOn || document.hidden) return;
  this.danceMs += delta;
  if (this.danceMs >= DANCE_MIN_MS) {
    this.danceMs -= DANCE_MIN_MS;
    this.tracker.emit('dance_min');
  }
}
