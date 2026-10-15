// Draws the app icon (a lit pixel house at night, 16x16) and writes PNGs for the PWA manifest and browsers.
// Run: node scripts/build-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const C = { '.': '#140f1c', E: '#0d0912', W: '#7a4b31', P: '#2b2034', L: '#f4b860', D: '#c9822f' };
const GRID = [
  '................',
  '................',
  '.......EE.......',
  '......EWWE......',
  '.....EWWWWE.....',
  '....EWWWWWWE....',
  '...EWWWWWWWWE...',
  '..EWWWWWWWWWWE..',
  '...EPPPPPPPPE...',
  '...EPLLPPLLPE...',
  '...EPLLPPLLPE...',
  '...EPPPDDPPPE...',
  '...EPPPDLPPPE...',
  '...EPPPDDPPPE...',
  '...EEEEEEEEEE...',
  '................',
];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const [r, g, b] = rgb(C[GRID[Math.floor((y * 16) / size)][Math.floor((x * 16) / size)]]);
      row.set([r, g, b], 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 176], ['favicon-32.png', 32]])
  fs.writeFileSync(`public/icons/${name}`, png(size));
console.log('icons written to public/icons/');
