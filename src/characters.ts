import Phaser from 'phaser';
import data from './house/skins.json';

// Characters ("skins", REDESIGN.md R4 / STORE.md §3): Ninja Adventure 16 px people, one atlas built by
// scripts/build_skins.py. A skin is a key like 'ninja.boy', stored in profiles.character_key. The atlas
// lists its facings, so isometric skins (4 diagonal facings) can join later (REDESIGN.md §5 rule 7):
// code asks for "the frame facing this way", never fixed frame numbers.

export type Dir = 'down' | 'left' | 'right' | 'up';
export const DIRS: Dir[] = ['down', 'left', 'right', 'up'];

export type Skin = string;
export type Rarity = 'starter' | 'common' | 'rare' | 'epic';
export type SkinCategory = 'people' | 'ninja' | 'animal' | 'fantasy';
export type SkinDef = { key: Skin; name: string; cat: SkinCategory; rarity: Rarity; at: number };
type Anim = 'walk' | 'idle' | 'attack' | 'jump' | 'item';

export const SKINS: SkinDef[] = (data.skins as Omit<SkinDef, 'at'>[]).map((s, at) => ({ ...s, at }));
const BY_KEY = new Map(SKINS.map((s) => [s.key, s]));
export const skinDef = (key: Skin) => BY_KEY.get(key) ?? null;
export const DEFAULT_SKIN: Skin = 'ninja.boy';
// Free for everyone (the rest come with the shop, phase S2). Same list as public.starter_characters().
export const STARTERS: Skin[] = SKINS.filter((s) => s.rarity === 'starter').map((s) => s.key);
// Guests choose from two. Same list as public.guest_characters().
export const GUEST_SKINS: Skin[] = ['ninja.boy', 'ninja.woman'];
export const guestSkin = (s: Skin) => (GUEST_SKINS.includes(s) ? s : GUEST_SKINS[0]);

// Old character numbers (0-15 chibis, 16-19 LimeZu people) and the starter each became. Same table as
// public.character_from_index() (supabase/migrations/20261103_character_key.sql).
const LEGACY: Skin[] = [
  'ninja.boy', 'ninja.woman', 'ninja.villager', 'ninja.villager2', 'ninja.villager3', 'ninja.villager4',
  'ninja.princess', 'ninja.eskimo', 'ninja.child', 'ninja.oldman', 'ninja.villager5', 'ninja.villager6',
  'ninja.boy', 'ninja.woman', 'ninja.villager', 'ninja.villager2',
  'ninja.boy', 'ninja.villager3', 'ninja.woman', 'ninja.oldman',
];
// The number an older copy of the game shows for a skin (kept one release; anything but a starter: 0).
export const legacyIndex = (s: Skin) => Math.max(0, LEGACY.indexOf(s));
// Whatever arrives (a key, an old number, junk) as a skin we can draw.
export function asSkin(x: unknown): Skin {
  if (typeof x === 'string' && BY_KEY.has(x)) return x;
  if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < LEGACY.length) return LEGACY[x];
  return DEFAULT_SKIN;
}

// Atlas layout: each skin is a block of `facings` columns × `rows` rows of `cell` px frames.
const COLS = data.perRow * data.facings.length;
const frameOf = (s: SkinDef, anim: Anim, dir: Dir, step: number) => {
  const bx = s.at % data.perRow;
  const by = Math.floor(s.at / data.perRow);
  const row = (data.anims as Record<Anim, number[]>)[anim][step];
  return (by * data.rows + row) * COLS + bx * data.facings.length + data.facings.indexOf(dir);
};

export const animKey = (skin: Skin, kind: 'walk' | 'idle', dir: Dir) => `${skin}-${kind}-${dir}`;

export function loadCharacterSheets(load: Phaser.Loader.LoaderPlugin) {
  load.spritesheet('skins', 'assets/characters/skins.webp', { frameWidth: data.cell, frameHeight: data.cell });
  load.spritesheet('faces', 'assets/characters/faces.webp', { frameWidth: data.face, frameHeight: data.face });
}

export function createCharacterAnims(anims: Phaser.Animations.AnimationManager) {
  for (const s of SKINS)
    for (const d of DIRS) {
      anims.create({ key: animKey(s.key, 'walk', d), frames: data.anims.walk.map((_, i) => ({ key: 'skins', frame: frameOf(s, 'walk', d, i) })), frameRate: 8, repeat: -1 });
      anims.create({ key: animKey(s.key, 'idle', d), frames: [{ key: 'skins', frame: frameOf(s, 'idle', d, 0) }], frameRate: 1, repeat: -1 });
    }
}

// One frame of a skin (the picker's preview steps through walk, attack and jump).
export const skinFrame = (skin: Skin, anim: Anim, dir: Dir, step = 0) => ({ key: 'skins', frame: frameOf(skinDef(skin) ?? SKINS[0], anim, dir, step) });
export const walkSteps = data.anims.walk.length;
// The face (38 × 38 Faceset) for portraits.
export const faceFrame = (skin: Skin) => ({ key: 'faces', frame: (skinDef(skin) ?? SKINS[0]).at });
