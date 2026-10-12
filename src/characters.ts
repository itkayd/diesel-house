import Phaser from 'phaser';

export type Dir = 'down' | 'left' | 'right' | 'up';
export const DIRS: Dir[] = ['down', 'left', 'right', 'up'];

export const CHARACTER_COUNT = 20; // 16 finalbossblues chibis (0-15) + 4 LimeZu (16-19); matches profiles.character_index

const LIMEZU = ['adam', 'alex', 'amelia', 'bob'];

// Frame source for one character: which texture + frame for each walk step and the idle pose.
type CharFrames = {
  walk: Record<Dir, { key: string; frame: number }[]>;
  idle: Record<Dir, { key: string; frame: number }[]>;
};

function chibi(index: number): CharFrames {
  // RPG Maker layout: 4x2 characters per sheet, each 3 frames wide, rows down/left/right/up.
  const key = index < 8 ? 'chibis_a' : 'chibis_b';
  const i = index % 8;
  const col0 = (i % 4) * 3;
  const row0 = Math.floor(i / 4) * 4;
  const f = (dirRow: number, step: number) => ({ key, frame: (row0 + dirRow) * 12 + col0 + step });
  const walk = {} as CharFrames['walk'];
  const idle = {} as CharFrames['idle'];
  DIRS.forEach((d, r) => {
    walk[d] = [0, 1, 2, 1].map((s) => f(r, s));
    idle[d] = [f(r, 1)];
  });
  return { walk, idle };
}

function limezu(index: number): CharFrames {
  // 24-frame strips, 6 per direction in the order right, up, left, down.
  const name = LIMEZU[index - 16];
  const order: Dir[] = ['right', 'up', 'left', 'down'];
  const walk = {} as CharFrames['walk'];
  const idle = {} as CharFrames['idle'];
  order.forEach((d, n) => {
    walk[d] = [0, 1, 2, 3, 4, 5].map((s) => ({ key: `limezu_${name}_run`, frame: n * 6 + s }));
    idle[d] = [0, 1, 2, 3, 4, 5].map((s) => ({ key: `limezu_${name}_idle`, frame: n * 6 + s }));
  });
  return { walk, idle };
}

export const characterFrames = (index: number) => (index < 16 ? chibi(index) : limezu(index));

export const animKey = (index: number, kind: 'walk' | 'idle', dir: Dir) => `char${index}-${kind}-${dir}`;

export function loadCharacterSheets(load: Phaser.Loader.LoaderPlugin) {
  const sheet = { frameWidth: 16, frameHeight: 32 };
  load.spritesheet('chibis_a', 'assets/characters/chibis_a.png', sheet);
  load.spritesheet('chibis_b', 'assets/characters/chibis_b.png', sheet);
  for (const n of LIMEZU) {
    load.spritesheet(`limezu_${n}_run`, `assets/characters/limezu_${n}_run.png`, sheet);
    load.spritesheet(`limezu_${n}_idle`, `assets/characters/limezu_${n}_idle.png`, sheet);
  }
}

export function createCharacterAnims(anims: Phaser.Animations.AnimationManager) {
  for (let i = 0; i < CHARACTER_COUNT; i++) {
    const c = characterFrames(i);
    for (const d of DIRS) {
      anims.create({ key: animKey(i, 'walk', d), frames: c.walk[d], frameRate: i < 16 ? 8 : 10, repeat: -1 });
      anims.create({ key: animKey(i, 'idle', d), frames: c.idle[d], frameRate: 8, repeat: -1 });
    }
  }
}

// The pose shown in the character picker.
export const portraitFrame = (index: number) => characterFrames(index).idle.down[0];

const STORAGE_KEY = 'diesel-house.character';

export function savedCharacter(): number | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    const n = v === null ? NaN : Number(v);
    return Number.isInteger(n) && n >= 0 && n < CHARACTER_COUNT ? n : null;
  } catch {
    return null;
  }
}

export function saveCharacter(index: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(index));
  } catch {
    // Private browsing: the choice just won't be remembered.
  }
}
