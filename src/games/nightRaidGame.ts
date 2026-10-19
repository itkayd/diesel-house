// Night Raid: the game itself (no drawing, no DOM), so it can be stepped in tests. Your character stands
// on the rooftop and throws shurikens at night spooks that drift down in waves, swaying in formation and
// diving at you; they drop fireballs. Snacks they drop are bonus points; a potion gives magic shurikens
// for 10 s; a heart is an extra life. Every 5th wave a Giant Spirit. 3 lives.
// World: 180 × 320 logical px, y down. Times in seconds.

export const W = 180;
export const H = 320;
const PLAYER_Y = H - 30;
const PLAYER_SPEED = 130;
const SHOT_SPEED = 230;
const FIRE_EVERY = 0.28;
const POWER_TIME = 10;
const INVULNERABLE = 1.6;
const ENTER_TIME = 1.6; // a wave flies in before it attacks
const BANNER_TIME = 1.2;

export type EnemyKind = 'bat' | 'bat2' | 'skull' | 'skull2' | 'spirit' | 'lantern' | 'eye' | 'flam' | 'octopus' | 'dragon';
const KINDS: Record<EnemyKind, { hp: number; pts: number }> = {
  bat: { hp: 1, pts: 10 },
  bat2: { hp: 1, pts: 15 },
  skull: { hp: 2, pts: 20 },
  skull2: { hp: 2, pts: 25 },
  spirit: { hp: 2, pts: 30 },
  lantern: { hp: 3, pts: 35 },
  eye: { hp: 3, pts: 40 },
  flam: { hp: 3, pts: 45 },
  octopus: { hp: 4, pts: 50 },
  dragon: { hp: 5, pts: 70 },
};
// Which spooks come in which rows, by wave (later waves bring the tougher ones down from the top).
const ROWS: EnemyKind[][] = [
  ['bat', 'bat'],
  ['bat2', 'bat', 'bat'],
  ['skull', 'bat2', 'bat'],
  ['spirit', 'skull', 'bat2', 'bat'],
  [], // boss
  ['lantern', 'skull2', 'skull', 'bat2'],
  ['eye', 'lantern', 'spirit', 'skull2', 'bat2'],
  ['flam', 'eye', 'lantern', 'skull2', 'skull'],
  ['octopus', 'flam', 'eye', 'spirit', 'skull2'],
  [], // boss
  ['dragon', 'octopus', 'flam', 'eye', 'lantern'],
];
export const SNACKS = ['onigiri', 'cookie', 'noodle', 'meat'] as const;

export type Enemy = { id: number; kind: EnemyKind; hp: number; slotX: number; slotY: number; x: number; y: number; dive: null | { t: number; fromX: number; fromY: number; side: number }; hit: number };
export type Shot = { x: number; y: number; vx: number; vy: number; magic: boolean };
export type Drop = { x: number; y: number; vy: number; kind: (typeof SNACKS)[number] | 'potion' | 'heart' };
export type Boss = { x: number; y: number; hp: number; max: number; dir: number; fire: number; hit: number };
export type Boom = { x: number; y: number; t: number; big: boolean };
export type GameEvent = 'shoot' | 'hit' | 'kill' | 'hurt' | 'snack' | 'power' | 'life' | 'wave' | 'boss' | 'bossdown' | 'over';

export type Input = { left: boolean; right: boolean; targetX: number | null }; // targetX: a finger's x (follow it)

