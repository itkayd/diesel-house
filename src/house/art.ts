import type Phaser from 'phaser';
import ART from './art/topdown.json';

// The top-down art table (REDESIGN.md §5 rule 4, built by scripts/art/build_house_art.py): which sheet and
// rectangle draws each kind of thing. Map furniture carries its rectangle already; this is for pieces the
// game places itself (the glitter ball, the café special…). In R6 an iso table sits beside it.

type Kind = { sheet: string; px: [number, number, number, number] };
const KINDS = ART.kinds as unknown as Record<string, Kind>;

// The texture and frame for a kind (the frame is added to the sheet the first time). Null if unknown.
export function artFrame(scene: Phaser.Scene, kind: string): { key: string; frame: string } | null {
  const k = KINDS[kind];
  if (!k || !scene.textures.exists(k.sheet)) return null;
  const tex = scene.textures.get(k.sheet);
  if (!tex.has(kind)) tex.add(kind, 0, k.px[0], k.px[1], k.px[2], k.px[3]);
  return { key: k.sheet, frame: kind };
}
