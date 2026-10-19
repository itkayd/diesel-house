import { icon } from './icons';
import { el, openModal } from './modal';

// Credits (ASSETS.md), reachable from settings. OpenMoji's CC BY-SA licence requires the credit and a link.
const CREDITS: [string, string, string, string][] = [
  ['Modern Interiors', 'LimeZu', 'Floors, walls and furniture. Free version, non-commercial use.', 'https://limezu.itch.io/moderninteriors'],
  ['Roguelike Indoors', 'Kenney', 'Extra props. CC0.', 'https://kenney.nl/assets/roguelike-indoors'],
  ['Pixel Interior LRK', 'bitglow', 'Bookcases, sofas, fireplaces, tables, rugs, lamps and plants in the new house.', 'https://bitglow.itch.io/pixelinterior-livingroomkitchen'],
  ['Cozy Interior 165+', 'Sleepless Poetry', 'The café counter, coffee maker, fridges, TV and speakers.', 'https://sleepless-poetry.itch.io/cozy-interior-165-pixel-art-furniture-assets'],
  ['Ninja Adventure', 'pixel-boy', 'Every character and their faces, the animals and pets, plus the garden: grass, trees, pond, fire pit and lanterns. CC0.', 'https://pixel-boy.itch.io/ninja-adventure-asset-pack'],
  ['Disco music', 'ansimuz', 'Sun Tribe, Determination and Ghost Town chiptunes on the jukebox. CC0.', 'https://opengameart.org/content/top-down-adventure-assets'],
  ['Assorted Disco', 'Michael Muirden', 'The glitter ball. CC0.', 'https://opengameart.org/node/31404'],
  ['Sound packs', 'Kenney', 'RPG Audio, Interface Sounds, Digital Audio, Music Jingles and Casino Audio. CC0.', 'https://kenney.nl/assets/category:Audio'],
  ['Game art', 'Kenney', 'Emotes, Playing Cards (with dice), UI Pack Pixel Adventure and Input Prompts. CC0.', 'https://kenney.nl/assets'],
  ['Retro Video Game Sound Effects', 'Juhani Junkala', 'The Essential Retro Video Game Sound Effects Collection (512 sounds). CC0.', 'https://opengameart.org/content/512-sound-effects-8-bit-style'],
  ['SoundPack01', 'OpenGameArt', 'Level-up, power-up and coin sounds. CC0.', 'https://opengameart.org'],
  ['Pixel medals', 'OpenGameArt', 'Badges. CC0.', 'https://opengameart.org'],
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
  x.style.cssText = 'width:44px;height:44px';
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
  panel.append(head, list, el('small', 'dh-lede', 'Made for friends; not for sale.'));
}
