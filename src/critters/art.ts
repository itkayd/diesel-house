// Pixel critters (12 x 12, drawn in code like the name-tag icons, in the house's palette). One letter per
// pixel; '.' is see-through. Used for the Phaser textures (src/scenes/critters.ts) and the little icons on
// the noticeboard and in toasts.

const P: Record<string, string> = {
  k: '#0d0912', // outline
  w: '#fff4e0', // cream
  o: '#f4a04a', // orange
  O: '#c96a2a', // dark orange
  g: '#b8aec4', // grey
  G: '#6e6280', // dark grey
  b: '#b07a45', // brown
  B: '#6b3f22', // dark brown
  y: '#ffd36b', // yellow
  Y: '#c9982f', // dark yellow
  p: '#ff9fb2', // pink
  n: '#7fd88c', // green
  N: '#3f9a5c', // dark green
  r: '#d94f4f', // red
  s: '#9ec9ff', // blue
  u: '#a07ad8', // purple
};

export const ART: Record<string, string[]> = {
  cat: [
    '..k......k..',
    '.kok....kok.',
    '.kook..kook.',
    '.koooooooook',
    'kooooooooook',
    'kokwkooowkok',
    'kookkoookkok',
    'koooopppoook',
    '.kooooooook.',
    '.kowoooowok.',
    '.koook.kook.',
    '..kkk...kkk.',
  ],
  dog: [
    '.kk......kk.',
    'kBBk....kBBk',
    'kBbbkkkkbbBk',
    'kBbbbbbbbbBk',
    '.kbwkbbwkbk.',
    '.kbkkbbkkbk.',
    '.kbbbkkbbbk.',
    '..kbbkkbbk..',
    '..kbbrrbbk..',
    '.kbbbbbbbbk.',
    '.kbbk..kbbk.',
    '..kk....kk..',
  ],
  duck: [
    '....kkkk....',
    '...kwwwwk...',
    '...kwkwwk...',
    '..kyykwwk...',
    '..kkyyywk...',
    '....kwwwk...',
    '..kkwwwwwkk.',
    '.kwwwwwwwwwk',
    '.kwwgwwwwwwk',
    '..kwwggwwwk.',
    '...kkkkkkk..',
    '....yk.yk...',
  ],
  frog: [
    '..kk....kk..',
    '.kwwk..kwwk.',
    '.kwkk..kwkk.',
    'knnnnnnnnnnk',
    'knnnnnnnnnnk',
    'knNkkkkkkNnk',
    '.knnnnnnnnk.',
    '.knnwwwwnnk.',
    'kNnnwwwwnnNk',
    'kNNnnnnnnNNk',
    '.kkNNk.kNNkk',
    '..kkk...kkk.',
  ],
  bunny: [
    '..kk....kk..',
    '.kwpk..kwpk.',
    '.kwpk..kwpk.',
    '.kwpk..kwpk.',
    '..kwkkkkwk..',
    '.kwwwwwwwwk.',
    '.kwkwwwwkwk.',
    '.kwwwppwwwk.',
    '..kwwwwwwk..',
    '.kwwwwwwwwk.',
    '.kwwk..kwwk.',
    '..kk....kk..',
  ],
  owl: [
    'kk........kk',
    'kBk......kBk',
    'kbbkkkkkkbbk',
    'kbwwwbbwwwbk',
    'kwyykwwkyywk',
    'kwykkwwkkywk',
    'kbwwwyywwwbk',
    'kbbbbyybbbbk',
    'kbBwbbbbwBbk',
    'kbbBwbbwBbbk',
    '.kbbbbbbbbk.',
    '..kykkkkyk..',
  ],
  fox: [
    'kk........kk',
    'kOk......kOk',
    'kowk....kwok',
    'koookkkkoook',
    'kooooooooook',
    'kokwoooowkok',
    'kookoooookok',
    '.kwwookwwwk.',
    '..kwwwwwwk..',
    '...kkwwkk...',
    '..kook..kook',
    '..kkk....kk.',
  ],
  medal: [
    '...kk..kk...',
    '...krkkrk...',
    '....krrk....',
    '....kkkk....',
    '...kyyyyk...',
    '..kyYyyYyk..',
    '.kyyywwyyyk.',
    '.kyywyywyyk.',
    '.kyyywwyyyk.',
    '..kyYyyYyk..',
    '...kyyyyk...',
    '....kkkk....',
  ],
};

export const ART_SIZE = 12;

// Paint a critter into a 2D context at (x, y), `scale` px per pixel.
export function paintCritter(g: CanvasRenderingContext2D, id: string, x = 0, y = 0, scale = 1) {
  const rows = ART[id];
  if (!rows) return;
  rows.forEach((row, r) =>
    [...row].forEach((c, col) => {
      const colour = P[c];
      if (!colour) return;
      g.fillStyle = colour;
      g.fillRect(x + col * scale, y + r * scale, scale, scale);
    }),
  );
}

// A crisp little canvas of a critter for the HUD (toasts, noticeboard).
export function critterIcon(id: string, size = 24) {
  const c = document.createElement('canvas');
  const scale = Math.max(1, Math.floor(size / ART_SIZE));
  c.width = c.height = ART_SIZE * scale;
  c.style.width = c.style.height = `${size}px`;
  c.style.imageRendering = 'pixelated';
  c.className = 'v2-critter';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', id);
  const g = c.getContext('2d');
  if (g) paintCritter(g, id, 0, 0, scale);
  return c;
}
