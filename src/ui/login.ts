import './login.css';
import { houseIsOpen, joinWithCode, signInMember, visitAsGuest } from '../net/auth';
import { NAME_MAX, PASSWORD_MIN } from '../shared/members';
import skins from '../house/skins.json';

// The front door: design/login/login.html (same look, fonts, colours, animated living room), with three
// ways in and no emails: members sign in with name + password; new members join with Diesel's invite
// code; anyone can visit as a guest. main.ts takes over once there's a session.

const SRC = {
  scene: 'assets/ui/login_scene.png',
  skins: 'assets/characters/skins.png',
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
    <form id="signin" data-mode="signin" novalidate style="display:grid;gap:14px">
      <h2>Knock to come in</h2>
      <p class="lede">Step into a room and you hear everyone inside. Step back into the hallway and it goes quiet.</p>
      <div class="field">
        <label for="si-name">Your name</label>
        <input id="si-name" name="username" type="text" autocomplete="username" maxlength="${NAME_MAX}" required>
      </div>
      <div class="field">
        <label for="si-pass">Password</label>
        <input id="si-pass" name="password" type="password" autocomplete="current-password" required>
      </div>
      <p class="error" hidden></p>
      <button class="knock" type="submit">Knock on the door</button>
      <p class="fine">Got an invite code? <button class="linkish" type="button" data-go="join">Join the house</button><br>
        Just visiting? <button class="linkish" type="button" data-go="guest">Come in as a guest</button></p>
    </form>

    <form id="join" data-mode="join" hidden novalidate style="display:grid;gap:14px">
      <h2>Join the house</h2>
      <p class="lede">Use the invite code Diesel gave you. Pick a name and password: that's how you'll get back in, on any device.</p>
      <div class="field">
        <label for="jn-code">Invite code</label>
        <input id="jn-code" name="code" type="text" autocomplete="one-time-code" autocapitalize="characters" placeholder="ABCD-1234" required>
      </div>
      <div class="field">
        <label for="jn-name">Your name</label>
        <input id="jn-name" name="username" type="text" autocomplete="username" maxlength="${NAME_MAX}" required>
      </div>
      <div class="field">
        <label for="jn-pass">Password</label>
        <input id="jn-pass" name="new-password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" required>
      </div>
      <p class="error" hidden></p>
      <button class="knock" type="submit">Join</button>
      <p class="fine"><button class="linkish" type="button" data-go="signin">I already have a name and password</button></p>
    </form>

    <form id="guest" data-mode="guest" hidden novalidate style="display:grid;gap:14px">
      <h2>Visit as a guest</h2>
      <p class="lede">Ask a friend in the house for their invite code. Guests can look around and talk in rooms with open doors for 12 hours; you'll pick a name and character inside.</p>
      <div class="field">
        <label for="gs-code">Friend's invite code</label>
        <input id="gs-code" name="code" type="text" autocomplete="off" autocapitalize="characters" placeholder="ABCD-1234">
      </div>
      <p id="open-house" class="fine" hidden>The house is open right now: you can come in without a code.</p>
      <p class="error" hidden></p>
      <button class="knock" type="submit">Come in as a guest</button>
      <p class="fine"><button class="linkish" type="button" data-go="signin">Back</button></p>
    </form>
  </section>
</main>`;

let root: HTMLDivElement | null = null;
let raf = 0;
let done: (() => void) | null = null;

// Resolves once someone has come in through one of the forms (signed in, joined, or admitted as a guest).
export const loginDone = () => new Promise<void>((resolve) => (done = resolve));

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

  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go!)));

  const busy = async (form: HTMLFormElement, label: string, work: () => Promise<void>) => {
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const was = btn.textContent;
    hideError();
    btn.disabled = true;
    btn.textContent = label;
    doorTarget = 1;
    try {
      await work();
      done?.(); // in: main.ts takes over
    } catch (ex) {
      doorTarget = 0;
      showError(ex instanceof Error ? ex.message : "Couldn't come in. Try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  };

  const signin = $<HTMLFormElement>('#signin');
  signin.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('#si-name').value;
    const pass = $<HTMLInputElement>('#si-pass').value;
    if (!name.trim() || !pass) return showError('Type your name and password.');
    void busy(signin, 'Knocking…', () => signInMember(name, pass));
  });

  const join = $<HTMLFormElement>('#join');
  join.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $<HTMLInputElement>('#jn-code').value;
    const name = $<HTMLInputElement>('#jn-name').value;
    const pass = $<HTMLInputElement>('#jn-pass').value;
    if (!code.trim()) return showError('Type the invite code Diesel gave you.');
    if (!name.trim()) return showError('Pick a name.');
    if (pass.length < PASSWORD_MIN) return showError(`Your password needs at least ${PASSWORD_MIN} characters.`);
    void busy(join, 'Joining…', () => joinWithCode(code, name, pass));
  });

  const guest = $<HTMLFormElement>('#guest');
  guest.addEventListener('submit', (e) => {
    e.preventDefault();
    void busy(guest, 'Coming in…', () => visitAsGuest($<HTMLInputElement>('#gs-code').value));
  });

  if (error) showError(error);
}

function show(mode: string) {
  root?.querySelectorAll<HTMLFormElement>('form[data-mode]').forEach((f) => (f.hidden = f.dataset.mode !== mode));
  hideError();
  if (mode === 'guest')
    void houseIsOpen().then((open) => {
      const note = root?.querySelector<HTMLParagraphElement>('#open-house');
      if (note) note.hidden = !open;
    });
  root?.querySelector<HTMLInputElement>(`form[data-mode="${mode}"] input`)?.focus();
}

function visibleForm() {
  return root?.querySelector<HTMLFormElement>('form[data-mode]:not([hidden])') ?? null;
}

function showError(text: string) {
  const err = visibleForm()?.querySelector<HTMLParagraphElement>('.error');
  if (!err) return;
  err.textContent = text;
  err.hidden = false;
}

function hideError() {
  root?.querySelectorAll<HTMLParagraphElement>('.error').forEach((e) => (e.hidden = true));
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

// One Ninja Adventure person from the skins atlas (scripts/build_skins.py), feet at (x, y + 32) like the
// 16 × 32 people this scene was drawn for. `row`: 0-3 walk steps.
function sprite(key: string, facing: string, row: number, x: number, y: number) {
  const at = skins.skins.findIndex((k) => k.key === key);
  const col = (at % skins.perRow) * skins.facings.length + skins.facings.indexOf(facing);
  const r = Math.floor(at / skins.perRow) * skins.rows + row;
  ctx.drawImage(imgs.skins, col * 16, r * 16, 16, 16, ox + x * s, oy + (y + 16) * s, 16 * s, 16 * s);
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

  // characters: a woman by the sofa facing right, a boy on the rug facing the viewer, who turns to face
  // the door once you knock (a little bob now and then, so they look alive)
  const bob = reduce ? 0 : Math.floor(sec * 2) % 4 === 0 ? 1 : 0;
  sprite('ninja.woman', 'right', bob, 8.4 * T, 3.6 * T);
  sprite('ninja.boy', doorTarget ? 'up' : 'down', bob ? 2 : 0, 11.5 * T, 4.1 * T);

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
