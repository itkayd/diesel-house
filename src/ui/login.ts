import './login.css';
import { requestAccess } from '../net/auth';

// The front door: design/login/login.html ported as-is (same copy, fonts, colours, animated living room).
// Shown before the game when nobody is signed in. Resolves never by itself: the magic link brings the
// player back signed in, and main.ts takes over from there.

const SRC = {
  scene: 'assets/ui/login_scene.png',
  adam: 'assets/characters/limezu_adam_idle.png',
  amelia: 'assets/characters/limezu_amelia_idle.png',
};
const T = 16;
const SW = 384; // scene size in pixels (24 x 11 tiles)
const SH = 176;
const DOOR_X = 12 * T; // centre of the front door

const HTML = `
<canvas id="scene" aria-hidden="true"></canvas>
<main class="stage">
  <header class="sign">
    <h1>Diesel House</h1>
    <p>8 rooms · walk in to talk</p>
  </header>
  <section class="card" aria-live="polite">
    <form id="login" novalidate style="display:grid;gap:14px">
      <h2>Knock to come in</h2>
      <p class="lede">Step into a room and you hear everyone inside. Step back into the hallway and it goes quiet.</p>
      <div class="field">
        <label for="email">Your email</label>
        <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
      </div>
      <p id="err" class="error" hidden></p>
      <button id="go" class="knock" type="submit">Knock on the door</button>
      <p class="fine">Invite only. Diesel emails you a link that opens the door, so there's no password to remember.</p>
    </form>
    <div id="sent" hidden style="display:grid;gap:12px">
      <h2>Knock knock!</h2>
      <p class="lede">Diesel heard you. He'll email a link to <span id="sentTo" class="email-out"></span>. Open it and the door opens.</p>
      <p class="fine">He sends them himself, so it can take a little while. Check spam if it doesn't turn up.</p>
      <button id="again" class="linkish" type="button">Use a different email</button>
    </div>
  </section>
</main>`;

let root: HTMLDivElement | null = null;
let raf = 0;

export function showLogin(error?: string) {
  if (root) {
    if (error) showError(error);
    return;
  }
  root = document.createElement('div');
  root.id = 'login-screen';
  root.innerHTML = HTML;
  document.body.append(root);
  const $ = <E extends HTMLElement>(sel: string) => root!.querySelector(sel) as E;
  startScene($<HTMLCanvasElement>('#scene'));

  const form = $<HTMLFormElement>('#login');
  const email = $<HTMLInputElement>('#email');
  const go = $<HTMLButtonElement>('#go');
  const sent = $<HTMLDivElement>('#sent');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const address = email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      showError('Type the email address your invite went to, like you@example.com.');
      email.focus();
      return;
    }
    go.disabled = true;
    go.textContent = 'Knocking…';
    try {
      await requestAccess(address);
      $('#sentTo').textContent = address;
      form.hidden = true;
      sent.hidden = false;
      doorTarget = 1;
    } catch (ex) {
      showError(ex instanceof Error ? ex.message : "The link didn't send. Check your connection and try again.");
    } finally {
      go.disabled = false;
      go.textContent = 'Knock on the door';
    }
  });
  $('#again').addEventListener('click', () => {
    sent.hidden = true;
    form.hidden = false;
    doorTarget = 0;
    email.select();
  });
  if (error) showError(error);
}

function showError(text: string) {
  const err = root?.querySelector<HTMLParagraphElement>('#err');
  const form = root?.querySelector<HTMLFormElement>('#login');
  if (!err || !form) return;
  form.hidden = false;
  root!.querySelector<HTMLDivElement>('#sent')!.hidden = true;
  err.textContent = text;
  err.hidden = false;
}

function hideError() {
  const err = root?.querySelector<HTMLParagraphElement>('#err');
  if (err) err.hidden = true;
}

export function hideLogin() {
  cancelAnimationFrame(raf);
  window.removeEventListener('resize', layout);
  root?.remove();
  root = null;
}

