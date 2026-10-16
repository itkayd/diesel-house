import type { RoomId } from '../config';
import { deleteMessage, loadChat, MAX_LENGTH, postMessage, setReaction, type Message, type Reaction } from '../net/chat';
import type { ChatChange } from '../net/presence';
import { icon } from './icons';
import { el } from './modal';
import { hudBottomRight, overlay, zoneLabel } from './overlay';
import { portrait } from './portrait';

// Room chat (design/game/mvp.html `openChat`): a button by the mic while you're in a room (with an unread
// dot), opening a side panel on desktop or a bottom sheet on phones. Late joiners see the last 100
// messages. Tap a message for reactions (OpenMoji) and, on your own, delete. Times are in your time zone.

const REACTIONS: [string, string][] = [
  ['👍', '1F44D'],
  ['😂', '1F602'],
  ['🔥', '1F525'],
  ['❤️', '2764'],
  ['😮', '1F62E'],
  ['👀', '1F440'],
];
const emojiImg = (emoji: string, size = 18) => {
  const hex = REACTIONS.find(([e]) => e === emoji)?.[1];
  const img = document.createElement('img');
  img.src = `assets/ui/openmoji/${hex ?? '1F44D'}.svg`;
  img.alt = emoji;
  img.width = img.height = size;
  img.style.display = 'block';
  return img;
};
const GROUP_MS = 5 * 60_000; // messages this close together from one person are grouped

type Me = { id: string; name: string; character: number };

export class ChatPanel {
  private button: HTMLButtonElement;
  private dot: HTMLSpanElement;
  private sheet: HTMLDivElement | null = null;
  private list: HTMLDivElement | null = null;
  private room: RoomId | null = null;
  private messages: Message[] = [];
  private reactions = new Map<number, Map<string, Set<string>>>(); // message -> emoji -> people
  private openBar: number | null = null;
  private loadToken = 0;

  constructor(private me: () => Me) {
    this.button = el('button', 'dh-iconbtn');
    this.button.type = 'button';
    this.button.id = 'chat-button';
    this.button.setAttribute('aria-label', 'Room chat');
    this.dot = el('span', 'dh-badge-dot');
    this.dot.id = 'unread';
    this.dot.hidden = true;
    this.button.append(icon('message-square'), this.dot);
    this.button.hidden = true;
    this.button.addEventListener('click', () => (this.sheet ? this.close() : void this.open()));
    hudBottomRight().prepend(this.button);
  }

  get isOpen() {
    return !!this.sheet;
  }

  // Entering a room shows the button and loads its chat; the hallway hides both.
  setRoom(room: RoomId | null) {
    if (room === this.room) return;
    this.room = room;
    this.close();
    this.messages = [];
    this.reactions.clear();
    this.dot.hidden = true;
    this.button.hidden = !room;
    if (room) void this.load();
  }

  private async load() {
    const token = ++this.loadToken;
    const room = this.room!;
    const { messages, reactions } = await loadChat(room);
    if (token !== this.loadToken) return;
    this.messages = messages;
    this.reactions.clear();
    for (const r of reactions) this.addReaction(r);
    this.render();
  }

