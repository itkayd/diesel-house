import Phaser from 'phaser';
import { bounds, ROOMS, tileIn } from './rooms';
import { DEPTH, TILE, toScreen } from './projection';
import { toast } from '../ui/toasts';
import { icon } from '../ui/icons';
import { overlay } from '../ui/overlay';
import { play } from '../ui/sounds';
import type { TimerMsg } from '../net/presence';
import type { HouseScene } from '../scenes/HouseScene';

// Small things that make rooms feel lived in (REDESIGN.md R3):
// - Café: the fridge's "special" of the day, a fun line that changes at midnight (your time).
// - Library: a shared study timer on the desk. Start it and everyone in the Library sees the same
//   countdown; it rings softly at the end. Sent over the house channel (a few messages per timer).
// - Garden and Rooftop: the sky follows your clock (day, sunset, night with stars).
// (Part of the house scene; `this` is the HouseScene.)

const NEAR = 30; // px from a piece to get its prompt
const STUDY_MS = 25 * 60_000;

const SPECIALS = [
  'Toast, but it’s been told it’s special',
  'Extra-large hot chocolate with marshmallow drama',
  'The "I’ll just have one biscuit" (it’s never one)',
  'Iced coffee, emotionally supportive',
  'Cheese toastie with a side of gossip',
  'Mystery muffin: flavour revealed at bite one',
  'Pancakes stacked to dangerous heights',
  'Cinnamon roll the size of a cat',
  'Lemonade that’s mostly ice and vibes',
  'Chai latte and a long chat',
  'Avocado toast (the avocado is shy today)',
  'Double espresso for the night owls',
  'Hot soup for whoever lost at Four in a row',
  'Strawberry milkshake, two straws',
  'Croissant that flakes on everyone nearby',
  'Leftover pizza, served with pride',
  'Banana bread nobody admits to making',
  'Mint tea for calm game nights',
  'Brownie with a crunchy corner (fought over)',
  'Ice cream sundae: sprinkles not optional',
  'Bagel with the works and then some',
  'Cookies straight off the tray, careful, hot',
];

export function specialToday(d = new Date()) {
  const n = d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
  return SPECIALS[(n * 7) % SPECIALS.length];
}

type Piece = { room: string; x: number; y: number; w: number; h: number };

// The first piece of `kind` inside a room (world px), from the map's furniture layer.
function findPiece(map: Phaser.Tilemaps.Tilemap, room: string, kind: string): Piece | null {
  const def = ROOMS.find((r) => r.id === room);
  if (!def) return null;
  for (const o of map.getObjectLayer('furniture')?.objects ?? []) {
    if (o.name !== kind) continue;
    if (!tileIn(def.polygon, Math.floor((o.x! + o.width! / 2) / TILE), Math.floor((o.y! + o.height!) / TILE - 0.5))) continue;
    return { room, x: o.x!, y: o.y!, w: o.width!, h: o.height! };
  }
  return null;
}

const near = (p: Piece, x: number, y: number) => x > p.x - NEAR && x < p.x + p.w + NEAR && y > p.y && y < p.y + p.h + NEAR;

export function setupRoomExtras(this: HouseScene, map: Phaser.Tilemaps.Tilemap) {
  for (const r of ROOMS) {
    if (r.special) {
      const p = findPiece(map, r.id, r.special);
      if (p) {
        this.specialAt = p;
        // A note pinned on the fridge door.
        const at = toScreen(p.x + p.w / 2, p.y + 8);
        const g = this.add.graphics().setDepth(p.y + p.h + 0.1);
        g.fillStyle(0x0d0912, 1).fillRect(at.x - 4, at.y - 1, 9, 9);
        g.fillStyle(0xfff4e0, 1).fillRect(at.x - 3, at.y, 7, 7);
        g.fillStyle(0xd94f4f, 1).fillRect(at.x - 1, at.y - 1, 2, 1);
        g.fillStyle(0x9a6440, 1).fillRect(at.x - 2, at.y + 2, 5, 1).fillRect(at.x - 2, at.y + 4, 4, 1);
      }
    }
    if (r.timer) {
      const p = findPiece(map, r.id, r.timer);
      if (p) {
        this.timerAt = p;
        const at = toScreen(p.x + p.w / 2, p.y - 6);
        this.timerText = this.add
          .text(at.x, at.y, '', { fontFamily: '"Pixelify Sans", monospace', fontSize: '7px', color: '#fff4e0', backgroundColor: '#2b2034', padding: { x: 2, y: 1 } })
          .setOrigin(0.5, 1)
          .setResolution(8)
          .setDepth(DEPTH.sign)
          .setVisible(false);
      }
    }
  }
  setupSky.call(this);
}