// ---- the living-room scene (same drawing as the design) ----
let ctx: CanvasRenderingContext2D;
let canvas: HTMLCanvasElement;
const imgs: Record<string, HTMLImageElement> = {};
let s = 3;
let ox = 0;
let oy = 0;
let doorOpen = 0;
let doorTarget = 0;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// light sources in scene pixels: fairy-light strands, fireplace, windows
const strands = [
  [2.5, 2],
  [8, 2],
  [14, 2],
  [21, 2],
];
const fire = { x: 20 * T, y: 2.9 * T };

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  s = Math.max(2, Math.ceil(Math.max(canvas.width / SW, canvas.height / SH)));
  ox = Math.round(canvas.width / 2 - DOOR_X * s); // keep the door centred
  ox = Math.min(0, Math.max(canvas.width - SW * s, ox));
  oy = 0;
  ctx.imageSmoothingEnabled = false;
}

function sprite(img: HTMLImageElement, frame: number, x: number, y: number) {
  ctx.drawImage(img, frame * 16, 0, 16, 32, ox + x * s, oy + y * s, 16 * s, 32 * s);
}

function glow(x: number, y: number, r: number, color: string, a: number) {
  const g = ctx.createRadialGradient(ox + x * s, oy + y * s, 0, ox + x * s, oy + y * s, r * s);
  g.addColorStop(0, color.replace('A', String(a)));
  g.addColorStop(1, color.replace('A', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(ox + (x - r) * s, oy + (y - r) * s, r * 2 * s, r * 2 * s);
}

function frame(t: number) {
  const sec = t / 1000;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#140f1c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imgs.scene, ox, oy, SW * s, SH * s);

  // characters: Amelia by the sofa facing right, Adam on the rug facing the viewer
  const f = reduce ? 0 : Math.floor(sec * 7) % 6;
  sprite(imgs.amelia, 0 + f, 8.4 * T, 3.6 * T);
  const adamFacing = doorTarget ? 6 : 18; // turns to face the door once you knock
  sprite(imgs.adam, adamFacing + f, 11.5 * T, 4.1 * T);

  // night: tint everything, then add warm light back
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#6b5c86';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalCompositeOperation = 'lighter';
  const flick = reduce ? 0.5 : 0.45 + 0.12 * Math.sin(sec * 9) + 0.06 * Math.sin(sec * 23);
  glow(fire.x, fire.y, 70, 'rgba(244,150,60,A)', flick * 0.55);
  strands.forEach(([tx, ty], i) => {
    const tw = reduce ? 0.5 : 0.4 + 0.18 * Math.sin(sec * 2.2 + i * 1.7);
    glow(tx * T + 16, ty * T + 6, 34, 'rgba(255,226,170,A)', tw * 0.45);
  });
  glow(6.5 * T, 3 * T, 40, 'rgba(150,180,255,A)', 0.12); // moonlight through the curtains
  glow(17 * T, 3 * T, 36, 'rgba(150,180,255,A)', 0.1);

  // the door: a warm spill of light once you knock
  doorOpen += (doorTarget - doorOpen) * (reduce ? 1 : 0.06);
  if (doorOpen > 0.01) glow(DOOR_X, 3.4 * T, 30 + 40 * doorOpen, 'rgba(255,200,120,A)', 0.7 * doorOpen);

  // soft vignette so the card and title read clearly
  ctx.globalCompositeOperation = 'source-over';
  const v = ctx.createLinearGradient(0, 0, 0, canvas.height);
  v.addColorStop(0, 'rgba(20,15,28,0.35)');
  v.addColorStop(0.45, 'rgba(20,15,28,0)');
  v.addColorStop(1, 'rgba(20,15,28,0.75)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  raf = requestAnimationFrame(frame);
}

function startScene(c: HTMLCanvasElement) {
  canvas = c;
  ctx = c.getContext('2d')!;
  let loaded = 0;
  for (const [k, src] of Object.entries(SRC)) {
    const im = new Image();
    im.onload = () => {
      if (++loaded === Object.keys(SRC).length) {
        layout();
        raf = requestAnimationFrame(frame);
      }
    };
    im.src = src;
    imgs[k] = im;
  }
  window.addEventListener('resize', layout);
}
