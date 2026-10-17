import { el } from '../ui/modal';

// Game feel, shared by the table games, dice and duels: a little buzz on phones that can (Android; iPhones
// ignore it), "+2" floating up off a card or button, a burst of pixel confetti, and a draining timer bar.
// All of it is decoration: nothing here changes a game.

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A short vibration (ms, or a pattern). Quietly does nothing where phones don't support it.
export function buzz(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // some browsers throw when the page isn't focused
  }
}

const anchorOf = (target: Element) => {
  const r = target.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 3 };
};

// "+3", "Bust!" floating up from an element, fixed over everything (it survives the element being redrawn).
export function floatText(target: Element, text: string, kind: 'good' | 'bad' | 'gold' = 'gold') {
  if (!target.isConnected) return;
  const { x, y } = anchorOf(target);
  const f = el('div', `v2-fx-float ${kind}`, text);
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  f.setAttribute('aria-hidden', 'true');
  document.body.append(f);
  setTimeout(() => f.remove(), reduced() ? 700 : 1000);
}

// Pixel confetti bursting out of an element (a win, doubles, a catch).
export function burst(target: Element, n = 18) {
  if (!target.isConnected || reduced()) return;
  const { x, y } = anchorOf(target);
  const box = el('div', 'v2-fx-burst');
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.setAttribute('aria-hidden', 'true');
  const cols = ['#f4b860', '#ffd36b', '#6fdc8c', '#9ec9ff', '#ff9fb2', '#c99bff'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 40 + Math.random() * 50;
    const bit = el('i');
    bit.style.cssText = `background:${cols[i % cols.length]};--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d - 20)}px;animation-delay:${Math.random() * 0.08}s`;
    box.append(bit);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1100);
}

// A bar that drains over `ms` and turns red for the last few seconds. Purely a guide: the game's own
// timers decide what happens when it runs out.
export function timerBar(ms: number, id?: string) {
  const bar = el('div', 'v2-timer');
  if (id) bar.id = id;
  bar.setAttribute('aria-hidden', 'true');
  const fill = el('i');
  fill.style.animationDuration = `${ms}ms`;
  bar.append(fill);
  setTimeout(() => bar.classList.add('low'), Math.max(0, ms - 5000));
  return bar;
}

// Restart a one-shot CSS animation class on an element (shake, pop…).
export function kick(e: Element, cls: string) {
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}
