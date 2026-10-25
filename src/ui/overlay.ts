import type { Zone } from '../config';
import { NET_LABEL, type NetQuality } from '../net/netQuality';
import { DND_ICON, icon } from './icons';
import { roomDef } from '../house/rooms';

// HUD, as in design/game/mvp.html:
//   top-left:  [house  Great Hall / ● 4 in the house]   or   [door  Lounge (Quiet) / 2 here]  (two lines)
//   top-centre: toasts and banners          top-right: [profile] [settings]
//   bottom-left: joystick (touch)           bottom-right: [chat] [MIC]   (in a room)
//   (phones: one bottom bar instead: [chat][emotes] block · joystick in the middle · [MIC], theme.css)
export const overlay = () => document.getElementById('overlay') as HTMLDivElement;

const HUD_LABELS: [string, string][] = [
  ['guide-button', 'Help'],
  ['map-button', 'Map'],
  ['challenges-button', 'Challenges'],
  ['messages-button', 'Messages'],
  ['settings-button', 'Settings'],
  ['chat-button', 'Chat'],
  ['jukebox-button', 'Music'],
  ['emote-button', 'Emotes'],
  ['watch-button', 'Watch'],
];

type Hud = { tl: HTMLDivElement; tc: HTMLDivElement; tr: HTMLDivElement; bl: HTMLDivElement; br: HTMLDivElement; pill: HTMLDivElement };
let hud: Hud | null = null;

function build(): Hud {
  if (hud) return hud;
  const root = overlay();
  root.classList.add('dh-game');
  const box = document.createElement('div');
  box.className = 'dh-hud';
  const part = (cls: string) => {
    const d = document.createElement('div');
    d.className = cls;
    box.append(d);
    return d;
  };
  const tl = part('dh-hud-tl');
  const tc = part('dh-hud-tc');
  tc.id = 'toasts';
  const tr = part('dh-hud-tr');
  tr.id = 'hud-buttons';
  const bl = part('dh-hud-bl');
  const br = part('dh-hud-br');
  br.id = 'hud-bottom-right';
  const pill = document.createElement('div');
  pill.className = 'dh-pill dh-where';
  pill.id = 'where';
  pill.setAttribute('role', 'status');
  tl.append(pill);
  root.append(box);
  hud = { tl, tc, tr, bl, br, pill };
  // HUD buttons get a short name: a tooltip everywhere, and a label beside the icon on wide desktops.
  const label = () => {
    for (const [id, text] of HUD_LABELS) {
      const b = document.getElementById(id);
      if (b && !b.dataset.label) {
        b.dataset.label = text;
        b.title ||= text;
      }
    }
  };
  new MutationObserver(label).observe(box, { childList: true, subtree: true });
  label();
  return hud;
}

export const hudButtons = () => build().tr;
export const hudBottomRight = () => build().br;
export const hudBottomLeft = () => build().bl;
export const hudToasts = () => build().tc;

// Room names (src/house/rooms.ts) and "Do not disturb" (live, from the rooms table) for the HUD.
type RoomInfo = { name: string; dnd: boolean };
let roomInfo = (zone: Zone): RoomInfo => ({ name: zone === 'hallway' ? 'Great Hall' : (roomDef(zone)?.name ?? zone), dnd: false });
export function setRoomInfo(f: (zone: Zone) => RoomInfo) {
  roomInfo = f;
}
export const zoneLabel = (zone: Zone | null) => (zone ? roomInfo(zone).name : '');

// Connection bars in the where-am-I pill (Poor / Strong / Super strong), kept across pill redraws.
let netBadge: NetQuality | null = null;
function netBars(q: NetQuality) {
  const colour = q === 'super' ? 'var(--ok)' : q === 'strong' ? 'var(--lamp)' : 'var(--error)';
  const lit = q === 'super' ? 3 : q === 'strong' ? 2 : 1;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 5 7');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '14');
  svg.setAttribute('shape-rendering', 'crispEdges');
  [3, 5, 7].forEach((h, i) => {
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(i * 2));
    r.setAttribute('y', String(7 - h));
    r.setAttribute('width', '1');
    r.setAttribute('height', String(h));
    r.setAttribute('fill', i < lit ? colour : 'var(--faint)');
    svg.append(r);
  });
  const box = document.createElement('span');
  box.id = 'net';
  box.dataset.net = q;
  box.title = `Your connection: ${NET_LABEL[q]}`;
  box.setAttribute('aria-label', box.title);
  box.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:6px';
  const label = document.createElement('span');
  label.className = 'dh-sub';
  label.textContent = NET_LABEL[q];
  box.append(svg, label);
  return box;
}
export function setNetBadge(q: NetQuality) {
  netBadge = q;
  const old = document.getElementById('net');
  if (old) old.replaceWith(netBars(q));
  else document.getElementById('status')?.after(netBars(q));
}

// The where-am-I pill. `sub` is the head count ("4 in the house" / "2 here") or "Connecting…"/"Offline".
export function showWhere(zone: Zone | null, sub: string, state: 'ok' | 'warn' | 'off') {
  const { pill } = build();
  pill.dataset.state = state;
  const inRoom = !!zone && zone !== 'hallway';
  const info = zone ? roomInfo(zone) : { name: '', dnd: false };
  const place = document.createElement('span');
  place.id = 'where-zone';
  place.textContent = info.name || 'Diesel House';
  const status = document.createElement('span');
  status.className = 'dh-sub';
  status.id = 'status';
  // Two short lines: where you are (and Do not disturb), then the head count and your connection.
  const top = document.createElement('span');
  top.className = 'dh-where-top';
  top.append(place);
  if (inRoom && info.dnd) {
    const badge = document.createElement('span');
    badge.className = 'dh-mood';
    badge.id = 'where-dnd';
    badge.dataset.mood = 'dnd';
    badge.title = 'Do not disturb';
    badge.setAttribute('aria-label', 'Do not disturb');
    badge.append(icon(DND_ICON));
    top.append(badge);
  }
  if (!inRoom || state !== 'ok') {
    const dot = document.createElement('span');
    dot.className = `dh-dot dh-dot--${state}`;
    status.append(dot, ' ');
  }
  status.append(sub);
  const line = document.createElement('span');
  line.className = 'dh-where-sub';
  line.append(status);
  if (netBadge) line.append(netBars(netBadge));
  const text = document.createElement('span');
  text.className = 'dh-where-text';
  text.append(top, line);
  pill.replaceChildren(icon(inRoom ? 'door-open' : 'house'), text);
}
