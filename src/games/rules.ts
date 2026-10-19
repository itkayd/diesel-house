import { icon, type IconName } from '../ui/icons';
import { isTouchDevice } from '../ui/joystick';
import { el, openModal } from '../ui/modal';
import type { GameId } from './catalog';

// How to play every game, in plain words: one card per game (the goal, how a turn goes, how points
// work, and a tip or two). Shown three ways: folded into each game's lobby (open the first time you
// see that game), from the ? in the games panel, and as a handbook with a tab per game (from the house
// guide and Settings → More).

export type RulesId = GameId | 'nightraid';
export type Rules = { title: string; icon: IconName; players: string; time: string; goal: string; how: string[]; points: string[]; tips: string[] };

export function rulesFor(id: RulesId): Rules {
  const tap = isTouchDevice() ? 'Tap' : 'Click';
  const R: Record<RulesId, Rules> = {
    quiz: {
      title: 'Quiz night', icon: 'brain', players: '2–8', time: '3 min',
      goal: 'Answer general knowledge questions faster than everyone else.',
      how: ['A question shows with four answers, A to D.', `${tap} your answer within 15 seconds. Nobody sees what you picked until the reveal.`, 'The reveal shows the right answer and who picked what. 8 questions in a game.'],
      points: ['First right answer: 3 points. Second: 2. Every other right answer: 1.', 'Wrong or too slow: 0.'],
      tips: ['Speed only counts if you’re right, so don’t guess blind.'],
    },
    sketch: {
      title: 'Sketch & guess', icon: 'brush', players: '2–8', time: '5–8 min',
      goal: 'Draw so your friends guess the word, and guess theirs before anyone else.',
      how: ['Everyone takes a turn as the artist. The artist sees a secret word and draws it: no letters or numbers.', 'Everyone else types guesses into the box. Wrong guesses show for all; "So close!" means you’re one letter off.', 'Halfway through, the first letter appears. A drawing lasts 75 seconds, or until everyone has guessed.', 'Each player draws once (twice with 2 or 3 players).'],
      points: ['First right guess: 3 points. Second: 2. Everyone after: 1.', 'The artist gets 1 point for every right guess.'],
      tips: ['Draw the big shape first, details after.', 'Thick pen for outlines, colours to help (a red apple, a yellow banana). Clear starts again.'],
    },
    liars: {
      title: 'Liar’s dice', icon: 'dices', players: '2–6', time: '5–10 min',
      goal: 'Be the last player with dice left.',
      how: [
        'Everyone has 5 dice under a cup. Only you can see yours.',
        'Take turns to bid on how many of one face are on the whole table, for example "four 5s". 1s count as any face.',
        'Each bid must go up: more dice, or the same number of a higher face.',
        'Or call Liar! on the last bid. Everyone lifts their cup and the dice are counted.',
      ],
      points: ['If there are at least as many as the bid, the caller loses a die. If not, the bidder loses one.', 'Lose all 5 and you’re out. The loser starts the next round.'],
      tips: ['Count your own dice that match (plus your 1s), then guess about a third of everyone else’s.', 'Nobody can peek or change dice: each roll is sealed on your own phone.'],
    },
    letters: {
      title: 'Letter rush', icon: 'type', players: '2–8', time: '4 min',
      goal: 'Think of answers nobody else thought of.',
      how: ['A letter and four categories show (like "An animal" and "A food").', 'Write one answer for each, starting with that letter, within 60 seconds. Tap Done when you’re finished.', 'Then everyone’s answers show. Tap ✕ on any answer that doesn’t count, and Looks good when you’re happy. 3 rounds.'],
      points: ['A good answer nobody else had: 2 points. One someone else had too: 1.', 'Wrong letter, blank, or voted out by half the others: 0.'],
      tips: ['Go for the unusual answer: "Lynx" beats "Lion".', '"The" and "A" at the start don’t count as the first letter.'],
    },
    quickdraw: {
      title: 'Quick Draw', icon: 'zap', players: '2–8', time: '1 min',
      goal: 'Be the fastest to tap when DRAW! shows.',
      how: ['Everyone waits while the lamp flickers.', `When DRAW! appears, ${tap.toLowerCase()} as fast as you can.`, 'Tap too early and you’re out of that round. 5 rounds.'],
      points: ['Fastest: 3 points. Second: 2. Third: 1.'],
      tips: ['Your time starts when DRAW! shows on your own screen, so a slow connection doesn’t cost you.'],
    },
    higherlower: {
      title: 'Higher or lower', icon: 'arrow-up-down', players: '2–8', time: '3 min',
      goal: 'Bank the most points by guessing the next card.',
      how: ['Players take turns. A card is face up; guess whether the next one is higher or lower (aces are high).', 'Keep going for more, or bank your points and pass the turn. Up to 3 guesses a turn, 3 rounds.'],
      points: ['Right guesses in a row are worth 1, then 2, then 3.', 'A wrong guess loses everything from that turn. The same card is safe but scores nothing.'],
      tips: ['Near the middle (7 or 8)? Bank. Near the ends? Go for it.'],
    },
    wyr: {
      title: 'Would you rather', icon: 'messages-square', players: '2–8', time: '3 min',
      goal: 'Find out what your friends really think.',
      how: ['A question shows with two choices (or a hot take to agree or disagree with).', 'Everyone votes in secret, then the reveal shows who picked what. 5 questions.'],
      points: ['A point for being with the majority.'],
      tips: ['Best with 3 or more. Talk about the answers: that’s the fun.', 'Members can add the room’s own questions in Settings → Room (while you’re in that room).'],
    },
    four: {
      title: 'Four in a row', icon: 'grid-3x3', players: '2', time: '3 min',
      goal: 'Line up four of your pieces: across, down or diagonal.',
      how: ['Two players take turns to drop a piece into one of the 7 columns.', 'Pieces fall to the lowest free space. Everyone else at the table watches.'],
      points: ['First to make a line of four wins. A full board is a draw.'],
      tips: ['Take the middle column early. Block your friend when they have three.'],
    },
    dice: {
      title: 'Dice', icon: 'dice-5', players: '1+', time: 'seconds',
      goal: 'Roll dice for anything: who goes first, a dare, a bet.',
      how: ['Pick 1 to 3 dice and roll. The dice land over your head for everyone near you to see.', 'In a room’s chat, type /roll (or /roll 3, /roll 2d6, /roll d20).'],
      points: ['No points: just luck.'],
      tips: ['Doubles, triples and runs get a special shout.'],
    },
    rps: {
      title: 'Rock paper scissors', icon: 'swords', players: '2', time: '30 s',
      goal: 'Win a best of three duel.',
      how: ['Challenge someone near you (or tap any friend and pick Duel).', 'Both pick in secret. Picks are locked in before they’re shown, so nobody can wait and react.'],
      points: ['Rock beats scissors, scissors beat paper, paper beats rock. First to 2 wins.'],
      tips: ['The winner wears a crown for 30 seconds.'],
    },
    nightraid: {
      title: 'Night Raid (arcade)', icon: 'gamepad-2', players: '1', time: '2–5 min',
      goal: 'Defend the rooftop from waves of spooks and beat your best score.',
      how: [
        isTouchDevice() ? 'Drag left and right to move.' : 'Move with ← → or A and D. P or Esc pauses.',
        'Your shurikens throw themselves. Dodge the fireballs.',
        'Catch snacks for points, potions for magic shurikens and hearts for lives. Every 5th wave a Giant Spirit appears.',
        'Play at the arcade cabinets in the Gaming room, or Games → Night Raid at any table.',
      ],
      points: ['A new personal best (300 points or more): 50 XP. A new house record: 150 XP. Up to 3 paid bests a day.'],
      tips: ['Stay low and keep moving. Clear the fast bats first.'],
    },
  };
  return R[id];
}

