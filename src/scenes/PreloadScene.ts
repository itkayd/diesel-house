import Phaser from 'phaser';
import houseMap from '../../maps/house.tmj?raw';
import { createCharacterAnims, loadCharacterSheets } from '../characters';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload() {
    this.load.image('limezu_room_builder', 'assets/tiles/limezu_room_builder.png');
    this.load.image('limezu_interiors', 'assets/furniture/limezu_interiors.png');
    this.load.image('kenney_indoor', 'assets/furniture/kenney_roguelike_indoor.png');
    this.load.tilemapTiledJSON('house', JSON.parse(houseMap));
    loadCharacterSheets(this.load);
  }

  create() {
    createCharacterAnims(this.anims);
    this.scene.start('House');
  }
}