  private async open() {
    if (!this.room || this.sheet) return;
    const sheet = el('div', 'dh-sheet dh-sheet--side');
    sheet.id = 'chat';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', `Chat in ${zoneLabel(this.room)}`);
    sheet.style.pointerEvents = 'auto';
    const head = el('div');
    const grip = el('div', 'dh-grip');
    const bar = el('div', 'dh-sheet__head');
    const title = el('span', 'grow', zoneLabel(this.room));
    const x = el('button', 'dh-iconbtn');
    x.type = 'button';
    x.id = 'chat-close';
    x.style.cssText = 'width:36px;height:36px';
    x.setAttribute('aria-label', 'Close chat');
    x.append(icon('x'));
    x.addEventListener('click', () => this.close());
    bar.append(icon('message-square', { width: 18 }), title, x);
    head.append(grip, bar);
    this.list = el('div', 'dh-sheet__body');
    this.list.id = 'msgs';
    this.list.setAttribute('aria-live', 'polite');
    const form = el('form', 'dh-sheet__foot');
    const input = el('input', 'dh-input');
    input.id = 'chat-input';
    input.maxLength = MAX_LENGTH;
    input.placeholder = `Message ${zoneLabel(this.room)}`;
    input.setAttribute('aria-label', 'Message');
    input.autocomplete = 'off';
    const send = el('button', 'dh-iconbtn');
    send.type = 'submit';
    send.id = 'chat-send';
    send.setAttribute('aria-label', 'Send');
    send.style.cssText = 'background:var(--lamp);color:var(--panel-edge)';
    send.append(icon('send'));
    form.append(input, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !this.room) return;
      input.value = '';
      const err = await postMessage(this.room, text, this.me());
      if (err) {
        input.value = text;
        this.note(`Couldn't send: ${err}`);
      }
    });
    sheet.append(head, this.list, form);
    overlay().append(sheet);
    this.sheet = sheet;
    this.dot.hidden = true;
    this.render();
    if (window.matchMedia('(pointer: fine)').matches) input.focus();
  }

  close() {
    this.sheet?.remove();
    this.sheet = null;
    this.list = null;
    this.openBar = null;
  }

  // A live change from the database (any room you may see).
  event(e: ChatChange) {
    if (e.table === 'messages') {
      const m = e.row as unknown as Message;
      if (e.type === 'INSERT') {
        if (m.room_id !== this.room || this.messages.some((x) => x.id === m.id)) return;
        this.messages.push(m);
        if (this.messages.length > 200) this.messages.shift();
        if (!this.sheet && m.author_id !== this.me().id) this.dot.hidden = false;
      } else {
        this.messages = this.messages.filter((x) => x.id !== m.id);
        this.reactions.delete(m.id);
      }
    } else {
      const r = e.row as unknown as Reaction;
      if (!this.messages.some((x) => x.id === r.message_id)) return;
      if (e.type === 'INSERT') this.addReaction(r);
      else this.reactions.get(r.message_id)?.get(r.emoji)?.delete(r.author_id);
    }
    this.render();
  }

  private addReaction(r: Reaction) {
    let byEmoji = this.reactions.get(r.message_id);
    if (!byEmoji) this.reactions.set(r.message_id, (byEmoji = new Map()));
    let people = byEmoji.get(r.emoji);
    if (!people) byEmoji.set(r.emoji, (people = new Set()));
    people.add(r.author_id);
  }

  private note(text: string) {
    this.list?.append(el('div', 'dh-day', text));
  }

  private render() {
    const list = this.list;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren();
    if (!this.messages.length) {
      const empty = el('div', 'dh-lede', 'No messages yet. Say hi.');
      empty.style.cssText = 'text-align:center;padding:30px 10px';
      list.append(empty);
      return;
    }
    const me = this.me().id;
    let lastDay = '';
    let prev: Message | null = null;
    for (const m of this.messages) {
      const when = new Date(m.created_at);
      const day = when.toDateString();
      if (day !== lastDay) {
        list.append(el('div', 'dh-day', dayLabel(when)));
        lastDay = day;
        prev = null;
      }
      const cont = !!prev && !!m.author_id && prev.author_id === m.author_id && when.getTime() - new Date(prev.created_at).getTime() < GROUP_MS;
      const row = el('div', 'dh-msg' + (cont ? ' dh-msg--cont' : ''));
      row.dataset.message = String(m.id);
      row.tabIndex = 0;
      const meta = el('div', 'meta');
      meta.append(
        el('span', 'name', !m.author_guest ? m.author_name : m.author_host ? `${m.author_name} · friend of ${m.author_host}` : `${m.author_name} · guest`),
        el('span', 'time', when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })),
      );
      const text = el('div', 'text', m.text);
      row.append(portrait(m.author_character, 32), meta, text);

      const counts = this.reactions.get(m.id);
      const chips = [...(counts ?? new Map<string, Set<string>>()).entries()].filter(([, s]) => s.size);
      if (chips.length) {
        const reacts = el('div', 'dh-reacts');
        for (const [emoji, people] of chips) {
          const b = el('button', 'dh-react');
          b.type = 'button';
          const mine = people.has(me);
          b.setAttribute('aria-pressed', String(mine));
          b.setAttribute('aria-label', `${emoji} ${people.size}`);
          b.append(emojiImg(emoji, 16), el('span', '', String(people.size)));
          b.addEventListener('click', () => void setReaction(m.id, emoji, !mine));
          reacts.append(b);
        }
        row.append(reacts);
      }
      if (this.openBar === m.id) row.append(this.reactionBar(m, me));
      const toggle = () => {
        this.openBar = this.openBar === m.id ? null : m.id;
        this.render();
      };
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        toggle();
      });
      row.addEventListener('keydown', (e) => e.key === 'Enter' && toggle());
      list.append(row);
      prev = m;
    }
    if (atBottom || this.openBar === null) list.scrollTop = list.scrollHeight;
  }

  // The 6 reactions, plus Delete on your own messages.
  private reactionBar(m: Message, me: string) {
    const bar = el('div', 'dh-reactbar');
    bar.style.gridColumn = '2';
    for (const [emoji] of REACTIONS) {
      const b = el('button');
      b.type = 'button';
      b.setAttribute('aria-label', `React ${emoji}`);
      b.dataset.react = emoji;
      b.append(emojiImg(emoji, 22));
      const mine = !!this.reactions.get(m.id)?.get(emoji)?.has(me);
      b.addEventListener('click', () => {
        this.openBar = null;
        void setReaction(m.id, emoji, !mine);
      });
      bar.append(b);
    }
    if (m.author_id === me) {
      const del = el('button', '', 'Delete');
      del.type = 'button';
      del.dataset.delete = String(m.id);
      del.style.cssText = 'width:auto;padding:0 8px;color:var(--error);font-family:var(--font-display);font-size:13px';
      del.addEventListener('click', () => {
        this.openBar = null;
        void deleteMessage(m.id);
      });
      bar.append(del);
    }
    return bar;
  }
}

function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
