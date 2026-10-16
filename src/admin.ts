import '@fontsource/pixelify-sans/500.css';
import '@fontsource/pixelify-sans/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './ui/theme.css';
import { el } from './ui/modal';
import { PASSWORD_MIN } from './shared/members';

// Diesel's door list (/admin.html): make single-use invite codes for the 8 friends, see who has joined,
// reset a forgotten password, remove someone. Talks to /api/admin with the passcode (ADMIN_PASSCODE).

type Code = { id: number; label: string | null; created_at: string; used_at: string | null; usedByName: string | null; revoked_at: string | null };
type Member = { id: string; name: string; joined: string; lastSeen: string | null };
const KEY = 'diesel-house.admin-passcode';
const root = document.getElementById('admin')!;
root.style.cssText = 'max-width:640px;margin:0 auto;padding:24px 16px 48px;display:grid;gap:24px;color:var(--cream);font-family:var(--font-body)';
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

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function header() {
  const h = el('header');
  h.style.cssText = 'display:grid;gap:4px';
  const t = el('h1', '', 'Door list');
  t.style.cssText = 'margin:0;font-family:var(--font-display);font-size:34px;text-shadow:0 0 18px rgba(244,184,96,.45),3px 3px 0 var(--panel-edge)';
  h.append(t, el('p', 'dh-lede', 'Invite codes for your 8 friends, and who has joined Diesel House.'));
  return h;
}

function section(title: string, ...children: Node[]) {
  const s = el('section');
  s.style.cssText = 'display:grid;gap:10px';
  s.append(el('h2', 'dh-title', title), ...children);
  return s;
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

// The new code, shown once: copy it into your group chat or a message.
function codeCard(code: string, label: string) {
  const box = el('div', 'dh-panel');
  box.id = 'new-code';
  box.style.boxShadow = 'var(--frame-drop), inset 0 0 0 2px var(--lamp)';
  const big = el('div', '', code);
  big.style.cssText = 'font-family:var(--font-display);font-size:34px;letter-spacing:.08em;color:var(--lamp);text-align:center';
  const row = el('div');
  row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
  const copy = el('button', 'dh-btn', 'Copy code');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(code).catch(() => {});
    copy.textContent = 'Copied';
  });
  const message = `Your invite to Diesel House${label ? `, ${label}` : ''}: open ${location.origin}, tap "Join the house" and use the code ${code}. It works once.`;
  const copyMsg = el('button', 'dh-btn dh-btn--quiet', 'Copy a message with it');
  copyMsg.type = 'button';
  copyMsg.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(message).catch(() => {});
    copyMsg.textContent = 'Copied';
  });
  row.append(copy, copyMsg);
  box.append(el('div', 'dh-label', label ? `Code for ${label}` : 'New code'), big, row, el('small', 'dh-lede', "Shown only now. It works once; if it's lost, cancel it and make another."));
  return box;
}

