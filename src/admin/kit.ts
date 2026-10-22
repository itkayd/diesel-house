// Small building blocks for the admin page: elements, icons, the API call, toasts, dialogs, formatting.
import {
  Activity, Ban, Check, CircleCheck, CircleX, Clock, Coins, Copy, createElement, DoorOpen, Eye, Flame, Gamepad2, Gem, House, Info, KeyRound,
  LayoutDashboard, LogOut, Megaphone, Minus, Moon, Music, PawPrint, Pencil, Plus, RefreshCw, RotateCcw, ScrollText, Search, ShieldAlert,
  ShieldCheck, SlidersHorizontal, Smartphone, Sparkles, Star, Ticket, Trash2, TriangleAlert, Trophy, Tv, UserPlus, Users, X, Bug,
  type IconNode,
} from 'lucide';

const ICONS = {
  activity: Activity, ban: Ban, check: Check, 'circle-check': CircleCheck, 'circle-x': CircleX, clock: Clock, coins: Coins, copy: Copy,
  door: DoorOpen, eye: Eye, flame: Flame, games: Gamepad2, gem: Gem, house: House, info: Info, key: KeyRound, dashboard: LayoutDashboard,
  logout: LogOut, megaphone: Megaphone, minus: Minus, moon: Moon, music: Music, paw: PawPrint, pencil: Pencil, plus: Plus, refresh: RefreshCw,
  undo: RotateCcw, scroll: ScrollText, search: Search, alert: ShieldAlert, shield: ShieldCheck, sliders: SlidersHorizontal, phone: Smartphone,
  sparkles: Sparkles, star: Star, ticket: Ticket, trash: Trash2, warn: TriangleAlert, trophy: Trophy, tv: Tv, 'user-plus': UserPlus,
  users: Users, x: X, bug: Bug,
} satisfies Record<string, IconNode>;
export type Icon = keyof typeof ICONS;
export const icon = (name: Icon) => createElement(ICONS[name], { 'aria-hidden': 'true' }) as unknown as SVGElement;

type Kid = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;
// h('button', { class: 'adm-btn', onclick: … }, icon('x'), 'Close')
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(typeof k === 'number' ? String(k) : k);
  return e;
}
export const btn = (label: string, onclick: () => void, opts: { icon?: Icon; kind?: 'gold' | 'danger' | 'ghost'; small?: boolean; id?: string; title?: string } = {}) =>
  h(
    'button',
    { type: 'button', class: ['adm-btn', opts.kind, opts.small ? 'small' : ''].filter(Boolean).join(' '), id: opts.id, title: opts.title, onclick: () => onclick() },
    opts.icon ? icon(opts.icon) : null,
    label,
  );
export const iconBtn = (name: Icon, label: string, onclick: () => void, id?: string) =>
  h('button', { type: 'button', class: 'adm-btn ghost icon', 'aria-label': label, title: label, id, onclick: () => onclick() }, icon(name));

// ---- The API (api/admin.ts). Signed out anywhere: back to the sign-in card. ----
export class SignedOut extends Error {}
let onSignedOut: () => void = () => {};
export const whenSignedOut = (f: () => void) => (onSignedOut = f);
export async function api<T = Record<string, unknown>>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/admin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const body = (await res.json().catch(() => ({ error: `The server had a problem (${res.status}).` }))) as T & { error?: string; signedOut?: boolean; ok?: boolean; why?: string };
  if (res.status === 401 && body.signedOut) {
    onSignedOut();
    throw new SignedOut(body.error ?? 'Signed out');
  }
  if (!res.ok) throw new Error(body.error ?? `The server had a problem (${res.status}).`);
  if (body && typeof body === 'object' && body.ok === false && body.why) throw new Error(body.why);
  return body;
}

