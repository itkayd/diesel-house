import type { RoomId, Zone } from '../config';
import { icon } from './icons';
import { el, openModal } from './modal';
import { hudButtons } from './overlay';
import { portrait } from './portrait';

// "Who's where" (design/game/v2.html showPeople): a map button in the HUD opens a little map of the house
// with everyone on it, and a list of friends with where they are. Tap a room on the map, or Go next to a
// friend, and you walk there by yourself (any move of your own stops it). Dots follow people live.

type Box = { x: number; y: number; w: number; h: number };
export type WhoWhere = {
  size: { w: number; h: number }; // the house, px
  zones: { name: Zone; rect: Box }[];
  me: { x: number; y: number; zone: Zone | null };
  people: { id: string; name: string; character: number; x: number; y: number; zone: Zone | null; talking: boolean }[];
  label: (zone: Zone) => string;
  goRoom: (room: RoomId) => void;
  goTo: (id: string) => void;
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
    const lab = el('span', 'lab', room ? w0.label(z.name).replace(/'s room$/, '') : '');
    zb.append(lab);
    mini.append(zb);
  }
  const dots = el('div', 'dots');
  mini.append(dots);

  const list = el('div', 'v2-list');
  list.id = 'whos-where-list';
  const note = el('p', 'v2-note', 'Tap a room on the map, or Go next to a friend, and you’ll walk there. Move any way to stop.');

  let lastList = '';
  const draw = () => {
    const w = get();
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
    const me = el('span', 'dot me');
    me.style.left = pct(w.me.x, w.size.w);
    me.style.top = pct(w.me.y - 6, w.size.h);
    dots.append(me);
    // The list only when someone moved zone (so a Go button isn't rebuilt under a finger).
    const key = w.people.map((p) => `${p.id}:${p.zone}:${p.talking}`).join('|');
    if (key === lastList) return;
    lastList = key;
    list.replaceChildren();
    if (!w.people.length) list.append(el('p', 'v2-note', 'Nobody else is in the house right now.'));
    for (const p of w.people) {
      const row = el('div', 'v2-item');
      row.dataset.person = p.id;
      const txt = el('span');
      txt.style.cssText = 'display:grid;gap:2px;min-width:0';
      const where = !p.zone || p.zone === 'hallway' ? 'Hallway' : w.label(p.zone);
      txt.append(el('span', 't', p.name || 'Someone'), el('span', 's', where + (p.talking ? ' · talking' : '')));
      const go = el('button', 'dh-btn dh-btn--quiet');
      go.type = 'button';
      go.dataset.walk = p.id;
      go.append(icon('footprints', { width: 18 }), document.createTextNode('Go'));
      go.addEventListener('click', () => {
        close();
        get().goTo(p.id);
      });
      row.append(portrait(p.character, 32), txt, go);
      list.append(row);
    }
  };
  draw();
  const timer = setInterval(() => (document.getElementById('whos-where') ? draw() : clearInterval(timer)), 500);
  ui.panel.append(head, mini, note, list);
}
