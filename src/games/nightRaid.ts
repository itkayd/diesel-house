import { skinFrame, type Skin } from '../characters';
import { icon } from '../ui/icons';
import { el, openModal } from '../ui/modal';
import { portrait } from '../ui/portrait';
import { play, type Sfx } from '../ui/sounds';
import atlas from './nightraid.json';
import { H, NightRaid, W, type GameEvent, type Input } from './nightRaidGame';

// Night Raid (the arcade cabinet in the Gaming room, or Games → Arcade): a one-player shooter in the
// house's own look (Ninja Adventure spooks, your own character on the rooftop). The title card shows
// your best, the house record and this week's top scores; a new personal best pays XP (more than any
// critter), a new house record more again (supabase/migrations/20261107_arcade.sql).
export type ArcadeResult =
  | { ok: true; best: number; previous: number | null; new_best: boolean; record: boolean; house_best: number; xp: number }
  | { ok: false; why: 'guest' | 'unbelievable' | 'too_soon' | 'offline' | 'error' };
export type ArcadeRow = { user_id: string; display_name: string; character_key: string; best: number; record: boolean };
export type ArcadeDeps = {
  me: () => { id: string; skin: Skin; guest: boolean };
  submit: (score: number, waves: number, durationMs: number) => Promise<ArcadeResult>;
  board: () => Promise<ArcadeRow[] | null>;
  onClose?: () => void;
};

const FRAMES = atlas.frames as unknown as Record<string, [number, number, number, number]>;
const LOCAL_BEST = 'diesel-house.nightraid-best';
const SOUND: Partial<Record<GameEvent, [Sfx, number]>> = {
  kill: ['card_flip', 0.35],
  hurt: ['error', 0.6],
  snack: ['coin', 0.6],
  power: ['powerup', 0.7],
  life: ['powerup', 0.8],
  wave: ['card_shuffle', 0.4],
  boss: ['dice_shake', 0.6],
  bossdown: ['win', 0.8],
  over: ['lose', 0.7],
};

const images = new Map<string, Promise<HTMLImageElement>>();
function image(src: string) {
  let p = images.get(src);
  if (!p) {
    p = new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = fail;
      im.src = src;
    });
    images.set(src, p);
  }
  return p;
}

