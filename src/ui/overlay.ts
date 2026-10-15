import type { Zone } from '../config';

// HUD skeleton (phone first):
//   top:    [● Room name · 3 here]                  [profile] [settings]
//   bottom: (joystick)                               [mic]
export const overlay = () => document.getElementById('overlay') as HTMLDivElement;

let els: { dot: HTMLSpanElement; zone: HTMLSpanElement; status: HTMLSpanElement; buttons: HTMLDivElement; bottomRight: HTMLDivElement } | null =
  null;

function hud() {
  if (els) return els;
  const top = document.createElement('div');
  top.id = 'hud-top';
  const pill = document.createElement('div');
  pill.className = 'dh-pill';
  pill.id = 'where';
  pill.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'dh-dot';
  const zone = document.createElement('span');
  zone.id = 'where-zone';
  const sep = document.createElement('span');
  sep.textContent = '·';
  sep.style.color = 'var(--muted)';
  const status = document.createElement('span');
  status.id = 'status';
  status.style.color = 'var(--muted)';
  pill.append(dot, zone, sep, status);
  const buttons = document.createElement('div');
  buttons.id = 'hud-buttons';
  top.append(pill, buttons);
  const bottomRight = document.createElement('div');
  bottomRight.id = 'hud-bottom-right';
  overlay().append(top, bottomRight);
  els = { dot, zone, status, buttons, bottomRight };
  return els;
}

export const hudButtons = () => hud().buttons;
export const hudBottomRight = () => hud().bottomRight;

// Room names shown in the HUD and on nameplates; Phase 5 fills these from the rooms table.
let roomName = (zone: Zone) => (zone === 'hallway' ? 'Hallway' : `Room ${Number(zone.slice(-2))}`);
export function setRoomNamer(f: (zone: Zone) => string) {
  roomName = f;
}
export const zoneLabel = (zone: Zone | null) => (zone ? roomName(zone) : '');

export function showZone(zone: Zone | null) {
  hud().zone.textContent = zoneLabel(zone);
}

// "3 here" / "5 in the house" / "Connecting…" / "Offline", with a coloured dot.
export function showStatus(text: string, state: 'ok' | 'warn' | 'bad') {
  const h = hud();
  h.status.textContent = text;
  h.dot.className = `dh-dot ${state}`;
}