// Every frame: prompts near the fridge and the study desk, the timer's countdown.
export function updateRoomExtras(this: HouseScene) {
  const x = this.player.x;
  const y = this.player.y;
  const sp = this.specialAt;
  if (sp && this.zone === sp.room && near(sp, x, y)) {
    if (!this.specialShown) {
      this.specialShown = true;
      toast({ icon: 'coffee', id: 'cafe-special', who: 'Today’s special', what: specialToday(), ttl: 5000 });
    }
  }
  const tp = this.timerAt;
  const atDesk = !!tp && this.zone === tp.room && near(tp, x, y) && this.canMove;
  showTimerPrompt.call(this, atDesk);
  if (tp && this.timerText) {
    const left = this.timerEnds ? this.timerEnds - Date.now() : 0;
    if (this.timerEnds && left <= 0) {
      this.timerEnds = 0;
      if (this.zone === tp.room) {
        play('confirm', 0.5);
        toast({ icon: 'timer', id: 'study-done', who: 'Study timer done', what: 'Time for a break.', small: true, ttl: 4000 });
      }
    }
    const on = this.timerEnds > 0;
    this.timerText.setVisible(on);
    if (on) {
      const s = Math.ceil(left / 1000);
      this.timerText.setText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }
    if (atDesk && this.timerPrompt) this.timerPrompt.querySelector('span')!.textContent = on ? 'Stop the study timer' : 'Study timer · 25 min';
  }
}

function showTimerPrompt(this: HouseScene, on: boolean) {
  if (on === !!this.timerPrompt) return;
  this.timerPrompt?.remove();
  this.timerPrompt = null;
  if (!on) return;
  const box = document.createElement('div');
  box.className = 'v2-act';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dh-btn';
  b.id = 'timer-prompt';
  const label = document.createElement('span');
  b.append(icon('timer'), label);
  b.addEventListener('click', () => {
    const room = this.timerAt?.room;
    if (!room) return;
    if (this.timerEnds) {
      this.timerEnds = 0;
      this.presence?.sendTimer({ room, k: 'stop' });
    } else {
      this.timerEnds = Date.now() + STUDY_MS;
      this.presence?.sendTimer({ room, k: 'set', left: STUDY_MS });
      play('click', 0.4);
    }
  });
  box.append(b);
  overlay().append(box);
  this.timerPrompt = box;
}

// Someone started, stopped or asked about a study timer.
export function receiveTimer(this: HouseScene, m: TimerMsg) {
  if (m.room !== this.timerAt?.room) return;
  if (m.k === 'ask') {
    const left = this.timerEnds - Date.now();
    if (left > 0) this.presence?.sendTimer({ room: m.room, k: 'set', left });
    return;
  }
  this.timerEnds = m.k === 'set' && m.left ? Date.now() + Math.min(m.left, STUDY_MS) : 0;
}

// Walked into the timer's room: ask if a timer is running (whoever has one answers).
export function askTimer(this: HouseScene, zone: string | null) {
  if (zone && zone === this.timerAt?.room && !this.timerEnds) this.presence?.sendTimer({ room: zone, k: 'ask' });
}

// ---- The sky over the Garden and the Rooftop ----
// Your clock picks the light: day (bright, warm), sunset/sunrise (orange), night (deep blue, stars).
function skyNow(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 7.5 && h < 18) return { wash: 0xfff2c4, alpha: 0.42, stars: 0 };
  if ((h >= 18 && h < 20) || (h >= 6 && h < 7.5)) return { wash: 0xff9a5a, alpha: 0.26, stars: 0.3 };
  return { wash: 0x3a4a9a, alpha: 0.18, stars: 1 };
}

