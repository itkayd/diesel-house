import type { Skin } from '../characters';
import type { RoomId, Zone } from '../config';
import { icon } from './icons';
import { el, openModal } from './modal';
import { hudButtons } from './overlay';
import { portrait } from './portrait';
import { critterIcon } from '../critters/art';

// "Who's where" (design/game/v2.html showPeople): a map button in the HUD opens a little map of the house
// with everyone on it, and a list of friends with where they are. Tap a room on the map, or Go next to a
// friend, and you walk there by yourself (any move of your own stops it). Dots follow people live.

type Box = { x: number; y: number; w: number; h: number };
export type WhoWhere = {
  size: { w: number; h: number }; // the house, px
  zones: { name: Zone; rect: Box; outline: { x: number; y: number }[] }[]; // rect: bounding box; outline: the real shape
  me: { x: number; y: number; zone: Zone | null };
  people: { id: string; name: string; character: Skin; x: number; y: number; zone: Zone | null; talking: boolean }[];
  label: (zone: Zone) => string;
  critters: { id: string; name: string; x: number; y: number; zone: Zone | null }[]; // to catch right now
  critterSeconds: number; // until they wander off
  goRoom: (room: RoomId) => void;
  goTo: (id: string) => void;
  // U4: your friends (in the house now or not) and friend requests, with Join / Accept.
  friends?: { id: string; name: string; character: Skin | null; status: 'friends' | 'incoming' | 'outgoing'; online: boolean; zone: Zone | null; lastSeen: string | null }[];
  answer?: (id: string, yes: boolean) => Promise<void>;
  profile?: (id: string, name: string) => void; // tap a face: their profile
  invite?: () => void; // members: open the invite code (shown when nobody else is in)
  // Hide and seek mode: set while a round is on. Nobody's dot, room count or whereabouts shows (only you and
  // the critters), and Join / Go are gone; the line says why.
  secret?: string | null;
};

export function addWhosWhereButton(get: () => WhoWhere) {
  const b = el('button', 'dh-iconbtn');
  b.type = 'button';
  b.id = 'map-button';
  b.setAttribute('aria-label', 'Who’s where');
  b.append(icon('map'));
  b.addEventListener('click', () => openWhosWhere(get));
  hudButtons().prepend(b);
}

