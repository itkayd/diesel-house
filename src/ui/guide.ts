import { icon, type IconName } from './icons';
import { isTouchDevice } from './joystick';
import { el, openModal } from './modal';
import { hudButtons } from './overlay';
import { addSettingsSection } from './settings';
import { play } from './sounds';

// "How the house works": a short guide in a pop-up, step by step (friends were lost in the new house).
// Shown once, on your first visit after picking a character; open it again any time from the ? button
// or Settings → More. Every step can be skipped (Next), the whole guide too (Skip intro), and the topic
// chips at the top jump straight to any step.

const DONE_KEY = 'diesel-house.guide-done';

type Step = { id: string; icon: IconName; chip: string; title: string; lines: string[] };

function steps(): Step[] {
  const phone = isTouchDevice();
  return [
    {
      id: 'welcome', icon: 'house', chip: 'Welcome', title: 'Welcome to Diesel House',
      lines: [
        'A house to hang out in with friends: walk around, talk, play games.',
        'The Great Hall is in the middle. 7 rooms are around it, and they belong to everyone.',
        'This guide takes a minute. Skip any step, or skip it all. The ? button brings it back.',
      ],
    },
    {
      id: 'move', icon: 'footprints', chip: 'Moving', title: 'Walking around',
      lines: [
        phone ? 'Use the joystick at the bottom left to walk.' : 'Walk with WASD or the arrow keys, or hold the mouse where you want to go.',
        'The map button (top right) shows who’s where. Tap a room on it and you walk there by yourself.',
        'You arrive on the front porch, just below the Great Hall.',
      ],
    },
    {
      id: 'talk', icon: 'mic', chip: 'Talking', title: 'Talking in a room',
      lines: [
        'Walk into a room and you join its voice: everyone inside hears you.',
        'Walk out and the voice stops at once. Nobody outside can hear the room.',
        'The mic button (bottom right) mutes you. Push-to-talk is in Settings → Mic.',
        'Rooms have a chat too (the speech bubble button). It’s only for people in that room.',
      ],
    },
    {
      id: 'hall', icon: 'radio', chip: 'The hall', title: 'The Great Hall',
      lines: [
        'No room voice here. Stand close to someone to whisper: a purple circle shows your range.',
        `To talk to everyone in the hall, hold the walkie button${phone ? '' : ' (or T)'}.`,
        `The noticeboard on the back wall has this week’s leaderboard and challenges${phone ? '' : ' (stand at it and press E)'}.`,
      ],
    },
    {
      id: 'rooms', icon: 'door-open', chip: 'Rooms', title: 'The 7 rooms',
      lines: [
        'Garden (up from the hall): trees, a pond, a fire pit. The sky follows your clock.',
        'Library: a quiet room. People only hear you up close. A shared study timer sits on the desk.',
        'Disco: stand on the dance floor and you dance; the ♪ button is the jukebox. Gaming room: the big games table, and arcade cabinets for Night Raid (beat your best score for XP).',
        'Café: check the fridge for today’s special. Lounge: fireplace and games table. Rooftop: the city at night.',
      ],
    },
    {
      id: 'games', icon: 'dice-5', chip: 'Games', title: 'Playing games',
      lines: [
        `Walk to a table with a GAMES sign and ${phone ? 'tap Play games' : 'press E'}: Quiz night, Sketch & guess, Liar’s dice, Letter rush, Quick Draw, Higher or lower, Would you rather, Four in a row, dice and rock-paper-scissors.`,
        'Tables are in the hall, the Gaming room, the Café and the Lounge. The Garden’s picnic blanket has the games that need no table.',
        'Anywhere in the house: tap a friend and choose Duel for a quick rock-paper-scissors.',
      ],
    },
    {
      id: 'friends', icon: 'smile-plus', chip: 'Friends', title: 'Friends and emotes',
      lines: [
        'Tap a friend for their menu: send them an emote, start a duel, or change how loud they are.',
        phone ? 'The smiley button sends an emote everyone near you can see.' : 'The smiley button sends an emote; keys 1–6 are quick emotes, Q opens the menu for whoever is next to you.',
        'Faces on a door sign show who’s inside that room.',
      ],
    },
    {
      id: 'xp', icon: 'trophy', chip: 'XP', title: 'Challenges, XP and medals',
      lines: [
        'The trophy button has 3 daily and 3 weekly challenges. Each one gives XP.',
        'XP raises your level. Tap your XP chip (top left) for your profile, medals and streak.',
        'Little critters turn up around the house. Walk into one to catch it for XP.',
      ],
    },
    {
      id: 'rules', icon: 'scroll-text', chip: 'House rules', title: 'House rules',
      lines: [
        'Be kind. This is a house for friends.',
        'A door sign with a moon means "Do not disturb". If you go in anyway, keep it quiet. Anyone inside can turn the sign on (Settings → Room); it goes off when the room empties.',
        'The Library is for quiet talk.',
        'Mute when it’s noisy where you are.',
        'You can invite a guest with your guest code (in your profile). Share it privately; you look after your guests.',
      ],
    },
  ];
}

let open = false;

