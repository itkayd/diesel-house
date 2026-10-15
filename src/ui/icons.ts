import {
  BookOpen,
  Check,
  createElement,
  DoorOpen,
  Gamepad2,
  Hand,
  Headphones,
  House,
  Lock,
  LogOut,
  MessageCircleHeart,
  MessageSquare,
  Mic,
  MicOff,
  Moon,
  Music,
  Send,
  Settings,
  Sofa,
  UserRound,
  Volume1,
  Volume2,
  VolumeX,
  X,
  type IconNode,
} from 'lucide';

// Lucide icons used in the HUD (no emoji in the HUD, per NEXT.md).
const ICONS = {
  'book-open': BookOpen, check: Check, 'door-open': DoorOpen, 'gamepad-2': Gamepad2, hand: Hand, headphones: Headphones,
  house: House, lock: Lock, 'log-out': LogOut, 'message-circle-heart': MessageCircleHeart, 'message-square': MessageSquare,
  mic: Mic, 'mic-off': MicOff, moon: Moon, music: Music, send: Send, settings: Settings, sofa: Sofa, 'user-round': UserRound,
  'volume-1': Volume1, 'volume-2': Volume2, 'volume-x': VolumeX, x: X,
} satisfies Record<string, IconNode>;
export type IconName = keyof typeof ICONS;

export const icon = (name: IconName, attrs: Record<string, string | number> = {}) => createElement(ICONS[name], attrs);

// Room moods (rooms.mood) and door states (rooms.door_state), as in design/game/mvp.html.
export const MOODS = {
  gaming: ['gamepad-2', 'Gaming'],
  deeptalk: ['message-circle-heart', 'Deep talk'],
  music: ['music', 'Music'],
  study: ['book-open', 'Study'],
  chill: ['sofa', 'Chill'],
  dnd: ['moon', 'Do not disturb'],
} as const satisfies Record<string, [IconName, string]>;
export type Mood = keyof typeof MOODS;
export const MOOD_COLOURS: Record<Mood, string> = {
  gaming: '#7fb2ff', deeptalk: '#ff9fb2', music: '#c99bff', study: '#9be0a8', chill: '#7fd8d0', dnd: '#ff8f7a',
};
export const DOORS = { open: ['door-open', 'Open'], knock: ['hand', 'Knock'], locked: ['lock', 'Locked'] } as const satisfies Record<
  string,
  [IconName, string]
>;
export type DoorState = keyof typeof DOORS;

// An SVG icon as an <img>-loadable data URL (for drawing icons inside the Phaser world).
export function iconDataUrl(name: IconName, colour: string, size = 48) {
  const svg = icon(name, { width: size, height: size, stroke: colour, 'stroke-width': 3 }) as SVGElement;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
}
