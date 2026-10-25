// Bundle budget (UX-RULES U6): fails if a part of the built site grows past its limit (gzip sizes, what a
// phone downloads). Run after `npm run build`: `npm run budget`. Raise a limit only on purpose.
//   front door: what the login screen needs (entry script, stylesheets, fonts), so it shows within ~2 s on 4G
//   game: Phaser + the house code, fetched after the login screen is up (or straight away when signed in)
//   images: the pictures the house loads at start
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const KB = 1024;
const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
const gz = (f) => gzipSync(readFileSync(join(dir, f))).length;
const raw = (p) => statSync(p).size;
const sum = (names, size = gz) => names.reduce((n, f) => n + size(f), 0);
const like = (re) => files.filter((f) => re.test(f));

const html = readFileSync('dist/index.html', 'utf8');
const entry = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const fonts = like(/\.woff2$/).filter((f) => /pixelify-sans-latin-(500|700)|atkinson-hyperlegible-latin-(400|700)/.test(f));

const checks = [
  ['front door: entry scripts + stylesheets', sum(entry), 60 * KB],
  ['front door: fonts (4 × latin woff2)', sum(fonts, (f) => raw(join(dir, f))), 80 * KB],
  ['game: Phaser', sum(like(/^phaser-.*\.js$/)), 330 * KB],
  ['game: house code', sum(like(/^game-.*\.js$/)), 110 * KB],
  ['game: games panel', sum(like(/^controller-.*\.js$/)), 45 * KB],
  ['images: skins + faces + furniture (webp)', ['public/assets/characters/skins.webp', 'public/assets/characters/faces.webp', 'public/assets/furniture/limezu_interiors.webp'].reduce((n, p) => n + raw(p), 0), 200 * KB],
];
let over = false;
for (const [name, size, limit] of checks) {
  const bad = size > limit;
  over ||= bad;
  console.log(`${bad ? 'OVER' : 'ok  '}  ${name}: ${(size / KB).toFixed(1)} kB of ${(limit / KB).toFixed(0)} kB`);
}
process.exit(over ? 1 : 0);
