import type Phaser from 'phaser';
import type { NetQuality } from '../net/netQuality';

// Tiny pixel icons for name tags (drawn in code, theme colours): a mic (on / muted / not working) and
// connection bars (1 red = poor, 2 amber = strong, 3 green = super strong).

export type MicIcon = 'on' | 'off' | 'warn';
const OK = '#6fdc8c';
const ERROR = '#ff8f7a';
const LAMP = '#f4b860';
const DIM = '#5a4d66';

const MIC = ['..###..', '..###..', '..###..', '#.###.#', '#.....#', '.#####.', '...#...', '..###..'];

function paint(scene: Phaser.Scene, key: string, w: number, h: number, draw: (px: (x: number, y: number, c: string) => void) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  const g = tex.getContext();
  draw((x, y, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, 1, 1);
  });
  tex.refresh();
}

export function makeTagIcons(scene: Phaser.Scene) {
  const mic = (key: string, colour: string, slash: boolean) =>
    paint(scene, key, 7, 8, (px) => {
      MIC.forEach((row, y) => [...row].forEach((c, x) => c === '#' && px(x, y, colour)));
      if (slash) for (let i = 0; i < 8; i++) px(Math.min(6, Math.round((i * 6) / 7)), i, '#ffffff');
    });
  mic('tag-mic-on', OK, false);
  mic('tag-mic-off', ERROR, true);
  mic('tag-mic-warn', LAMP, true);
  const bars = (key: string, lit: number, colour: string) =>
    paint(scene, key, 5, 7, (px) => {
      [3, 5, 7].forEach((h, i) => {
        for (let y = 7 - h; y < 7; y++) px(i * 2, y, i < lit ? colour : DIM);
      });
    });
  // Walkie-talkie over a talker's head: radio body, antenna, green LED.
  paint(scene, 'tag-radio', 7, 11, (px) => {
    const R = '#9ec9ff';
    for (let y = 0; y < 4; y++) px(5, y, R);
    for (let x = 1; x < 6; x++) {
      px(x, 4, R);
      px(x, 10, R);
    }
    for (let y = 4; y < 11; y++) {
      px(1, y, R);
      px(5, y, R);
    }
    px(3, 7, R);
    px(3, 8, R);
    px(2, 5, OK);
    px(3, 5, OK);
  });
  bars('tag-net-poor', 1, ERROR);
  bars('tag-net-strong', 2, LAMP);
  bars('tag-net-super', 3, OK);
}

export const micKey = (m: MicIcon) => `tag-mic-${m}`;
export const netKey = (q: NetQuality) => `tag-net-${q}`;
