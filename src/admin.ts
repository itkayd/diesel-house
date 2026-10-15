import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './ui/theme.css';
import { el } from './ui/modal';

// Diesel's door list (/admin.html): who's knocking, a sign-in link for each to email from your own
// address, and the guest list. Talks to /api/admin with the passcode (ADMIN_PASSCODE on the server).

type Req = { id: number; email: string; created_at: string; status: 'pending' | 'sent' | 'dismissed'; handled_at: string | null };
type Guest = { email: string; added_at: string };
const KEY = 'diesel-house.admin-passcode';
const root = document.getElementById('admin')!;
root.style.cssText = 'max-width:640px;margin:0 auto;padding:24px 16px 48px;display:grid;gap:22px;color:var(--cream);font-family:var(--font-body)';
document.body.style.overflow = 'auto';
document.documentElement.style.overflow = 'auto';

let passcode = sessionStorage.getItem(KEY) ?? '';

async function api<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode, action, ...extra }),
  });
  const body = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  if (res.status === 401) {
    passcode = '';
    sessionStorage.removeItem(KEY);
  }
  if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
  return body as T;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

function header() {
  const h = el('header');
  h.style.cssText = 'display:grid;gap:4px';
  const t = el('h1', '', 'Door list');
  t.style.cssText = 'margin:0;font-family:var(--font-display);font-size:34px;text-shadow:0 0 18px rgba(244,184,96,.45),3px 3px 0 var(--panel-edge)';
  h.append(t, el('p', 'dh-lede', 'Who’s knocking at Diesel House, and who’s on the guest list.'));
  return h;
}

function showLock(error = '') {
  root.replaceChildren(header());
  const card = el('form', 'dh-panel');
  card.id = 'lock';
  const label = el('label', 'dh-label', 'Passcode');
  label.htmlFor = 'passcode';
  const input = el('input', 'dh-input');
  input.type = 'password';
  input.id = 'passcode';
  input.autocomplete = 'current-password';
  const err = el('p', 'dh-error', error);
  err.hidden = !error;
  const go = el('button', 'dh-btn', 'Open the door list');
  go.type = 'submit';
  card.append(label, input, err, go);
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    passcode = input.value;
    sessionStorage.setItem(KEY, passcode);
    void load();
  });
  root.append(card);
  input.focus();
}

function emailHref(to: string, link: string) {
  const subject = 'Your key to Diesel House';
  const body = `Hi!\n\nHere's your link into Diesel House. Tap it on the phone or computer you'll use, and the door opens:\n\n${link}\n\nIt works once and runs out after a while, so use it soon. If it has expired, knock again on the login page and I'll send a new one.\n\nSee you inside.`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function linkBox(email: string, link: string) {
  const box = el('div');
  box.className = 'link-box';
  box.style.cssText = 'display:grid;gap:8px;padding:10px;background:var(--panel-edge);box-shadow:inset 0 0 0 2px var(--lamp)';
  const field = el('input', 'dh-input');
  field.readOnly = true;
  field.value = link;
  field.setAttribute('aria-label', `Sign-in link for ${email}`);
  const row = el('div');
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
  const mail = el('a', 'dh-btn', 'Write the email');
  mail.href = emailHref(email, link);
  const copy = el('button', 'dh-btn dh-btn--quiet', 'Copy link');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    field.select();
    await navigator.clipboard?.writeText(link).catch(() => document.execCommand('copy'));
    copy.textContent = 'Copied';
  });
  row.append(mail, copy);
  box.append(field, row, el('small', 'dh-lede', 'Send it from your own email. The link works once.'));
  return box;
}

