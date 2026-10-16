import { icon } from './icons';
import { el } from './modal';
import { hudBottomRight, overlay } from './overlay';

// Emotes (UPDATE.md Phase 11, design/game/v2.html): Kenney Emotes, Pixel Style 1
// (public/assets/emotes/emotes.png, 16 px cells). Keys 1-6 send the first six.
export const EMOTES = [
  { id: 'faceHappy', label: 'Wave', x: 32, y: 16 },
  { id: 'laugh', label: 'Laugh', x: 16, y: 16 },
  { id: 'hearts', label: 'Love', x: 16, y: 48 },
  { id: 'question', label: 'Huh?', x: 0, y: 80 },
  { id: 'exclamation', label: 'Wow!', x: 32, y: 64 },
  { id: 'sleep', label: 'Zzz', x: 0, y: 64 },
  { id: 'music', label: 'Music', x: 16, y: 0 },
  { id: 'idea', label: 'Idea', x: 16, y: 32 },
  { id: 'stars', label: 'Stars', x: 0, y: 16 },
  { id: 'anger', label: 'Grr', x: 64, y: 48 },
] as const;
export type EmoteId = (typeof EMOTES)[number]['id'];
export const isEmote = (e: unknown): e is EmoteId => EMOTES.some((x) => x.id === e);
export const EMOTE_EVERY = 2000; // ms: one emote per person per 2 s

// A pixel emote as a DOM element (for the grids), `size` px square.
export function emoteIcon(id: EmoteId, size = 32) {
  const e = EMOTES.find((x) => x.id === id)!;
  const s = size / 16;
  const i = el('i', 'dh-emo');
  i.style.cssText = `width:${size}px;height:${size}px;background-image:url(assets/emotes/emotes.png);background-size:${80 * s}px ${96 * s}px;background-position:-${e.x * s}px -${e.y * s}px`;
  return i;
}

// The grid of emote buttons (friend menu and the emote bar).
export function emoteGrid(onPick: (id: EmoteId) => void) {
  const grid = el('div', 'v2-emogrid');
  EMOTES.forEach((e, n) => {
    const b = el('button');
    b.type = 'button';
    b.dataset.emote = e.id;
    b.setAttribute('aria-label', n < 6 ? `${e.label} (key ${n + 1})` : e.label);
    b.title = b.getAttribute('aria-label')!;
    b.append(emoteIcon(e.id));
    b.addEventListener('click', () => onPick(e.id));
    grid.append(b);
  });
  return grid;
}

// The emote button (bottom right) and its bar of emotes.
export class EmoteButton {
  private btn: HTMLButtonElement;
  private bar: HTMLDivElement | null = null;

  constructor(private send: (id: EmoteId) => void) {
    this.btn = el('button', 'dh-iconbtn');
    this.btn.type = 'button';
    this.btn.id = 'emote-button';
    this.btn.setAttribute('aria-label', 'Emotes');
    this.btn.append(icon('smile-plus'));
    this.btn.addEventListener('click', () => (this.bar ? this.close() : this.open()));
    hudBottomRight().prepend(this.btn);
  }

  private open() {
    this.bar = el('div', 'dh-panel v2-emotebar');
    this.bar.id = 'emote-bar';
    this.bar.append(
      emoteGrid((id) => {
        this.close();
        this.send(id);
      }),
    );
    overlay().append(this.bar);
    setTimeout(() => window.addEventListener('pointerdown', this.outside, true), 0);
  }

  private outside = (e: PointerEvent) => {
    if (this.bar && !this.bar.contains(e.target as Node) && !this.btn.contains(e.target as Node)) this.close();
  };

  close() {
    window.removeEventListener('pointerdown', this.outside, true);
    this.bar?.remove();
    this.bar = null;
  }
}