export function openGuide(start = 0) {
  if (open) return;
  open = true;
  const list = steps();
  let i = Math.max(0, Math.min(start, list.length - 1));
  const finish = () => {
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // not remembered in private browsing
    }
    open = false;
    close();
  };
  const { panel, close } = openModal('guide', { dismissable: true, onDismiss: finish, label: 'guide-title' });
  panel.classList.add('dh-guide');

  const chips = el('div', 'dh-guide-chips');
  chips.setAttribute('role', 'tablist');
  chips.setAttribute('aria-label', 'Topics');
  const body = el('div', 'dh-guide-body');
  body.setAttribute('aria-live', 'polite');
  const pips = el('div', 'dh-guide-pips');
  const skip = el('button', 'dh-btn dh-btn--quiet', 'Skip intro');
  skip.type = 'button';
  skip.id = 'guide-skip';
  const back = el('button', 'dh-btn dh-btn--quiet', 'Back');
  back.type = 'button';
  back.id = 'guide-back';
  const next = el('button', 'dh-btn');
  next.type = 'button';
  next.id = 'guide-next';
  const nav = el('div', 'dh-guide-nav');
  const right = el('div', 'dh-guide-nav-r');
  right.append(back, next);
  nav.append(skip, right);

  const chipEls = list.map((s, j) => {
    const c = el('button', 'dh-guide-chip', s.chip);
    c.type = 'button';
    c.setAttribute('role', 'tab');
    c.dataset.step = s.id;
    c.addEventListener('click', () => go(j));
    chips.append(c);
    return c;
  });

  const draw = () => {
    const s = list[i];
    body.textContent = '';
    const head = el('div', 'dh-guide-head');
    const ico = el('span', 'dh-guide-ico');
    ico.append(icon(s.icon));
    const title = el('h2', 'dh-title', s.title);
    title.id = 'guide-title';
    head.append(ico, title);
    const ul = el('ul', 'dh-guide-lines');
    for (const line of s.lines) ul.append(el('li', '', line));
    body.append(head, ul);
    chipEls.forEach((c, j) => {
      c.classList.toggle('on', j === i);
      c.setAttribute('aria-selected', String(j === i));
    });
    chipEls[i].scrollIntoView?.({ block: 'nearest', inline: 'center' });
    pips.textContent = `${i + 1} of ${list.length}`;
    back.hidden = i === 0;
    next.textContent = i === list.length - 1 ? 'Let’s go' : 'Next';
    skip.textContent = i === list.length - 1 ? 'Close' : 'Skip intro';
  };
  const go = (j: number) => {
    i = Math.max(0, Math.min(j, list.length - 1));
    play('click', 0.3);
    draw();
  };
  next.addEventListener('click', () => (i >= list.length - 1 ? finish() : go(i + 1)));
  back.addEventListener('click', () => go(i - 1));
  skip.addEventListener('click', finish);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Escape') finish();
    else return;
    e.preventDefault();
    e.stopPropagation(); // don't walk while reading
  });

  const foot = el('div', 'dh-guide-foot');
  foot.append(pips, nav);
  panel.append(chips, body, foot);
  draw();
  next.focus();
}

// The ? button in the HUD, the Settings entry, and the guide itself on a first visit.
let ready = false;
export function setupGuide(firstVisit: boolean) {
  if (ready) return;
  ready = true;
  const b = el('button', 'dh-iconbtn');
  b.type = 'button';
  b.id = 'guide-button';
  b.setAttribute('aria-label', 'How the house works');
  b.append(icon('circle-help'));
  b.addEventListener('click', () => openGuide());
  hudButtons().prepend(b);
  addSettingsSection(
    5,
    (box) => {
      const g = el('button', 'dh-btn dh-btn--quiet');
      g.type = 'button';
      g.id = 'settings-guide';
      g.append(icon('circle-help'), document.createTextNode('How the house works'));
      g.addEventListener('click', () => {
        document.getElementById('settings-sheet')?.remove();
        openGuide();
      });
      box.append(g);
      // Keyboard shortcuts (only worth showing with a keyboard).
      if (window.matchMedia('(pointer: fine)').matches) {
        const keys = el('div', 'dh-keys');
        keys.id = 'settings-keys';
        for (const [k, what] of [
          ['WASD / arrows', 'Walk'],
          ['E', 'Use what you’re next to (games, board, timer)'],
          ['Space', 'Push to talk (when it’s on)'],
          ['T', 'Walkie-talkie in the Great Hall (hold; change the key under Mic)'],
          ['1–6', 'Quick emotes'],
          ['Q', 'Menu for the friend next to you'],
          ['M', 'Who’s where'],
          ['Enter', 'Room chat'],
          ['Esc', 'Close'],
        ]) {
          keys.append(el('kbd', '', k), el('span', '', what));
        }
        box.append(el('div', 'dh-label', 'Keyboard shortcuts'), keys);
      }
    },
    false,
    'more',
  );
  let seen = false;
  try {
    seen = localStorage.getItem(DONE_KEY) === '1';
  } catch {
    // private browsing: show it
  }
  // Automated checks (navigator.webdriver) don't get it popping up over the house unless they ask (?guide).
  const robot = navigator.webdriver && !new URLSearchParams(location.search).has('guide');
  if (firstVisit && !seen && !robot) openGuide();
}
