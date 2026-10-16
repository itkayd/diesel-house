import { el } from '../ui/modal';
import { icon } from '../ui/icons';
import { play } from '../ui/sounds';
import { cryptoInt } from './fair';

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

// The dice panel: two dice, Roll, and the last result.
export function diceView(onRoll: (r: Roll) => void) {
  const root = el('div', 'v2-dicebox');
  const dice = el('div', 'v2-dice');
  dice.id = 'dice-faces';
  const faces = [dieIcon(null), dieIcon(null)];
  dice.append(...faces);
  const result = el('div', 'v2-result');
  result.id = 'dice-result';
  const btn = el('button', 'dh-btn');
  btn.type = 'button';
  btn.id = 'dice-roll';
  btn.append(icon('dice-5'), document.createTextNode('Roll'));
  const note = el('p', 'v2-note', 'Everyone near you sees the roll. In a room it goes in the chat too (or type /roll 2d6 there).');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    const r = roll(2, 6);
    play('dice_shake', 0.8);
    faces.forEach((f) => f.classList.add('roll'));
    const spin = setInterval(() => faces.forEach((f) => setFace(f, cryptoInt(1, 6), 44)), 70);
    setTimeout(() => {
      clearInterval(spin);
      faces.forEach((f, i) => {
        f.classList.remove('roll');
        setFace(f, r.values[i], 44);
      });
      play('dice_throw', 0.8);
      result.textContent = r.values[0] === r.values[1] ? `${r.total} · doubles!` : String(r.total);
      result.className = 'v2-result' + (r.values[0] === r.values[1] ? ' win' : '');
      btn.disabled = false;
      btn.replaceChildren(icon('rotate-ccw'), document.createTextNode('Roll again'));
      onRoll(r);
    }, 900);
  });
  root.append(dice, result, btn, note);
  return root;
}