async function load() {
  let data: { codes: Code[]; members: Member[]; guests: number };
  try {
    data = await api('list');
  } catch (e) {
    return showLock((e as Error).message);
  }
  root.replaceChildren(header());

  // Make a code.
  const make = el('form');
  make.id = 'make-code';
  make.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap';
  const label = el('input', 'dh-input');
  label.placeholder = 'Who is it for? (optional)';
  label.maxLength = 40;
  label.style.flex = '1 1 200px';
  label.setAttribute('aria-label', 'Who the code is for');
  const go = el('button', 'dh-btn', 'Make an invite code');
  go.type = 'submit';
  make.append(label, go);
  const out = el('div');
  make.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true;
    try {
      const { code } = await api<{ code: string }>('make-code', { label: label.value });
      out.replaceChildren(codeCard(code, label.value.trim()));
      label.value = '';
      void refreshLists();
    } catch (err) {
      out.replaceChildren(el('p', 'dh-error', (err as Error).message));
    } finally {
      go.disabled = false;
    }
  });
  root.append(section('Invite a friend', el('p', 'dh-lede', 'Each code makes one account. Friends pick their own name and password.'), make, out));

  // Codes you already have: one per line, optionally with who it's for ("Sami: ABCD-1234").
  const add = el('form');
  add.id = 'add-codes';
  add.style.cssText = 'display:grid;gap:10px';
  const lines = el('textarea', 'dh-input');
  lines.id = 'codes-to-add';
  lines.rows = 8;
  lines.placeholder = 'Sami: ABCD-1234\nLayla: EFGH-5678';
  lines.setAttribute('aria-label', 'Codes to add, one per line');
  lines.style.cssText = 'font-family:var(--font-display);resize:vertical;min-height:120px';
  const addGo = el('button', 'dh-btn', 'Add these codes');
  addGo.type = 'submit';
  const added = el('div');
  added.id = 'codes-added';
  added.style.cssText = 'display:grid;gap:4px';
  add.append(lines, addGo, added);
  add.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codes = lines.value
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/([A-Za-z]{4})[\s-]?(\d{4})/);
        if (!m) return { code: l, label: '' };
        const label = (l.slice(0, m.index) + l.slice(m.index! + m[0].length)).replace(/^[\s:=,–-]+|[\s:=,–-]+$/g, '');
        return { code: `${m[1]}-${m[2]}`, label };
      });
    if (!codes.length) return;
    addGo.disabled = true;
    try {
      const { results } = await api<{ results: { code: string; label: string | null; ok: boolean; problem?: string }[] }>('add-codes', { codes });
      added.replaceChildren(
        ...results.map((r) => {
          const p = el('p', r.ok ? 'dh-lede' : 'dh-error', `${r.ok ? '✓' : '✗'} ${r.label ? r.label + ': ' : ''}${r.code}${r.ok ? ' added' : ' – ' + r.problem}`);
          p.style.margin = '0';
          return p;
        }),
      );
      lines.value = results.filter((r) => !r.ok).map((r) => (r.label ? `${r.label}: ${r.code}` : r.code)).join('\n');
      void refreshLists();
    } catch (err) {
      added.replaceChildren(el('p', 'dh-error', (err as Error).message));
    } finally {
      addGo.disabled = false;
    }
  });
  root.append(
    section(
      'Add codes you already have',
      el('p', 'dh-lede', 'One per line, four letters then four numbers. Put who it is for in front if you like. Each works once, for one friend.'),
      add,
    ),
  );

  const lists = el('div');
  lists.style.cssText = 'display:grid;gap:24px';
  root.append(lists);
  render(data);

  async function refreshLists() {
    try {
      render(await api('list'));
    } catch {
      // keep what's shown
    }
  }

  function render(d: typeof data) {
    const open = d.codes.filter((c) => !c.used_at && !c.revoked_at);
    const openRows = open.map((c) => {
      const row = el('div', 'dh-row');
      row.dataset.code = String(c.id);
      row.style.boxShadow = 'inset 0 -1px 0 var(--line)';
      const t = el('span', 'txt', c.label || 'Unnamed code');
      t.append(el('small', '', `made ${when(c.created_at)}, not used yet`));
      const cancel = el('button', 'dh-btn dh-btn--quiet', 'Cancel');
      cancel.type = 'button';
      cancel.style.cssText = 'min-height:36px;font-size:14px;padding:4px 10px 6px';
      cancel.addEventListener('click', async () => {
        await api('revoke-code', { id: c.id }).catch(() => {});
        void refreshLists();
      });
      row.append(t, cancel);
      return row;
    });

    const memberRows = d.members.map((m) => {
      const row = el('div');
      row.dataset.member = m.id;
      row.style.cssText = 'display:grid;gap:8px;padding:6px 0;box-shadow:inset 0 -1px 0 var(--line)';
      const top = el('div', 'dh-row');
      const t = el('span', 'txt');
      const b = el('b', '', m.name);
      b.style.fontFamily = 'var(--font-display)';
      t.append(b, el('small', '', m.lastSeen ? `last in ${when(m.lastSeen)}` : `joined ${when(m.joined)}`));
      const acts = el('div');
      acts.style.cssText = 'display:flex;gap:8px;flex:none';
      const small = 'min-height:36px;font-size:14px;padding:4px 10px 6px';
      const reset = el('button', 'dh-btn dh-btn--quiet', 'Reset password');
      reset.type = 'button';
      reset.style.cssText = small;
      const remove = el('button', 'dh-btn dh-btn--quiet', 'Remove');
      remove.type = 'button';
      remove.style.cssText = small;
      acts.append(reset, remove);
      top.append(t, acts);
      row.append(top);
      reset.addEventListener('click', () => {
        if (row.querySelector('form')) return;
        const f = el('form');
        f.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        const p = el('input', 'dh-input');
        p.type = 'text';
        p.placeholder = `New password (${PASSWORD_MIN}+ characters)`;
        p.style.flex = '1 1 180px';
        p.setAttribute('aria-label', `New password for ${m.name}`);
        const save = el('button', 'dh-btn', 'Set');
        save.type = 'submit';
        const msg = el('small', 'dh-lede');
        f.append(p, save, msg);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('reset-password', { userId: m.id, password: p.value });
            msg.textContent = `Done. Tell ${m.name} their new password.`;
          } catch (err) {
            msg.textContent = (err as Error).message;
          }
        });
        row.append(f);
        p.focus();
      });
      remove.addEventListener('click', async () => {
        if (!confirm(`Remove ${m.name} from Diesel House? Their account and profile are deleted; any room they own becomes empty.`)) return;
        await api('remove-member', { userId: m.id }).catch((e) => alert((e as Error).message));
        void refreshLists();
      });
      return row;
    });

    const used = d.codes.filter((c) => c.used_at || c.revoked_at).slice(0, 10);
    lists.replaceChildren(
      section(`Codes not used yet (${open.length})`, ...(openRows.length ? openRows : [el('p', 'dh-lede', 'None.')])),
      section(`Members (${d.members.length} of 8)`, ...(memberRows.length ? memberRows : [el('p', 'dh-lede', 'Nobody has joined yet.')])),
      section(
        'History',
        ...used.map((c) =>
          el('div', 'dh-lede', c.revoked_at ? `${c.label || 'A code'} was cancelled` : `${c.label || 'A code'} was used by ${c.usedByName ?? 'someone'} on ${when(c.used_at!)}`),
        ),
        el('div', 'dh-lede', `Guest visits so far: ${d.guests}`),
      ),
    );
  }
}

if (passcode) void load();
else showLock();
