import Phaser from 'phaser';
import houseMap from '../../maps/house.tmj?raw';
import { createCharacterAnims, loadCharacterSheets } from '../characters';
import { loadAnimals } from '../house/animals';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload() {
    this.load.image('limezu_room_builder', 'assets/tiles/limezu_room_builder.png');
    this.load.image('limezu_interiors', 'assets/furniture/limezu_interiors.png');
    // R3: the octagon house's extra tiles (grass, deck, hedge, skyline) and furniture (scripts/art/build_house_art.py).
    this.load.image('house_extra', 'assets/tiles/house_extra.png');
    this.load.image('house_v3', 'assets/furniture/house_v3.png');
    this.load.tilemapTiledJSON('house', JSON.parse(houseMap));
    loadCharacterSheets(this.load);
    loadAnimals(this.load);
    // v2 packs (UPDATE.md Phase 9, built by scripts/build-v2-assets.mjs): cards + dice, emotes, key/tap
    // prompts, and the pixel UI tiles.
    this.load.atlas('cards', 'assets/games/cards.png', 'assets/games/cards.json');
    this.load.atlas('emotes', 'assets/emotes/emotes.png', 'assets/emotes/emotes.json');
    this.load.atlas('prompts', 'assets/prompts/prompts.png', 'assets/prompts/prompts.json');
    this.load.spritesheet('ui_pack', 'assets/ui/ui-pack.png', { frameWidth: 16, frameHeight: 16 });
  }

  create() {
    createCharacterAnims(this.anims);
    this.scene.start('House');
  }
}