function localBest() {
  try {
    return Number(localStorage.getItem(LOCAL_BEST) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function saveLocalBest(n: number) {
  try {
    localStorage.setItem(LOCAL_BEST, String(n));
  } catch {
    // private browsing
  }
}

let open: { close: () => void } | null = null;
export const nightRaidOpen = () => !!open;

export function openNightRaid(deps: ArcadeDeps) {
  if (open) return;
  const ui = openModal('arcade', { dismissable: true, label: 'arcade-title', onDismiss: () => stop() });
  ui.scrim.classList.add('dh-arcade-scrim');
  ui.panel.classList.add('dh-arcade');
  let game: NightRaid | null = null;
  let raf = 0;
  let last = 0;
  let paused = false;
  const input: Input = { left: false, right: false, targetX: null };
  let sheet: HTMLImageElement | null = null;
  let skins: HTMLImageElement | null = null;
  void image('assets/arcade/nightraid.png').then((im) => (sheet = im));
  void image('assets/characters/skins.png').then((im) => (skins = im));
  const stars = Array.from({ length: 50 }, (_, i) => ({ x: (i * 73) % W, y: (i * 151) % H, s: (i % 3) + 1 }));

  const pauseBtn = el('button', 'dh-iconbtn arcade-pause');
  pauseBtn.type = 'button';
  pauseBtn.id = 'arcade-pause';
  pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.append(icon('pause'));
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  pauseBtn.hidden = true; // only while a game is on
  const head = el('div', 'v2-head');
  const title = el('h2', '', 'Night Raid');
  title.id = 'arcade-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'arcade-close';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', () => {
    ui.close();
    stop();
  });
  head.append(icon('gamepad-2'), title, pauseBtn, x);
  const body = el('div', 'arcade-body');
  ui.panel.append(head, body);
  open = { close: () => (ui.close(), stop()) };

  // ---- Title card ----
  function titleCard() {
    cancelAnimationFrame(raf);
    game = null;
    pauseBtn.hidden = true;
    const me = deps.me();
    const card = el('div', 'arcade-title');
    const best = el('p', 'arcade-best');
    best.id = 'arcade-best';
    best.textContent = `Your best: ${localBest().toLocaleString()}`;
    card.append(
      el('p', 'v2-note', 'Spooks are raiding the rooftop! Move left and right; your shurikens throw themselves. Catch snacks for points, potions for magic shurikens and hearts for lives. Every 5th wave: a Giant Spirit.'),
      best,
      el('p', 'v2-note', me.guest ? 'Guests can play; scores and XP are for members.' : 'A new personal best: +50 XP. A new house record: +150 XP (3 paid bests a day).'),
    );
    const board = el('div', 'v2-list arcade-board');
    board.id = 'arcade-board';
    if (!me.guest) {
      board.append(el('p', 'v2-note', 'Loading this week’s top scores…'));
      void deps.board().then((rows) => {
        if (!board.isConnected) return;
        board.replaceChildren(el('div', 'dh-label', 'This week’s top scores'));
        if (!rows) return void board.append(el('p', 'v2-note', 'Couldn’t load the scores.'));
        if (!rows.length) return void board.append(el('p', 'v2-note', 'No scores yet this week. Be the first!'));
        rows.forEach((r, i) => {
          const row = el('div', 'v2-item');
          row.append(el('span', 'rk', String(i + 1)), portrait(r.character_key, 28), el('span', 't', r.user_id === me.id ? 'You' : r.display_name), el('b', '', `${r.best.toLocaleString()}${r.record ? ' ★' : ''}`));
          board.append(row);
        });
        const mine = rows.find((r) => r.user_id === me.id);
        if (mine && mine.best > localBest()) {
          saveLocalBest(mine.best);
          best.textContent = `Your best: ${mine.best.toLocaleString()}`;
        }
      });
    }
    const go = el('button', 'dh-btn');
    go.type = 'button';
    go.id = 'arcade-play';
    go.append(icon('play'), 'Play');
    go.addEventListener('click', start);
    card.append(go, board);
    body.replaceChildren(card);
    go.focus({ preventScroll: true });
  }

  // ---- The game ----
  const canvas = el('canvas', 'arcade-canvas');
  canvas.id = 'arcade-canvas';

  const toLogical = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    input.targetX = toLogical(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (input.targetX !== null) input.targetX = toLogical(e);
  });
  const lift = () => (input.targetX = null);
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  const keys = (on: boolean) => (e: KeyboardEvent) => {
    if (!game) return;
    if (['ArrowLeft', 'a', 'A'].includes(e.key)) input.left = on;
    else if (['ArrowRight', 'd', 'D'].includes(e.key)) input.right = on;
    else if (on && (e.key === 'p' || e.key === 'P')) setPaused(!paused);
    else if (on && e.key === 'Escape' && !game.over && !paused) setPaused(true); // Escape pauses first; again closes
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const down = keys(true);
  const up = keys(false);
  addEventListener('keydown', down, true);
  addEventListener('keyup', up, true);
  const hidden = () => document.hidden && game && !game.over && setPaused(true);
  document.addEventListener('visibilitychange', hidden);

  function fit() {
    const r = body.getBoundingClientRect();
    const room = Math.max(1, Math.min((r.width || W) / W, (window.innerHeight - 140) / H));
    const scale = room >= 2 ? Math.floor(room) : room;
    canvas.style.width = `${Math.round(W * scale)}px`;
    canvas.style.height = `${Math.round(H * scale)}px`;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
  }

  function start() {
    play('confirm', 0.5);
    game = new NightRaid(Date.now(), (e) => {
      const s = SOUND[e];
      if (s) play(s[0], s[1]);
      if (e === 'hurt') navigator.vibrate?.(80);
    });
    paused = false;
    const wrap = el('div', 'arcade-stage');
    wrap.append(canvas);
    pauseBtn.hidden = false;
    body.replaceChildren(wrap);
    fit();
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function setPaused(on: boolean) {
    if (!game || game.over) return;
    paused = on;
    pauseBtn.replaceChildren(icon(on ? 'play' : 'pause'));
    pauseBtn.setAttribute('aria-label', on ? 'Resume' : 'Pause');
    if (!on) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    } else draw();
  }

  function loop(t: number) {
    if (!game || paused) return;
    const dt = (t - last) / 1000;
    last = t;
    game.step(dt, input);
    draw();
    if (game.over) return void setTimeout(() => void finish(), 700);
    raf = requestAnimationFrame(loop);
  }

  function sprite(g: CanvasRenderingContext2D, name: string, cx: number, cy: number, flip = false) {
    const f = FRAMES[name];
    if (!f || !sheet) return;
    const [sx, sy, w, h] = f;
    g.save();
    g.translate(Math.round(cx), Math.round(cy));
    if (flip) g.scale(-1, 1);
    g.drawImage(sheet, sx, sy, w, h, -Math.round(w / 2), -Math.round(h / 2), w, h);
    g.restore();
  }

  function draw() {
    const gm = game;
    if (!gm) return;
    const g = canvas.getContext('2d')!;
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    g.imageSmoothingEnabled = false;
    // Night sky, stars drifting down, the moon, the rooftop.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d0912');
    sky.addColorStop(1, '#2b2034');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    for (const s of stars) {
      const y = (s.y + gm.time * 6 * s.s) % H;
      g.fillStyle = s.s === 3 ? '#fff4e0' : '#75668a';
      g.fillRect(s.x, y, 1, 1);
    }
    g.fillStyle = '#f4e3b0';
    g.beginPath();
    g.arc(150, 30, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a2c46';
    g.fillRect(0, H - 16, W, 16);
    g.fillStyle = '#4a3a57';
    for (let i = 0; i < W; i += 8) g.fillRect(i, H - 16, 7, 2);

    const t = gm.time;
    for (const e of gm.enemies) {
      if (e.hit > 0 && Math.floor(t * 40) % 2) continue;
      sprite(g, `${e.kind}_${Math.floor(t * 6 + e.id) % 4}`, e.x, e.y);
    }
    if (gm.boss) {
      const b = gm.boss;
      sprite(g, b.hit > 0 ? `bosshit_${Math.floor(t * 10) % 3}` : `boss_${Math.floor(t * 6) % 5}`, b.x, b.y);
      g.fillStyle = '#0d0912';
      g.fillRect(30, 22, W - 60, 5);
      g.fillStyle = '#ff8f7a';
      g.fillRect(31, 23, (W - 62) * (b.hp / b.max), 3);
    }
    for (const d of gm.drops) sprite(g, d.kind, d.x, d.y);
    for (const s of gm.shots) sprite(g, `${s.magic ? 'magic' : 'shuriken'}_${Math.floor(t * 12) % 2}`, s.x, s.y);
    for (const f of gm.fire) sprite(g, `fire_${Math.floor(t * 10) % 4}`, f.x, f.y);
    for (const bm of gm.booms) sprite(g, `boom_${Math.min(8, Math.floor((bm.t / 0.6) * 9))}`, bm.x, bm.y);
    // You: your own character, from behind, on the rooftop (blinking just after a hit).
    if (skins && !(gm.hurt > 0 && Math.floor(t * 12) % 2)) {
      const moving = input.left || input.right || input.targetX !== null;
      const fr = skinFrame(deps.me().skin, moving ? 'walk' : 'idle', 'up', moving ? Math.floor(t * 8) % 4 : 0);
      const cols = skins.width / 16;
      const sx = (fr.frame % cols) * 16;
      const sy = Math.floor(fr.frame / cols) * 16;
      g.drawImage(skins, sx, sy, 16, 16, Math.round(gm.x - 8), H - 30 - 8, 16, 16);
      if (gm.power > 0) sprite(g, `shield_${Math.floor(t * 10) % 6}`, gm.x, H - 30);
    }
    // Score, wave, lives.
    g.font = '8px "Pixelify Sans", monospace';
    g.textBaseline = 'top';
    g.fillStyle = '#fff4e0';
    g.fillText(gm.score.toLocaleString(), 6, 6);
    g.textAlign = 'center';
    g.fillStyle = '#bcaccb';
    g.fillText(`Wave ${gm.waveNumber}`, W / 2, 6);
    g.textAlign = 'left';
    for (let i = 0; i < gm.lives; i++) sprite(g, 'heart', W - 12 - i * 13, 10);
    if (gm.banner > 0) {
      g.textAlign = 'center';
      g.font = '16px "Pixelify Sans", monospace';
      g.fillStyle = '#f4b860';
      g.fillText(gm.boss ? 'Giant Spirit!' : `Wave ${gm.waveNumber}`, W / 2, H / 2 - 20);
      g.textAlign = 'left';
    }
    if (paused) {
      g.fillStyle = 'rgba(13,9,18,.6)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.font = '16px "Pixelify Sans", monospace';
      g.fillStyle = '#fff4e0';
      g.fillText('Paused', W / 2, H / 2 - 8);
      g.textAlign = 'left';
    }
  }

  // ---- Game over: save the score, then the result ----
  async function finish() {
    const gm = game;
    if (!gm || !body.isConnected) return;
    const score = gm.score;
    const before = localBest();
    if (score > before) saveLocalBest(score);
    pauseBtn.hidden = true;
    const card = el('div', 'arcade-title');
    const big = el('p', 'arcade-score', score.toLocaleString());
    big.id = 'arcade-score';
    const note = el('p', 'v2-note', 'Saving your score…');
    note.id = 'arcade-result';
    const again = el('button', 'dh-btn');
    again.type = 'button';
    again.id = 'arcade-again';
    again.append(icon('rotate-ccw'), 'Play again');
    again.addEventListener('click', start);
    const back = el('button', 'dh-btn dh-btn--quiet');
    back.type = 'button';
    back.append(icon('arrow-left'), 'Scores');
    back.addEventListener('click', titleCard);
    card.append(el('div', 'dh-label', `Game over · wave ${gm.waveNumber}`), big, note, again, back);
    body.replaceChildren(card);
    again.focus({ preventScroll: true });
    const r = await deps.submit(score, gm.wave, Math.round(gm.time * 1000));
    if (!note.isConnected) return;
    if (r.ok) {
      if (r.record && r.xp) {
        note.textContent = `New house record! +${r.xp} XP`;
        play('levelup', 0.9);
      } else if (r.new_best && r.xp) {
        note.textContent = `New personal best! +${r.xp} XP`;
        play('win', 0.8);
      } else if (r.new_best) note.textContent = score < 300 ? 'New best! Bests pay XP from 300 points.' : 'New best! (Bests pay XP 3 times a day: more tomorrow.)';
      else note.textContent = `Your best: ${r.best.toLocaleString()} · house record: ${r.house_best.toLocaleString()}`;
    } else {
      note.textContent =
        r.why === 'guest' ? 'Guests’ scores aren’t saved: members get XP for bests.'
          : r.why === 'offline' ? (score > before ? 'New best on this device! (Test mode: not saved.)' : 'Test mode: not saved.')
            : r.why === 'too_soon' ? 'Saved scores are one every few seconds: that one wasn’t kept.'
              : 'Couldn’t save that score.';
    }
  }

  function stop() {
    cancelAnimationFrame(raf);
    game = null;
    removeEventListener('keydown', down, true);
    removeEventListener('keyup', up, true);
    document.removeEventListener('visibilitychange', hidden);
    open = null;
    deps.onClose?.();
  }

  titleCard();
  return { get game() { return game; } };
}
