import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '../ui/theme.css';
import './admin.css';
import { act, api, btn, field, h, icon, input, SignedOut, toast, whenSignedOut, type Icon } from './kit';
import { dashboard } from './sections/dashboard';
import { players } from './sections/players';
import { invites } from './sections/invites';
import { rooms } from './sections/rooms';
import { house } from './sections/house';
import { critters } from './sections/critters';
import { shop } from './sections/shop';
import { scores } from './sections/scores';
import { logs } from './sections/logs';
import { reports } from './sections/reports';
import { audit } from './sections/audit';

// The admin page (/admin.html): everything in the house in one place. Admins sign in with their own
// username + password (api/admin.ts); the very first one is made with the setup passcode.

export type Section = { id: string; label: string; icon: Icon; render: (main: HTMLElement, go: (id: string) => void) => Promise<void> | void };
const SECTIONS: Section[] = [dashboard, players, reports, invites, rooms, house, shop, critters, scores, logs, audit];

const root = document.getElementById('admin')!;
let me = '';

// ---- Signing in ----
function gate(setupNeeded: boolean, error = '') {
  document.title = 'Admin · Diesel House';
  const user = input({ id: 'adm-user', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: 3, maxlength: 32 });
  const pass = input({ id: 'adm-pass', type: 'password', autocomplete: setupNeeded ? 'new-password' : 'current-password', required: true, minlength: setupNeeded ? 12 : 1 });
  const code = setupNeeded ? input({ id: 'adm-code', type: 'password', autocomplete: 'one-time-code', required: true }) : null;
  const err = h('p', { class: 'adm-err', role: 'alert', id: 'adm-error' }, error);
  const go = h('button', { type: 'submit', class: 'adm-btn gold', id: 'adm-go' }, icon(setupNeeded ? 'shield' : 'key'), setupNeeded ? 'Create admin and sign in' : 'Sign in');
  const form = h(
    'form',
    { class: 'adm-card adm-gate-card', id: 'adm-gate' },
    h('div', { class: 'adm-brand' }, h('img', { src: '/icons/favicon-32.png', alt: '' }), h('h1', {}, 'Diesel House', h('small', {}, setupNeeded ? 'First-time admin setup' : 'Admin'))),
    setupNeeded
      ? h('p', { class: 'adm-hint' }, 'Make the first admin account. You need the setup passcode (ADMIN_PASSCODE in the Vercel settings) once; after that you sign in with this username and password.')
      : null,
    field('Username', user, setupNeeded ? '3–32 letters, numbers, dots, dashes or underscores.' : undefined),
    field('Password', pass, setupNeeded ? 'At least 12 characters. A short sentence is easy to remember and hard to guess.' : undefined),
    code ? field('Setup passcode', code) : null,
    err,
    go,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    void act(go, async () => {
      try {
        const r = await api<{ username: string }>(setupNeeded ? 'setup' : 'login', { username: user.value.trim(), password: pass.value, passcode: code?.value });
        me = r.username;
        shell();
      } catch (e) {
        err.textContent = (e as Error).message;
        pass.select();
        throw e;
      }
    });
  });
  root.replaceChildren(h('div', { class: 'adm-gate' }, form));
  user.focus();
}

// ---- The page ----
let current = 'dashboard';
let nav: HTMLElement;
let main: HTMLElement;
function shell() {
  const out = btn('Sign out', () => void signOut(), { icon: 'logout', kind: 'ghost', small: true });
  out.classList.add('adm-menu-out');
  nav = h('nav', { class: 'adm-nav', 'aria-label': 'Sections' });
  for (const s of SECTIONS) {
    nav.append(h('button', { type: 'button', 'data-id': s.id, id: `nav-${s.id}`, onclick: () => show(s.id) }, icon(s.icon), h('span', {}, s.label)));
  }
  main = h('main', { class: 'adm-main', id: 'adm-main', tabindex: '-1' });
  root.replaceChildren(
    h(
      'div',
      { class: 'adm-shell' },
      h('header', { class: 'adm-top' }, h('div', { class: 'adm-top-row' }, h('h1', {}, 'Diesel House'), h('span', { class: 'adm-who', id: 'adm-who' }, `Signed in as ${me}`), out), nav),
      main,
    ),
  );
  const fromHash = location.hash.slice(1);
  show(SECTIONS.some((s) => s.id === fromHash) ? fromHash : 'dashboard');
  void refreshCounts();
}

export function show(id: string) {
  const s = SECTIONS.find((x) => x.id === id) ?? SECTIONS[0];
  current = s.id;
  history.replaceState(null, '', `#${s.id}`);
  for (const b of nav.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
    if (b.dataset.id === s.id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  // Phones: the tab row scrolls sideways to show the current one (the desktop sidebar never scrolls sideways).
  const tab = nav.querySelector<HTMLElement>(`[data-id="${s.id}"]`);
  if (tab && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: tab.offsetLeft - 16, behavior: 'smooth' });
  document.title = `${s.label} · Admin · Diesel House`;
  main.replaceChildren();
  main.scrollTop = 0;
  scrollTo(0, 0);
  Promise.resolve(s.render(main, show)).catch((e) => {
    if (e instanceof SignedOut) return;
    if (current === s.id) main.append(h('div', { class: 'adm-empty' }, icon('warn'), h('span', {}, `Couldn’t load this: ${(e as Error).message}`), btn('Try again', () => show(s.id), { icon: 'refresh' })));
  });
}

// The little red numbers in the menu: open device logs, rejected Night Raid runs this week.
export async function refreshCounts() {
  try {
    const o = await api<{ logs_open: number; rejected_week: number; player_reports_open?: number }>('overview');
    setCount('logs', o.logs_open);
    setCount('reports', o.player_reports_open ?? 0);
    setCount('scores', o.rejected_week ?? 0);
  } catch {
    // shown again next time
  }
}
function setCount(id: string, count: number) {
  const b = nav?.querySelector(`[data-id="${id}"]`);
  if (!b) return;
  b.querySelector('.adm-count')?.remove();
  if (count > 0) b.append(h('span', { class: 'adm-count', 'aria-label': `${count} to look at` }, count > 99 ? '99+' : count));
}

async function signOut() {
  try {
    await api('logout');
  } catch {
    // signed out either way
  }
  me = '';
  gate(false);
  toast('Signed out.');
}

whenSignedOut(() => {
  if (!me) return;
  me = '';
  gate(false, 'Your session ended (8 hours, or signed out elsewhere). Sign in again.');
});

async function boot() {
  root.replaceChildren(h('div', { class: 'adm-gate' }, h('div', { class: 'adm-skel', style: 'width:min(420px,100%);height:280px' })));
  try {
    const s = await api<{ setupNeeded: boolean; username: string | null }>('status');
    if (s.username) {
      me = s.username;
      shell();
    } else gate(s.setupNeeded);
  } catch (e) {
    root.replaceChildren(h('div', { class: 'adm-gate' }, h('div', { class: 'adm-card adm-gate-card' }, h('h1', {}, 'Admin'), h('p', { class: 'adm-err' }, (e as Error).message), btn('Try again', () => void boot(), { icon: 'refresh', kind: 'gold' }))));
  }
}
void boot();
