import Phaser from 'phaser';
import data from './animals.json';

// Animals (REDESIGN.md R4): Ninja Adventure (CC0) animals, two side-view frames each (sitting, moving),
// facing right, in 24 px cells (scripts/build_animals.py). Some wander in the rooms that suit them; members
// can have one as a pet that follows them around (cosmetic only).

export type AnimalKey = string;
export const ANIMALS = data.animals as { key: AnimalKey; name: string }[];
const INDEX = new Map(ANIMALS.map((a, i) => [a.key, i]));
export const animalName = (key: AnimalKey) => ANIMALS[INDEX.get(key) ?? -1]?.name ?? '';
export const isAnimal = (key: unknown): key is AnimalKey => typeof key === 'string' && INDEX.has(key);
// Frame 0: sitting; 1: moving.
export const animalFrame = (key: AnimalKey, moving: boolean) => (INDEX.get(key) ?? 0) * 2 + (moving ? 1 : 0);
export const ANIMAL_CELL = data.cell;

export function loadAnimals(load: Phaser.Loader.LoaderPlugin) {
  load.spritesheet('animals', 'assets/animals/animals.png', { frameWidth: data.cell, frameHeight: data.cell });
}

// Who lives where (room id → animals). Same for everyone; each browser moves them about by itself (no
// network messages), so friends see the same animals in the same rooms, not always in the same spot.
export const AMBIENT: Record<string, AnimalKey[]> = {
  hallway: ['dog2', 'cat_white'],
  garden: ['frog', 'chicken', 'chick_brown', 'cow'],
  library: ['cat_black'],
  cafe: ['cat', 'hamster'],
  lounge: ['dog_yellow', 'cat_orange'],
  rooftop: ['parrot', 'parrot_red'],
  disco: ['monkey'],
  gaming: ['racoon', 'dog'],
};

// Pets: free for members from level PET_LEVEL (STORE.md: more pets come with the shop). Same list and
// level as public.free_pets() / profiles_check_pet().
export const PET_LEVEL = 3;
export const FREE_PETS: AnimalKey[] = ['cat', 'dog', 'hamster', 'chicken', 'frog'];