// One game's rules as a card (for the lobby, the games panel and the handbook).
export function rulesCard(id: RulesId) {
  const r = rulesFor(id);
  const box = el('div', 'dh-rules');
  box.dataset.rules = id;
  const meta = el('div', 'dh-rules-meta');
  meta.append(chip('users', `${r.players} players`), chip('timer', r.time));
  box.append(el('p', 'dh-rules-goal', r.goal), meta, section('How to play', r.how, 'ol'), section('Points', r.points), section('Tips', r.tips));
  return box;
}

function chip(name: IconName, text: string) {
  const c = el('span', 'dh-rules-chip');
  c.append(icon(name, { width: 14, height: 14 }), document.createTextNode(text));
  return c;
}

function section(title: string, lines: string[], tag: 'ul' | 'ol' = 'ul') {
  const s = el('div', 'dh-rules-sec');
  const list = el(tag, '');
  for (const l of lines) list.append(el('li', '', l));
  s.append(el('div', 'dh-label', title), list);
  return s;
}

// "How to play" folded up in a game's lobby: open the first time you see that game.
const SEEN_KEY = 'diesel-house.rules-seen';
function seenRules(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function rulesFold(id: RulesId) {
  const d = el('details', 'dh-rules-fold');
  d.id = `rules-${id}`;
  const seen = seenRules();
  d.open = !seen.includes(id);
  const sum = el('summary', '');
  sum.append(icon('circle-help', { width: 16, height: 16 }), document.createTextNode('How to play'));
  d.append(sum, rulesCard(id));
  if (!seen.includes(id))
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id]));
    } catch {
      // private browsing: it opens each time
    }
  return d;
}

// The handbook: a tab for every game.
export const HANDBOOK: RulesId[] = ['quiz', 'sketch', 'liars', 'letters', 'quickdraw', 'higherlower', 'wyr', 'four', 'dice', 'rps', 'nightraid'];

export function openRules(start: RulesId = 'quiz') {
  const { panel, close } = openModal('rules', { dismissable: true, label: 'rules-title' });
  panel.classList.add('dh-guide', 'dh-rules-book');
  const head = el('div', 'v2-head');
  const h = el('h2', '', 'How to play');
  h.id = 'rules-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'rules-close';
  x.setAttribute('aria-label', 'Close');
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(icon('circle-help'), h, x);
  const tabs = el('div', 'dh-guide-chips');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Games');
  const body = el('div', 'dh-guide-body');
  const show = (id: RulesId) => {
    for (const t of tabs.children) {
      const on = (t as HTMLElement).dataset.rules === id;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', String(on));
      if (on) t.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    }
    const r = rulesFor(id);
    const top = el('div', 'dh-guide-head');
    const ico = el('span', 'dh-guide-ico');
    ico.append(icon(r.icon));
    top.append(ico, el('h3', 'dh-title', r.title));
    body.replaceChildren(top, rulesCard(id));
  };
  for (const id of HANDBOOK) {
    const t = el('button', 'dh-guide-chip', rulesFor(id).title);
    t.type = 'button';
    t.setAttribute('role', 'tab');
    t.dataset.rules = id;
    t.addEventListener('click', () => show(id));
    tabs.append(t);
  }
  panel.append(head, tabs, body);
  show(start);
}