// Seeded random numbers (mulberry32) so a test can replay a game.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class NightRaid {
  x = W / 2;
  score = 0;
  lives = 3;
  wave = 0; // waves cleared
  time = 0; // seconds played
  over = false;
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  fire: Shot[] = []; // the spooks' fireballs
  drops: Drop[] = [];
  booms: Boom[] = [];
  boss: Boss | null = null;
  power = 0; // magic shurikens left (s)
  hurt = 0; // invulnerable left (s)
  banner = 0; // "Wave N" left (s)
  enter = 0; // wave flying in (s)
  private fireIn = 0;
  private diveIn = 3;
  private shootIn = 2;
  private sway = 0;
  private nextId = 1;
  private r: () => number;

  constructor(seed = Date.now(), private on: (e: GameEvent) => void = () => {}) {
    this.r = rng(seed);
    this.startWave();
  }

  get waveNumber() {
    return this.wave + 1;
  }

  private startWave() {
    const n = this.waveNumber;
    this.banner = BANNER_TIME;
    this.enter = ENTER_TIME;
    this.diveIn = 3;
    this.shootIn = 2;
    this.on('wave');
    if (n % 5 === 0) {
      const max = 40 + n * 8;
      this.boss = { x: W / 2, y: -40, hp: max, max, dir: 1, fire: 1.5, hit: 0 };
      this.on('boss');
      return;
    }
    const rows = ROWS[(n - 1) % ROWS.length].length ? ROWS[(n - 1) % ROWS.length] : ROWS[0];
    const cols = Math.min(7, 5 + Math.floor(n / 4));
    const gap = 22;
    const left = (W - (cols - 1) * gap) / 2;
    rows.forEach((kind, row) => {
      for (let c = 0; c < cols; c++) {
        const slotX = left + c * gap;
        const slotY = 48 + row * 20;
        const hp = KINDS[kind].hp + Math.floor(n / 6);
        this.enemies.push({ id: this.nextId++, kind, hp, slotX, slotY, x: slotX, y: slotY - 200 - row * 30, dive: null, hit: 0 });
      }
    });
  }

  // One step of `dt` seconds.
  step(dt: number, input: Input) {
    if (this.over) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const n = this.waveNumber;
    // You: keys, or follow a finger.
    if (input.targetX !== null) this.x += Math.max(-PLAYER_SPEED * 1.6 * dt, Math.min(PLAYER_SPEED * 1.6 * dt, input.targetX - this.x));
    else this.x += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * PLAYER_SPEED * dt;
    this.x = Math.max(10, Math.min(W - 10, this.x));
    this.power = Math.max(0, this.power - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.banner = Math.max(0, this.banner - dt);

    // Shurikens fly by themselves.
    this.fireIn -= dt;
    if (this.fireIn <= 0) {
      this.fireIn = FIRE_EVERY;
      const magic = this.power > 0;
      const spread = magic ? [-50, 0, 50] : [0];
      for (const vx of spread) this.shots.push({ x: this.x, y: PLAYER_Y - 10, vx, vy: -SHOT_SPEED, magic });
      this.on('shoot');
    }
    for (const s of this.shots) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.shots = this.shots.filter((s) => s.y > -10 && s.x > -10 && s.x < W + 10);

    // The formation: flies in, then sways and creeps down; now and then one dives at you.
    this.enter = Math.max(0, this.enter - dt);
    this.sway += dt;
    const swayX = Math.sin(this.sway * 0.9) * 22;
    const creep = Math.min(60, this.sway * (0.6 + n * 0.12));
    for (const e of this.enemies) {
      e.hit = Math.max(0, e.hit - dt);
      if (e.dive) {
        const d = e.dive;
        d.t += dt;
        const speed = 95 + n * 6;
        e.y = d.fromY + d.t * speed;
        e.x = d.fromX + Math.sin(d.t * 2.4) * 40 * d.side + (this.x - d.fromX) * Math.min(1, d.t / 2);
        if (e.y > H + 20) {
          e.dive = null;
          e.y = -20;
        }
      } else {
        const tx = e.slotX + swayX;
        const ty = e.slotY + creep;
        e.x += (tx - e.x) * Math.min(1, dt * 4);
        e.y += (ty - e.y) * Math.min(1, dt * (this.enter > 0 ? 2.5 : 4));
      }
    }
    if (this.enter === 0 && this.enemies.length) {
      this.diveIn -= dt;
      if (this.diveIn <= 0) {
        this.diveIn = Math.max(0.9, 2.6 - n * 0.15) * (0.7 + this.r() * 0.6);
        const idle = this.enemies.filter((e) => !e.dive);
        const e = idle[Math.floor(this.r() * idle.length)];
        if (e) e.dive = { t: 0, fromX: e.x, fromY: e.y, side: this.r() < 0.5 ? -1 : 1 };
      }
      this.shootIn -= dt;
      if (this.shootIn <= 0) {
        this.shootIn = Math.max(0.35, 1.4 - n * 0.08) * (0.6 + this.r() * 0.8);
        const e = this.enemies[Math.floor(this.r() * this.enemies.length)];
        if (e) this.fire.push({ x: e.x, y: e.y + 8, vx: 0, vy: 80 + n * 5, magic: false });
      }
    }

    // The boss: swings side to side and throws fireball fans.
    const b = this.boss;
    if (b) {
      b.hit = Math.max(0, b.hit - dt);
      if (b.y < 60) b.y += 40 * dt;
      else {
        b.x += b.dir * (30 + n * 2) * dt;
        if (b.x < 30 || b.x > W - 30) b.dir *= -1;
        b.fire -= dt;
        if (b.fire <= 0) {
          b.fire = Math.max(0.8, 2 - n * 0.05);
          for (const vx of [-45, 0, 45]) this.fire.push({ x: b.x, y: b.y + 20, vx, vy: 95 + n * 3, magic: false });
        }
      }
    }

    // Their fireballs.
    for (const f of this.fire) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.fire = this.fire.filter((f) => f.y < H + 10);

    // Hits on spooks and the boss.
    for (const s of this.shots) {
      const hitE = this.enemies.find((e) => Math.abs(e.x - s.x) < 8 && Math.abs(e.y - s.y) < 8);
      if (hitE) {
        s.y = -100;
        hitE.hp -= s.magic ? 2 : 1;
        hitE.hit = 0.1;
        this.on('hit');
        if (hitE.hp <= 0) this.kill(hitE);
        continue;
      }
      if (b && b.y >= 30 && Math.abs(b.x - s.x) < 20 && Math.abs(b.y - s.y) < 20) {
        s.y = -100;
        b.hp -= s.magic ? 2 : 1;
        b.hit = 0.1;
        this.on('hit');
        if (b.hp <= 0) {
          this.score += 1000 + n * 50;
          this.booms.push({ x: b.x, y: b.y, t: 0, big: true });
          this.drops.push({ x: b.x, y: b.y, vy: 60, kind: 'heart' }, { x: b.x - 14, y: b.y, vy: 60, kind: 'potion' });
          this.boss = null;
          this.on('bossdown');
        }
      }
    }
    this.shots = this.shots.filter((s) => s.y > -50);

    // Things falling: snacks, potions, hearts.
    for (const d of this.drops) d.y += d.vy * dt;
    for (const d of this.drops) {
      if (Math.abs(d.x - this.x) < 12 && Math.abs(d.y - PLAYER_Y) < 12) {
        d.y = H + 100;
        if (d.kind === 'potion') {
          this.power = POWER_TIME;
          this.on('power');
        } else if (d.kind === 'heart') {
          this.lives = Math.min(5, this.lives + 1);
          this.on('life');
        } else {
          this.score += 50;
          this.on('snack');
        }
      }
    }
    this.drops = this.drops.filter((d) => d.y < H + 20);

    // Being hit (by a fireball or a diving spook).
    if (this.hurt === 0) {
      const f = this.fire.find((f) => Math.abs(f.x - this.x) < 6 && Math.abs(f.y - PLAYER_Y) < 8);
      const e = this.enemies.find((e) => Math.abs(e.x - this.x) < 10 && Math.abs(e.y - PLAYER_Y) < 10);
      if (f || e) {
        if (f) f.y = H + 100;
        if (e) this.kill(e, false);
        this.lives--;
        this.hurt = INVULNERABLE;
        this.power = 0;
        this.booms.push({ x: this.x, y: PLAYER_Y, t: 0, big: false });
        this.on('hurt');
        if (this.lives <= 0) {
          this.over = true;
          this.on('over');
          return;
        }
      }
    }

    for (const bm of this.booms) bm.t += dt;
    this.booms = this.booms.filter((bm) => bm.t < 0.6);

    // Wave cleared: the next one.
    if (!this.enemies.length && !this.boss) {
      this.wave++;
      this.fire = [];
      this.sway = 0;
      this.startWave();
    }
  }

  private kill(e: Enemy, scored = true) {
    this.enemies = this.enemies.filter((x) => x !== e);
    this.booms.push({ x: e.x, y: e.y, t: 0, big: false });
    if (!scored) return;
    this.score += Math.round(KINDS[e.kind].pts * (1 + this.wave * 0.1));
    this.on('kill');
    const roll = this.r();
    if (roll < 0.015) this.drops.push({ x: e.x, y: e.y, vy: 55, kind: 'heart' });
    else if (roll < 0.055) this.drops.push({ x: e.x, y: e.y, vy: 55, kind: 'potion' });
    else if (roll < 0.17) this.drops.push({ x: e.x, y: e.y, vy: 60, kind: SNACKS[Math.floor(this.r() * SNACKS.length)] });
  }
}