function requestRow(r: Req) {
  const row = el('div', 'dh-panel');
  row.dataset.request = String(r.id);
  row.style.cssText = 'padding:12px 14px;gap:10px';
  const top = el('div', 'dh-row');
  const who = el('div', 'txt');
  const strong = el('b', '', r.email);
  strong.style.cssText = 'font-family:var(--font-display);overflow-wrap:anywhere';
  who.append(strong, el('small', '', `knocked ${when(r.created_at)}`));
  const actions = el('div');
  actions.style.cssText = 'display:flex;gap:8px;flex:none';
  const get = el('button', 'dh-btn', 'Get link');
  get.type = 'button';
  const dismiss = el('button', 'dh-btn dh-btn--quiet', 'Dismiss');
  dismiss.type = 'button';
  actions.append(get, dismiss);
  top.append(who, actions);
  row.append(top);
  get.addEventListener('click', async () => {
    get.disabled = true;
    get.textContent = 'Making link…';
    try {
      const { link } = await api<{ link: string }>('link', { email: r.email, redirectTo: location.origin });
      actions.remove();
      row.append(linkBox(r.email, link));
    } catch (e) {
      get.disabled = false;
      get.textContent = 'Get link';
      row.append(el('p', 'dh-error', (e as Error).message));
    }
  });
  dismiss.addEventListener('click', async () => {
    await api('dismiss', { id: r.id }).catch(() => {});
    row.remove();
  });
  return row;
}

function section(title: string, ...children: Node[]) {
  const s = el('section');
  s.style.cssText = 'display:grid;gap:10px';
  const h = el('h2', 'dh-title', title);
  s.append(h, ...children);
  return s;
}

async function load() {
  let data: { requests: Req[]; guests: Guest[] };
  try {
    data = await api('list');
  } catch (e) {
    return showLock((e as Error).message);
  }
  root.replaceChildren(header());
  const pending = data.requests.filter((r) => r.status === 'pending');
  const knocking = pending.length ? pending.map(requestRow) : [el('p', 'dh-lede', 'Nobody knocking right now.')];
  const refresh = el('button', 'dh-btn dh-btn--quiet', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => void load());
  root.append(section(`Knocking (${pending.length})`, ...knocking, refresh));

  // A link for anyone, without them knocking first.
  const direct = el('form');
  direct.id = 'direct-link';
  direct.style.cssText = 'display:flex;gap:10px';
  const de = el('input', 'dh-input');
  de.type = 'email';
  de.placeholder = 'friend@example.com';
  de.setAttribute('aria-label', 'Email for a sign-in link');
  const dg = el('button', 'dh-btn', 'Get link');
  dg.type = 'submit';
  direct.append(de, dg);
  const directOut = el('div');
  directOut.style.cssText = 'display:grid;gap:8px';
  direct.addEventListener('submit', async (e) => {
    e.preventDefault();
    directOut.replaceChildren();
    try {
      const { link, email } = await api<{ link: string; email: string }>('link', { email: de.value, redirectTo: location.origin });
      directOut.append(linkBox(email, link));
    } catch (err) {
      directOut.append(el('p', 'dh-error', (err as Error).message));
    }
  });
  root.append(section('Send a link to someone', el('p', 'dh-lede', 'Adds them to the guest list too.'), direct, directOut));

  const guests = data.guests.map((g) => {
    const row = el('div', 'dh-row');
    row.dataset.guest = g.email;
    row.style.cssText = 'padding:4px 0;box-shadow:inset 0 -1px 0 var(--line)';
    const t = el('span', '', g.email);
    t.style.overflowWrap = 'anywhere';
    const rm = el('button', 'dh-btn dh-btn--quiet', 'Remove');
    rm.type = 'button';
    rm.style.cssText = 'min-height:36px;font-size:14px;padding:4px 10px 6px';
    rm.addEventListener('click', async () => {
      if (!confirm(`Take ${g.email} off the guest list? They won't get back in.`)) return;
      await api('guest-remove', { email: g.email }).catch(() => {});
      void load();
    });
    row.append(t, rm);
    return row;
  });
  root.append(section(`Guest list (${data.guests.length})`, ...guests));

  const done = data.requests.filter((r) => r.status !== 'pending').slice(0, 15);
  if (done.length)
    root.append(
      section(
        'Recently handled',
        ...done.map((r) => el('div', 'dh-lede', `${r.email} · ${r.status === 'sent' ? 'link made' : 'dismissed'} ${when(r.handled_at ?? r.created_at)}`)),
      ),
    );
}

if (passcode) void load();
else showLock();