// Runs an action with the button showing it's working; a toast says how it went.
export async function act(button: HTMLButtonElement | null, work: () => Promise<unknown>, done?: string) {
  if (button) button.disabled = true;
  try {
    await work();
    if (done) toast(done);
    return true;
  } catch (e) {
    if (!(e instanceof SignedOut)) toast((e as Error).message, true);
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- Toasts ----
let toasts: HTMLElement | null = null;
export function toast(text: string, bad = false) {
  if (!toasts) document.body.append((toasts = h('div', { class: 'adm-toasts', role: 'status', 'aria-live': 'polite' })));
  const t = h('div', { class: `adm-toast${bad ? ' bad' : ''}` }, icon(bad ? 'circle-x' : 'circle-check'), h('span', {}, text));
  toasts.append(t);
  while (toasts.children.length > 3) toasts.firstElementChild?.remove(); // only the latest few
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

// ---- Dialogs: confirm (optionally "type the name to confirm") and ask (a few fields) ----
export function confirmBox(title: string, text: string, opts: { ok?: string; danger?: boolean; typeToConfirm?: string } = {}): Promise<boolean> {
  return new Promise((done) => {
    const typed = opts.typeToConfirm ? h('input', { class: 'adm-in', 'aria-label': `Type ${opts.typeToConfirm} to confirm`, autocomplete: 'off' }) : null;
    const ok = btn(opts.ok ?? 'OK', () => close(true), { kind: opts.danger ? 'danger' : 'gold', id: 'dialog-ok' });
    if (typed) {
      ok.disabled = true;
      typed.addEventListener('input', () => (ok.disabled = typed.value.trim() !== opts.typeToConfirm));
    }
    const box = h(
      'div',
      { class: 'adm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'adm-card' }, h('h3', {}, title), h('p', {}, text), typed ? h('label', { class: 'adm-field' }, h('span', {}, `Type “${opts.typeToConfirm}” to confirm`), typed) : null, h('div', { class: 'adm-actions' }, btn('Cancel', () => close(false), { kind: 'ghost' }), ok)),
    );
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    function close(v: boolean) {
      removeEventListener('keydown', key);
      box.remove();
      done(v);
    }
    addEventListener('keydown', key);
    box.addEventListener('click', (e) => e.target === box && close(false));
    document.body.append(box);
    (typed ?? ok).focus();
  });
}

// ---- Bits of form ----
export function field(label: string, control: HTMLElement, hint?: string) {
  return h('label', { class: 'adm-field' }, h('span', {}, label), control, hint ? h('small', { class: 'adm-hint' }, hint) : null);
}
export function toggle(label: string, on: boolean, change: (on: boolean, box: HTMLInputElement) => void, hint?: string, id?: string) {
  const box = h('input', { type: 'checkbox', role: 'switch', id }) as HTMLInputElement;
  box.checked = on;
  box.addEventListener('change', () => change(box.checked, box));
  return h('label', { class: 'adm-switch' }, box, h('span', {}, label, hint ? h('small', {}, hint) : null));
}
export const input = (attrs: Attrs = {}) => h('input', { class: 'adm-in', ...attrs }) as HTMLInputElement;
export function empty(iconName: Icon, text: string, action?: HTMLElement) {
  return h('div', { class: 'adm-empty' }, icon(iconName), h('span', {}, text), action ?? null);
}
export const skeleton = (n = 3) => h('div', { class: 'adm-list' }, ...Array.from({ length: n }, () => h('div', { class: 'adm-skel' })));
export const badge = (text: string, kind: '' | 'ok' | 'warn' | 'bad' | 'info' = '') => h('span', { class: `adm-badge ${kind}` }, text);
export function card(title: string, iconName: Icon | null, ...kids: Kid[]) {
  return h('section', { class: 'adm-card' }, h('h3', {}, iconName ? icon(iconName) : null, title), ...kids);
}
export function sectionHead(title: string, lede: string, ...side: Kid[]) {
  return h('div', { class: 'adm-head' }, h('h2', {}, title), ...side, h('p', {}, lede));
}

// ---- Formatting (times in the viewer's own time zone) ----
export const n = (v: unknown) => Number(v ?? 0).toLocaleString();
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return `in ${Math.round(-s / 60)} min`;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return when(iso);
}
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const initial = (name: string | null | undefined) => (name?.trim()?.[0] ?? '?').toUpperCase();
export const debounce = <A extends unknown[]>(f: (...a: A) => void, ms = 200) => {
  let t = 0;
  return (...a: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => f(...a), ms);
  };
};
