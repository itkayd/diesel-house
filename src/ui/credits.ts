import { icon } from './icons';
import { el, openModal } from './modal';

// Credits (ASSETS.md), reachable from settings. OpenMoji's CC BY-SA licence requires the credit and a link.
const CREDITS: [string, string, string, string][] = [
  ['Modern Interiors', 'LimeZu', 'Floors, walls, furniture and four characters. Free version, non-commercial use.', 'https://limezu.itch.io/moderninteriors'],
  ['Modern Chibis', 'finalbossblues', '16 characters from the Asset Alliance sprite collection.', 'https://finalbossblues.itch.io/16-char-sprite-collection-modern-chibis-asset-alliance'],
  ['Roguelike Indoors', 'Kenney', 'Extra props. CC0.', 'https://kenney.nl/assets/roguelike-indoors'],
  ['Lucide', 'Lucide contributors', 'Icons. ISC licence.', 'https://lucide.dev'],
  ['OpenMoji', 'HfG Schwäbisch Gmünd', 'Reaction emojis. CC BY-SA 4.0.', 'https://openmoji.org'],
  ['Fonts', 'Pixelify Sans, Atkinson Hyperlegible', 'SIL Open Font Licence.', 'https://fonts.google.com'],
];

export function openCredits() {
  const { panel, close } = openModal('credits', { dismissable: true, label: 'credits-title' });
  const head = el('div', 'dh-row');
  head.style.minHeight = '0';
  const title = el('h2', 'dh-title', 'Credits');
  title.id = 'credits-title';
  const x = el('button', 'dh-iconbtn');
  x.type = 'button';
  x.id = 'credits-close';
  x.setAttribute('aria-label', 'Close');
  x.style.cssText = 'width:36px;height:36px';
  x.append(icon('x'));
  x.addEventListener('click', close);
  head.append(title, x);

  const list = el('ul');
  list.style.cssText = 'list-style:none;margin:0;padding:0;display:grid;gap:10px';
  for (const [what, who, note, url] of CREDITS) {
    const li = el('li');
    const a = el('a', '', what);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.cssText = 'color:var(--lamp);font-family:var(--font-display)';
    li.append(a, el('span', '', ` by ${who}`), el('div', 'dh-lede', note));
    list.append(li);
  }
  panel.append(head, list, el('small', 'dh-lede', 'Sounds made for Diesel House with ElevenLabs. Made for friends; not for sale.'));
}
