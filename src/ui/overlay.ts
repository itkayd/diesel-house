import type { Zone } from '../config';
import { icon, MOODS, type Mood } from './icons';

// HUD, as in design/game/mvp.html:
//   top-left:  [house  Hallway  ● 4 in the house]   or   [door  Sami's room  (Chill)  2 here]
//   top-centre: toasts and banners          top-right: [profile] [settings]
//   bottom-left: joystick (touch)           bottom-right: [chat] [MIC]   (in a room)
export const overlay = () => document.getElementById('overlay') as HTMLDivElement;

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
  return hud;
}

export const hudButtons = () => build().tr;
export const hudBottomRight = () => build().br;
export const hudBottomLeft = () => build().bl;
export const hudToasts = () => build().tc;

// Room names and moods for the HUD and nameplates; Phase 5 fills these from the rooms table.
type RoomInfo = { name: string; mood: Mood | null };
let roomInfo = (zone: Zone): RoomInfo => ({ name: zone === 'hallway' ? 'Hallway' : `Room ${Number(zone.slice(-2))}`, mood: null });
export function setRoomInfo(f: (zone: Zone) => RoomInfo) {
  roomInfo = f;
}
export const zoneLabel = (zone: Zone | null) => (zone ? roomInfo(zone).name : '');

// The where-am-I pill. `sub` is the head count ("4 in the house" / "2 here") or "Connecting…"/"Offline".
export function showWhere(zone: Zone | null, sub: string, state: 'ok' | 'warn' | 'off') {
  const { pill } = build();
  const inRoom = !!zone && zone !== 'hallway';
  const info = zone ? roomInfo(zone) : { name: '', mood: null };
  const place = document.createElement('span');
  place.id = 'where-zone';
  place.textContent = info.name || 'Diesel House';
  const status = document.createElement('span');
  status.className = 'dh-sub';
  status.id = 'status';
  const parts: Node[] = [icon(inRoom ? 'door-open' : 'house'), place];
  if (inRoom && info.mood) {
    const [ic, label] = MOODS[info.mood];
    const badge = document.createElement('span');
    badge.className = 'dh-mood';
    badge.dataset.mood = info.mood;
    badge.append(icon(ic), label);
    parts.push(badge);
  }
  if (!inRoom || state !== 'ok') {
    const dot = document.createElement('span');
    dot.className = `dh-dot dh-dot--${state}`;
    status.append(dot, ' ');
  }
  status.append(sub);
  parts.push(status);
  pill.replaceChildren(...parts);
}
