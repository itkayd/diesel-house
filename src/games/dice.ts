import { el } from '../ui/modal';
import { icon } from '../ui/icons';
import { play } from '../ui/sounds';
import { cryptoInt } from './fair';
import { burst, buzz, kick } from './juice';

// Dice (UPDATE.md Phase 12): the Roll button in the games panel, or /roll and /roll 2d6 in room chat.
// The dice tumble (pixel dice from the cards pack), land over your head for everyone to see, and in a
// room the result goes into the chat as a system line. Casino dice sounds.

export type Roll = { n: number; sides: number; values: number[]; total: number };
export const MAX_DICE = 6;

// "/roll" (2 dice), "/roll 3", "/roll 2d6", "/roll d20". Null if it isn't a roll command.
export function parseRoll(text: string): { n: number; sides: number } | null {
  const m = text.trim().match(/^\/roll(?:\s+(\d*)(?:d(\d+))?)?\s*$/i);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : m[2] ? 1 : 2;
  const sides = m[2] ? Number(m[2]) : 6;
  if (n < 1 || n > MAX_DICE || sides < 2 || sides > 100) return null;
  return { n, sides };
}

export function roll(n = 2, sides = 6): Roll {
  const values = Array.from({ length: n }, () => cryptoInt(1, sides));
  return { n, sides, values, total: values.reduce((a, b) => a + b, 0) };
}

// The chat line: "rolled 2d6: 3 + 5 = 8".
export const rollText = (r: Roll) => `rolled ${r.n}d${r.sides}: ${r.values.length > 1 ? `${r.values.join(' + ')} = ${r.total}` : r.total}`;

// A pixel die (cards pack, 32 px cells at y 128: faces 1-6, then "?").
export function dieIcon(face: number | null, size = 44) {
  const i = el('i', 'v2-die');
  setFace(i, face, size);
  return i;
}
function setFace(i: HTMLElement, face: number | null, size: number) {
  const s = size / 32;
  const col = face && face >= 1 && face <= 6 ? face - 1 : 6;
  i.style.cssText = `width:${size}px;height:${size}px;background-image:url(assets/games/cards.png);background-size:${480 * s}px ${160 * s}px;background-position:-${col * 32 * s}px -${128 * s}px`;
}

// What a roll is called: "Snake eyes!", "Boxcars!", "Triples!", "Doubles!" (null for nothing special).
export function rollName(values: number[]) {
  if (values.length < 2) return null;
  const same = values.every((v) => v === values[0]);
  if (values.length === 2 && same) return values[0] === 1 ? 'Snake eyes!' : values[0] === 6 ? 'Boxcars!' : 'Doubles!';
  if (same) return values.length === 3 ? 'Triples!' : 'All the same!';
  const sorted = [...values].sort((a, b) => a - b);
  if (values.length >= 3 && sorted.every((v, i) => !i || v === sorted[i - 1] + 1)) return 'A run!';
  return null;
}

const COUNT_KEY = 'diesel-house.dice';
const savedCount = () => {
  try {
    const n = Number(localStorage.getItem(COUNT_KEY));
    return n >= 1 && n <= 3 ? n : 2;
  } catch {
    return 2;
  }
};
const SIZE = 56;
const COOLDOWN_MS = 1500; // the house only shows one roll every 1.5 s (HouseScene.rollDice)

// The dice panel: 1-3 dice (tap them or Roll), the total with a name for doubles and runs, and the last
// few rolls.
export function diceView(onRoll: (r: Roll) => void) {
  const root = el('div', 'v2-dicebox');
  let n = savedCount();

  const pick = el('div', 'v2-seg');
  pick.id = 'dice-count';
  pick.setAttribute('role', 'radiogroup');
  pick.setAttribute('aria-label', 'How many dice');
  const tray = el('button', 'v2-tray');
  tray.type = 'button';
  tray.id = 'dice-faces';
  tray.setAttribute('aria-label', 'Roll the dice');
  let faces: HTMLElement[] = [];
  const lay = () => {
    faces = Array.from({ length: n }, () => dieIcon(null, SIZE));
    tray.replaceChildren(...faces);
    pick.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.n) === n)));
  };
  for (const k of [1, 2, 3]) {
    const b = el('button', '', `${k} ${k === 1 ? 'die' : 'dice'}`);
    b.type = 'button';
    b.dataset.n = String(k);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      if (busy) return;
      n = k;
      try {
        localStorage.setItem(COUNT_KEY, String(k));
      } catch {
        // private mode: just this time
      }
      lay();
      play('click', 0.4);
    });
    pick.append(b);
  }

  const result = el('div', 'v2-result');
  result.id = 'dice-result';
  result.setAttribute('aria-live', 'polite');
  const hist = el('div', 'v2-dicehist');
  hist.id = 'dice-history';
  const btn = el('button', 'dh-btn');
  btn.type = 'button';
  btn.id = 'dice-roll';
  btn.append(icon('dice-5'), document.createTextNode('Roll'));
  const note = el('p', 'v2-note', 'Tap the dice or Roll. Everyone near you sees it; in a room it goes in the chat too (or type /roll 2d6 there).');

  let busy = false;
  const go = () => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    tray.disabled = true;
    const r = roll(n, 6);
    play('dice_shake', 0.8);
    buzz(15);
    result.textContent = '';
    result.className = 'v2-result';
    faces.forEach((f, i) => {
      f.classList.add('roll');
      f.style.animationDelay = `${i * 60}ms`;
    });
    const spin = setInterval(() => faces.forEach((f) => setFace(f, cryptoInt(1, 6), SIZE)), 80);
    setTimeout(() => {
      clearInterval(spin);
      faces.forEach((f, i) => {
        f.classList.remove('roll');
        setFace(f, r.values[i], SIZE);
        f.style.animationDelay = '';
        kick(f, 'land');
      });
      play('dice_throw', 0.8);
      const name = rollName(r.values);
      result.textContent = name ? `${r.total} · ${name}` : String(r.total);
      result.className = 'v2-result' + (name ? ' win' : '');
      kick(result, 'v2-pop');
      if (name) {
        burst(tray, 22);
        buzz([20, 30, 20]);
      }
      // The last 6 rolls, newest first.
      const chip = el('span', 'v2-xpchip' + (name ? ' hot' : ''), String(r.total));
      chip.title = r.values.join(' + ');
      hist.prepend(chip);
      while (hist.children.length > 6) hist.lastElementChild?.remove();
      btn.replaceChildren(icon('rotate-ccw'), document.createTextNode('Roll again'));
      onRoll(r);
    }, 900);
    setTimeout(() => {
      busy = false;
      btn.disabled = false;
      tray.disabled = false;
    }, COOLDOWN_MS);
  };
  tray.addEventListener('click', go);
  btn.addEventListener('click', go);
  lay();
  root.append(pick, tray, result, hist, btn, note);
  return root;
}
