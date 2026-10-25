import type { Skin } from '../characters';
import { history, markRead, onDm, onUnread, sendDm, threads, type Dm } from '../net/dms';
import { isBlocked } from '../net/social';
import { icon } from './icons';
import { el, openModal } from './modal';
import { hudButtons } from './overlay';
import { portrait } from './portrait';
import { play } from './sounds';
import { toast } from './toasts';

// Private messages (src/net/dms.ts): a Messages button in the top bar (with how many are unread), the
// inbox, and a conversation. A message arriving while you're elsewhere pops up with Reply.

export type MessagesDeps = {
  me: () => string;
  nameOf: (id: string) => { name: string; character: Skin | null } | null; // someone in the house now
  profile: (id: string, name: string) => void;
};

let open: { with: string; add: (m: Dm) => void } | null = null;

export function addMessagesButton(deps: MessagesDeps) {
  if (document.getElementById('messages-button')) return; // joining again (after a reconnect): already there
  const b = el('button', 'dh-iconbtn');
  b.type = 'button';
  b.id = 'messages-button';
  b.setAttribute('aria-label', 'Messages');
  b.append(icon('mail'));
  const badge = el('span', 'dh-count');
  badge.hidden = true;
  b.append(badge);
  b.addEventListener('click', () => openInbox(deps));
  // Top-right bar: Map · Messages · Settings.
  const row = hudButtons();
  const map = row.querySelector('#map-button');
  if (map) map.after(b);
  else row.prepend(b);
  onUnread((n) => {
    badge.hidden = n <= 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    b.setAttribute('aria-label', n ? `Messages (${n} unread)` : 'Messages');
  });
  // Arriving while the conversation isn't open: a pop-up with Reply.
  onDm((m) => {
    if (open?.with === m.sender) return open.add(m);
    if (isBlocked(m.sender)) return;
    const who = deps.nameOf(m.sender);
    play('emote', 0.5);
    toast({
      icon: 'mail',
      id: 'dm-toast',
      who: who?.name ?? 'New message',
      what: m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text,
      ttl: 8000,
      actions: [{ label: 'Reply', id: 'dm-reply', onClick: () => (document.getElementById('dm-toast')?.remove(), openConversation(m.sender, who?.name ?? 'Someone', who?.character ?? null, deps)) }],
    });
  });
}

function header(title: string, close: () => void, extra?: HTMLElement) {
  const head = el('div', 'v2-head');
  const t = el('h2', '', title);
  t.id = 'dm-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(icon('mail'), t, ...(extra ? [extra] : []), x);
  return head;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export function openInbox(deps: MessagesDeps) {
  const ui = openModal('dm-inbox', { dismissable: true, label: 'dm-title' });
  const list = el('div', 'v2-list');
  list.id = 'dm-threads';
  list.append(el('div', 'dh-skeleton'), el('div', 'dh-skeleton'));
  ui.panel.append(header('Messages', ui.close), list);
  threads().then(
    (ts) => {
      list.replaceChildren();
      if (!ts.length) {
        list.append(el('p', 'v2-note', 'No messages yet. Tap someone in the house, open their profile and choose Message.'));
        return;
      }
      for (const t of ts) {
        const row = el('button', 'v2-item dm-thread');
        row.type = 'button';
        row.dataset.thread = t.id;
        const txt = el('span');
        txt.style.cssText = 'display:grid;gap:2px;min-width:0;flex:1;text-align:left';
        const last = el('span', 's', `${t.last_mine ? 'You: ' : ''}${t.last_text ?? ''}`);
        last.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        txt.append(el('span', 't', t.name ?? 'Someone'), last);
        const side = el('span', 'dm-side');
        side.append(el('span', 's', when(t.last_at)));
        if (t.unread) side.append(el('span', 'dh-count', String(t.unread)));
        row.append(t.character ? portrait(t.character, 32) : icon('user-round'), txt, side);
        row.addEventListener('click', () => {
          ui.close();
          openConversation(t.id, t.name ?? 'Someone', t.character, deps);
        });
        list.append(row);
      }
    },
    (e) => list.replaceChildren(el('p', 'v2-note', (e as Error).message)),
  );
}

export function openConversation(withId: string, name: string, character: Skin | null, deps: MessagesDeps) {
  const ui = openModal('dm-chat', { dismissable: true, label: 'dm-title', onDismiss: () => (open = null) });
  const close = () => {
    open = null;
    ui.close();
  };
  const prof = el('button', 'dh-iconbtn');
  prof.type = 'button';
  prof.id = 'dm-profile';
  prof.setAttribute('aria-label', `${name}’s profile`);
  prof.append(character ? portrait(character, 24) : icon('user-round'));
  prof.addEventListener('click', () => deps.profile(withId, name));
  const list = el('div', 'dm-list');
  list.id = 'dm-list';
  const form = el('form', 'dm-form');
  const input = el('textarea', 'dh-input');
  input.id = 'dm-input';
  input.rows = 1;
  input.maxLength = 500;
  input.placeholder = `Message ${name}`;
  input.setAttribute('aria-label', `Message ${name}`);
  const send = el('button', 'dh-btn');
  send.type = 'submit';
  send.id = 'dm-send';
  send.setAttribute('aria-label', 'Send');
  send.append(icon('send', { width: 18 }));
  send.disabled = true;
  form.append(input, send);
  ui.panel.classList.add('dm-panel');
  ui.panel.append(header(name, close, prof), list, el('p', 'v2-note dm-note', 'Only you two see these. Be kind; Report is on their profile.'), form);

  const me = deps.me();
  const bubble = (m: Dm) => {
    const mine = m.sender === me;
    const b = el('div', `dm-msg${mine ? ' mine' : ''}`);
    b.dataset.dm = String(m.id);
    b.append(el('span', 'tx', m.text), el('span', 'tm', when(m.created_at)));
    return b;
  };
  const add = (m: Dm) => {
    list.querySelector('.v2-note')?.remove();
    list.append(bubble(m));
    list.scrollTop = list.scrollHeight;
    if (m.sender !== me) void markRead(withId, 1);
  };
  open = { with: withId, add };
  history(withId).then(
    (ms) => {
      list.replaceChildren(...ms.map(bubble));
      if (!ms.length) list.append(el('p', 'v2-note', `Say hi to ${name}.`));
      list.scrollTop = list.scrollHeight;
      const unread = ms.filter((m) => m.sender === withId && !m.read_at).length;
      void markRead(withId, unread);
    },
    (e) => list.replaceChildren(el('p', 'v2-note', (e as Error).message)),
  );
  input.addEventListener('input', () => {
    send.disabled = !input.value.trim();
    input.style.height = 'auto';
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    sendDm(withId, text).then(
      (m) => {
        input.value = '';
        input.style.height = 'auto';
        add(m);
        play('click', 0.3);
      },
      (err) => {
        send.disabled = false;
        toast({ icon: 'info', who: 'Not sent', what: (err as Error).message, small: true, ttl: 3500 });
      },
    );
  });
  setTimeout(() => input.focus({ preventScroll: true }), 50);
}