// Friends first: requests to answer, then friends (Join the ones in the house), then requests you sent.
function friendRows(w: WhoWhere, close: () => void, get: () => WhoWhere) {
  const box = el('div', 'v2-list');
  box.id = 'friends-list';
  box.append(el('div', 'dh-label', 'Friends'));
  const order = { incoming: 0, friends: 1, outgoing: 2 } as const;
  const list = [...(w.friends ?? [])].sort((a, b) => order[a.status] - order[b.status] || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  for (const f of list) {
    const row = el('div', 'v2-item');
    row.dataset.friend = f.id;
    const txt = el('span');
    txt.style.cssText = 'display:grid;gap:2px;min-width:0;flex:1';
    const where = f.online ? (w.secret ? 'In the house' : !f.zone || f.zone === 'hallway' ? 'In the Great Hall' : `In ${w.label(f.zone)}`) : f.lastSeen ? `Last on ${lastOn(f.lastSeen)}` : 'Not in the house';
    const sub = f.status === 'incoming' ? 'Wants to be friends' : f.status === 'outgoing' ? 'Request sent' : where;
    txt.append(el('span', 't', f.name), el('span', 's', sub));
    const btn = (label: string, ic: Parameters<typeof icon>[0], go: () => void, id: string, quiet = true) => {
      const b = el('button', quiet ? 'dh-btn dh-btn--quiet' : 'dh-btn');
      b.type = 'button';
      b.dataset.act = id;
      b.append(icon(ic, { width: 18 }), document.createTextNode(label));
      b.addEventListener('click', go);
      return b;
    };
    const iconOnly = (label: string, go: () => void, id: string) => {
      const b = el('button', 'dh-iconbtn');
      b.type = 'button';
      b.dataset.act = id;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.append(icon('x'));
      b.addEventListener('click', go);
      return b;
    };
    const answer = (yes: boolean) => () => void w.answer?.(f.id, yes).catch(() => {});
    const acts: HTMLElement[] =
      f.status === 'incoming' ? [btn('Accept', 'check', answer(true), 'accept', false), iconOnly('Not now', answer(false), 'decline')]
        : f.status === 'outgoing' ? [btn('Cancel', 'x', answer(false), 'cancel')]
          : f.online && !w.secret ? [btn('Join', 'footprints', () => (close(), get().goTo(f.id)), 'join', false)] : [];
    row.append(faceButton(f.id, f.name, f.character ? portrait(f.character, 32) : icon('user-round', { width: 32 }), w, close), txt, ...acts);
    box.append(row);
  }
  return box;
}
// A face you can tap for their profile (when the house offers profiles).
function faceButton(id: string, name: string, face: Element, w: WhoWhere, close: () => void) {
  const open = w.profile;
  if (!open) return face;
  const b = el('button', 'dh-facebtn');
  b.type = 'button';
  b.dataset.profile = id;
  b.setAttribute('aria-label', `${name}’s profile`);
  b.append(face);
  b.addEventListener('click', () => {
    close();
    open(id, name);
  });
  return b;
}

const lastOn = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 86400_000;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 14 ? `${Math.floor(d)} days ago` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

export function openWhosWhere(get: () => WhoWhere) {
  const ui = openModal('whos-where', { dismissable: true, label: 'whos-where-title', onDismiss: () => clearInterval(timer) });
  const close = () => {
    clearInterval(timer);
    ui.close();
  };
  const head = el('div', 'v2-head');
  const h = el('h2', '', 'Who’s where');
  h.id = 'whos-where-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'whos-where-close';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(icon('map'), h, x);

  const w0 = get();
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const mini = el('div', 'v2-mini');
  mini.id = 'whos-where-map';
  mini.style.aspectRatio = `${w0.size.w} / ${w0.size.h}`;
  for (const z of w0.zones) {
    const room = z.name !== 'hallway';
    const zb = el(room ? 'button' : 'div', 'zone' + (room ? '' : ' hall'));
    zb.style.cssText = `left:${pct(z.rect.x, w0.size.w)};top:${pct(z.rect.y, w0.size.h)};width:${pct(z.rect.w, w0.size.w)};height:${pct(z.rect.h, w0.size.h)}`;
    // Odd shapes (the octagon house's diagonal rooms) are cut to their outline.
    if (z.outline.length > 4) zb.style.clipPath = `polygon(${z.outline.map((p) => `${pct(p.x - z.rect.x, z.rect.w)} ${pct(p.y - z.rect.y, z.rect.h)}`).join(',')})`;
    if (room) {
      const b = zb as HTMLButtonElement;
      b.type = 'button';
      b.dataset.go = z.name;
      b.setAttribute('aria-label', `Go to ${w0.label(z.name)}`);
      b.addEventListener('click', () => {
        close();
        get().goRoom(z.name as RoomId);
      });
    }
    const lab = el('span', 'lab', room ? w0.label(z.name) : 'Great Hall');
    zb.append(lab);
    // How many friends are in there (set as they move).
    if (room) {
      const n = el('span', 'n');
      n.hidden = true;
      zb.append(n);
    }
    mini.append(zb);
  }
  const dots = el('div', 'dots');
  mini.append(dots);

  const list = el('div', 'v2-list');
  list.id = 'whos-where-list';
  const note = el('p', 'v2-note', 'Tap a room on the map, or Go next to a friend, and you’ll walk there. Move any way to stop.');

  let lastList = '';
  let critNote = el('p');
  const secretNote = el('p', 'v2-note hs-secret');
  secretNote.id = 'whos-where-secret';
  const draw = () => {
    const w0 = get();
    // Hide and seek: nobody else on the map or in the list.
    const w = w0.secret ? { ...w0, people: [] } : w0;
    secretNote.hidden = !w0.secret;
    secretNote.replaceChildren(...(w0.secret ? [icon('eye-off', { width: 18 }), document.createTextNode(w0.secret)] : []));
    note.textContent = w0.secret ? 'Tap a room on the map and you’ll walk there. Move any way to stop.' : 'Tap a room on the map, or Go next to a friend, and you’ll walk there. Move any way to stop.';
    // Dots: friends' faces, and you (blinking).
    dots.replaceChildren(
      ...w.people.map((p) => {
        const d = el('span', 'dot');
        d.style.left = pct(p.x, w.size.w);
        d.style.top = pct(p.y - 6, w.size.h);
        d.append(portrait(p.character, 10));
        d.title = p.name;
        return d;
      }),
    );
    // People per room, on the map.
    const count = new Map<Zone, number>();
    for (const p of w.people) if (p.zone) count.set(p.zone, (count.get(p.zone) ?? 0) + 1);
    for (const b of mini.querySelectorAll<HTMLButtonElement>('button.zone')) {
      const n = b.querySelector<HTMLElement>('.n')!;
      const k = count.get(b.dataset.go as Zone) ?? 0;
      n.hidden = !k;
      n.textContent = String(k);
      b.setAttribute('aria-label', `Go to ${w.label(b.dataset.go as Zone)}${k ? ` (${k} here)` : ''}`);
    }
    const crit = el('p', 'v2-note');
    crit.id = 'whos-where-critter';
    for (const c of w.critters) {
      const d = el('span', 'dot critter');
      d.style.left = pct(c.x, w.size.w);
      d.style.top = pct(c.y - 6, w.size.h);
      d.append(critterIcon(c.id, 12));
      d.title = c.name;
      dots.append(d);
    }
    if (w.critters.length) {
      const m = Math.floor(w.critterSeconds / 60);
      const left = m ? `${m}:${String(w.critterSeconds % 60).padStart(2, '0')}` : `${w.critterSeconds} s`;
      const where = (z: Zone | null) => (!z || z === 'hallway' ? 'the Great Hall' : w.label(z));
      const c0 = w.critters[0];
      crit.textContent =
        w.critters.length === 1
          ? `A ${c0.name.toLowerCase()} is in ${where(c0.zone)} for another ${left}. Catch it!`
          : `${w.critters.length} critters about for another ${left}: ${w.critters.map((c) => `${c.name.toLowerCase()} (${where(c.zone)})`).join(', ')}.`;
    }
    critNote.replaceWith(crit);
    critNote = crit;
    const me = el('span', 'dot me');
    me.style.left = pct(w.me.x, w.size.w);
    me.style.top = pct(w.me.y - 6, w.size.h);
    dots.append(me);
    // The list only when someone moved zone (so a Go button isn't rebuilt under a finger).
    const key = String(!!w0.secret) + w.people.map((p) => `${p.id}:${p.zone}:${p.talking}`).join('|') + '#' + (w.friends ?? []).map((f) => `${f.id}:${f.status}:${f.online}:${f.zone}`).join('|');
    if (key === lastList) return;
    lastList = key;
    list.replaceChildren();
    const friendIds = new Set((w.friends ?? []).filter((f) => f.status === 'friends').map((f) => f.id));
    if (w.friends?.length) list.append(friendRows(w, close, get));
    if (!w.people.length && !w0.secret) {
      list.append(el('p', 'v2-note', 'Nobody else is in the house right now.'));
      if (w.invite) {
        const inv = el('button', 'dh-btn dh-btn--quiet');
        inv.type = 'button';
        inv.id = 'whos-where-invite';
        inv.append(icon('ticket', { width: 18 }), document.createTextNode('Invite a friend as a guest'));
        const go = w.invite;
        inv.addEventListener('click', () => {
          close();
          go();
        });
        list.append(inv);
      }
    }
    if (w.people.length && w.friends?.length) list.append(el('div', 'dh-label', 'Everyone in the house'));
    for (const p of [...w.people].sort((a, b) => Number(friendIds.has(b.id)) - Number(friendIds.has(a.id)))) {
      const row = el('div', 'v2-item');
      row.dataset.person = p.id;
      const txt = el('span');
      txt.style.cssText = 'display:grid;gap:2px;min-width:0';
      const where = !p.zone || p.zone === 'hallway' ? 'Great Hall' : w.label(p.zone);
      txt.append(el('span', 't', (friendIds.has(p.id) ? '★ ' : '') + (p.name || 'Someone')), el('span', 's', where + (p.talking ? ' · in a voice chat' : '')));
      const go = el('button', 'dh-btn dh-btn--quiet');
      go.type = 'button';
      go.dataset.walk = p.id;
      go.append(icon('footprints', { width: 18 }), document.createTextNode('Go'));
      go.addEventListener('click', () => {
        close();
        get().goTo(p.id);
      });
      row.append(faceButton(p.id, p.name, portrait(p.character, 32), w, close), txt, go);
      list.append(row);
    }
  };
  draw();
  const timer = setInterval(() => (document.getElementById('whos-where') ? draw() : clearInterval(timer)), 500);
  ui.panel.append(head, secretNote, mini, critNote, note, list);
}