function setupSky(this: HouseScene) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const r of ROOMS) {
    if (!r.outdoor) continue;
    const pts = r.polygon.map(([px, py]) => toScreen(px * TILE, py * TILE));
    const wash = this.add.graphics().setDepth(DEPTH.light + 1).setBlendMode(Phaser.BlendModes.ADD);
    const b = bounds(r.polygon);
    const stars: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < 26; i++) {
      // Spread over the room's floor (a fixed pattern, so it's the same every visit).
      const tx = b.x + ((i * 7919) % (b.w * 100)) / 100;
      const ty = b.y + 2 + ((i * 104729) % ((b.h - 2) * 100)) / 100;
      if (!tileIn(r.polygon, Math.floor(tx), Math.floor(ty))) continue;
      const at = toScreen(tx * TILE, ty * TILE);
      stars.push(this.add.rectangle(at.x, at.y, 1, 1, 0xffffff, 0.8).setDepth(DEPTH.light + 2).setBlendMode(Phaser.BlendModes.ADD).setData('k', i));
    }
    const paint = () => {
      const s = skyNow();
      wash.clear();
      wash.fillStyle(s.wash, s.alpha).fillPoints(pts, true);
      stars.forEach((st) => st.setVisible(s.stars > 0));
      this.skyLight = s;
    };
    paint();
    this.time.addEvent({ delay: 60_000, loop: true, callback: paint });
    if (!reduce)
      this.events.on('update', () => {
        if (!this.skyLight?.stars) return;
        const t = this.time.now / 1000;
        for (const st of stars) st.setAlpha(this.skyLight.stars * (0.35 + 0.45 * Math.abs(Math.sin(t * 0.7 + (st.getData('k') as number)))));
      });
  }
  setupNightOutside.call(this, reduce);
}

// Outside the house (the dark around it): a scatter of faint stars, a few twinkling, so the edges of the
// screen look like night sky rather than nothing. A fixed pattern, well clear of the house.
function setupNightOutside(this: HouseScene, reduce: boolean) {
  const map = this.wallLayer.tilemap;
  // (Outside is filled with the plain dark wall tile; any floor nearby, or a wall face above one, is the house.)
  const floor = (tx: number, ty: number) => !!map.getTileAt(tx, ty, false, 'floor');
  const clear = (tx: number, ty: number) => {
    for (let dy = -2; dy <= 4; dy++) for (let dx = -2; dx <= 2; dx++) if (floor(tx + dx, ty + dy)) return false;
    return true;
  };
  const g = this.add.graphics().setDepth(DEPTH.light + 2).setBlendMode(Phaser.BlendModes.ADD);
  const twinkles: Phaser.GameObjects.Rectangle[] = [];
  for (let ty = 0; ty < map.height; ty++)
    for (let tx = 0; tx < map.width; tx++) {
      const h = (tx * 73856093) ^ (ty * 19349663);
      if ((h >>> 0) % 7 !== 0 || !clear(tx, ty)) continue;
      const at = toScreen(tx * TILE + ((h >>> 4) % TILE), ty * TILE + ((h >>> 9) % TILE));
      if ((h >>> 0) % 5 === 0 && twinkles.length < 40) twinkles.push(this.add.rectangle(at.x, at.y, 2, 2, 0xfff4e0, 0.6).setDepth(DEPTH.light + 2).setBlendMode(Phaser.BlendModes.ADD).setData('k', twinkles.length));
      else g.fillStyle(0xd8d0ff, 0.18 + ((h >>> 13) % 4) * 0.08).fillRect(at.x, at.y, 1, 1);
    }
  if (reduce) return;
  this.events.on('update', () => {
    const t = this.time.now / 1000;
    for (const st of twinkles) st.setAlpha(0.15 + 0.5 * Math.abs(Math.sin(t * 0.5 + (st.getData('k') as number) * 1.7)));
  });
}
